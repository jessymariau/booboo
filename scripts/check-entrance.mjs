// The entrance check — headed + motion, the first four seconds of the product.
//
// Every capture in this project's history ran with --force-prefers-reduced-motion,
// which sets skip on frame 1 and photographs the SETTLED scene. The part a visitor
// actually judges — the wave igniting links at 0.9s, the field at 1.8s, the flags
// at 2.8s — had never once been under test, and a green golden says nothing about
// it (2026-08-03, task 281213e9). This check runs the real thing: a real visible
// window, motion on, and asserts BOTH that the entrance plays AND that it reaches
// the settled state on its own — the second half is what the wall-clock backstop
// in IntroDriver guarantees when frames starve.
//
// Headed means a display: this is a local rung like film.mjs, not a CI rung.
// Usage: node scripts/check-entrance.mjs [baseUrl]   (default: serve web/dist)
import { spawn } from "node:child_process";
import { launch, serveDir } from "./lib/cdp.mjs";

// Count lit pixels (luma > 40/255) via ffmpeg — the project's existing frame tool.
async function lit(png) {
  return new Promise((ok, no) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
    const out = [];
    ff.stdout.on("data", (d) => out.push(d));
    ff.on("error", no);
    ff.on("close", (code) => {
      if (code !== 0) return no(new Error("ffmpeg exit " + code));
      let n = 0;
      for (const buf of out) for (const b of buf) if (b > 40) n++;
      ok(n);
    });
    ff.stdin.end(png);
  });
}

const ext = process.argv[2];
const srv = ext ? null : await serveDir("web/dist");
const base = ext ?? srv.url;
const page = await launch({ width: 1200, height: 800, motion: true, headed: true });

let fail = null;
try {
  // goto's waitMs doubles as the "early" sampling point: ~1.2s after navigate the
  // wave is mid-flight (links up, field not yet — it ignites at uT 1.8).
  await page.goto(base + "/viewer/?file=/pemberton.booboo.json", 1200);
  const early = await lit(await page.shot());
  // 6.5s: entrance done at 3.6 on a healthy path, backstop at 4.5 on a starved one.
  await new Promise((r) => setTimeout(r, 5300));
  const late = await lit(await page.shot());

  console.log("lit pixels  early(~1.2s): " + early + "   late(~6.5s): " + late + "   ratio: " + (late / Math.max(1, early)).toFixed(2));

  // Floors seeded from observation on this rig, 2026-08-04 (RTX 4070 Ti, gl-egl):
  // early measured 43,791 (discs + mid-wave links), late 133,393 (field + glyphs +
  // flags), ratio 3.05. Floors sit far below so slower GPUs pass; the ratio is the
  // real assert.
  if (early < 5000) fail = "early frame near-black (" + early + ") — nothing rendered during the wave";
  else if (late < 40000) fail = "settled frame too sparse (" + late + ") — field/flags missing";
  else if (late < early * 1.8) fail = "late/early ratio " + (late / early).toFixed(2) + " — entrance did not visibly play (skipped or frozen)";
} finally {
  page.close();
  srv?.close();
}

if (fail) { console.error("ENTRANCE CHECK FAIL: " + fail); process.exit(1); }
console.log("entrance check OK — wave played and reached the settled scene");
