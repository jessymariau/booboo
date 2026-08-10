/* Booboo — the Descent driver.
 *
 * Ported out of Framer 2026-08-10. In Framer this was three code components
 * (DescentTunnel, BoobooViewer, DescentHUD) each running its OWN rAF loop and
 * each recomputing scroll progress from the same document. That worked, but it
 * carried a coupling class the file headers had to keep warning about: `tailVh`
 * had to be given the identical value in three places or the breadcrumb would
 * name a tier the graph was not showing. Here there is ONE loop and ONE progress
 * number, so the three surfaces cannot disagree by construction.
 *
 * Everything else is a faithful port. The tuned numbers below are measured, not
 * chosen, and the reasoning behind each one is kept with it.
 */

/* ══ THE COPY ENGINE ══
 *
 * Every frame sits at the same point on screen. One proxy value (`world`) is
 * scrubbed by scroll and each frame's scale/opacity/blur is purely a function of
 * `world - <its own index>`.
 *
 * THE TUNING IS NOT TASTE. FOUR ATTEMPTS, THREE OF THEM WRONG.
 * The reference engine is built for IMAGE frames, where overlap reads as depth.
 * Ported to TEXT it collides: two frames printed straight through each other.
 *
 *  ① Narrow the opacity windows → collision gone, screen went EMPTY at the
 *    crossover. Worse.
 *  ② The metric was the bug. Measuring min top-opacity across the WHOLE scroll
 *    includes the deliberate end-overrun, which pins it to 0 for every
 *    candidate. Re-measured over the narrative span only, and the result is
 *    structural: COLLISION AND MIN-TOP ARE THE SAME NUMBER, because at a
 *    symmetric crossfade the two curves cross at equal value by construction.
 *    OPACITY ALONE CANNOT SEPARATE THEM. Do not come back and re-tune A..D
 *    expecting a better answer on that axis.
 *  ③ Separate in SCALE and BLUR instead — departing big and soft, incoming small
 *    and crisp. Looked right standalone. Still overlapped on the live page.
 *  ④ What the standalone render hid: A FIXED PIXEL BLUR GETS PROPORTIONALLY
 *    WEAKER AS THE TYPE GROWS, so the departing frame became MORE readable as it
 *    flew at the reader. Blur is therefore MULTIPLIED BY SCALE, and the
 *    departing frame is knocked to 0.30 opacity, not 0.80.
 *
 * These five numbers move together. Do not nudge one alone.
 */
const A = -0.85, B = -0.35, C = 0.18, D = 0.80;
const PAST_ALPHA = 0.30;

const BASE = 3.4;        /* zoom base. Lower and the departing frame never gets
                            big enough to read as a wash, so it competes with
                            the incoming copy. */
const LEAD = 1.4;        /* overrun past the last frame, so you land in the paper
                            on pure graph rather than on a held sentence. */
const TAIL_VH = 1;       /* viewport-heights of non-descent content below the
                            last frame — the paper footer. Progress is mapped
                            across the whole document, so without this the
                            footer steals part of the descent. */
const EASE_COPY = 0.1;
const EASE_GRAPH = 0.07; /* deliberately slower than the copy: the graph settles
                            into each beat just behind the sentence. */

/* ⚠️ Duplicated in tunnel.css. Change both together. */
const STACK_BELOW = 810;

const frames = Array.from(document.querySelectorAll(".frame"));
const SPAN = Math.max(1, frames.length - 1 + LEAD);

/* ══ THE GRAPH ══
 *
 * 🔒 FRAME_BEAT is why the graph stopped lagging the copy. The tunnel has ELEVEN
 * copy frames; the graph has FIVE beats. Both read the same scroll, but each used
 * to map it through its OWN span — 11.4 against 4 — and those curves do not line
 * up. Measuring it showed 4 of the 11 frames naming a node the graph was not
 * showing. So the beat is no longer derived from a separate span: this maps each
 * copy frame to the beat that must be lit while it is on screen, and the tween
 * runs between the beats of ADJACENT FRAMES. The graph turns when the sentence
 * turns. Add or remove a frame in tunnel.html and you MUST update this array, or
 * it drifts again — silently, which is how it survived a whole build unnoticed.
 *
 *            frame: 0  1  2  3  4  5  6  7  8  9 10 */
const FRAME_BEAT = [0, 0, 0, 1, 1, 2, 2, 3, 4, 4, 4];

