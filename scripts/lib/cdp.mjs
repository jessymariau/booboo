// Minimal CDP driver — launch headless Chrome, attach, evaluate, capture.
// No dependencies: Node 22+ ships a global WebSocket.
//
// Extracted rather than copied. Two files needed the same forty lines, and
// "two implementations of one fact" is this project's most repeated defect
// (GAPS C29 relTime, C33 the vendored index, C2 the memory alias) — every one
// of them found in production, none of them found by review.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);

// headed:true launches a REAL VISIBLE WINDOW. Headless is always "visible" to
// document.visibilityState, but it is not the path a visitor runs: a headless
// tab never gets occluded, never loses focus and never has rAF throttled by the
// compositor. The 2026-08-03 defect lived precisely in that gap, so the driver
// has to be able to open the window a person actually looks at.
export async function launch({ width = 1200, height = 630, dpr = 1, motion = false, touch = false, headed = false } = {}) {
  const profile = resolve(tmpdir(), "booboo-cdp-" + process.pid + "-" + Math.floor(performance.now()));
  let chrome, wsUrl, lastErr;

  for (const bin of CHROME_CANDIDATES) {
    try {
      chrome = spawn(bin, [
        ...(headed ? [] : ["--headless=new"]),
        "--remote-debugging-port=0",
        "--user-data-dir=" + profile,
        "--no-sandbox",                 // CI containers run as root
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        ...(motion ? [] : ["--force-prefers-reduced-motion"]),
        // THE ANGLE BACKEND IS A VERIFICATION VARIABLE, SO IT IS OVERRIDABLE.
        // gl-egl was pinned for headless stability, so every capture this project
        // has ever taken — shot, check-golden, capture, film, record — ran on it,
        // while real Chrome on Windows reports "ANGLE (NVIDIA ... Direct3D11,
        // D3D11)". That divergence was worth closing on principle, and it was the
        // fourth suspect for the 2026-08-03 defect where the node field and the
        // flags do not draw in Jesse's real Chrome. IT IS NOT THE CAUSE: gl-egl
        // and d3d11 render this scene IDENTICALLY and CORRECTLY here, verified
        // side by side at 1600x1000. Keep the flag anyway — a headless check that
        // cannot switch to the backend visitors use is a check with a blind spot,
        // and this one cost hours to rule out. BOOBOO_ANGLE=d3d11 to switch.
        "--enable-gpu", "--use-gl=angle", "--use-angle=" + (process.env.BOOBOO_ANGLE || "gl-egl"),
        "--window-size=" + width + "," + height,
        "about:blank",
      ], { stdio: ["ignore", "ignore", "pipe"] });

      wsUrl = await new Promise((ok, no) => {
        let buf = "";
        const t = setTimeout(() => no(new Error("no debug port from " + bin)), 20000);
        chrome.on("error", (e) => { clearTimeout(t); no(e); });
        chrome.stderr.on("data", (d) => {
          buf += d;
          const m = buf.match(/ws:\/\/[^\s]+/);
          if (m) { clearTimeout(t); ok(m[0]); }
        });
      });
      break;
    } catch (e) { lastErr = e; try { chrome?.kill(); } catch {} chrome = null; }
  }
  if (!wsUrl) throw new Error("could not start Chrome. Tried:\n  " + CHROME_CANDIDATES.join("\n  ") + "\n" + (lastErr?.message ?? ""));

  const ws = new WebSocket(wsUrl);
  await new Promise((ok, no) => {
    ws.addEventListener("open", ok, { once: true });
    ws.addEventListener("error", () => no(new Error("cdp socket failed")), { once: true });
  });

  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    for (const fn of listeners) fn(m);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, no) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? no(new Error(method + ": " + m.error.message)) : ok(m.result)));
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  await S("Page.enable");
  // A new target opens as a background tab, and a background tab has no rAF.
  if (headed) await S("Page.bringToFront");
  await S("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: touch });
  if (touch) {
    await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await S("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
  }

  return {
    S,
    on: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    async goto(url, waitMs = 6000) {
      await S("Page.navigate", { url });
      await new Promise((r) => setTimeout(r, waitMs));
      // A hidden tab suspends rAF, freezes GSAP mid-tween and serves stale
      // compositor frames, so nothing read from one is evidence. Headless is
      // always visible — assert it rather than assume it.
      const vis = await S("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true });
      if (vis.result.value !== "visible") throw new Error("page is " + vis.result.value + " — not evidence");
    },
    async eval(expression) {
      const r = await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error("eval threw: " + r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
      return r.result?.value;
    },
    async shot({ format = "png", quality, clip } = {}) {
      const r = await S("Page.captureScreenshot", {
        format, ...(quality ? { quality } : {}),
        // clip is in PAGE coordinates and ignores scroll — isolate a section
        // rather than scrolling to it (design/NEXT_SESSION.md).
        ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
      });
      return Buffer.from(r.data, "base64");
    },
    close() {
      try { ws.close(); } catch {}
      try { chrome.kill(); } catch {}
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    },
  };
}

// Tiny static file server, so a check can run against web/dist with no deps.
export async function serveDir(dir, port = 0) {
  const { createServer } = await import("node:http");
  const { readFile, stat } = await import("node:fs/promises");
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".svg": "image/svg+xml" };
  const srv = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let f = join(dir, p);
      if ((await stat(f).catch(() => null))?.isDirectory()) f = join(f, "index.html");
      const body = await readFile(f);
      res.writeHead(200, { "content-type": TYPES[f.slice(f.lastIndexOf("."))] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
  await new Promise((ok) => srv.listen(port, ok));
  return { url: "http://127.0.0.1:" + srv.address().port, close: () => srv.close() };
}
