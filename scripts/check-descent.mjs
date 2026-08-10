#!/usr/bin/env node
// The descent check — the scroll MECHANIC under test, not the static render.
//
//   node scripts/check-descent.mjs [--base <url>] [--shots <dir>] [--json]
//                                  [--w 1440] [--h 900] [--mobile] [--poison]
//
// WHY THIS EXISTS. The tunnel was broken twice in one sitting on the live
// domain and both times every static check passed: curl returned 200, the page
// rendered correctly in a screenshot, the served bytes were identical to the
// working build (same ETag). What was broken was BEHAVIOUR — the fixed layers
// stopped pinning and scrolled away with the document — and nothing in the
// toolchain could see that, so it survived until Jesse scrolled the page by
// hand. A check that cannot fail on the defect you actually shipped is not a
// check. This one scrolls.
//
// It is deliberately written against the RENDERED page rather than against this
// repo's classes, so it runs unchanged on the original Framer build at
// contextual-booking-052776.framer.app. Diffing the two outputs is how the port
// was verified as faithful rather than merely as working.
//
// --poison reproduces the exact defect that broke it: a transform on an ancestor
// of the fixed layers, which creates a new containing block so position:fixed
// anchors to that ancestor's scrolling box instead of the viewport. Run it once
// and watch this fail; a check nobody has seen fail is a check nobody should
// trust.
//
// ⚠️ motion:true is load-bearing. lib/cdp.mjs defaults to reduced motion, which
// puts this page into its FLAT fallback — the run would photograph and measure
// the wrong page entirely and report a clean pass.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, serveDir } from "./lib/cdp.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };

const WIDTH = Number(opt("w", flag("mobile") ? 390 : 1440));
const HEIGHT = Number(opt("h", flag("mobile") ? 844 : 900));
const SHOT_DIR = opt("shots", null);
const POISON = flag("poison");
const MOBILE = flag("mobile");

// Sampled across the whole runway. The frame-centre positions are i/11.4 for
// frame i (span = 11 frames - 1 + 1.4 overrun), so 0.176 / 0.439 / 0.702 land
// ON a sentence and 0.307 / 0.57 land in a crossover, which is where the
// two-frames-at-once defect lived.
const POSITIONS = Array.from({ length: 21 }, (_, i) => Math.round(i * 0.05 * 1000) / 1000);
const SHOT_AT = new Set([0, 0.15, 0.3, 0.45, 0.6, 0.8, 0.9, 1]);

// SETTLING IS WAITED FOR, NOT GUESSED AT. The copy driver eases at 0.1 per
// FRAME, so how long it takes to converge is a function of the frame rate, and a
// headless tab under a live WebGL iframe does not run at 60. A fixed 2000ms wait
// sampled two builds mid-tween and produced a diff between them that was pure
// harness artifact — the numbers disagreed because one page was further through
// its own easing, not because the engines differ. Poll until the painted state
// stops moving instead.
const SETTLE_POLL_MS = 200;
const SETTLE_MAX_MS = 9000;

const SETTLE = `(async () => {
  const read = () => [...document.querySelectorAll("div")]
    .filter((el) => /translate\\(-50%, ?-50%\\) scale\\(/.test(el.style.transform))
    .map((el) => (parseFloat(el.style.opacity) || 0).toFixed(3) + el.style.transform)
    .join("|");
  let prev = read(), still = 0, waited = 0;
  while (waited < ${SETTLE_MAX_MS}) {
    await new Promise((r) => setTimeout(r, ${SETTLE_POLL_MS}));
    waited += ${SETTLE_POLL_MS};
    const now = read();
    if (now === prev) { if (++still >= 2) return { settled: true, waited }; } else still = 0;
    prev = now;
  }
  return { settled: false, waited };
})()`;