const LAYERS = ["gm", "executive", "staff", "ledger"];
const NUMERIC = ["peel", "orbit", "drift", "bloom", "cinematic", "lines", "flow", "nodeScale"];
/* platforms/rings/labels off: reintroducing platform discs is the old design
   coming back sideways. spines pinned 0. fog pinned 0 because FrontierFog still
   draws the old gaussian-blob nebula and at 0.10 floods the frame with blue and
   purple — a live defect, not a deletion. */
const CONSTANT = { platforms: false, rings: false, labels: false, spines: 0, fog: 0 };

/* Each beat carries a FULL profile and every numeric field is interpolated,
   including each band's own size, so the graph is continuously BECOMING the next
   state rather than snapping between two.
   NO BEAT ISOLATES LAYERS: the ledger alone is 2,717 of 2,839 nodes, so hiding
   it deletes the luminous seabed the whole direction rests on. Weight shifts via
   per-layer `sizes` instead.
   THE OPENING BEAT DELIBERATELY SELECTS NOTHING — a selection dims everything
   outside its neighbourhood to 12%, which is the wrong move on the beat whose
   claim is "everything". Do not add a `sel` to beat 0.
   AND DO NOT STACK DIMMERS: the torch does the focusing, `sizes` only nudges,
   and peel stays under ~2 on any beat that also carries a `sel`. */
const DESCENT = [
  { sel: null, peel: 1.4, orbit: 0, drift: 0.34, bloom: 0.75, cinematic: 1, lines: 0.24, flow: 0.9, nodeScale: 1, sizes: { gm: 1, executive: 1, staff: 1, ledger: 1 } },
  { sel: "standard", peel: 1.5, orbit: 0, drift: 0.3, bloom: 0.75, cinematic: 1, lines: 0.3, flow: 0.9, nodeScale: 1, sizes: { gm: 1, executive: 1, staff: 1, ledger: 1 } },
  { sel: "agent:housekeeping", peel: 1.7, orbit: 0, drift: 0.28, bloom: 0.75, cinematic: 1, lines: 0.5, flow: 1.1, nodeScale: 1, sizes: { gm: 1.05, executive: 1.15, staff: 0.95, ledger: 0.8 } },
  { sel: "agent:housekeeping-room-attendant-07", peel: 1.9, orbit: 0, drift: 0.3, bloom: 0.75, cinematic: 1, lines: 0.36, flow: 1.3, nodeScale: 1, sizes: { gm: 0.9, executive: 1, staff: 1.3, ledger: 0.95 } },
  /* peel COLLAPSES so floor and apex share the frame — the sentence made visual. */
  { sel: "obs:incident-room-407-leak", focus: "obs:incident-room-407-leak", peel: 1.15, orbit: 0, drift: 0.36, bloom: 0.9, cinematic: 1, lines: 0.62, flow: 1.6, nodeScale: 1, sizes: { gm: 0.9, executive: 0.9, staff: 1, ledger: 1.25 } },
];

/* THE FALL, in node radii. Under ~2.2r the camera sits INSIDE the 2,717-node
   ledger floor and the frame becomes a dim wash. The camera used to fly to the
   flagged node once and hold, which is a destination, not a descent — `dist`
   now ramps the whole way down. */
const DOLLY_FROM = 7, DOLLY_TO = 2.45, DOLLY_STEP = 0.02;
/* The crop is asymmetric, so the visual centre of what a reader can SEE is left
   of the iframe's own centre. bias carries that offset to the camera. */
const CROP_LEFT = 60, CROP_RIGHT = 440, FOCUS_X = 0.5;

const EMBED_TIMEOUT_MS = 9000;

const graph = document.getElementById("graph");
const brain = document.getElementById("brain");
const brainNote = document.getElementById("brainNote");
const hudRail = document.getElementById("hudRail");
const hudFill = document.getElementById("hudFill");
const depthNum = document.getElementById("depthNum");
const tiers = Array.from(document.querySelectorAll(".hud .tier"));

const viewerOrigin = new URL(brain.src, location.href).origin;

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const clampIx = (i) => Math.max(0, Math.min(frames.length - 1, i));
const smooth = (t) => t * t * (3 - 2 * t);

/* ── liveness ────────────────────────────────────────────────────────────── */
/* A BLOCKED FRAME FIRES NO ERROR: X-Frame-Options or a CSP gives a silent black
   rectangle. Time out and say so, with a way out. */
let ready = false;
const markLoaded = () => graph.classList.add("is-loaded");
brain.addEventListener("load", markLoaded);

