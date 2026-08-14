import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BNode, BOrg, BOrgAgent } from "@booboo-brain/spec";
import { orgBootSlice, relTime } from "@booboo-brain/spec";
import { PANEL_CSS } from "./panel-css";

// THE PANEL — Booboo's control plane. Five tabs over one org file + one
// snapshot: ORGANIGRAM (drag-drop hierarchy, the editable half), BUCKETS
// (memory by bucket), REPORTS (the portfolio timeline), RULES (who declares,
// who inherits), GRAPH (the real 3D viewer, embedded). Dossier-first;
// the graph is a lens, not the front door.
//
// EXPORTED as a mountable component: <Panel /> works standalone (same-origin
// /api/*), or a host injects its own backend via the `api` prop. The default
// is the original same-origin fetch, so standalone behaviour is unchanged.

export type ApiFn = (path: string, init?: RequestInit) => Promise<any>;

const defaultApi: ApiFn = (path, init) =>
  fetch(`/api${path}`, init).then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(b))));

const ApiCtx = createContext<ApiFn>(defaultApi);
const useApi = () => useContext(ApiCtx);

type Stats = { nodes: number; links: number; byLayer: Record<string, number> };
type Change = { key: string; id: string; kind: "added" | "removed" | "moved" | "edited"; label: string };