const PROBE = `(() => {
  const r = (el) => el ? el.getBoundingClientRect() : null;
  const box = (el) => { const b = r(el); return b ? { top: Math.round(b.top), left: Math.round(b.left), h: Math.round(b.height), w: Math.round(b.width) } : null; };

  // Find the tunnel frames by what they DO, not by a class name, so this probe
  // runs identically on the Framer build and on the port.
  const frames = [...document.querySelectorAll("div")]
    .filter((el) => /translate\\(-50%, ?-50%\\) scale\\(/.test(el.style.transform))
    .map((el, i) => {
      const m = el.style.transform.match(/scale\\(([\\d.]+)\\)/);
      const b = (el.style.filter || "").match(/blur\\(([\\d.]+)px\\)/);
      return {
        i,
        vis: el.style.visibility || "visible",
        op: Math.round((parseFloat(el.style.opacity) || 0) * 1000) / 1000,
        scale: m ? Math.round(parseFloat(m[1]) * 1000) / 1000 : 1,
        blur: b ? Math.round(parseFloat(b[1]) * 100) / 100 : 0,
        head: (el.querySelector("h2") || {}).textContent || "",
      };
    });
  const painted = frames.filter((f) => f.vis !== "hidden" && f.op > 0.001);

  // Every layer that must stay welded to the viewport while the document moves.
  // A fixed layer that has lost its containing block reports a top that tracks
  // scroll, which is the entire failure this file exists to catch.
  const fixed = [...document.querySelectorAll("body *")]
    .filter((el) => getComputedStyle(el).position === "fixed")
    .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 40 && b.height > 20; })
    .map((el) => ({ tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 40), ...box(el) }));

  const doc = document.scrollingElement || document.documentElement;
  return {
    y: Math.round(scrollY),
    docH: doc.scrollHeight,
    innerH: innerHeight,
    scrollW: doc.scrollWidth,
    innerW: innerWidth,
    painted,
    maxOp: painted.length ? Math.max(...painted.map((f) => f.op)) : 0,
    readable: painted.filter((f) => f.op > 0.35).length,
    fixed,
    hudFill: (document.querySelector(".hud-fill, [class*=fill]") || {}).style?.width ?? null,
    // NOT "does an iframe element exist" — that was the old test and it passed
    // while the graph was invisible. The frame is revealed by opacity once it
    // loads, so ASK WHETHER IT CAN BE SEEN. Implementation-agnostic on purpose:
    // it reads the same on the Framer build and on the port.
    graphVisible: (() => {
      const f = document.querySelector("iframe[src*=viewer]");
      if (!f) return null;
      for (let el = f; el && el !== document.body; el = el.parentElement) {
        if (Number(getComputedStyle(el).opacity) <= 0.01) return false;
      }
      return true;
    })(),
  };
})()`;

const srv = opt("base", null) ? null : await serveDir("web/dist");
const base = opt("base", null) ?? srv.url;
const page = await launch({ width: WIDTH, height: HEIGHT, motion: true, touch: MOBILE });

const errors = [];
page.on((m) => {
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
  } else if (m.method === "Runtime.exceptionThrown") {
    errors.push(m.params.exceptionDetails.exception?.description ?? "uncaught exception");
  }
});

const fail = [];
const rows = [];