/* AND THE RACE THE LOAD EVENT ALONE LOSES. The iframe is loading="eager" but
   this is a module script, so it is deferred — on a warm cache the frame can
   finish BEFORE the listener is attached, and a load event that has already
   fired never fires again. The graph then sits at opacity 0 behind a
   "would not embed" message while being perfectly loaded. Measured, not
   theorised: locally the frame reported readyState "complete" with a live
   canvas and zero console errors, and the class never landed.
   about:blank is also "complete", so it is excluded by name; a cross-origin
   frame throws here and correctly falls back to the load event. */
try {
  const d = brain.contentDocument;
  if (d && d.readyState === "complete" && d.URL !== "about:blank") markLoaded();
} catch { /* cross-origin — the load event is the only route, and it is enough */ }

setTimeout(() => {
  if (graph.classList.contains("is-loaded")) return;
  brainNote.innerHTML =
    'the live graph would not embed — <a href="./viewer/?file=/pemberton.booboo.json">open it directly</a>';
  brainNote.style.opacity = "0.7";
}, EMBED_TIMEOUT_MS);

window.addEventListener("message", (e) => {
  if (e.origin !== viewerOrigin) return;
  if (e.data && e.data.type === "booboo:ready") {
    ready = true;
    if (flat) driveGraph(0);   /* flat gets the profile once, not sixty times a second */
  }
});

/* ── flat ────────────────────────────────────────────────────────────────── */

const narrow = window.matchMedia(`(max-width: ${STACK_BELOW}px)`);
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
let flat = narrow.matches || calm.matches;
let raf = 0;

function clearInlineFrameStyles() {
  for (const el of frames) {
    el.style.opacity = "";
    el.style.visibility = "";
    el.style.transform = "";
    el.style.filter = "";
    el.style.willChange = "";
  }
}

function syncMode() {
  const next = narrow.matches || calm.matches;
  if (next === flat) return;
  flat = next;
  if (flat) {
    cancelAnimationFrame(raf);
    raf = 0;
    /* paint() left inline styles on the frames; the flat stylesheet cannot beat
       them, so hand the frames back to CSS. */
    clearInlineFrameStyles();
    if (hudRail) hudRail.style.opacity = "";
    if (ready) driveGraph(0);
  } else {
    start();
  }
}
narrow.addEventListener("change", syncMode);
calm.addEventListener("change", syncMode);

/* ── progress ────────────────────────────────────────────────────────────── */

function progress() {
  const doc = document.scrollingElement || document.documentElement;
  const y = window.scrollY || doc.scrollTop || 0;
  const max = doc.scrollHeight - window.innerHeight * (1 + TAIL_VH);
  return { y, max, p: max > 0 ? clamp(y / max) : 0 };
}

/* ── the copy ────────────────────────────────────────────────────────────── */

function paintFrames(world) {
  for (let i = 0; i < frames.length; i++) {
    const el = frames[i];
    const t = world - i;

    let op;
    if (t < A) op = 0;
    else if (t < B) op = (t - A) / (B - A);
    else if (t < C) op = 1;
    else if (t < D) op = 1 - (t - C) / (D - C);
    else op = 0;
    op = clamp(op);

    /* Cheap early-out doing real work: without it frame 0 at the end of the
       runway is asked for 3.4^11.4, a compositor bomb. It also keeps
       `will-change` OFF every frame that is not painting — only ~3 of 11 paint
       at once, so the other 8 promoted layers would be pure waste on a page
       already carrying a live WebGL iframe. */
    if (op <= 0.001) {
      if (el.style.visibility !== "hidden") {
        el.style.visibility = "hidden";
        el.style.opacity = "0";
        el.style.willChange = "auto";
      }
      continue;
    }
    if (el.style.visibility === "hidden" || el.style.visibility === "") {
      el.style.visibility = "visible";
      el.style.willChange = "transform, opacity, filter";
    }

    const sc = Math.pow(Math.max(1.05, BASE), t);
    const past = t > 0;
    const blur = past ? Math.min(26, t * 16 * sc) : (1 - op) * 3;
    el.style.opacity = String(op * (past ? PAST_ALPHA : 1));
    el.style.transform = `translate(-50%, -50%) scale(${sc.toFixed(4)})`;
    el.style.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : "none";
  }
}

/* ── the graph ───────────────────────────────────────────────────────────── */

let lastSig = "";
let lastSel;
let lastFocus = null;
let lastDist = NaN;

const beatFor = (frameIx) => DESCENT[Math.min(DESCENT.length - 1, FRAME_BEAT[clampIx(frameIx)])];

function sizesAt(a, b, t) {
  const out = {};
  for (const n of LAYERS) {
    const an = typeof a.sizes?.[n] === "number" ? a.sizes[n] : 1;
    const bn = typeof b.sizes?.[n] === "number" ? b.sizes[n] : an;
    out[n] = Math.round((an + (bn - an) * t) * 100) / 100;
  }
  return out;
}