const TABS = [
  { id: "org", glyph: "⌂", label: "organigram" },
  { id: "buckets", glyph: "▤", label: "buckets" },
  { id: "reports", glyph: "⏱", label: "reports" },
  { id: "rules", glyph: "§", label: "rules" },
  { id: "graph", glyph: "◉", label: "graph" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// Timestamps vary by adapter — accept the common field names; "" = undated.
function nodeAt(n: BNode): string {
  const d = (n.data ?? {}) as Record<string, unknown>;
  for (const k of ["at", "ts", "time", "created_at", "date", "bst", "ts_bst", "finished_at"]) {
    const v = d[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

// ── HEALTH — reports are the heartbeat ─────────────────────────────────────
// Recency-weighted: the LATEST report decides the light. green: latest ok and
// fresh · amber: latest was a warn, or silent past ~2× cadence · red: latest
// failed · gray: never reported. Older failures inside the window never tint
// the light — they only add a subtle "recent instability" ring on the dot.
type Pulse = { lastAt: string; lastMs: number; lastStatus: string; n: number; fails: number };
type HealthMap = Map<string, Pulse>;
type Light = "ok" | "warn" | "fail" | "none";

// Parse a timestamp to epoch ms. Adapters emit ISO, epoch, or locale strings;
// compare on parsed TIME, never lexically (string ">=" mis-orders mixed formats).
function timeMs(at: string): number {
  if (!at) return NaN;
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : Number(at); // fall back to a bare epoch number if Date.parse fails
}

function buildHealthMap(nodes: BNode[]): HealthMap {
  const m: HealthMap = new Map();
  for (const r of nodes) {
    const who = reportAgentId(r);
    if (!who) continue;
    const d = (r.data ?? {}) as Record<string, unknown>;
    // Only rows with an explicit status are heartbeats. Close-notes/decisions
    // carry none — defaulting them to ok let one overwrite a run's verdict.
    if (typeof d.status !== "string") continue;
    const status = d.status;
    const at = nodeAt(r);
    const atMs = timeMs(at);
    const cur = m.get(who) ?? { lastAt: "", lastMs: -Infinity, lastStatus: "", n: 0, fails: 0 };
    cur.n++;
    if (status === "fail") cur.fails++;
    // Only a dated, newer row becomes the "latest": undated rows count but never
    // overwrite a real verdict, and the comparison is on parsed time not string order.
    if (Number.isFinite(atMs) && atMs >= cur.lastMs) { cur.lastMs = atMs; cur.lastAt = at; cur.lastStatus = status; }
    m.set(who, cur);
  }
  return m;
}

function pulseFor(a: BOrgAgent, health: HealthMap | null): Pulse | null {
  if (!health) return null;
  const keys = [a.id, ...(a.buckets ?? [])];
  let best: Pulse | null = null;
  for (const k of keys) {
    const p = health.get(k);
    if (p && (!best || p.lastMs > best.lastMs)) best = p;
  }
  return best;
}

/** Cadence in hours → the words a person would actually use. "expected every
 *  720h" is a machine talking to itself; the board is read by someone deciding
 *  whether silence is normal, and "monthly" answers that instantly. */
function everyN(h: number): string {
  if (h <= 1) return "hourly";
  if (h < 24) return `every ${h}h`;
  if (h === 24) return "daily";
  if (h === 168) return "weekly";
  if (h >= 672 && h <= 744) return "monthly";
  if (h % 24 === 0) return `every ${h / 24} days`;
  return `every ${h}h`;
}

function lightFor(a: BOrgAgent, health: HealthMap | null): Light {
  const p = pulseFor(a, health);
  if (!p || !p.lastAt) return "none";
  if (p.lastStatus === "fail") return "fail";
  const ageH = (Date.now() - p.lastMs) / 3600e3;
  const cadence = typeof a.cadence === "number" && a.cadence > 0 ? a.cadence : 26;
  if (ageH > cadence * 2) return "warn";
  if (p.lastStatus === "warn") return "warn";
  return "ok";
}

// Green but with failures earlier in the window — recovered, worth a glance.
function unstableFor(a: BOrgAgent, health: HealthMap | null): boolean {
  return lightFor(a, health) === "ok" && (pulseFor(a, health)?.fails ?? 0) > 0;
}

const worst = (ls: Light[]): Light =>
  ls.includes("fail") ? "fail" : ls.includes("warn") ? "warn" : ls.includes("ok") ? "ok" : "none";

function nodeSummary(n: BNode): string {
  const d = (n.data ?? {}) as Record<string, unknown>;
  for (const k of ["summary", "title", "detail"]) {
    const v = d[k];
    if (typeof v === "string" && v && v !== n.label) return v;
  }
  return "";
}

/** Which agent filed this report.
 *  `cluster` is the usual carrier, but house-level agents (the Executive) file
 *  with cluster null — those reports rendered as "unknown" in the timeline and
 *  vanished from the filer's own dossier, which is how the most important entry
 *  in the house ("Amended the House Standard § 14") ended up unattributed.
 *  Every report also carries `data.agent`; prefer cluster, fall back to it. */
function reportAgentId(n: BNode): string {
  const d = (n.data ?? {}) as Record<string, unknown>;
  return n.cluster || (typeof d.agent === "string" ? d.agent : "") || "";
}

// "What the agent closed" lives as type `report` — or `decision` in systems
// that record decisions. Both count; query both and merge, newest first.
// The server caps a page at 1000, so page by offset up to `limit` — truncation
// here once dropped the newest runs and froze stale FAIL lights on the chart.
async function fetchReports(api: ApiFn, cluster: string | null, limit = 500): Promise<{ total: number; nodes: BNode[] }> {
  const q = async (t: string) => {
    try {
      const base = `/nodes?type=${t}${cluster ? `&cluster=${encodeURIComponent(cluster)}` : ""}`;
      const first = await api(`${base}&limit=${limit}`);
      const nodes: BNode[] = first.nodes ?? [];
      const want = Math.min(first.total ?? 0, limit);
      while (nodes.length < want) {
        const page = await api(`${base}&limit=${limit}&offset=${nodes.length}`);
        if (!page.nodes?.length) break;
        nodes.push(...page.nodes);
      }
      return { total: first.total ?? 0, nodes };
    } catch { return { total: 0, nodes: [] as BNode[] }; }
  };
  const [r, d] = await Promise.all([q("report"), q("decision")]);
  const nodes = [...(r.nodes ?? []), ...(d.nodes ?? [])].sort((a: BNode, b: BNode) => nodeAt(b).localeCompare(nodeAt(a)));
  return { total: (r.total ?? 0) + (d.total ?? 0), nodes };
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const REDUCED = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Light / dark — dark by default, persisted, applied to <html data-theme> so the CSS vars swap.
const THEME_KEY = "booboo-theme-v2"; // v1 values were auto-written, see below

function readTheme(): "dark" | "light" {
  try {
    // Embedded in a light page (the landing), the board is ALWAYS light. A dark
    // board inside a white page is never what anyone wanted, and the iframe is
    // same-origin so it would otherwise inherit the host's stored preference.
    if (new URLSearchParams(window.location.search).get("embed")) return "light";
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch { return "light"; }
}
// `pinned` is the host's `theme` prop: a mounting app states the theme it wants
// and the panel obeys, with no toggle offered. Dionisos OS is a dark cockpit and
// pins dark; the demo leaves it unset and defaults light for strangers.
function useTheme(pinned?: "dark" | "light"): ["dark" | "light", (() => void) | null] {
  const [theme, setTheme] = useState<"dark" | "light">(readTheme);
  const chosen = useRef(false);
  useEffect(() => {
    if (pinned) return;
    // The theme now rides on the panel's OWN root element, not <html>. Writing
    // documentElement made a mounted component reach out and restyle its host's
    // document — and, worse, made the panel obey a host that happened to set
    // data-theme for its own reasons.
    // ONLY AN EXPLICIT TOGGLE PERSISTS. Writing on mount meant the DEFAULT
    // persisted itself: every visit while dark was the default silently stored
    // "dark", so the moment light became the default those visitors were pinned
    // to a preference they never chose — and the landing page's embedded board
    // rendered dark inside a white page. Hence the v2 key: values written by
    // the old mount-write are indistinguishable from a real choice, so they are
    // abandoned rather than trusted. Anyone who truly wants dark toggles once.
    if (!chosen.current) return;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  }, [theme, pinned]);
  if (pinned) return [pinned, null];
  return [theme, () => { chosen.current = true; setTheme((t) => (t === "dark" ? "light" : "dark")); }];
}

function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(REDUCED ? target : 0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (REDUCED) { setV(target); return; } // land instantly — also keeps screenshots honest
    const from = fromRef.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setV(Math.round(from + (target - from) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

// #/  ·  #/buckets  ·  #/buckets/<name>  ·  #/reports  ·  #/rules  ·  #/graph
function useRoute(): [TabId, string | null] {
  const parse = (): [TabId, string | null] => {
    const h = window.location.hash.replace(/^#\/?/, "");
    const [tab, ...rest] = h.split("/");
    const known = TABS.some((t) => t.id === tab) ? (tab as TabId) : "org";
    return [known, rest.length ? decodeURIComponent(rest.join("/")) : null];
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}
const nav = (path: string) => { window.location.hash = path; };

// A steady hue per bucket so each keeps its identity across screens.
function bucketHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// The ledger shelf (CRAFT §5): every bucket the org declares, laid out as a
// row of pigeonholes. Hovering a role lights the ones it can reach — the
// same bucket set the dossier and the card's own ▤ chip already agree on.
// The sealed bucket is a real node in the dataset (bucket:guest-registry,
// DESIGN.md §Buckets) that no agent ever declares — it renders, locked,
// forever unlit: the wall shown, never the secrets behind it.
const SEALED_BUCKET = "guest-registry";
function LedgerShelf({ org, lit }: { org: BOrg; lit: Set<string> }) {
  const buckets = useMemo(() => {
    const s = new Set<string>();
    for (const a of org.agents) for (const b of a.buckets ?? []) s.add(b);
    return [...s].sort();
  }, [org]);
  return (
    <div className="ledger-shelf" role="list" aria-label="the ledger — hover a role to see what it reaches">
      <span className="shelf-label">the ledger</span>
      <div className="shelf-slots">
        {buckets.map((b) => (
          <span key={b} className={`shelf-slot${lit.has(b) ? " lit" : ""}`} role="listitem">{b}</span>
        ))}
        <span className="shelf-slot sealed" role="listitem" title="ledger:guest-registry — sealed by wall. Visible, never emitted.">
          🔒 {SEALED_BUCKET}
        </span>
      </div>
    </div>
  );
}

/* The hero's atmosphere: a faint constellation behind the rack. Deterministic
   (a seeded LCG, not Math.random) so a screenshot of the board is reproducible
   and golden-frame diffing stays possible. Points + links only — the mockup's
   grain/noise overlay is deliberately absent, it read as a blurry filter. */
function Constellation() {
  const svg = useMemo(() => {
    const W = 1600, H = 1000, N = 58;
    let s = 20260719;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pts: [number, number][] = [];
    for (let i = 0; i < N; i++) pts.push([rnd() * W, rnd() * H]);
    let d = "";
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dist = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
        if (dist < 200) d += `<line x1="${pts[i][0].toFixed(1)}" y1="${pts[i][1].toFixed(1)}" x2="${pts[j][0].toFixed(1)}" y2="${pts[j][1].toFixed(1)}" stroke="rgba(217,160,91,${((1 - dist / 200) * 0.14).toFixed(3)})" stroke-width="1"/>`;
      }
    }
    for (const [x, y] of pts) d += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(rnd() * 1.4 + 0.6).toFixed(2)}" fill="rgba(239,195,137,.45)"/>`;
    return d;
  }, []);
  return (
    <svg className="pnl-stars" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

/* Rank I — THE HOUSE STANDARD. Not an agent: it is the law the root DECLARES,
   read straight off the root's own rule refs. Rendering it as a plate is what
   makes the cascade honest — a master-key chart starts at the master, and here
   the thing above the GM is the standard the GM alone may amend. */
function LawPlate({ org, selected, onSelect }: { org: BOrg; selected: boolean; onSelect: (id: string) => void }) {
  const root = org.agents.find((a) => a.id === org.root);
  const rules = root?.rules ?? [];
  if (!rules.length) return null;
  return (
    <div
      className={`ag law-plate${selected ? " sel" : ""}`}
      data-rail="law"
      tabIndex={0}
      title="the law every agent in the house boots against"
      onClick={(e) => { e.stopPropagation(); if (root) onSelect(root.id); }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && root) { e.preventDefault(); onSelect(root.id); } }}
    >
      <div className="ag-head">
        <span className="ag-ava">§</span>
        <span className="ag-name">The House Standard</span>
      </div>
      <span className="ag-role">{rules[0]}</span>
      <span className="ag-facts">
        <em className="ag-fact">binds {org.agents.length}</em>
        <em className="ag-fact">{rules.length} clause{rules.length === 1 ? "" : "s"}</em>
      </span>
    </div>
  );
}

/* ── the brass elbows ──────────────────────────────────────────────────────
   Orthogonal rails between arbitrary measured boxes — the geometry of the
   master-key chart. CSS pseudo-elements cannot do this honestly (a bus that
   spans exactly first-child-centre to last-child-centre is not expressible),
   so the rails are one measured SVG plane under the plates.
   Measurement uses offsetLeft/offsetTop, NOT getBoundingClientRect: the chart
   sits inside a CSS transform: scale(), which rect-based maths would bake in. */
function boxIn(el: HTMLElement, root: HTMLElement) {
  let x = 0, y = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== root) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight, cy: y + el.offsetHeight / 2 };
}

/** an orthogonal elbow: out of the source, across at a mid-x, into the target */
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y2 - y1) < 1.5) return `M${x1},${y1.toFixed(1)} H${x2}`;
  const mx = x1 + (x2 - x1) * 0.45;
  const r = Math.min(9, Math.abs(y2 - y1) / 2);
  const dir = y2 > y1 ? 1 : -1;
  return `M${x1},${y1.toFixed(1)} H${(mx - r).toFixed(1)} Q${mx},${y1.toFixed(1)} ${mx},${(y1 + r * dir).toFixed(1)} V${(y2 - r * dir).toFixed(1)} Q${mx},${y2.toFixed(1)} ${(mx + r).toFixed(1)},${y2.toFixed(1)} H${x2}`;
}

function CascadeRails({ chartRef, version }: { chartRef: React.RefObject<HTMLDivElement | null>; version: string }) {
  const [paths, setPaths] = useState<string[]>([]);
  useLayoutEffect(() => {
    const root = chartRef.current;
    if (!root) return;
    const measure = () => {
      const pick = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
      const law = root.querySelector<HTMLElement>('[data-rail="law"]');
      const gm = root.querySelector<HTMLElement>('[data-rail="gm"]');
      const depts = pick('[data-rail="dept"]');
      const staff = pick('[data-rail="staff"]');
      const out: string[] = [];
      const gmB = gm ? boxIn(gm, root) : null;
      if (law && gmB) {
        const lawB = boxIn(law, root);
        out.push(elbow(lawB.x + lawB.w, lawB.cy, gmB.x, gmB.cy));
      }
      const deptBox = new Map<string, ReturnType<typeof boxIn>>();
      for (const d of depts) {
        const b = boxIn(d, root);
        deptBox.set(d.dataset.id ?? "", b);
        if (gmB) out.push(elbow(gmB.x + gmB.w, gmB.cy, b.x, b.cy));
      }
      for (const s of staff) {
        const parent = deptBox.get(s.dataset.parent ?? "");
        if (!parent) continue;
        const b = boxIn(s, root);
        out.push(elbow(parent.x + parent.w, parent.cy, b.x, b.cy));
      }
      setPaths((prev) => (prev.length === out.length && prev.every((p, i) => p === out[i]) ? prev : out));
    };
    measure();
    // the plane is position:absolute and pointer-events:none, so redrawing it
    // never resizes `root` — no observer feedback loop.
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [chartRef, version]);
  return (
    <svg className="rails" aria-hidden>
      <defs>
        <linearGradient id="railGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--brass)" stopOpacity="0.3" />
          <stop offset="1" stopColor="var(--brass-hi)" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      {paths.map((d, i) => (
        <g key={i}>
          <path className="rail-line" d={d} />
          <path className="rail-dash" d={d} />
        </g>
      ))}
    </svg>
  );
}

/** ── RANK HEADERS, MEASURED ────────────────────────────────────────────────
 *  These were a fixed-px CSS grid (232px / rail / 268px / rail / 232-300 / 1fr)
 *  sitting above a chart that is transform: scale()d to fit. The two can never
 *  agree, and they did not: measured on the live board at its DEFAULT 70% fit,
 *  "III Departments" sat 154px to the right of the department column and "IV
 *  Staff & machines" 139px right of staff — so the board's one explicit claim
 *  about rank was already wrong before anyone touched the zoom control.
 *
 *  Rank is the whole grammar of this chart (name the rank, never make the
 *  reader infer it from indentation), so a header over the wrong column is not
 *  cosmetic. They are now positioned from the SAME data-rail anchors
 *  CascadeRails measures to draw the elbows, in viewport space via
 *  getBoundingClientRect — which bakes the transform in, which is exactly what
 *  is wanted here and exactly what boxIn must NOT do for the rails.
 *
 *  A header whose column does not exist renders nothing, per the standing note
 *  on .ranks: labelling a column that is not there is worse than no header. */
const RANKS = [
  { sel: 'law', numeral: "I", label: "The standard" },
  { sel: 'gm', numeral: "II", label: "The executive" },
  { sel: 'dept', numeral: "III", label: "Departments" },
  { sel: 'staff', numeral: "IV", label: "Staff & machines" },
] as const;

function RankHeaders({ chartRef, fitRef, version, scale }: {
  chartRef: React.RefObject<HTMLDivElement | null>;
  fitRef: React.RefObject<HTMLDivElement | null>;
  version: string;
  scale: number;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState<({ x: number; w: number } | null)[]>([null, null, null, null]);
  useLayoutEffect(() => {
    const measure = () => {
      const bar = barRef.current, root = chartRef.current;
      if (!bar || !root) return;
      const b = bar.getBoundingClientRect();
      const next = RANKS.map(({ sel }) => {
        const els = Array.from(root.querySelectorAll<HTMLElement>(`[data-rail="${sel}"]`));
        if (!els.length) return null;
        let l = Infinity, r = -Infinity;
        for (const el of els) {
          const q = el.getBoundingClientRect();
          if (q.width === 0) continue;
          l = Math.min(l, q.left);
          r = Math.max(r, q.right);
        }
        if (!Number.isFinite(l)) return null;
        // clamp into the strip so a panned-off column keeps a visible header
        const x = Math.max(0, Math.round(l - b.left));
        return { x, w: Math.max(0, Math.round(Math.min(r - b.left, b.width) - x)) };
      });
      setCols((prev) =>
        prev.every((p, i) => p?.x === next[i]?.x && p?.w === next[i]?.w) ? prev : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (chartRef.current) ro.observe(chartRef.current);
    if (barRef.current) ro.observe(barRef.current);
    const vp = fitRef.current;
    vp?.addEventListener("scroll", measure, { passive: true });
    // .chart carries a 350ms transform transition and a transform does not
    // resize the layout box, so neither this effect firing on `scale` nor the
    // ResizeObserver sees the geometry the chart is MOVING TO — a single
    // measurement here reads the previous frame and freezes on it. The first
    // version of this fix did exactly that: 1px of drift at the default fit
    // and 616px one zoom click later, which is the same defect it replaced.
    // Follow the transition frame by frame, bounded so it cannot spin — and
    // ALSO settle on transitionend, because the 600ms budget is wall-clock: a
    // main-thread stall (first paint of a big org) can exhaust it before the
    // transition finishes, which would freeze the headers mid-flight with
    // nothing left to re-trigger them. Under reduced motion the transition is
    // none, the first measure lands on final geometry, and both paths no-op.
    let raf = 0;
    const until = performance.now() + 600;
    const follow = () => {
      measure();
      raf = performance.now() < until ? requestAnimationFrame(follow) : 0;
    };
    raf = requestAnimationFrame(follow);
    const chartEl = chartRef.current;
    const onEnd = (e: TransitionEvent) => { if (e.propertyName === "transform") measure(); };
    chartEl?.addEventListener("transitionend", onEnd);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      chartEl?.removeEventListener("transitionend", onEnd);
      vp?.removeEventListener("scroll", measure);
    };
  }, [chartRef, fitRef, version, scale]);
  return (
    <div className="ranks" ref={barRef}>
      {RANKS.map((r, i) => {
        const c = cols[i];
        if (!c || c.w < 24) return null;
        return (
          <div className="rank" key={r.sel} style={{ left: c.x, width: c.w }}>
            <b>{r.numeral}</b>{r.label}
          </div>
        );
      })}
    </div>
  );
}

/** A department lane that is ITSELF a drop target.
 *  Cards were the only thing accepting a drop, so releasing over the empty
 *  space inside a lane did nothing at all and read as "it will not let me move
 *  this". The lane is a much larger target and its meaning is unambiguous:
 *  drop anywhere in Engineering's row and you report to Engineering. */
function Lane({ laneId, isLane, dragId, onDropOn, children }: {
  laneId: string; isLane: boolean; dragId: string | null;
  onDropOn: (id: string) => void; children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  if (!isLane) return <div className="oc-child">{children}</div>;
  return (
    <div
      className={`oc-child${over && dragId && dragId !== laneId ? " lane-over" : ""}`}
      onDragOver={(e) => { if (dragId && dragId !== laneId) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (dragId && dragId !== laneId) onDropOn(laneId); }}
    >
      {children}
    </div>
  );
}

/* ────────────────────────── ORGANIGRAM ────────────────────────── */

// The card's fact row (CRAFT §5: "health chip · bucket chips · rule count ·
// last report" — the four things that matter, replacing a role line that
// used to just repeat the name). Reach comes from the same orgBootSlice the
// dossier already uses, so a card and its dossier never disagree.
const HEALTH_WORD: Record<Light, string> = { ok: "Healthy", warn: "Needs a look", fail: "Failing", none: "No reports yet" };

/** Everything that FLOWS OUT of this node.
 *  The board is not a picture of the org — it is the source the org is
 *  generated from: `booboo_boot` reads it, rules inherit down it, bucket reach
 *  derives from it. So a card has to state its consequence, not just its
 *  attributes. A node with children shows what it EMITS downward (rules it
 *  declares, agents bound by them); a leaf shows what it RECEIVES (its own boot
 *  slice). Same question — "what does this node do to the system" — answered in
 *  whichever direction actually carries weight for that rank. */
function consequenceOf(a: BOrgAgent, org: BOrg, slice: ReturnType<typeof orgBootSlice>): string {
  if (!slice) return "";
  const descendants = (id: string): number => {
    const kids = org.agents.filter((x) => x.parent === id);
    return kids.reduce((n, k) => n + 1 + descendants(k.id), 0);
  };
  const declares = a.rules?.length ?? 0;
  const below = descendants(a.id);
  // LEAVES GET NOTHING HERE. They previously read "boots on 2 rules · reaches 3
  // buckets" — identical on all 52, because in this org every staff role
  // inherits exactly the same slice. A fact that never varies across a column
  // is texture pretending to be data. A leaf's "what" is its duty line; its
  // consequence is genuinely upward, and the dossier already tells that story.
  if (below === 0) return "";
  const parts = [];
  if (declares) parts.push(`declares ${declares} rule${declares === 1 ? "" : "s"}`);
  parts.push(`binds ${below} below`);
  return parts.join(" · ");
}

function AgentFacts({ a, org, health, showLaw }: { a: BOrgAgent; org: BOrg; health: HealthMap | null; showLaw?: boolean }) {
  const slice = useMemo(() => orgBootSlice(org, a.id), [org, a.id]);
  const consequence = useMemo(() => consequenceOf(a, org, slice), [a, org, slice]);
  const pulse = pulseFor(a, health);
  const light = lightFor(a, health);
  // ABSENCE IS QUIET. "No reports yet" rendered 51 times on the org screen,
  // twelve of them visible at once, set in the fact row's heavier ink — and
  // the "wall of empty states" everyone complains about is only a wall
  // BECAUSE fifty-one identical cards make it one. A plate with no health, no
  // report and no declared beat has nothing to put in this row, so the row and
  // its dividing rule are not drawn at all. Absence stays perfectly legible —
  // no lamp, no facts, a shorter card — and the dossier still tells the whole
  // story on click. Saying nothing is the honest way to render nothing.
  // The !pulse?.n clause: a plate whose only heartbeats are UNDATED failures
  // has light "none" (no dated verdict) but real history — hiding its row
  // would upgrade "wrong row" to "no row". Any recorded pulse keeps the row.
  const silent = light === "none" && !pulse?.lastAt && !(pulse && pulse.n > 0) && typeof a.cadence !== "number";
  if (!slice) return null;
  return (
    <>
      {/* what this node does to the system, in plain English. Empty on leaves —
          see consequenceOf: a line identical across 52 cards is not a fact. */}
      {consequence && <span className="ag-flows" title="what flows out of this node — the org file is the source booboo_boot reads">{consequence}</span>}
      {!silent && (
      <span className="ag-facts">
        <em className={`ag-fact ag-fact-health ${light}`}>{HEALTH_WORD[light]}</em>
        {/* "reported 4d ago" alone is an oracle: the lamp knows whether that is
            fine and the reader does not. Naming the expected beat next to it
            makes the judgement checkable — 4d against weekly is obviously ok,
            4d against daily is obviously not. */}
        <em className="ag-fact ag-fact-report" title={typeof a.cadence === "number"
          ? `${pulse?.lastAt ? `last report filed ${relTime(pulse.lastAt)}` : "no report filed yet"} · expected ${everyN(a.cadence)}; amber past about twice that`
          : pulse?.lastAt ? `last report filed ${relTime(pulse.lastAt)}` : "no report filed yet"}>
          {pulse?.lastAt ? `reported ${relTime(pulse.lastAt)}` : ""}
          {typeof a.cadence === "number" && a.kind !== "automation" && (
            <b className="ag-cadence"> · {everyN(a.cadence)}</b>
          )}
        </em>
      </span>
      )}
      {/* the law, made visible: the boot-order chain that binds this card —
          House Standard → SOP → role — only drawn while the toggle is on. */}
      {showLaw && (
        <span className="ag-law" title="inheritance in boot order">
          {slice.chain.map((c, i) => (
            <span key={c.id}>{i > 0 && <i className="ag-law-arrow">↓</i>}{c.name}</span>
          ))}
        </span>
      )}
    </>
  );
}

function AgentCard({
  a, org, isRoot, depth, order, selected, dragId, onSelect, onDragStart, onDropOn, childCount, light = "none", health = null, onHover, showLaw = false,
}: {
  a: BOrgAgent;
  org: BOrg;
  isRoot: boolean;
  depth: number;
  order: number;
  selected: boolean;
  dragId: string | null;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDropOn: (id: string) => void;
  childCount: number;
  light?: Light;
  health?: HealthMap | null;
  /** reports this card's own id on hover-in, null on hover-out — the ledger
   *  shelf uses it to light the buckets this role can reach. */
  onHover?: (id: string | null) => void;
  showLaw?: boolean;
}) {
  const [over, setOver] = useState(false);
  const nSkills = a.skills?.length ?? 0;
  const parentName = a.parent ? org.agents.find((x) => x.id === a.parent)?.name : null;
  return (
    <div
      className={`ag${isRoot ? " root" : ""}${depth >= 2 ? " staff" : ""}${selected ? " sel" : ""}${over ? " over" : ""}${dragId === a.id ? " dragging" : ""}${showLaw ? " law-on" : ""}${light !== "none" ? " h-" + light : ""}`}
      /* no --h: rank reads through brass FINISH, never through hash-hue */
      style={{ ["--d" as string]: depth, animationDelay: `${Math.min(depth * 70 + order * 45, 600)}ms` }}
      draggable={!isRoot}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(a.id); } }}
      onClick={(e) => { e.stopPropagation(); onSelect(a.id); }}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(a.id); }}
      onDragOver={(e) => { if (dragId && dragId !== a.id) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDropOn(a.id); }}
      onMouseEnter={() => onHover?.(a.id)}
      onMouseLeave={() => onHover?.(null)}
      /* rail anchors: CascadeRails measures these to draw the brass elbows */
      data-rail={isRoot ? "gm" : depth === 1 ? "dept" : "staff"}
      data-id={a.id}
      data-parent={a.parent ?? ""}
    >
      {/* the lamp's breath is offset per bubble so the board never blinks in
          unison — a synchronised pulse reads as a screensaver, a staggered one
          reads as a building with people in it. Deterministic off the id. */}
      {light !== "none" && (
        <i
          className={`ag-light ${light}`}
          style={{ ["--lamp-delay" as string]: `${(bucketHue(a.id) % 26) / 10}s` }}
          title={`health: ${light === "ok" ? "healthy" : light === "warn" ? "needs a look" : "failing"}`}
        />
      )}
      {/* WHERE IT BELONGS, first — a staff card lifted out of its lane used to
          be orphaned: "Lift Engineer" with no way to know it was Engineering's.
          Rank is named too, so the card carries its own place in the cascade. */}
      <span className="ag-eyebrow">
        {depth === 0 ? "The house · rank II" : depth === 1 ? "Department · rank III" : (parentName ?? "Staff")}
      </span>
      <div className="ag-head">
        {/* the mark is earned by rank. Staff plates carry none — 51 identical
            🤖 avatars were the cheapest visual token on the board, and a
            brass name plate does not have a cartoon on it. */}
        {depth <= 1 && a.emoji && <span className="ag-ava">{a.emoji}</span>}
        <span className="ag-name">{a.name}</span>
      </div>
      {a.role && <span className="ag-role">{a.role}</span>}
      <AgentFacts a={a} org={org} health={health} showLaw={showLaw} />
      {(nSkills > 0 || childCount > 0) && (
        <span className="ag-meta">
          {nSkills > 0 && <em title="skills">✦ {nSkills}</em>}
          {childCount > 0 && <span className="ag-kids" title="direct reports">{childCount} reports</span>}
        </span>
      )}
    </div>
  );
}

// A real company chart: the root on top, branches fanning out beneath, with
// connector lines drawn in CSS (vertical drop → horizontal bar → drops).
function ChartNode({
  org, a, depth, order, ...cardProps
}: {
  org: BOrg;
  a: BOrgAgent;
  depth: number;
  order: number;
  selected: string | null;
  dragId: string | null;
  health: HealthMap | null;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDropOn: (id: string) => void;
  onHover?: (id: string | null) => void;
  /** "show the law": traces House Standard → SOP → role on every rail + card */
  showLaw?: boolean;
  /** semantic zoom (house → department → role): department ids collapsed to
   *  head-only. Click a department's rail to fold or unfold its staff. */
  collapsed?: Set<string>;
  onToggleCollapse?: (id: string) => void;
}) {
  // Automations are machines this node OPERATES, not org units — they render
  // as a compact TRAY of chips under the owner's card (with health lights),
  // never as full org cards.
  // Root's children are the departments: sorted by id so the board's column
  // order matches the cosmos viewer's sector enumeration (the one-ordering law
  // in design/CRAFT.md — sectors in SEE, columns in GOVERN, always identical).
  const kidsRaw = org.agents.filter((c) => c.parent === a.id && c.kind !== "automation");
  const kids = depth === 0 ? [...kidsRaw].sort((x, y) => x.id.localeCompare(y.id)) : kidsRaw;
  // A LANE earns its full-width row by HAVING people — "head on the left, its
  // people flowing right". A childless child fills none of that: the staff
  // column sits empty and the tray is ~940px of nothing. The Pemberton never
  // showed this because all nine of its departments have staff. The live
  // Dionisos fleet has 55 root children, 43 of them childless, and every one
  // took its own full-width row — 12,211px of single file, which is not a
  // cascade, it is a queue (GAPS C34). Childless children flow into one packed
  // grid instead; they keep their rails (CascadeRails MEASURES the anchors, so
  // it follows them) and stay drop targets. An org whose children all have
  // staff renders byte-identically to before.
  const hasStaff = (k: BOrgAgent) => org.agents.some((x) => x.parent === k.id && x.kind !== "automation");
  const laneKids = depth === 0 ? kids.filter(hasStaff) : kids;
  const soloKids = depth === 0 ? kids.filter((k) => !hasStaff(k)) : [];
  const machines = (() => {
    const out: BOrgAgent[] = [];
    const walk = (pid: string) => {
      for (const c of org.agents.filter((x) => x.parent === pid && x.kind === "automation")) {
        const hasKids = org.agents.some((x) => x.parent === c.id);
        if (hasKids) walk(c.id);
        else out.push(c);
      }
    };
    walk(a.id);
    return out;
  })();
  const lights = machines.map((m) => lightFor(m, cardProps.health));
  const trayLight = worst(lights);
  // semantic zoom lever: department-level nodes (depth 1) fold their staff
  // behind a click on their own rail — house → department → role, one level
  // at a time, without leaving the board.
  const isDept = depth === 1 && kids.length > 0;
  const folded = isDept && cardProps.collapsed?.has(a.id);
  const TRAY_MAX = 8;
  const hidden = machines.length - TRAY_MAX;
  const hiddenBad = machines.slice(TRAY_MAX).reduce(
    (n, m) => n + (lightFor(m, cardProps.health) !== "ok" && lightFor(m, cardProps.health) !== "none" ? 1 : 0),
    0,
  );
  const cardAndRack = (
    <>
      <AgentCard
        a={a}
        org={org}
        isRoot={a.id === org.root}
        depth={depth}
        order={order}
        selected={cardProps.selected === a.id}
        dragId={cardProps.dragId}
        onSelect={cardProps.onSelect}
        onDragStart={cardProps.onDragStart}
        onDropOn={cardProps.onDropOn}
        childCount={kids.length}
        light={trayLight}
        health={cardProps.health}
        onHover={cardProps.onHover}
        showLaw={cardProps.showLaw}
      />
      {machines.length > 0 && (
        <div className={`oc-tray ${trayLight}`}>
          {machines.slice(0, TRAY_MAX).map((m) => (
            <button
              key={m.id}
              type="button"
              className={`oc-mac${cardProps.selected === m.id ? " sel" : ""}${cardProps.dragId === m.id ? " dragging" : ""}`}
              title={`${m.name}${m.role ? ` — ${m.role}` : ""} · drag onto an agent to reallocate`}
              draggable
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; cardProps.onDragStart(m.id); }}
              onClick={(e) => { e.stopPropagation(); cardProps.onSelect(m.id); }}
            >
              <i className={`mac-dot ${lightFor(m, cardProps.health)}${unstableFor(m, cardProps.health) ? " unstable" : ""}`} />
              <BrandMark agent={m} />
              <span className="mac-name">{m.name}</span>
            </button>
          ))}
          {hidden > 0 && (
            <button
              type="button"
              className="oc-mac more"
              title="open the full machine list in the dossier"
              onClick={(e) => { e.stopPropagation(); cardProps.onSelect(a.id); }}
            >
              +{hidden} machines{hiddenBad > 0 ? ` · ${hiddenBad} not green` : ""}
            </button>
          )}
        </div>
      )}
    </>
  );
  return (
    <div className="ocn">
      {/* At the root, the plate + its rack occupy ONE cascade cell so the GM
          centres against the whole lane stack. Left as two grid items they
          fell into separate rows and the GM pinned to the top while the lanes
          spanned both — measured, not guessed. */}
      {depth === 0 ? <div className="casc-head">{cardAndRack}</div> : cardAndRack}
      {kids.length > 0 && (
        <>
          <div
            className={`oc-down${isDept ? " foldable" : ""}${folded ? " folded" : ""}`}
            role={isDept ? "button" : undefined}
            tabIndex={isDept ? 0 : undefined}
            title={isDept ? (folded ? `${kids.length} staff — click to expand (semantic zoom: department → role)` : "click to fold this department to head-only (semantic zoom: role → department)") : undefined}
            onClick={isDept ? (e) => { e.stopPropagation(); cardProps.onToggleCollapse?.(a.id); } : undefined}
            onKeyDown={isDept ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cardProps.onToggleCollapse?.(a.id); } } : undefined}
          >
            {isDept && <i className="oc-fold-glyph">{folded ? "▸" : "▾"}</i>}
          </div>
          {/* The staff-board law: departments are LANES that stack DOWNWARD.
              Nine of them fanned sideways forced a 17%-zoom canvas nobody
              could read. Each lane is a self-contained row — head on the left,
              its people flowing right — so the board reads like a document and
              every card stays legible. Deeper generations keep the old rule
              (≤4 fan, more → a compact grid that grows down). */}
          {folded ? (
            <button
              type="button"
              className="oc-folded-summary"
              onClick={(e) => { e.stopPropagation(); cardProps.onToggleCollapse?.(a.id); }}
              title="click to expand — semantic zoom: department → role"
            >
              {kids.length} staff · folded to department level — click to expand
            </button>
          ) : (
          <>
          <div className={`oc-row${depth > 0 && kids.length > 3 ? " wrap" : ""}${depth === 0 ? " lanes" : ""}`}>
            {laneKids.map((k, i) => (
              <Lane
                key={k.id}
                laneId={k.id}
                isLane={depth === 0}
                dragId={cardProps.dragId}
                onDropOn={cardProps.onDropOn}
              >
                <ChartNode org={org} a={k} depth={depth + 1} order={i} {...cardProps} />
              </Lane>
            ))}
          </div>
          {soloKids.length > 0 && (
            <div className="oc-row solo-pack">
              {soloKids.map((k, i) => (
                <Lane
                  key={k.id}
                  laneId={k.id}
                  isLane
                  dragId={cardProps.dragId}
                  onDropOn={cardProps.onDropOn}
                >
                  <ChartNode org={org} a={k} depth={depth + 1} order={laneKids.length + i} {...cardProps} />
                </Lane>
              ))}
            </div>
          )}
          </>
          )}
        </>
      )}
    </div>
  );
}

