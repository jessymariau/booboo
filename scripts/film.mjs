#!/usr/bin/env node
// Film a page deterministically: one rendered frame per output frame.
//
//   node scripts/film.mjs <url> <out-basename> [--w 1600] [--h 900]
//                         [--secs 24] [--fps 30] [--load 9000] [--crf 18]
//                         [--crop w:h:x:y] [--loop]
//
// Why this exists rather than record.mjs. That script screencasts in real time,
// which is correct for the mobile hero: it wants whatever the compositor happens
// to produce and encodes a short ambient loop. Measured on this scene at
// 1600x900 it delivers ~10fps regardless of JPEG quality (59/180 at q88, 0/180
// at q100) — CDP screencast is compositor-throttled, so a smooth showreel is not
// reachable that way at any setting.
//
// So time is driven instead of observed. rAF is replaced with a queue this
// script flushes once per frame, and performance.now()/Date.now() report virtual
// time, so frame n renders at exactly n/fps no matter how long the GPU took.
// Two consequences worth having: the output fps is exact, and the film is
// reproducible — re-run it after the graph changes and the reel regenerates
// rather than going stale.
//
// The scene's entrance (discs rise bottom-up, spines ignite top-down, field
// wakes from t=1.8s) is the subject here, so launch({motion:true}) is mandatory:
// the shared driver forces prefers-reduced-motion by default and Booboo.tsx
// skips the intro outright under it (`skip: !intro || !!reduced`).
//
// --loop, --crop and --skip make this script, not record.mjs, the tool for the
// mobile hero loop as of the direction-C redesign: that loop wants the wide
// composed aspect cropped to portrait, and at 1638x1280 screencast collapses to
// 8.4fps while this stays exact. --skip burns virtual time past the entrance,
// because an ambient loop containing the reveal rewinds it on every ping-pong.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { launch } from "./lib/cdp.mjs";
import { chain } from "./lib/vf.mjs";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };
const [url, base] = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1] || "").startsWith("--"));
if (!url || !base) { console.error("usage: film.mjs <url> <out-basename> [--w][--h][--secs][--fps][--load][--crf]"); process.exit(2); }

const W = +flag("w", 1600), H = +flag("h", 900);
const SECS = +flag("secs", 24), FPS = +flag("fps", 30);
const LOAD = +flag("load", 9000), CRF = +flag("crf", 18);
const CROP = flag("crop"), LOOP = args.includes("--loop"), SKIP = +flag("skip", 0);
const total = Math.round(SECS * FPS);

// Installed before any page script runs, so three's Clock and R3F's loop both
// read virtual time from their very first call.
const CLOCK = `(() => {
  let t = 0; let q = [];
  const realNow = Date.now();
  window.__vc = {
    step(dt) { t += dt; const due = q; q = []; for (const f of due) { try { f(t); } catch (e) {} } return due.length; },
    now: () => t,
    pending: () => q.length,
  };
  window.requestAnimationFrame = (f) => { q.push(f); return q.length; };
  window.cancelAnimationFrame = () => {};
  Object.defineProperty(window.performance, "now", { value: () => t, configurable: true });
  Date.now = () => realNow + t;
})();`;

const frames = mkdtempSync(join(tmpdir(), "booboo-film-"));
const b = await launch({ width: W, height: H, motion: true });   // intro dies under reduced-motion
try {
  await b.S("Page.addScriptToEvaluateOnNewDocument", { source: CLOCK });
  await b.S("Page.navigate", { url });

  // Let the app fetch its graph and mount. Time is held at 0 throughout: pumping
  // with dt=0 lets React commit and the canvas initialise without burning any of
  // the entrance, so frame 1 is genuinely t=0 of the sequence.
  const deadline = Date.now() + LOAD;
  while (Date.now() < deadline) {
    await b.eval("window.__vc && window.__vc.step(0)");
    await new Promise((r) => setTimeout(r, 50));
  }
  const ready = await b.eval("!!document.querySelector('canvas') && !!window.__vc");
  if (!ready) throw new Error("no canvas or no virtual clock — the viewer did not mount");

  const dt = 1000 / FPS;
  // Advance past the entrance before frame 1, in fps-sized slices so nothing in
  // the scene sees one impossible jump.
  for (let i = 0; i < Math.round(SKIP * FPS); i++) await b.eval(`window.__vc.step(${dt})`);
  for (let i = 1; i <= total; i++) {
    await b.eval(`window.__vc.step(${dt})`);
    writeFileSync(join(frames, String(i).padStart(5, "0") + ".png"), await b.shot({ format: "png" }));
    if (i % 60 === 0) process.stdout.write(`  ${i}/${total}\r`);
  }
  console.log(`\nrendered ${total} frames at ${FPS}fps`);

  // A frozen scene screenshots happily and encodes to a video nobody can tell is
  // dead until they watch it. Identical byte sizes across the arc means the clock
  // shim never reached the render loop.
  const sz = (i) => statSync(join(frames, String(i).padStart(5, "0") + ".png")).size;
  if (sz(1) === sz(Math.floor(total / 2)) && sz(1) === sz(total)) {
    throw new Error("frames 1, mid and last are byte-identical — scene is not animating");
  }
} finally { b.close(); }

mkdirSync(dirname(resolve(base)), { recursive: true });
const vf = chain({ crop: CROP, loopFrames: LOOP ? total : 0 });
const enc = (out, extra) => {
  const r = spawnSync(FFMPEG, [
    "-y", "-framerate", String(FPS), "-i", join(frames, "%05d.png"),
    "-filter_complex", vf, ...extra, "-an", resolve(out),
  ], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  if (r.status !== 0) throw new Error("ffmpeg failed for " + out + "\n" + (r.stderr || "").slice(-1500));
  console.log(out);
};
enc(base + ".mp4", ["-c:v", "libx264", "-crf", String(CRF), "-preset", "slow", "-movflags", "+faststart", "-profile:v", "high"]);
enc(base + ".webm", ["-c:v", "libvpx-vp9", "-crf", String(CRF + 6), "-b:v", "0", "-row-mt", "1"]);
// A showreel's poster is its last frame (the end card); a loop's is its FIRST,
// because that is the one the video paints when it starts and the poster sits
// underneath it until then.
spawnSync(FFMPEG, ["-y", "-i", join(frames, String(LOOP ? 1 : total).padStart(5, "0") + ".png"),
  ...(CROP ? ["-vf", "crop=" + CROP] : []), "-q:v", "3", resolve(base + ".jpg")], { stdio: "ignore" });
console.log(base + ".jpg");

rmSync(frames, { recursive: true, force: true });
