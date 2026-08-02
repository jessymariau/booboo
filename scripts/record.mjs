#!/usr/bin/env node
// Record a page to a looping video via CDP screencast + ffmpeg.
//
//   node scripts/record.mjs <url> <out-basename> [--w 720] [--h 1280]
//                           [--secs 9] [--fps 24] [--settle 12000] [--crf 32]
//
// Why this exists: the mobile hero is a PRE-RENDERED LOOP, not live WebGL
// (GOALS G1). That decision closes three holes at once — mobile has no cosmos
// at all today, a weak GPU deep-linking the viewer is unguarded (GAPS C7), and
// the landing otherwise runs a second WebGL context purely for decoration.
//
// The loop is built by PING-PONG, and that is forced rather than chosen. The
// scene's own turn rate is a sum of incommensurate sines (`Spin` in
// Booboo.tsx: 0.065 + .085·sin(.047t) + .05·sin(.019t) + .025·sin(.101t)), so
// it never returns to its start — there is no revolution to cut on. Forward
// then reversed is seamless by construction, and at ~0.07 rad/s no viewer can
// tell which direction is "real".
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };
const [url, base] = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1] || "").startsWith("--"));
if (!url || !base) { console.error("usage: record.mjs <url> <out-basename> [--w][--h][--secs][--fps][--settle][--crf]"); process.exit(2); }

const W = +flag("w", 720), H = +flag("h", 1280);
const SECS = +flag("secs", 9), FPS = +flag("fps", 24);
const SETTLE = +flag("settle", 12000), CRF = +flag("crf", 32);
// --noloop: keep the arc instead of ping-ponging it. The reverse leg is right for
// an ambient hero (no revolution to cut on, see above) but nonsense for a piece
// that opens on the entrance sequence — it would rewind the reveal. --q raises
// screencast JPEG quality; 92 bands visibly on this scene's dark gradients.
const NOLOOP = args.includes("--noloop"), Q = +flag("q", 92);

const frames = mkdtempSync(join(tmpdir(), "booboo-rec-"));
const profile = join(frames, "profile");

const chrome = spawn(CHROME, [
  "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
  "--hide-scrollbars", "--enable-gpu", "--use-gl=angle", "--use-angle=gl-egl",
  "--window-size=" + W + "," + H, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const wsUrl = await new Promise((ok, no) => {
  let buf = ""; const t = setTimeout(() => no(new Error("no debug port")), 20000);
  chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); ok(m[0]); } });
});
const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));

let id = 0; const pending = new Map(); let onFrame = null;
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Page.screencastFrame" && onFrame) onFrame(m.params);
});
const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
  const i = ++id;
  pending.set(i, (m) => (m.error ? no(new Error(method + ": " + m.error.message)) : ok(m.result)));
  ws.send(JSON.stringify({ id: i, method, params, sessionId }));
});

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);

await S("Page.enable");
await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", { url });
await new Promise((r) => setTimeout(r, SETTLE));   // let the entrance sequence finish

let n = 0;
const want = SECS * FPS;
onFrame = async (p) => {
  if (n < want) writeFileSync(join(frames, String(++n).padStart(5, "0") + ".jpg"), Buffer.from(p.data, "base64"));
  try { await S("Page.screencastFrameAck", { sessionId: p.sessionId }); } catch {}
};
await S("Page.startScreencast", { format: "jpeg", quality: Q, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
await new Promise((r) => setTimeout(r, (SECS + 2) * 1000));
await S("Page.stopScreencast");
ws.close(); chrome.kill();

if (n < want * 0.6) throw new Error(`only ${n}/${want} frames — the scene is probably not rendering`);
console.log(`captured ${n} frames`);

mkdirSync(dirname(resolve(base)), { recursive: true });
// Ping-pong, then encode twice. The reverse leg drops the first and last frame
// so neither seam repeats a frame and stutters.
const vf = NOLOOP
  ? "format=yuv420p"
  : `format=yuv420p,split[a][b];[b]reverse,trim=start_frame=1:end_frame=${n - 1},setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1:a=0`;
const enc = (out, extra) => {
  const r = spawnSync(FFMPEG, [
    "-y", "-framerate", String(FPS), "-i", join(frames, "%05d.jpg"),
    "-filter_complex", vf, ...extra, "-an", resolve(out),
  ], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  if (r.status !== 0) throw new Error("ffmpeg failed for " + out + "\n" + (r.stderr || "").slice(-1500));
  console.log(out);
};
enc(base + ".mp4", ["-c:v", "libx264", "-crf", String(CRF), "-preset", "slow", "-movflags", "+faststart", "-profile:v", "main"]);
enc(base + ".webm", ["-c:v", "libvpx-vp9", "-crf", String(CRF + 4), "-b:v", "0", "-row-mt", "1"]);
// Poster: the video cannot paint before it loads, and a black rectangle behind
// the headline for even half a second is the exact "handed a black rectangle"
// failure the guard in main.js exists to prevent.
spawnSync(FFMPEG, ["-y", "-i", join(frames, "00001.jpg"), "-q:v", "6", resolve(base + ".jpg")], { stdio: "ignore" });
console.log(base + ".jpg");

rmSync(frames, { recursive: true, force: true });