function driveGraph(cur) {
  const win = brain.contentWindow;
  if (!win || !ready) return;

  /* World is measured in COPY FRAMES, which is the whole point of FRAME_BEAT. */
  const world = cur * SPAN;
  const fi = clampIx(Math.floor(world));
  const frac = smooth(clamp(world - fi));
  const nearest = beatFor(clampIx(Math.round(world)));
  const a = beatFor(fi);
  const b = beatFor(fi + 1);

  const cfg = { ...CONSTANT };
  for (const k of NUMERIC) {
    const av = a[k], bv = b[k];
    if (typeof av !== "number" && typeof bv !== "number") continue;
    const an = typeof av === "number" ? av : bv;
    const bn = typeof bv === "number" ? bv : an;
    cfg[k] = Math.round((an + (bn - an) * frac) * 100) / 100;
  }
  cfg.layers = Object.fromEntries(LAYERS.map((n) => [n, true]));
  cfg.sizes = sizesAt(a, b, frac);

  const sig = JSON.stringify(cfg);
  if (sig !== lastSig) {
    lastSig = sig;
    try { win.postMessage({ type: "booboo:cfg", cfg }, viewerOrigin); } catch { /* frame gone */ }
  }

  const wantSel = typeof nearest.sel === "string" ? nearest.sel : null;
  if (wantSel !== lastSel) {
    lastSel = wantSel;
    try { win.postMessage({ type: "booboo:sel", id: wantSel }, viewerOrigin); } catch { /* frame gone */ }
  }

  /* Target is whatever node this stretch is standing on; once the chain starts
     it never returns to nothing, because releasing focus mid-descent hands the
     camera back and the fall visibly stalls. */
  const chainNode =
    typeof nearest.focus === "string" ? nearest.focus :
    typeof nearest.sel === "string" ? nearest.sel :
    lastFocus;
  const dist = DOLLY_FROM + (DOLLY_TO - DOLLY_FROM) * cur;
  const movedEnough = !(Math.abs(dist - lastDist) < DOLLY_STEP);

  if (chainNode && (chainNode !== lastFocus || movedEnough)) {
    lastFocus = chainNode;
    lastDist = dist;
    const w = graph.clientWidth || 0;
    const cw = CROP_LEFT + w + CROP_RIGHT;
    const bias = cw > 0 ? (CROP_LEFT + FOCUS_X * w - cw / 2) / cw : 0;
    try { win.postMessage({ type: "booboo:focus", id: chainNode, dist, bias }, viewerOrigin); } catch { /* frame gone */ }
  }
}

/* ── the instrument ──────────────────────────────────────────────────────── */

let shownTier = -1;

function paintHud(p, y, max, world) {
  /* It retires when the descent does: a depth readout pinned at 100% over a
     paper footer is chrome that has stopped meaning anything, and its dark
     scrim would be sitting on a cream ground. */
  const tail = Math.max(0, TAIL_VH) * window.innerHeight;
  const past = tail > 0 ? clamp((y - max) / tail) : 0;
  hudRail.style.opacity = String(1 - past);

  hudFill.style.width = `${p * 100}%`;
  depthNum.textContent = String(Math.round(p * 100));

  /* THE TIER COMES FROM FRAME_BEAT, NOT FROM RAW PROGRESS. This file's header
     claims the three surfaces cannot disagree by construction; while the
     breadcrumb derived its own tier from a linear p that claim was false, and
     the reference build shows it: at p=0.60 the copy reads "03 · the shift"
     while the instrument lights "the department". The graph was already using
     beatFor(round(world)), so reading the same map here is what makes the
     sentence, the graph and the breadcrumb one number instead of three. */
  const idx = Math.min(tiers.length - 1, FRAME_BEAT[clampIx(Math.round(world))]);
  if (idx !== shownTier) {
    shownTier = idx;
    tiers.forEach((el, i) => el.classList.toggle("is-on", i === idx));
  }
}

/* ── the loop ────────────────────────────────────────────────────────────── */

let curCopy = 0;
let curGraph = 0;

function tick() {
  const { y, max, p } = progress();
  curCopy += (p - curCopy) * EASE_COPY;
  curGraph += (p - curGraph) * EASE_GRAPH;

  paintFrames(curCopy * SPAN);
  driveGraph(curGraph);
  paintHud(p, y, max, curCopy * SPAN);

  raf = requestAnimationFrame(tick);
}

function start() {
  if (raf) return;
  raf = requestAnimationFrame(tick);
}

if (!flat) start();
