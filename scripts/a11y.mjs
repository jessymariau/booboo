#!/usr/bin/env node
// Accessibility probe over the live surfaces. Measurements, not opinions.
//
//   node scripts/a11y.mjs [--base https://booboo.fractionalhq.uk] [--json]
//
// Why measurements: design/GAPS.md has no a11y row at all, so the honest
// starting point is numbers nobody has to trust me for. Every finding below is
// a computed value read off the rendered page — contrast from real resolved
// colours, hit areas from real boxes — so a fix can be checked by re-running
// this rather than by looking again.
//
// It follows check-golden.mjs's shape (probe, compare, fail loudly) and imports
// lib/cdp.mjs rather than repeating it.
import { launch } from "./lib/cdp.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };
const BASE = flag("base", "https://booboo.fractionalhq.uk");

// Runs in the page. Contrast per WCAG 2.1: sRGB → linear → relative luminance.
const PROBE = `(() => {
  const lin = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  const lum = ([r,g,b]) => 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
  const parse = s => { const m = (s||"").match(/[\\d.]+/g); return m ? m.slice(0,4).map(Number) : null; };
  const ratio = (f, b) => { const L1 = lum(f), L2 = lum(b); const [a,z] = L1 > L2 ? [L1,L2] : [L2,L1]; return (a+0.05)/(z+0.05); };
  // Walk up for the first opaque background. A transparent parent chain ending
  // nowhere means the real backdrop is an image or a canvas, which is reported
  // rather than guessed at — that distinction is the whole point on this site.
  const bgOf = el => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && (c[3] === undefined || c[3] >= 0.95)) return { rgb: c.slice(0,3), from: e.tagName };
      const bi = getComputedStyle(e).backgroundImage;
      if (bi && bi !== "none") return { rgb: null, from: e.tagName + ":image" };
    }
    return { rgb: null, from: "none" };
  };
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };

  const textish = [...document.querySelectorAll("body *")].filter(el =>
    vis(el) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1));

  const contrast = [];
  for (const el of textish) {
    const s = getComputedStyle(el);
    const fg = parse(s.color); if (!fg) continue;
    const bg = bgOf(el);
    const px = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (!bg.rgb) { contrast.push({ text: el.textContent.trim().slice(0,42), px: +px.toFixed(1), ratio: null, need, over: bg.from }); continue; }
    const r = ratio(fg.slice(0,3), bg.rgb);
    if (r < need) contrast.push({ text: el.textContent.trim().slice(0,42), px: +px.toFixed(1), ratio: +r.toFixed(2), need, over: bg.from });
  }

  const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(vis);
  const unnamed = focusables.filter(el => {
    const n = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim();
    return !n && !el.querySelector("img[alt]:not([alt=''])");
  }).map(el => el.tagName + (el.className ? "." + String(el.className).slice(0,24) : ""));

  const small = focusables.map(el => { const r = el.getBoundingClientRect();
      return { el: el.tagName + (el.className ? "." + String(el.className).slice(0,20) : ""), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter(o => o.h < 24 || o.w < 24);

  const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(vis).map(h => +h.tagName[1]);
  const skips = []; for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i-1] > 1) skips.push(hs[i-1] + "->" + hs[i]);

  return {
    url: location.pathname, viewport: innerWidth + "x" + innerHeight,
    lang: document.documentElement.lang || null,
    title: document.title ? "present" : "MISSING",
    landmarks: { main: document.querySelectorAll("main").length, nav: document.querySelectorAll("nav").length, header: document.querySelectorAll("header").length },
    h1Count: document.querySelectorAll("h1").length, headingSkips: skips,
    imgsNoAlt: [...document.querySelectorAll("img")].filter(i => vis(i) && !i.hasAttribute("alt")).length,
    iframesNoTitle: [...document.querySelectorAll("iframe")].filter(f => !f.getAttribute("title")).length,
    iframeCount: document.querySelectorAll("iframe").length,
    focusableCount: focusables.length,
    unnamedFocusables: unnamed,
    smallHitAreas: small.slice(0, 8),
    contrastFailures: contrast.slice(0, 14),
    contrastFailCount: contrast.length,
  };
})()`;

const SURFACES = [
  { path: "/", w: 1440, h: 900 },
  { path: "/", w: 390, h: 844 },
  { path: "/chart/", w: 1440, h: 900 },
];

const out = [];
for (const s of SURFACES) {
  const b = await launch({ width: s.w, height: s.h, motion: true });
  try {
    await b.goto(BASE + s.path, 13000);
    const r = await b.eval(PROBE);
    out.push({ surface: `${s.path} @ ${s.w}x${s.h}`, ...r });
  } catch (e) {
    out.push({ surface: `${s.path} @ ${s.w}x${s.h}`, error: String(e.message || e) });
  } finally { b.close(); }
}

if (args.includes("--json")) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }

for (const r of out) {
  console.log("\n══ " + r.surface + " ══");
  if (r.error) { console.log("  ERROR " + r.error); continue; }
  console.log(`  lang=${r.lang ?? "MISSING"}  title=${r.title}  h1=${r.h1Count}  headingSkips=${r.headingSkips.join(",") || "none"}`);
  console.log(`  landmarks main/nav/header = ${r.landmarks.main}/${r.landmarks.nav}/${r.landmarks.header}`);
  console.log(`  iframes=${r.iframeCount} (untitled ${r.iframesNoTitle})  imgs missing alt=${r.imgsNoAlt}  focusables=${r.focusableCount}`);
  if (r.unnamedFocusables.length) console.log("  UNNAMED CONTROLS: " + r.unnamedFocusables.join(", "));
  if (r.smallHitAreas.length) console.log("  SMALL HIT AREAS: " + r.smallHitAreas.map(o => `${o.el} ${o.w}x${o.h}`).join(" · "));
  console.log(`  CONTRAST failures: ${r.contrastFailCount}`);
  for (const c of r.contrastFailures) {
    console.log(`    ${c.ratio ?? "over " + c.over} (needs ${c.need})  ${c.px}px  "${c.text}"`);
  }
}