try {
  await page.S("Runtime.enable");
  await page.goto(base, 7000);

  if (POISON) {
    // The 2026-08-10 defect, exactly: a transform on an ancestor of the fixed
    // layers. Everything still renders; only the mechanic dies.
    await page.eval(`document.body.style.transform = "translateZ(0)"; "poisoned"`);
  }

  if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

  // ASK THE PAGE WHERE ITS DESCENT ENDS, do not re-derive it. The port publishes
  // window.__descentMax because its footer is taller than one viewport, so the
  // old "docH - innerH * 2" would sample past the end and read the last few
  // positions off the footer instead of the tunnel. The fallback keeps this file
  // running unchanged against the Framer reference, whose tail really is one
  // viewport — which is the whole reason the two builds stay comparable.
  const geom = await page.eval(`(() => { const d = document.scrollingElement || document.documentElement; return { docH: d.scrollHeight, innerH: innerHeight, innerW: innerWidth, published: typeof window.__descentMax === "number" ? window.__descentMax : null }; })()`);
  const max = geom.published ?? geom.docH - geom.innerH * 2;

  for (const p of POSITIONS) {
    await page.eval(`scrollTo(0, ${Math.round(Math.max(0, max) * p)}); "ok"`);
    const settle = await page.eval(SETTLE);
    if (!settle.settled) fail.push(`the painted state never stopped moving at p=${p} after ${settle.waited}ms — measurements below are mid-tween`);
    const s = await page.eval(PROBE);
    rows.push({ p, ...s });

    if (SHOT_DIR && SHOT_AT.has(p)) {
      writeFileSync(join(SHOT_DIR, `p${String(p).replace(".", "_")}.png`), await page.shot());
    }
  }

  const narrative = rows.filter((r) => r.p > 0.02 && r.p < 0.88);

  if (MOBILE) {
    // Flat is not "the animation, off" — it is a different, readable page. The
    // frames must be in flow, all of them, with nothing hidden.
    const last = rows[rows.length - 1];
    if (last.painted.length) fail.push(`flat mode still painting ${last.painted.length} transformed frames — the driver is running below the breakpoint`);
    if (last.scrollW > last.innerW + 1) fail.push(`horizontal scroll at ${WIDTH}px: scrollWidth ${last.scrollW} > ${last.innerW}`);
  } else {
    // ── THE PIN. This is the one that matters.
    //
    // The invariant is not "top is 0" — the instrument is pinned to the BOTTOM,
    // so its top is legitimately ~830 and constant. What must never happen is a
    // fixed layer's viewport-relative top CHANGING as the document scrolls.
    // That is the signature of a lost containing block, and it is exactly what
    // both the proxy and the transform did.
    const track = new Map();
    for (const r of rows) for (const f of r.fixed) {
      const key = `${f.tag}.${f.cls}`;
      const t = track.get(key) ?? { min: Infinity, max: -Infinity };
      track.set(key, { min: Math.min(t.min, f.top), max: Math.max(t.max, f.top) });
    }
    for (const [key, t] of track) {
      const drift = t.max - t.min;
      if (drift > 2) fail.push(`fixed layer "${key}" moved ${drift}px through the scroll (top ${t.min}..${t.max}) — the scroll-pin is broken, which is the defect that shipped twice`);
    }
    if (track.size < 3) fail.push(`expected at least 3 fixed layers (graph, tunnel, nav); saw ${track.size}`);

    // ── THE MUSH TEST. The whole tuning exists to stop two frames being
    // readable at once; at a crossover the departing frame is knocked to 0.30
    // so it reads as texture and not as words.
    const mush = narrative.filter((r) => r.readable > 1);
    if (mush.length) fail.push(`two frames readable at once at p=${mush.map((r) => r.p).join(", ")} — the crossover is mush`);

    // ── AND THE OPPOSITE FAILURE, which is what narrowing the windows caused:
    // a crossover where the screen goes empty. 0.25 is measured off the
    // approved build, not chosen.
    const empty = narrative.filter((r) => r.maxOp < 0.25);
    if (empty.length) fail.push(`nothing legible at p=${empty.map((r) => r.p).join(", ")} (max opacity ${empty.map((r) => r.maxOp).join(", ")}) — the crossover is empty`);

    // ── The early-out is doing its job: only ~3 of 11 frames paint at once.
    const crowded = rows.filter((r) => r.painted.length > 3);
    if (crowded.length) fail.push(`${crowded[0].painted.length} frames painting at once at p=${crowded[0].p} — the early-out is not firing and 11 layers are promoted`);

    // ── The copy actually advances rather than sitting on one frame.
    const heads = new Set(narrative.flatMap((r) => r.painted.filter((f) => f.op > 0.5).map((f) => f.head)));
    if (heads.size < 6) fail.push(`only ${heads.size} distinct headlines became legible across the descent — the tunnel is not advancing`);

    const wide = rows.filter((r) => r.scrollW > r.innerW + 1);
    if (wide.length) fail.push(`horizontal scroll at ${WIDTH}px: scrollWidth ${wide[0].scrollW} > ${wide[0].innerW}`);
  }

  if (rows[0].graphVisible === null) fail.push("the graph iframe is not present");
  else if (!rows.some((r) => r.graphVisible)) fail.push("the graph iframe never became visible at any scroll position — it is loaded but held at opacity 0, which is what the load-event race did");
  if (errors.length) fail.push(`console errors: ${errors.slice(0, 3).join(" | ")}`);
} finally {
  page.close();
  srv?.close();
}

if (flag("json")) {
  console.log(JSON.stringify({ base, width: WIDTH, height: HEIGHT, poison: POISON, rows, fail }, null, 2));
} else {
  console.log(`\ndescent · ${base} · ${WIDTH}x${HEIGHT}${POISON ? " · POISONED" : ""}\n`);
  console.log("    p     y  painted  maxOp  readable  fixedTops  headline");
  for (const r of rows) {
    const top = r.painted.slice().sort((a, b) => b.op - a.op)[0];
    console.log(
      `${String(r.p).padStart(5)} ${String(r.y).padStart(6)} ${String(r.painted.length).padStart(7)} ` +
      `${r.maxOp.toFixed(2).padStart(6)} ${String(r.readable).padStart(9)} ${r.fixed.map((f) => f.top).join(",").padStart(10)}  ${(top?.head ?? "—").slice(0, 40)}`,
    );
  }
  console.log("");
  for (const f of fail) console.log(`✗ ${f}`);
  if (!fail.length) console.log(`✓ descent intact · ${rows.length} scroll positions · pin held · no mush, no empty crossover`);
  console.log("");
}

process.exit(fail.length ? 1 : 0);