/* The real mark of a real service. `data.brand` is a simpleicons slug; the CDN
   returns a single-colour SVG we tint to the house palette so twelve vendors
   don't turn the board into a sticker album. Falls back to the emoji when a
   vendor isn't in the set (or the CDN is unreachable) — a missing logo must
   never leave an empty square. */
function BrandMark({ agent }: { agent: BOrgAgent }) {
  const brand = ((agent.data ?? {}) as Record<string, unknown>).brand;
  const [failed, setFailed] = useState(false);
  if (typeof brand !== "string" || !brand || failed) {
    return <span className="mac-emoji">{agent.emoji || "⚙️"}</span>;
  }
  return (
    <img
      className="mac-brand"
      /* /000 = black glyph, which is what a white chip needs. Untinted brand
         colour across a dozen vendors turns the rack into a sticker album. */
      src={`https://cdn.simpleicons.org/${brand}/000`}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

// A CLICKABLE CHIP IS A BUTTON. Every one of these was a <span> with an
// onClick: no tab stop, no Enter or Space, no role, invisible to a screen
// reader — and on the reports tab they ARE the filter, which made that tab's
// primary control unreachable without a mouse. Decorative chips (no onClick)
// stay a <span>, because a button with nothing to do is worse than no button.
// `pressed` drives aria-pressed: these are TOGGLE buttons, not radios — the
// first version claimed role="radio" inside a radiogroup, which was half a
// pattern (radios promise arrow-key movement and never toggle OFF; these
// chips do exactly both). aria-pressed tells the truth about the behaviour.
function Chip({ children, tone, onClick, pressed }: { children: React.ReactNode; tone?: string; onClick?: () => void; pressed?: boolean }) {
  const cls = `chip${tone ? ` ${tone}` : ""}${onClick ? " tap" : ""}`;
  if (!onClick) return <span className={cls}>{children}</span>;
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
    >
      {children}
    </button>
  );
}

// The dossier: everything one agent is — and where you EDIT it. Edits land in
// the draft; the top-bar apply writes them to the org file.
function Dossier({
  org, id, hasSnapshot, onUpdate, onAdd, onRemove, onSelect, onClose, health = null,
}: {
  org: BOrg;
  id: string;
  hasSnapshot: boolean;
  onUpdate: (id: string, patch: Partial<BOrgAgent>) => void;
  onAdd: (parentId: string) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  health?: HealthMap | null;
}) {
  const api = useApi();
  const slice = useMemo(() => orgBootSlice(org, id), [org, id]);

  // The machines this agent operates — automation leaves anywhere in its
  // automation subtree (grouping nodes like a "fleet" flatten away).
  const autos = useMemo(() => {
    const out: BOrgAgent[] = [];
    const walk = (pid: string) => {
      for (const c of org.agents.filter((x) => x.parent === pid && x.kind === "automation")) {
        const hasKids = org.agents.some((x) => x.parent === c.id);
        if (hasKids) walk(c.id);
        else out.push(c);
      }
    };
    walk(id);
    return out;
  }, [org, id]);
  const [memCount, setMemCount] = useState<Loaded<number>>(null);
  const [repCount, setRepCount] = useState<Loaded<number>>(null);
  const [reports, setReports] = useState<BNode[] | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [openRep, setOpenRep] = useState<string | null>(null);
  const [editContract, setEditContract] = useState(false);
  const [contractText, setContractText] = useState("");

  useEffect(() => { setEdit(false); setOpenRep(null); setEditContract(false); }, [id]);

  useEffect(() => {
    setMemCount(null);
    setRepCount(null);
    setReports(null);
    if (!hasSnapshot || !slice) return;
    // A failed read is not an answer of zero (Loaded<T>, same law as the
    // screens): these were the literal "confident 0 in the dossier" — a dead
    // API rendered "0 MEMORIES IN REACH · 0 REPORTS FILED" on every agent.
    Promise.all(
      slice.buckets.map((b) =>
        api(`/nodes?type=memory&cluster=${encodeURIComponent(b)}&limit=1`).then((j) => j.total as number),
      ),
    ).then((counts) => setMemCount(counts.reduce((s, n) => s + n, 0)))
      .catch(() => setMemCount("err"));
    // Fetch by cluster first (cheap, server-side). House-level filers like the
    // Executive carry cluster null, so that query returns nothing and the
    // dossier claimed "0 reports filed" while holding three years of them —
    // fall back to a full pull matched on the report's own `data.agent`.
    fetchReports(api, id, 100).then(({ total, nodes }) => {
      if (total > 0) { setRepCount(total); setReports(nodes.slice(0, 4)); return; }
      return fetchReports(api, null, 2000).then(({ nodes: all }) => {
        const mine = all.filter((n) => reportAgentId(n) === id);
        setRepCount(mine.length);
        setReports(mine.slice(0, 4));
      });
    }).catch(() => { setRepCount("err"); setReports([]); });
  }, [id, hasSnapshot, slice, api]);

  const mem = useCountUp(typeof memCount === "number" ? memCount : 0);
  const rep = useCountUp(typeof repCount === "number" ? repCount : 0);

  const startEdit = () => {
    if (!slice) return;
    const ag = slice.agent;
    setForm({
      name: ag.name ?? "",
      emoji: ag.emoji ?? "",
      role: ag.role ?? "",
      boot: ag.boot ?? "",
      rules: (ag.rules ?? []).join(", "),
      skills: (ag.skills ?? []).join(", "),
      buckets: (ag.buckets ?? []).join(", "),
    });
    setEdit(true);
  };

  const saveEdit = () => {
    const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    onUpdate(id, {
      name: form.name.trim() || slice?.agent.name || id,
      emoji: form.emoji.trim() || undefined,
      role: form.role.trim() || undefined,
      boot: form.boot.trim() || undefined,
      rules: list(form.rules),
      skills: list(form.skills),
      buckets: list(form.buckets),
    });
    setEdit(false);
  };

  if (!slice) return null;
  const a = slice.agent;
  const isRoot = a.id === org.root;
  const own = new Set(a.rules ?? []);

  return (
    <aside className="doss" onClick={(e) => e.stopPropagation()}>
      {/* The role sits OUTSIDE this flex row. Inside it, the action buttons
          claimed their width first and the role took what was left, so The
          Executive's four seats wrapped into a 7-line ribbon down one side of
          the panel. Name and controls share the row; the role gets the panel. */}
      <div className="doss-head">
        <span className="doss-emoji">{a.emoji || "🤖"}</span>
        <h2>{a.name} {a.kind === "automation" && <span className="auto-badge">automation</span>}</h2>
        <div className="doss-head-actions">
          {!edit && (
            <button className="doss-3d" title="edit this agent" onClick={startEdit}>✎ edit</button>
          )}
          {hasSnapshot && (
            <button className="doss-3d" title="see the whole brain in 3D" onClick={() => nav("/graph")}>◉ 3D</button>
          )}
          <button className="doss-close" title="close the dossier" aria-label="close the dossier" onClick={onClose}>✕</button>
        </div>
      </div>
      {a.role && <p className="doss-role">{a.role}</p>}

      {edit && (
        <div className="doss-edit">
          <div className="doss-edit-row2">
            <label>name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="narrow">emoji<input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} /></label>
          </div>
          <label>role<input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="one line — what this agent is for" /></label>
          <label>rules <em>comma-separated refs · inherited by everyone beneath</em>
            <input value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} placeholder="rules/GLOBAL.md, rules/CONTENT.md" />
          </label>
          <label>memory buckets <em>comma-separated</em>
            <input value={form.buckets} onChange={(e) => setForm({ ...form, buckets: e.target.value })} placeholder="shared, content" />
          </label>
          <label>skills <em>comma-separated</em>
            <input value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} placeholder="humanizer, deep-research" />
          </label>
          <p className="doss-edit-hint">↓ edit the contract below — the agent's operating prompt lives in its own section.</p>
          <div className="doss-edit-actions">
            <button className="btn primary" onClick={saveEdit}>save to draft</button>
            <button className="btn ghost" onClick={() => setEdit(false)}>cancel</button>
          </div>
        </div>
      )}

      {a.kind === "automation" && (() => {
        const p = pulseFor(a, health);
        const l = lightFor(a, health);
        return (
          <div className={`doss-health ${l}`}>
            <i className={`mac-dot ${l}`} />
            <b>
              {l === "ok" ? "healthy" : l === "fail" ? "last run failed" : l === "warn" ? "stale or degraded" : "no runs recorded"}
            </b>
            {p?.lastAt && <span>last run {relTime(p.lastAt)}</span>}
            {p && p.n > 0 && <span>{Math.round(((p.n - p.fails) / p.n) * 100)}% ok of {p.n}</span>}
            {typeof a.cadence === "number" && <span>reports {everyN(a.cadence)}</span>}
          </div>
        );
      })()}

      <div className="doss-chain">
        {slice.chain.map((c, i) => (
          <span key={c.id}>
            {i > 0 && <i>›</i>}
            <b className={c.id === a.id ? "me" : ""}>{c.name}</b>
          </span>
        ))}
      </div>

      {hasSnapshot && (
        <div className="doss-stats">
          <div className="doss-stat">
            <div className="doss-n">{memCount === null ? "…" : memCount === "err" ? <span title="could not reach the API — this is not a count of zero">—</span> : mem.toLocaleString()}</div>
            <div className="doss-l">memories in reach</div>
          </div>
          <div className="doss-stat">
            <div className="doss-n">{repCount === null ? "…" : repCount === "err" ? <span title="could not reach the API — this is not a count of zero">—</span> : rep.toLocaleString()}</div>
            <div className="doss-l">reports filed</div>
          </div>
          <div className="doss-stat">
            <div className="doss-n">{slice.children.filter((c) => c.kind !== "automation").length}</div>
            <div className="doss-l">direct reports</div>
          </div>
        </div>
      )}

      {hasSnapshot && (
        <section>
          <h3>latest reports</h3>
          {reports === null ? (
            <p className="doss-empty">loading…</p>
          ) : reports.length === 0 ? (
            <p className="doss-empty">no reports filed yet — they appear here as this agent closes work.</p>
          ) : (
            <div className="doss-reps">
              {reports.map((r) => {
                const when = relTime(nodeAt(r));
                const sum = nodeSummary(r);
                const st = typeof (r.data as Record<string, unknown> | undefined)?.status === "string"
                  ? String((r.data as Record<string, unknown>).status) : undefined;
                const open = openRep === r.id;
                const skip = new Set(["summary", "status", "at", "ts", "time", "created_at", "date", "bst", "ts_bst", "finished_at"]);
                const extra = r.data ? Object.entries(r.data).filter(([k, v]) => !skip.has(k) && v != null && v !== "") : [];
                return (
                  <div className={`doss-rep tap${open ? " open" : ""}`} key={r.id} role="button" tabIndex={0}
                    aria-expanded={open} title="click for the full report"
                    onClick={() => setOpenRep(open ? null : r.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenRep(open ? null : r.id); } }}>
                    <div className="doss-rep-top">
                      {st && <span className={`rep-dot ${st}`} aria-label={st} />}
                      {when && <span className="doss-rep-when">{when}</span>}
                      <span className="doss-rep-label">{r.label}</span>
                      <span className="doss-rep-caret" aria-hidden>{open ? "▾" : "▸"}</span>
                    </div>
                    {sum && <p className="doss-rep-sum">{sum}</p>}
                    {open && (
                      <div className="doss-rep-detail">
                        {st && <div><span className="doss-l">status</span> <b className={`rep-${st}`}>{st}</b></div>}
                        {extra.map(([k, v]) => (
                          <div key={k}><span className="doss-l">{k}</span> {String(v)}</div>
                        ))}
                        {extra.length === 0 && !st && <div className="doss-empty">no extra detail on this report</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {autos.length > 0 && (
        <section>
          <h3>automations · {autos.length} — machines this agent operates</h3>
          <div className="doss-autos">
            {autos.map((m) => {
              const p = pulseFor(m, health);
              return (
                <button className="doss-auto" key={m.id} onClick={() => onSelect(m.id)}>
                  <i className={`mac-dot ${lightFor(m, health)}${unstableFor(m, health) ? " unstable" : ""}`} />
                  <span className="doss-auto-emoji">{m.emoji || "⚙️"}</span>
                  <span className="doss-auto-name">{m.name}</span>
                  {m.role && <span className="doss-auto-role">{m.role}</span>}
                  {p?.lastAt && <span className="doss-auto-when">{relTime(p.lastAt)}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h3>rules · inherited top-down</h3>
        {slice.rules.length === 0 ? (
          <p className="doss-empty">no rules anywhere on this branch yet.</p>
        ) : (
          <ul className="doss-rules">
            {slice.rules.map((r) => (
              <li key={r} className={own.has(r) ? "own" : ""}>
                {r} {!own.has(r) && <em>inherited</em>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>memory buckets</h3>
        {slice.buckets.length === 0 ? (
          <p className="doss-empty">no bucket access — this agent remembers nothing.</p>
        ) : (
          <div className="doss-chips">
            {slice.buckets.map((b) => (
              <Chip key={b} onClick={() => nav(`/buckets/${encodeURIComponent(b)}`)}>{b} ›</Chip>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3>skills</h3>
        {slice.skills.length === 0 ? (
          <p className="doss-empty">no skills declared.</p>
        ) : (
          <div className="doss-chips">{slice.skills.map((s) => <Chip key={s} tone="alt">{s}</Chip>)}</div>
        )}
      </section>

      {!edit && (
        <section className="doss-contract">
          <h3>contract <em>the operating prompt — loaded first, every session</em></h3>
          {editContract ? (
            <div className="contract-edit">
              <textarea
                className="contract-ta"
                autoFocus
                value={contractText}
                onChange={(e) => setContractText(e.target.value)}
                placeholder="Who this agent is · what it decides · how it verifies · when it stops. This is the first thing it reads."
              />
              <div className="doss-edit-actions">
                <button className="btn primary" onClick={() => { onUpdate(id, { boot: contractText.trim() || undefined }); setEditContract(false); }}>save to draft</button>
                <button className="btn ghost" onClick={() => setEditContract(false)}>cancel</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`contract-card${a.boot ? "" : " empty"}`}
              title="click to open · edit this agent's contract"
              onClick={() => { setContractText(a.boot ?? ""); setEditContract(true); }}
            >
              {a.boot
                ? <p className="doss-boot">{a.boot}</p>
                : <p className="doss-empty">no contract yet — click to write one.</p>}
              <span className="contract-hint">✎ edit</span>
            </button>
          )}
        </section>
      )}

      <div className="doss-foot">
        <button className="btn ghost" onClick={() => onAdd(id)}>＋ add agent under {a.name}</button>
        {!isRoot && (
          <button className="btn danger" onClick={() => onRemove(id)}>− remove {a.name}</button>
        )}
      </div>
    </aside>
  );
}

function OrgScreen({
  draft, selected, dragId, setSelected, setDragId, dropOn, hasSnapshot, onUpdate, onAdd, onRemove, showLaw,
}: {
  draft: BOrg;
  selected: string | null;
  dragId: string | null;
  setSelected: (id: string | null) => void;
  setDragId: (id: string | null) => void;
  dropOn: (id: string) => void;
  hasSnapshot: boolean;
  onUpdate: (id: string, patch: Partial<BOrgAgent>) => void;
  onAdd: (parentId: string) => void;
  onRemove: (id: string) => void;
  showLaw: boolean;
}) {
  const api = useApi();
  // The heartbeat: one fetch of every report powers all the lights.
  // A swallowed failure here was the worst lie on the board: health stayed
  // null, every plate went light "none", and — with the silent-absence gate —
  // an API outage rendered as a PERFECTLY CLEAN org, indistinguishable from a
  // healthy fresh install. Quiet absence is only honest when the read
  // succeeded, so a failed read says so on the board itself.
  const [health, setHealth] = useState<HealthMap | null>(null);
  const [healthErr, setHealthErr] = useState(false);
  useEffect(() => {
    if (!hasSnapshot) return;
    fetchReports(api, null, 10000)
      .then(({ nodes }) => { setHealth(buildHealthMap(nodes)); setHealthErr(false); })
      .catch(() => setHealthErr(true));
  }, [hasSnapshot, api]);

  // The ledger shelf: hovering a role's card lights the buckets it can reach.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const litBuckets = useMemo(
    () => new Set(hoverId ? (orgBootSlice(draft, hoverId)?.buckets ?? []) : []),
    [hoverId, draft],
  );

  // Semantic zoom: house → department → role. Each department folds to
  // head-only on a rail click; these two controls fold/unfold every
  // department at once — house-level and role-level in one press.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const depts = useMemo(() => draft.agents.filter((a) => a.parent === draft.root), [draft]);
  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const allFolded = depts.length > 0 && depts.every((d) => collapsed.has(d.id));
  // anything that moves a plate must re-measure the rails
  const railVersion = `${draft.agents.length}:${[...collapsed].sort().join(",")}:${showLaw}:${health ? 1 : 0}:${selected ?? ""}`;

  // Measured fit-to-viewport: scale the whole chart so the full org is always
  // visible on both axes with no page scroll. We read the chart's NATURAL
  // scrollWidth/scrollHeight (CSS transforms don't affect scroll metrics) against
  // the wrapper's available box, and set --fit = min(1, availW/natW, availH/natH).
  // Capped at 1 — small orgs are never upscaled. A ResizeObserver on both the
  // wrapper (window resize + dossier open/close) and the chart (org-size change)
  // keeps it correct; the [draft, health, selected] deps cover data + toggles.
  const fitRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  // User zoom on top of the auto-fit: null = fit-to-viewport (default). Set by
  // the −/＋ controls or ctrl+wheel; "fit" resets. When zoomed, the wrapper
  // scrolls natively (top-left origin so the overflow is fully reachable).
  const [zoom, setZoom] = useState<number | null>(null);
  // natural (unscaled) size of the chart, so the scroll spacer can be sized to
  // the visual footprint after scaling
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const eff = zoom ?? fit;
  // The smallest scale at which a plate still reads. Measured, not guessed:
  // the name plate is 13px, so 0.45 puts it just under 6px — the point where
  // the card is still identifiable as a card with a name on it.
  const FIT_FLOOR = 0.45;
  useLayoutEffect(() => {
    const vp = fitRef.current, chart = chartRef.current;
    if (!vp || !chart) return;
    const PAD = 24;
    const measure = () => {
      const natW = chart.scrollWidth, natH = chart.scrollHeight;
      const availW = vp.clientWidth - PAD * 2, availH = vp.clientHeight - PAD * 2;
      if (natW <= 0 || natH <= 0) return;
      // Fit WIDTH, then scroll. Fitting height too crushed a lane board — a
      // document that grows downward — to 17-33% to force it onto one screen,
      // which is unreadable and defeats the point. Height only constrains when
      // the board is nearly square (a wide fan), where a tall shrink is mild.
      setNat((p) => (p.w === natW && p.h === natH ? p : { w: natW, h: natH }));
      const kW = availW / natW;
      const kH = availH / natH;
      const k = natH > availH * 1.35 ? kW : Math.min(kW, kH);
      // Floor the auto-fit. On a phone the same arithmetic that gives a laptop
      // a comfortable 70% gives 20%, and a plate at 20% is a coloured rectangle
      // with a grey smudge where its name should be — the board stops being a
      // board. Below the floor, stop shrinking and let the viewport scroll:
      // a legible board you pan beats an illegible one you can see all of.
      // Same reasoning as the height rule above, one axis over.
      setFit(Math.min(1, Math.max(FIT_FLOOR, k > 0 ? k : 1)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    ro.observe(chart);
    return () => ro.disconnect();
  }, [draft, health, selected, collapsed]);

  // ctrl/⌘ + wheel zooms (native listener — React's delegated wheel is passive,
  // so preventDefault would be ignored there). Plain wheel keeps scrolling.
  const effRef = useRef(eff);
  effRef.current = eff;
  useEffect(() => {
    const vp = fitRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom(Math.min(2.5, Math.max(0.2, effRef.current * k)));
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  const root = draft.agents.find((a) => a.id === draft.root);
  return (
    <div className="body" onClick={() => setSelected(null)}>
      <main className={`tree${showLaw ? " law-on" : ""}`} onClick={(e) => e.stopPropagation()}>
        <p className="tree-hint">
          {showLaw
            ? "the rails now trace authority — brass flows from the House Standard through every SOP to every role"
            : "drag a plate — or a machine — onto its new parent · click for its dossier · machine racks show live health"}
        </p>
        {healthErr && (
          <p className="tree-warn" role="status">
            health is <b>unknown</b> — the reports API could not be reached, so the lamps and fact
            rows are hidden, not healthy. Check <code>booboo panel</code> is running, then reload.
          </p>
        )}
        {/* rank grammar, borrowed from the ministry organigram: name the rank,
            never make the reader infer it from indentation. Positions are
            measured off the real columns — see RankHeaders. */}
        <RankHeaders chartRef={chartRef} fitRef={fitRef} version={railVersion} scale={eff} />
        <div className={`chart-fit${zoom !== null ? " zoomed" : ""}`} ref={fitRef}>
          {/* spacer sized to the SCALED footprint so the scroll extent matches
              what you can actually see (transform doesn't resize the layout box) */}
          <div className="chart-scaled" style={{ width: nat.w * eff, height: nat.h * eff }}>
          {/* transform applied inline, not via a CSS var: the var indirection
              silently resolved to scale(1) here, leaving the board unscaled
              inside a spacer sized for the scaled footprint (dead scroll). */}
          <div
            className="chart"
            ref={chartRef}
            style={{
              ["--fit" as string]: eff,
              transform: zoom !== null ? `scale(${eff})` : `translateX(-50%) scale(${eff})`,
            }}
          >
            <CascadeRails chartRef={chartRef} version={railVersion} />
            <div className="cascade">
              <LawPlate org={draft} selected={selected === draft.root} onSelect={setSelected} />
              {root && (
                <ChartNode
                  org={draft}
                  a={root}
                  depth={0}
                  order={0}
                  selected={selected}
                  dragId={dragId}
                  health={health}
                  onSelect={setSelected}
                  onDragStart={setDragId}
                  onDropOn={dropOn}
                  onHover={setHoverId}
                  showLaw={showLaw}
                  collapsed={collapsed}
                  onToggleCollapse={toggleCollapse}
                />
              )}
            </div>
          </div>
          </div>
        </div>
        <div className="zoomer">
          <button
            type="button"
            className={allFolded ? "on" : ""}
            title={allFolded ? "unfold every department — see roles again" : "fold every department to head-only — house → department"}
            onClick={() => setCollapsed(allFolded ? new Set() : new Set(depts.map((d) => d.id)))}
          >
            {allFolded ? "⌂ house" : "▾ roles"}
          </button>
          <span className="zoomer-sep" />
          <button type="button" title="zoom out (ctrl+wheel)" onClick={() => setZoom(Math.max(0.2, eff / 1.25))}>−</button>
          <span className="zoomer-pct">{Math.round(eff * 100)}%</span>
          <button type="button" title="zoom in (ctrl+wheel)" onClick={() => setZoom(Math.min(2.5, eff * 1.25))}>＋</button>
          <button type="button" className={zoom === null ? "on" : ""} title="fit the whole org in view" onClick={() => setZoom(null)}>fit</button>
        </div>
        <LedgerShelf org={draft} lit={litBuckets} />
      </main>
      {selected && (
        <Dossier
          org={draft}
          id={selected}
          hasSnapshot={hasSnapshot}
          onUpdate={onUpdate}
          onAdd={onAdd}
          onRemove={onRemove}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
          health={health}
        />
      )}
    </div>
  );
}

/* ────────────────────────── BUCKETS ────────────────────────── */

// A FAILED READ IS NOT AN ANSWER OF ZERO. The fetches behind the board's
// headline numbers used to .catch() into an empty result, so an API outage
// rendered as a confident "286 memories" turning into "0" and "no reports
// filed yet" — the most-trusted numbers, quietly wrong, with nothing on
// screen to say so. "err" is a third state alongside loading and loaded, and
// it prints a dash. Converted: bucket counts, bucket contents, the reports
// list, the dossier's two stats, and the health map (which says so on the
// board). Deliberately NOT converted: /api/stats and /api/totals in App —
// their failure currently renders the "start with --snapshot" empty states,
// which is the same class of lie but is wired through hasSnapshot everywhere;
// that is its own change, not a rider on this one.
type Loaded<T> = T | "err" | null;

function BucketCount({ bucket }: { bucket: string }) {
  const api = useApi();
  const [n, setN] = useState<Loaded<number>>(null);
  useEffect(() => {
    api(`/nodes?type=memory&cluster=${encodeURIComponent(bucket)}&limit=1`)
      .then((j) => setN(j.total))
      .catch(() => setN("err"));
  }, [bucket, api]);
  const v = useCountUp(typeof n === "number" ? n : 0);
  if (n === "err")
    return <div className="bk-n dim" title="could not reach the API for this bucket — this is not a count of zero">—</div>;
  return <div className="bk-n">{n === null ? "…" : v.toLocaleString()}</div>;
}

function BucketsScreen({ org, param, hasSnapshot }: { org: BOrg; param: string | null; hasSnapshot: boolean }) {
  const api = useApi();
  // Discovered clusters from the snapshot — buckets that exist in the data even
  // if no agent declares them. Nothing gets to hide from the buckets screen.
  const [discovered, setDiscovered] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!hasSnapshot) { setDiscovered({}); return; }
    api("/clusters?type=memory").then((j) => setDiscovered(j.clusters ?? {})).catch(() => setDiscovered({}));
  }, [hasSnapshot, api]);

  // bucket → the agents that can reach it (declared or inherited), UNION the
  // discovered set (agent-less buckets render as "unassigned").
  const buckets = useMemo(() => {
    const map = new Map<string, BOrgAgent[]>();
    for (const a of org.agents) {
      const slice = orgBootSlice(org, a.id);
      for (const b of slice?.buckets ?? []) {
        const arr = map.get(b) ?? [];
        arr.push(a);
        map.set(b, arr);
      }
    }
    for (const b of Object.keys(discovered ?? {})) if (!map.has(b)) map.set(b, []);
    return [...map.entries()].sort(
      (x, y) =>
        (y[1].length ? 1 : 0) - (x[1].length ? 1 : 0) ||
        (discovered?.[y[0]] ?? 0) - (discovered?.[x[0]] ?? 0) ||
        x[0].localeCompare(y[0]),
    );
  }, [org, discovered]);

  const [items, setItems] = useState<Loaded<BNode[]>>(null);
  useEffect(() => {
    setItems(null);
    if (!param || !hasSnapshot) return;
    api(`/nodes?type=memory&cluster=${encodeURIComponent(param)}&limit=500`)
      .then((j: { nodes: BNode[] }) => {
        setItems([...j.nodes].sort((a, b) => nodeAt(b).localeCompare(nodeAt(a))));
      })
      .catch(() => setItems("err"));
  }, [param, hasSnapshot, api]);

  if (param) {
    return (
      <div className="screen">
        <button className="pnl-back" onClick={() => nav("/buckets")}>← all buckets</button>
        <h2 className="scr-title">
          <i className="bk-dot" style={{ ["--h" as string]: bucketHue(param) }} /> {param}
        </h2>
        {!hasSnapshot ? (
          <p className="scr-empty">start with <code>--snapshot</code> to browse this bucket's memories.</p>
        ) : items === null ? (
          <p className="scr-empty">loading…</p>
        ) : items === "err" ? (
          <p className="scr-empty">couldn't reach the API for this bucket, so what is inside it is <b>unknown</b> — this is not the same as empty. Check <code>booboo panel</code> is still running, then reload.</p>
        ) : items.length === 0 ? (
          <p className="scr-empty">this bucket is empty — nothing remembered here yet.</p>
        ) : (
          <div className="mem-list">
            {items.slice(0, 150).map((m) => {
              const when = relTime(nodeAt(m));
              return (
                <div className="mem-row" key={m.id}>
                  {when && <span className="mem-when">{when}</span>}
                  <span className="mem-label">{m.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      <h2 className="scr-title">memory buckets</h2>
      <p className="scr-sub">every bucket in the organigram, who reaches it, and how much lives inside.</p>
      {buckets.length === 0 ? (
        <p className="scr-empty">no buckets declared on any agent yet — add <code>"buckets"</code> to agents in the org file.</p>
      ) : (
        <div className="bk-grid">
          {buckets.map(([b, agents], i) => (
            <button
              className="bk-card"
              key={b}
              style={{ ["--h" as string]: bucketHue(b), animationDelay: `${i * 70}ms` }}
              onClick={() => nav(`/buckets/${encodeURIComponent(b)}`)}
            >
              <div className="bk-top">
                <i className="bk-dot" />
                <span className="bk-name">{b}</span>
              </div>
              {hasSnapshot ? <BucketCount bucket={b} /> : <div className="bk-n dim">—</div>}
              <div className="bk-l">memories</div>
              {agents.length > 0 ? (
                <>
                  <div className="bk-crew">
                    {agents.slice(0, 7).map((a) => (
                      <span className="bk-face" key={a.id} title={a.name}>{a.emoji || "🤖"}</span>
                    ))}
                    {agents.length > 7 && <span className="bk-more">+{agents.length - 7}</span>}
                  </div>
                  <div className="bk-agents">{agents.slice(0, 3).map((a) => a.name).join(" · ")}{agents.length > 3 ? ` +${agents.length - 3}` : ""}</div>
                </>
              ) : (
                <div className="bk-agents unassigned">unassigned — no agent declares this bucket; add it to an agent's buckets to claim it</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── REPORTS ────────────────────────── */

function ReportsScreen({ org, hasSnapshot }: { org: BOrg; hasSnapshot: boolean }) {
  const api = useApi();
  const [rows, setRows] = useState<Loaded<BNode[]>>(null);
  const [who, setWho] = useState<string>("");
  // 425 reports were fetched and 100 rendered, so 325 of them were unreachable
  // by any means the UI offered. The page grows on demand instead.
  const PAGE = 100;
  const [cap, setCap] = useState(PAGE);
  const nameOf = useMemo(() => new Map(org.agents.map((a) => [a.id, a])), [org]);

  useEffect(() => {
    if (!hasSnapshot) return;
    fetchReports(api, null, 1000)
      .then(({ nodes }) => setRows(nodes))
      .catch(() => setRows("err"));
  }, [hasSnapshot, api]);

  const list = Array.isArray(rows) ? rows : [];
  const agents = useMemo(() => [...new Set(list.map(reportAgentId))].filter(Boolean), [rows]);
  const shown = list.filter((r) => !who || reportAgentId(r) === who);
  const total = useCountUp(shown.length);

  if (!hasSnapshot)
    return <div className="screen"><h2 className="scr-title">reports</h2><p className="scr-empty">start with <code>--snapshot</code> to see the portfolio timeline.</p></div>;

  return (
    <div className="screen">
      {/* on a failed read the count prints the same dash as every other failed
          number — a confident 0 above a body saying "unknown" is half a fix */}
      <h2 className="scr-title">reports <span className="scr-count">{rows === "err" ? "—" : total}</span></h2>
      <p className="scr-sub">what the fleet has been closing, newest first.</p>
      {agents.length > 1 && (
        /* the filter is this tab's primary control and it was a row of <span>s:
           six focusable elements on the whole screen, none of them these.
           Toggle buttons in a labelled group — not a radiogroup, because a
           chip can be toggled OFF and there is no arrow-key roving, and
           claiming radio semantics without either is worse than none. */
        <div className="rep-filter" role="group" aria-label="filter reports by who filed them">
          <Chip tone={who === "" ? "" : "alt"} pressed={who === ""} onClick={() => { setWho(""); setCap(PAGE); }}>everyone</Chip>
          {agents.map((a) => (
            <Chip key={a} tone={who === a ? "" : "alt"} pressed={who === a} onClick={() => { setWho(who === a ? "" : a); setCap(PAGE); }}>
              {nameOf.get(a)?.emoji ?? ""} {nameOf.get(a)?.name ?? a}
            </Chip>
          ))}
        </div>
      )}
      {rows === null ? (
        <p className="scr-empty">loading…</p>
      ) : rows === "err" ? (
        <p className="scr-empty">couldn't reach the API, so whether anything has been filed is <b>unknown</b> — this is not the same as no reports. Check <code>booboo panel</code> is still running, then reload.</p>
      ) : shown.length === 0 ? (
        <p className="scr-empty">no reports filed yet — they land here as agents close work (node type <code>report</code>).</p>
      ) : (
        <div className="timeline">
          {shown.slice(0, cap).map((r) => {
            const filer = reportAgentId(r);
            const a = filer ? nameOf.get(filer) : undefined;
            const when = relTime(nodeAt(r));
            const sum = nodeSummary(r);
            return (
              <div className="tl-row" key={r.id} style={{ ["--h" as string]: bucketHue(filer || "x") }}>
                <div className="tl-dot" />
                <div className="tl-body">
                  <div className="tl-top">
                    <span className="tl-ava">{a?.emoji ?? "🤖"}</span>
                    <span className="tl-agent">{a?.name ?? filer ?? "unknown"}</span>
                    {when && <span className="tl-when">{when}</span>}
                  </div>
                  <p className="tl-sum">{sum || r.label}</p>
                </div>
              </div>
            );
          })}
          {shown.length > cap && (
            <p className="scr-empty">
              showing the latest {cap} of {shown.length}.{" "}
              <button type="button" className="pnl-more" onClick={() => setCap((c) => c + PAGE)}>
                show {Math.min(PAGE, shown.length - cap)} more
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── RULES ────────────────────────── */

function RulesScreen({ org }: { org: BOrg }) {
  const rules = useMemo(() => {
    const declared = new Map<string, string[]>();
    for (const a of org.agents) for (const r of a.rules ?? []) {
      const arr = declared.get(r) ?? [];
      arr.push(a.id);
      declared.set(r, arr);
    }
    const inherited = new Map<string, string[]>();
    for (const a of org.agents) {
      const own = new Set(a.rules ?? []);
      const slice = orgBootSlice(org, a.id);
      for (const r of slice?.rules ?? []) if (!own.has(r)) {
        const arr = inherited.get(r) ?? [];
        arr.push(a.id);
        inherited.set(r, arr);
      }
    }
    const name = (id: string) => org.agents.find((a) => a.id === id)?.name ?? id;
    // The bar's denominator is the DECLARER'S OWN REACH, not the whole house.
    // Scaled against all 76 agents, every departmental SOP (binding 5-9 of its
    // own people) rendered a ~5% sliver on a full track — nine "stalled
    // loading bars" that made honest data look like an error state. A rule is
    // full when it binds everyone below its declarer, which is what a bound
    // department actually looks like.
    const reach = (ids: string[]): number => {
      const below = (id: string): number => {
        const kids = org.agents.filter((x) => x.parent === id);
        return kids.reduce((n, k) => n + 1 + below(k.id), 0);
      };
      return Math.max(1, ids.reduce((n, id) => n + below(id), 0));
    };
    return [...declared.entries()]
      .sort((x, y) => x[0].localeCompare(y[0]))
      .map(([r, by]) => ({
        rule: r,
        global: by.includes(org.root),
        declaredBy: by.map(name),
        inheritedBy: (inherited.get(r) ?? []).map(name),
        reach: reach(by),
      }));
  }, [org]);

  return (
    <div className="screen">
      <h2 className="scr-title">rules <span className="scr-count">{rules.length}</span></h2>
      <p className="scr-sub">every rule in the organigram — who declares it, and who lives under it.</p>
      {rules.length === 0 ? (
        <p className="scr-empty">no rules declared yet — add <code>"rules"</code> refs to agents in the org file.</p>
      ) : (
        <div className="rule-list">
          {rules.map((r, i) => (
            <div className="rule-card" key={r.rule} style={{ animationDelay: `${i * 60}ms` }}>
              <div className="rule-top">
                <span className="rule-ref">{r.rule}</span>
                {r.global && <span className="rule-scope">global — binds everyone</span>}
              </div>
              {/* THE COUNT IS THE FACT; THE NAMES ARE THE FOOTNOTE. The House
                  Standard binds 75 agents and this printed all 75 as prose —
                  eight wrapped lines that turned the card into a paragraph in
                  a box and made every rule card the same grey slab. Six names
                  set the scale, the count carries the weight, and the full
                  list is one hover away. */}
              <div className="rule-meta">
                <span>declared by <b>{r.declaredBy.join(", ")}</b></span>
                {r.inheritedBy.length > 0 && (
                  <span title={`binds: ${r.inheritedBy.join(", ")}`}>
                    {" "}· binds <b>{r.inheritedBy.length}</b> below: {r.inheritedBy.slice(0, 6).join(", ")}
                    {r.inheritedBy.length > 6 && <i className="rule-more"> +{r.inheritedBy.length - 6} more</i>}
                  </span>
                )}
              </div>
              <div className="rule-bar" title={`binds ${r.inheritedBy.length} of the ${r.reach} below its declarer`}>
                <i style={{ width: `${Math.round((Math.min(r.inheritedBy.length, r.reach) / r.reach) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── GRAPH ────────────────────────── */

function GraphScreen({ hasSnapshot }: { hasSnapshot: boolean }) {
  if (!hasSnapshot)
    return <div className="screen"><h2 className="scr-title">graph</h2><p className="scr-empty">start with <code>--snapshot graph.json</code> and the 3D brain renders right here.</p></div>;
  return (
    <div className="graph-wrap">
      <iframe className="graph-frame" src="/view/?file=/snapshot.json" title="Booboo 3D brain" />
    </div>
  );
}

/* ────────────────────────── APP ────────────────────────── */

function App({ theme: pinnedTheme }: { theme?: "dark" | "light" }) {
  const api = useApi();
  const [tab, param] = useRoute();
  const [saved, setSaved] = useState<BOrg | null>(null);
  const [draft, setDraft] = useState<BOrg | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  const [applying, setApplying] = useState(false);

  const [totals, setTotals] = useState<{ mem: number; rep: number } | null>(null);

  useEffect(() => {
    api("/org")
      .then((o: BOrg) => {
        setSaved(o); setDraft(o);
        // ?embed=1 opens with NOTHING selected. Auto-selecting the root is right
        // for the full-screen tool (you land on something), but inside the
        // landing page it costs a quarter of the frame to a dossier nobody
        // asked for, hiding the cascade that is the reason it is embedded.
        // The same argument settles the phone, and more strongly: at 390px the
        // dossier is not a right rail but a sheet over more than half the
        // screen, so auto-selecting means a visitor's first sight of the staff
        // board is a card about one agent covering it.
        const embed = new URLSearchParams(window.location.search).get("embed");
        const narrow = typeof matchMedia === "function" && matchMedia("(max-width: 720px)").matches;
        if (!embed && !narrow) setSelected(o.root);
      })
      .catch(() => setErr("Can't load the organigram — is `booboo panel --org` running?"));
    api("/stats").then(setStats).catch(() => setStats(null));
    Promise.all([
      api("/nodes?type=memory&limit=1").then((j) => j.total as number),
      fetchReports(api, null, 1).then((r) => r.total),
    ])
      .then(([mem, rep]) => setTotals({ mem, rep }))
      .catch(() => setTotals(null));
  }, [api]);

  // Structured, not strings: every pending change has to be revertible ON ITS
  // OWN. The only undo used to be a global "discard", which makes a single
  // mis-drop cost you every other edit you had made, so people stop dragging.
  const changes = useMemo<Change[]>(() => {
    if (!saved || !draft) return [];
    const before = new Map(saved.agents.map((a) => [a.id, a]));
    const after = new Map(draft.agents.map((a) => [a.id, a]));
    const name = (id: string) => after.get(id)?.name ?? before.get(id)?.name ?? id;
    const noParent = ({ parent: _p, ...rest }: BOrgAgent) => rest;
    const out: Change[] = [];
    for (const a of draft.agents) {
      const b = before.get(a.id);
      if (!b) { out.push({ key: `add:${a.id}`, id: a.id, kind: "added", label: `＋ ${a.name} under ${a.parent ? name(a.parent) : "root"}` }); continue; }
      if ((b.parent ?? null) !== (a.parent ?? null)) out.push({ key: `move:${a.id}`, id: a.id, kind: "moved", label: `${a.name} → now under ${a.parent ? name(a.parent) : "root"}` });
      if (JSON.stringify(noParent(b)) !== JSON.stringify(noParent(a))) out.push({ key: `edit:${a.id}`, id: a.id, kind: "edited", label: `✎ ${a.name} edited` });
    }
    for (const b of saved.agents) if (!after.has(b.id)) out.push({ key: `rm:${b.id}`, id: b.id, kind: "removed", label: `− ${b.name} removed` });
    return out;
  }, [saved, draft]);

  /** Undo ONE pending change, leaving every other edit intact. */
  const revertOne = useCallback((c: Change) => {
    if (!saved || !draft) return;
    const was = saved.agents.find((a) => a.id === c.id);
    setDraft((d) => {
      if (!d) return d;
      if (c.kind === "added") return { ...d, agents: d.agents.filter((a) => a.id !== c.id) };
      if (c.kind === "removed" && was) return { ...d, agents: [...d.agents, was] };
      if (!was) return d;
      return {
        ...d,
        agents: d.agents.map((a) => {
          if (a.id !== c.id) return a;
          // a move restores only the parent; an edit restores everything else,
          // so reverting one does not silently undo the other.
          return c.kind === "moved" ? { ...a, parent: was.parent } : { ...was, parent: a.parent };
        }),
      };
    });
  }, [saved, draft]);

  // Tweakability — every field of every agent, plus add/remove, all draft-side.
  const updateAgent = useCallback((id: string, patch: Partial<BOrgAgent>) => {
    setDraft((d) => (d ? { ...d, agents: d.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) } : d));
  }, []);

  const addAgent = useCallback(
    (parentId: string) => {
      if (!draft) return;
      const nm = window.prompt("Name for the new agent:");
      if (!nm || !nm.trim()) return;
      const base = slugify(nm) || "agent";
      let newId = base;
      let i = 2;
      while (draft.agents.some((a) => a.id === newId)) newId = `${base}-${i++}`;
      setDraft({ ...draft, agents: [...draft.agents, { id: newId, name: nm.trim(), emoji: "🤖", parent: parentId }] });
      setSelected(newId);
    },
    [draft],
  );

  const removeAgent = useCallback(
    (id: string) => {
      if (!draft || id === draft.root) return;
      const ag = draft.agents.find((a) => a.id === id);
      if (!ag) return;
      const parentName = draft.agents.find((a) => a.id === ag.parent)?.name ?? "the root";
      const kids = draft.agents.filter((a) => a.parent === id).length;
      if (!window.confirm(`Remove ${ag.name}?${kids ? ` Its ${kids} direct report${kids > 1 ? "s" : ""} move up to ${parentName}.` : ""}`)) return;
      setDraft({
        ...draft,
        agents: draft.agents.filter((a) => a.id !== id).map((a) => (a.parent === id ? { ...a, parent: ag.parent ?? draft.root } : a)),
      });
      setSelected(ag.parent ?? draft.root);
    },
    [draft],
  );

  const isDescendant = useCallback((org: BOrg, maybeChild: string, of: string): boolean => {
    const byId = new Map(org.agents.map((a) => [a.id, a]));
    let cur = byId.get(maybeChild);
    const guard = new Set<string>();
    while (cur?.parent && !guard.has(cur.id)) {
      guard.add(cur.id);
      if (cur.parent === of) return true;
      cur = byId.get(cur.parent);
    }
    return false;
  }, []);

  const dropOn = useCallback(
    (targetId: string) => {
      if (!draft || !dragId || dragId === targetId) return;
      if (dragId === draft.root) return;
      if (isDescendant(draft, targetId, dragId)) return;
      setDraft({ ...draft, agents: draft.agents.map((a) => (a.id === dragId ? { ...a, parent: targetId } : a)) });
      setDragId(null);
    },
    [draft, dragId, isDescendant],
  );

  const apply = useCallback(async () => {
    if (!draft) return;
    setApplying(true);
    setErr("");
    try {
      await api("/org", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      setSaved(draft);
    } catch (e) {
      setErr(`apply failed: ${(e as { errors?: string[] })?.errors?.join("; ") ?? "unknown error"}`);
    } finally {
      setApplying(false);
    }
  }, [draft, api]);

  const agentCount = useCountUp(draft?.agents.length ?? 0);
  const nodeCount = useCountUp(stats?.nodes ?? 0, 1200);
  const memTotal = useCountUp(totals?.mem ?? 0, 1100);
  const repTotal = useCountUp(totals?.rep ?? 0, 1300);
  const [theme, toggleTheme] = useTheme(pinnedTheme);
  // "Show the law": the product's core idea, made visible on demand — rule
  // inheritance (House Standard → SOP → role) traced as a second reading of
  // the same rails, gold on dim, plus the boot-order chain on every card.
  const [showLaw, setShowLaw] = useState(false);

  // data-theme sits on the panel's own root — the tokens are declared here too
  // (see panel.css), so theme and palette can never be resolved by different
  // elements, which is what let a host's shell shadow half the board.
  if (err && !draft) return <div className="pnl-fatal" data-theme={theme}>{err}</div>;
  if (!draft) return <div className="pnl-fatal calm" data-theme={theme}>waking the organigram…</div>;

  return (
    <div className="pnl" data-theme={theme}>
      <div className="pnl-aurora" aria-hidden />
      <Constellation />
      <header className="bar">
        {/* the board had NO h1 at all — every screen opened at h2 — so the one
            thing that names the document was a div. It is the house's name. */}
        <h1 className="bar-brand">🐾 <b>{draft.title || "the organigram"}</b></h1>
        <div className="bar-stats">
          <span><b>{agentCount}</b> agents</span>
          {stats && <span><b>{nodeCount.toLocaleString()}</b> nodes</span>}
          {totals && <span onClick={() => nav("/buckets")} className="tap"><b>{memTotal.toLocaleString()}</b> memories</span>}
          {totals && <span onClick={() => nav("/reports")} className="tap"><b>{repTotal.toLocaleString()}</b> reports</span>}
        </div>
        <div className="bar-actions">
          {tab === "org" && (
            <button
              className={`btn ghost law-toggle${showLaw ? " on" : ""}`}
              title="trace rule inheritance — House Standard → SOP → role"
              aria-pressed={showLaw}
              onClick={() => setShowLaw((v) => !v)}
            >
              ⚖ show the law
            </button>
          )}
          {toggleTheme && <button className="btn ghost theme-toggle" title="light / dark" aria-label="toggle light or dark theme" onClick={toggleTheme}>{theme === "dark" ? "☀" : "☾"}</button>}
          {changes.length > 0 ? (
            <>
              <span className="bar-draft">{changes.length} unapplied change{changes.length > 1 ? "s" : ""}</span>
              <button className="btn ghost" onClick={() => setDraft(saved)}>discard</button>
              <button className="btn primary" disabled={applying} onClick={apply}>
                {applying ? "applying…" : "apply → org file"}
              </button>
            </>
          ) : (
            <span className="bar-ok">● in sync with the org file</span>
          )}
        </div>
      </header>

      {/* Deliberately NOT role="tablist": these change the hash route, and a
          tablist promises tabpanels wired by aria-controls that do not exist
          here. Navigation that announces which one you are on is the honest
          shape, so <nav> keeps its name and the current tab says so. */}
      <nav className="tabs" aria-label="board sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " on" : ""}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => nav(`/${t.id === "org" ? "" : t.id}`)}
          >
            <span className="tab-glyph" aria-hidden="true">{t.glyph}</span> {t.label}
          </button>
        ))}
      </nav>

      {changes.length > 0 && tab === "org" && (
        <div className="pending">
          <span className="pending-lead">unapplied</span>
          {changes.map((c) => (
            <button
              key={c.key}
              type="button"
              className="pending-item"
              title="undo just this change"
              onClick={() => revertOne(c)}
            >
              {c.label}<i aria-hidden="true">undo</i>
            </button>
          ))}
        </div>
      )}
      {err && <div className="pnl-err">{err}</div>}

      <div className="content" key={tab + (param ?? "")}>
        {tab === "org" && (
          <OrgScreen
            draft={draft}
            selected={selected}
            dragId={dragId}
            setSelected={setSelected}
            setDragId={setDragId}
            dropOn={dropOn}
            hasSnapshot={!!stats}
            onUpdate={updateAgent}
            onAdd={addAgent}
            onRemove={removeAgent}
            showLaw={showLaw}
          />
        )}
        {tab === "buckets" && <BucketsScreen org={draft} param={param} hasSnapshot={!!stats} />}
        {tab === "reports" && <ReportsScreen org={draft} hasSnapshot={!!stats} />}
        {tab === "rules" && <RulesScreen org={draft} />}
        {tab === "graph" && <GraphScreen hasSnapshot={!!stats} />}
      </div>
    </div>
  );
}

/* ────────────────────────── EXPORTED PANEL ────────────────────────── */

// The mountable component. Standalone: <Panel /> talks to same-origin /api/*.
// Embedded in a host: pass `api` to inject a backend (auth, base URL, proxy).
// The panel carries its own styles via <style>, so a host needs no CSS import.
//
// `theme` pins the palette for hosts that have a ground colour of their own —
// a dark cockpit should not get a white slab dropped into it, and before this
// existed a host had no way to say so (localStorage and ?embed were the only
// levers, and neither is a host's to pull). Pinned means pinned: the in-panel
// toggle is not rendered, so the host's choice cannot drift out from under it.
// Left unset, the panel keeps its own behaviour: light by default, dark if the
// visitor has explicitly toggled it.
export function Panel({ api = defaultApi, theme }: { api?: ApiFn; theme?: "dark" | "light" } = {}) {
  return (
    <ApiCtx.Provider value={api}>
      <style>{PANEL_CSS}</style>
      <App theme={theme} />
    </ApiCtx.Provider>
  );
}
