import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { relTime, type BoobooGraph, type BNode, type BLink } from "@booboo-brain/spec";
import { Booboo, defaultCfg, type BoobooCfg } from "./Booboo";
import { usePersisted } from "./usePersisted";

/* ── design tokens ─────────────────────────────────────────────── */
const T = {
  bg: "#06080e",
  panel: "rgba(11,14,21,0.92)",
  panelSolid: "#0b0e15",
  card: "#0f131c",
  line: "#222734",
  text: "#E8DCC4",
  dim: "#8a8268",
  faint: "#585240",
  gold: "#c9a04a",
  goldHi: "#E8C877",
  green: "#5fae7e",
  amber: "#d6a23e",
  red: "#d05a5a",
  teal: "#4ECDC4",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace",
};
const PULSE_CSS =
  "@keyframes bbpulse{0%,100%{opacity:1}50%{opacity:.3}}.bb-pulse{animation:bbpulse 2.4s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.bb-pulse{animation:none}}";

const copy = (text: string) => {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    /* clipboard unavailable */
  }
};

type Rel = { dir: "out" | "in"; rel: string; other: string };
type Flag = { id: string; label: string; kind: string };
const FLAG_RANK = ["critical", "overdue", "stale", "orphan"];
const FLAG_HUE: Record<string, string> = { critical: "#d05a5a", overdue: "#d6a23e", stale: "#c9a04a", orphan: "#8a8268" };
const ORIENT_KEY = "booboo-oriented-v1";

/* ── narrow / touch ──
   Every piece of chrome in this file is an inline style, which is exactly why
   the viewer had no responsive behaviour at all: you cannot write a media
   query in a style object. So the breakpoint is a hook and the handful of
   places that genuinely differ read it.

   `narrow` and `touch` are asked separately on purpose. Width decides whether
   a 310px panel fits; input decides whether "drag to rotate · scroll to zoom ·
   press / to find" is a lie. A small window on a laptop is narrow and not
   touch; an iPad is touch and not narrow. */
const NARROW = 720;
function useMedia(query: string) {
  const [hit, setHit] = useState(() => (typeof matchMedia === "function" ? matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(query);
    const on = () => setHit(m.matches);
    m.addEventListener("change", on);
    on();
    return () => m.removeEventListener("change", on);
  }, [query]);
  return hit;
}
const useNarrow = () => useMedia(`(max-width: ${NARROW}px)`);
const useTouch = () => useMedia("(pointer: coarse)");

const mergeCfg = (initial: BoobooCfg, s: Partial<BoobooCfg>): BoobooCfg => ({
  ...initial,
  ...s,
  sizes: { ...initial.sizes, ...(s.sizes ?? {}) },
  layers: { ...initial.layers, ...(s.layers ?? {}) },
});
function urlCfg(): Partial<BoobooCfg> | null {
  if (typeof window === "undefined") return null;
  try {
    const u = new URLSearchParams(window.location.search).get("cfg");
    if (u) return JSON.parse(decodeURIComponent(u)) as Partial<BoobooCfg>;
  } catch {
    /* ignore malformed ?cfg= */
  }
  return null;
}

/* ── view presets (CRAFT §4): four buttons, not fourteen sliders. A converting
   surface shows OVERVIEW · DEPARTMENTS · LEDGER · TRACE; the slider drawer
   below is the "pro controls" — still there, no longer the front door. */
function layerSet(data: BoobooGraph, visible: boolean): Record<string, boolean> {
  const o: Record<string, boolean> = {};
  data.meta.layers.forEach((l) => (o[l.name] = visible));
  return o;
}
function layersOnly(data: BoobooGraph, names: string[]): Record<string, boolean> {
  const o = layerSet(data, false);
  for (const n of names) o[n] = true;
  return o;
}
function layersExcept(data: BoobooGraph, names: string[]): Record<string, boolean> {
  const o = layerSet(data, true);
  for (const n of names) o[n] = false;
  return o;
}
type ViewPreset = { id: string; label: string; hint: string; apply: (data: BoobooGraph) => Partial<BoobooCfg> };
const VIEW_PRESETS: ViewPreset[] = [
  {
    id: "overview", label: "Overview", hint: "the whole house, every band lit — the front-door frame",
    apply: (data) => ({ layers: layerSet(data, true), orbit: 1, drift: 1, spines: 1, bloom: 0, fog: 0, cinematic: 1, peel: 1.2, lines: 0.15, flow: 1 }),
  },
  {
    id: "departments", label: "Departments", hint: "the chain of command — ledger dimmed, the spines lit",
    apply: (data) => ({ layers: layersExcept(data, ["ledger"]), orbit: 0.4, drift: 0.3, spines: 1.6, bloom: 0, fog: 0, cinematic: 1, peel: 1.6, lines: 0.1, flow: 0.6 }),
  },
  {
    id: "ledger", label: "Ledger", hint: "the memory — structure dimmed, the field brought forward",
    apply: (data) => ({ layers: layersOnly(data, ["ledger"]), orbit: 0.5, drift: 0.4, spines: 0, bloom: 0, fog: 0.6, cinematic: 1, peel: 1.0, lines: 0.25, flow: 1.4 }),
  },
  {
    id: "trace", label: "Trace", hint: "hold still and read the alarm — nothing spinning, nothing hidden",
    apply: (data) => ({ layers: layerSet(data, true), orbit: 0, drift: 0, spines: 1.2, bloom: 0, fog: 0, cinematic: 0.6, peel: 1.2, lines: 0.15, flow: 1 }),
  },
];

function PresetBar({ data, active, onPick }: { data: BoobooGraph; active: string | null; onPick: (p: ViewPreset) => void }) {
  return (
    <div style={{ position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 10, display: "flex", gap: 6, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 10, padding: 5, backdropFilter: "blur(10px)", boxShadow: "0 12px 36px rgba(0,0,0,0.4)" }}>
      {VIEW_PRESETS.map((p) => {
        const on = active === p.id;
        return (
          <button
            key={p.id}
            title={p.hint}
            onClick={() => onPick(p)}
            style={{
              background: on ? "#221c10" : "transparent", border: `1px solid ${on ? T.gold : "transparent"}`,
              color: on ? T.goldHi : T.dim, borderRadius: 7, padding: "7px 14px", cursor: "pointer",
              fontFamily: T.sans, fontSize: 11.5, letterSpacing: 0.3, fontWeight: on ? 650 : 500,
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── error boundary: a render throw shows a fallback, not a blank white canvas ── */
class RenderBoundary extends Component<{ children: ReactNode }, { msg: string | null }> {
  state = { msg: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { msg: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.msg == null) return this.props.children;
    return (
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#e6a0a0", fontFamily: T.sans, textAlign: "center", padding: 24 }}>
        <div>
          <div style={{ fontSize: 18 }}>Failed to render</div>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85, maxWidth: 520, wordBreak: "break-word", color: T.dim }}>{this.state.msg}</div>
        </div>
      </div>
    );
  }
}

/** Booboo + the full instrument: HUD · click→node menu · a collapsible control drawer.
 *  Controls live on the LEFT, the node menu on the RIGHT — they never overlap. */
export function BoobooView({
  data,
  // v4: rings default off + spines added + spin halved. A stale v3 in
  // localStorage would keep serving the old look to anyone who has visited
  // before — which is exactly who is coming back to re-judge it.
  persistKey = "booboo-cfg-v4",
  persist = true,
  initialSel = null,
  initialCfg,
  controls = true,
}: {
  data: BoobooGraph;
  persistKey?: string;
  persist?: boolean;
  initialSel?: string | null;
  /** false = "lite": the scene, flags, dossier and palette, without the
   *  fourteen-slider drawer. For embedding a playable graph in a page. */
  controls?: boolean;
  // Opening overrides merged over defaultCfg — lets a host set its own look
  // (e.g. a de-bloomed, peeled-wide layered view) without forking the viewer.
  initialCfg?: Partial<BoobooCfg>;
}) {
  const initial = useMemo(() => ({ ...defaultCfg(data), ...(initialCfg ?? {}) }), [data, initialCfg]);
  const [cfg, setCfg, resetCfg] = usePersisted<BoobooCfg>(persistKey, initial, persist, mergeCfg, urlCfg());
  const [sel, setSel] = useState<string | null>(initialSel);
  // Camera target, set only by a host over booboo:focus. Never by a click —
  // hijacking the camera on every selection would fight the user in the board.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Optional per-message framing, in multiples of the graph radius. The default
  // is tuned, but "point at this node" is not one framing for every host: a page
  // whose whole claim is one-out-of-thousands wants the colony to stay whole,
  // and a board drilling into a subtree does not.
  const [focusDist, setFocusDist] = useState<number | undefined>(undefined);
  // Where a focused node should LAND, as a signed fraction of frame width from
  // centre. Only the host knows this — it is the one that crops our chrome and
  // runs its own copy over us — so undefined means "use the viewer's own".
  const [focusBias, setFocusBias] = useState<number | undefined>(undefined);
  const [palette, setPalette] = useState(false);
  // view presets (CRAFT §4) — which one is active, purely a UI highlight; the
  // pro drawer below can always override it, and that's fine (a preset is a
  // starting frame, not a lock).
  const [activePreset, setActivePreset] = useState<string | null>("overview");

  /* ── host bridge ──
     `?cfg=` only lands once, at load, which is fine for a bookmark and useless
     for an embed that wants to CHANGE as the page scrolls. Re-pointing the
     iframe src would remount the whole scene and flash a WebGL re-init on every
     beat, so the host needs to talk to a viewer that is already running.

     A host posts { type: "booboo:cfg", cfg: Partial<BoobooCfg> } and it merges
     through the same mergeCfg the URL and the drawer use — so `peel` spreads the
     layer shells apart, `layers` isolates a band, and a page can walk down
     through the graph explaining one layer at a time.

     ORIGIN IS CHECKED FIRST. `message` fires for ANY page that frames us, so an
     unguarded listener would hand every embedder a remote control over the
     viewer. Allowlist only. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ALLOWED = [
      /^https:\/\/([a-z0-9-]+\.)*fractionalhq\.uk$/,
      /^https:\/\/([a-z0-9-]+\.)*framer\.(com|app|website)$/,
      // Framer PREVIEWS the page inside project-<id>.framercanvas.com, not on
      // framer.com. Miss this and the guard silently drops every message from
      // the editor — the embed looks alive (it has its own idle orbit) while
      // ignoring the host completely, which reads as "the bridge does nothing".
      /^https:\/\/([a-z0-9-]+\.)*framercanvas\.com$/,
      /^http:\/\/localhost(:\d+)?$/,
    ];
    const onMessage = (e: MessageEvent) => {
      if (!ALLOWED.some((re) => re.test(e.origin))) return;
      const m = e.data as { type?: string; cfg?: Partial<BoobooCfg>; id?: string | null; dist?: number; bias?: number } | null;
      if (!m) return;

      if (m.type === "booboo:cfg" && m.cfg) {
        setCfg((prev) => mergeCfg(prev, m.cfg as Partial<BoobooCfg>));
        setActivePreset(null); // the host is driving now; no preset is "active"
        return;
      }

      /* Selecting a node is what makes an embed EXPLAIN itself. Lighting a
         whole layer is scenery — the reader sees a band move and learns
         nothing. Naming one node opens its dossier (type, layer, relations)
         and labels it in space, so a host page can say "down to the night
         porter" and have the graph point at the night porter. `null` clears. */
      if (m.type === "booboo:sel") {
        setSel(typeof m.id === "string" ? m.id : null);
        return;
      }

      /* booboo:focus MOVES THE CAMERA to one node, which `sel` deliberately
         does not. Selection torches a neighbourhood where it stands; on a
         2,839-node graph the reader still has to hunt the frame for what
         changed. Focus flies there and holds it, so "it finds the one that
         matters" stops being a sentence in the copy and becomes the thing on
         screen. Kept SEPARATE from sel on purpose — the board and the site
         both select without ever wanting the camera taken off them, and
         folding the two together would have moved their cameras too.
         `null` releases the camera and eases it home. */
      if (m.type === "booboo:focus") {
        setFocusId(typeof m.id === "string" ? m.id : null);
        setFocusDist(typeof m.dist === "number" ? m.dist : undefined);
        setFocusBias(typeof m.bias === "number" ? m.bias : undefined);
      }
    };
    window.addEventListener("message", onMessage);
    // Tell the host we are listening, so it does not post into the void while
    // the scene is still booting.
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "booboo:ready" }, "*");
      }
    } catch {
      /* cross-origin parent that refuses postMessage — nothing to do */
    }
    return () => window.removeEventListener("message", onMessage);
  }, [setCfg]);

  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);

  // semantic adjacency for the dossier — structural spines excluded so the verb
  // list reads as meaning, not plumbing (the Atlas dossier pattern)
  const adj = useMemo(() => {
    const m = new Map<string, Rel[]>();
    const push = (id: string, r: Rel) => {
      const a = m.get(id);
      if (a) a.push(r);
      else m.set(id, [r]);
    };
    for (const l of data.links) {
      if (l.type === "spine" || l.type === "tether") continue;
      push(l.source, { dir: "out", rel: l.type, other: l.target });
      push(l.target, { dir: "in", rel: l.type, other: l.source });
    }
    return m;
  }, [data]);

  // `/` opens the concierge palette (never while typing); Escape closes palette → dossier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setPalette(true);
      } else if (e.key === "Escape") {
        setPalette((p) => {
          if (p) return false;
          setSel(null);
          return p;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of data.nodes) c[n.layer] = (c[n.layer] ?? 0) + 1;
    return c;
  }, [data]);
  const layerColor = useMemo(() => {
    const m: Record<string, string> = {};
    data.meta.layers.forEach((l) => (m[l.name] = l.color ?? "#9aa"));
    return m;
  }, [data]);
  // reports indexed by the agent that filed them, newest first — one pass over
  // the graph, not a scan per selection.
  const reportsByAgent = useMemo(() => {
    const m = new Map<string, BNode[]>();
    for (const n of data.nodes) {
      if (n.type !== "report" || !n.parent) continue;
      const a = m.get(n.parent);
      if (a) a.push(n);
      else m.set(n.parent, [n]);
    }
    const at = (x: BNode) => Date.parse(String((x.data as Record<string, unknown> | undefined)?.at ?? "")) || 0;
    for (const list of m.values()) list.sort((x, y) => at(y) - at(x));
    return m;
  }, [data]);

  const narrow = useNarrow();
  const touch = useTouch();

  const node = sel ? byId.get(sel) ?? null : null;
  // the alarms, worst first — the orientation card leads with the real problem
  const flags = useMemo(
    () =>
      data.nodes
        .filter((n) => {
          const d = (n.data ?? {}) as Record<string, unknown>;
          return typeof d.flag === "string" || d.health === "amber" || d.health === "red";
        })
        .map((n) => {
          const d = (n.data ?? {}) as Record<string, unknown>;
          const kind = (typeof d.flag === "string" ? d.flag : d.health === "red" ? "critical" : "overdue") as string;
          return { id: n.id, label: n.label, kind };
        })
        .sort((a, b) => FLAG_RANK.indexOf(a.kind) - FLAG_RANK.indexOf(b.kind)),
    [data],
  );

  return (
    <div style={{ position: "absolute", inset: 0, background: T.bg, fontFamily: T.sans }}>
      <style>{PULSE_CSS}</style>
      <RenderBoundary>
        {/* The band and node labels are 3D-positioned HTML. Pulled back far
            enough to fit a phone's width, four band names and up to 150 node
            names land within a few dozen pixels of each other and overprint
            into an unreadable smear — a real capture showed "THE LEDGER ·
            MEMORY / BRONZE · SILVER · DEPARTMENT HEADS" stacked on one line.
            The Orient card already names the bands in order, so dropping them
            here costs a narrow visitor nothing. */}
        {/* On narrow the dossier is 94% of the frame — there is no visible field
            left to centre a node in, so the lateral correction is switched off
            rather than shoving the node off the left edge. */}
        <Booboo data={data} cfg={narrow ? { ...cfg, labels: false } : cfg} onSelect={setSel} sel={sel} focusId={focusId} focusDist={focusDist} focusPanelPx={node && !narrow ? DOSSIER_W : 0} focusBias={focusBias} />
      </RenderBoundary>

      {/* HUD — top-left. On narrow it drops BELOW the preset bar, which is
          centred and eats the full width there; before this they were both at
          top:18 and the house's own name rendered behind the buttons.
          Gated with the rest of the chrome: an embed host puts its own title on
          the page, and the tunnel already prints these exact counts in its
          "the file" block, so this was the same fact twice in two typefaces. */}
      {controls && (
      <div style={{ position: "absolute", top: narrow ? 62 : 18, left: narrow ? 12 : 20, zIndex: 10, pointerEvents: "none" }}>
        <div style={{ color: T.gold, fontSize: 13, letterSpacing: 2.5, fontWeight: 700, fontFamily: T.mono }}>🐾 {data.meta.title ?? "BOOBOO"}</div>
        <div style={{ color: T.faint, fontSize: 10.5, letterSpacing: 0.6, marginTop: 3 }}>
          {data.nodes.length.toLocaleString()} nodes · {data.links.length.toLocaleString()} links · {data.meta.layers.length} layers
        </div>
        {/* The band legend is dropped on narrow: it wrapped to two full-width
            rows over the scene, and the Orient card below carries the same
            four bands with the same colour dots, in order, with their meaning
            spelled out. Two legends for one fact, and the worse one was on top
            of the house. */}
        {!narrow && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 12px", marginTop: 9, fontSize: 11 }}>
            {data.meta.layers.map((l) => (
              <span key={l.name} style={{ color: l.color ?? "#aaa", opacity: cfg.layers[l.name] !== false ? 1 : 0.32, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: 7, background: l.color ?? "#aaa", display: "inline-block" }} />
                {l.label ?? l.name} <b style={{ color: T.dim, fontWeight: 600 }}>{(counts[l.name] ?? 0).toLocaleString()}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      )}

      {controls && (
        <PresetBar
          data={data}
          active={activePreset}
          onPick={(p) => { setCfg(p.apply(data)); setActivePreset(p.id); }}
        />
      )}

      {/* Fourteen sliders in a 236px drawer is not a phone interface, and its
          button sat on top of the hint line. The four presets above stay —
          they are the front door on every width. */}
      {controls && !narrow && (
        <Controls
          data={data}
          cfg={cfg}
          setCfg={(patch) => { setActivePreset(null); setCfg(patch); }}
          resetCfg={() => { setActivePreset("overview"); resetCfg(); }}
        />
      )}

      {/* ── EMBEDDED MODE (controls=false, i.e. ?chrome=lite) SHOWS NO CHROME ──
          controls=false is not "hide the sliders", it is "you are scenery inside
          somebody else's page". A host embed still speaks the full postMessage
          protocol (booboo:cfg / booboo:sel / booboo:focus / booboo:ready) — only
          chrome=0 drops that, and it renders a different component entirely.

          WHY THIS CHANGED, 2026-08-10: the Booboo tunnel embeds this with
          pointer-events:none, so every affordance below was a lie. On desktop
          nobody noticed because the host crops 440px off the right and the panels
          fall out of frame; at phone widths the crop is gone and the graph sat
          there inviting "drag to turn · pinch to zoom · tap a node" while
          ignoring every touch. Suppressing beats re-enabling pointer events: a
          58vh interactive WebGL canvas mid-page is a scroll trap on touch, which
          is exactly why the host disables it. */}
      {controls && node && <Dossier key={node.id} n={node} byId={byId} rels={adj.get(node.id) ?? []} reports={reportsByAgent.get(node.id) ?? []} accent={layerColor[node.layer] ?? T.gold} onClose={() => setSel(null)} onJump={setSel} />}

      {palette && <Palette data={data} layerColor={layerColor} onJump={(id) => { setSel(id); setPalette(false); }} onClose={() => setPalette(false)} />}

      {controls && !sel && <Orient data={data} flags={flags} narrow={narrow} touch={touch} onJump={setSel} onAsk={() => setPalette(true)} />}

      {/* The hint sat bottom-centre at 10px and ran straight under the
          "pro controls" button on a phone — and told a touch visitor to
          scroll to zoom and press a key they do not have. */}
      {controls && (
        <div style={{ position: "absolute", bottom: narrow ? 10 : 12, left: "50%", transform: "translateX(-50%)", width: narrow ? "100%" : "auto", textAlign: "center", fontSize: 10, color: T.faint, pointerEvents: "none", letterSpacing: 0.4 }}>
          {touch ? (
            <>drag to turn · pinch to zoom · tap a node</>
          ) : (
            <>drag to rotate · scroll to zoom · click a node · <span style={{ color: T.dim }}>press / to find</span></>
          )}
        </div>
      )}
    </div>
  );
}

/* ── orientation: what am I looking at, and where's the problem? ──
   A stranger used to land in a 3D scene with a fourteen-slider drawer and no
   legend. This names the bands top-to-bottom, then hands them the actual
   alarm to click. Dismissed state is remembered; "what am I looking at?"
   in the corner brings it back. */
function Orient({ data, flags, narrow, touch, onJump, onAsk }: { data: BoobooGraph; flags: Flag[]; narrow: boolean; touch: boolean; onJump: (id: string) => void; onAsk: () => void }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(ORIENT_KEY) !== "1"; } catch { return true; }
  });
  const dismiss = () => {
    setOpen(false);
    try { localStorage.setItem(ORIENT_KEY, "1"); } catch { /* private mode */ }
  };
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ position: "absolute", ...(narrow ? { bottom: 34, right: 12 } : { top: 18, right: 20 }), zIndex: 10, ...btn(), padding: "6px 11px", fontSize: 10.5, background: T.panel, backdropFilter: "blur(8px)" }}>
        what am I looking at?
      </button>
    );
  }
  const worst = flags[0];
  return (
    /* On a phone this card is 350 of 390 available pixels. Anchored top-right
       it covered the top third of the scene, so the first thing a visitor saw
       of the brain was a card explaining a brain they could not see. Docked to
       the bottom instead: the house reads above it, the card below, the way
       the landing already orders hook-then-label. */
    <div style={{ position: "absolute", ...(narrow ? { left: 10, right: 10, bottom: 30 } : { top: 18, right: 20, width: 310, maxWidth: "calc(100% - 40px)" }), zIndex: 10, background: T.panel, border: `1px solid ${T.line}`, borderTop: `2px solid ${T.gold}`, borderRadius: 8, padding: narrow ? "12px 13px 11px" : "15px 16px 14px", backdropFilter: "blur(10px)", boxShadow: "0 14px 44px rgba(0,0,0,.5)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
        <span style={{ fontFamily: T.mono, fontSize: 9.5, letterSpacing: 2, textTransform: "uppercase", color: T.gold }}>You're looking at</span>
        <button onClick={dismiss} title="dismiss" style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ color: T.text, fontSize: 13.5, lineHeight: 1.5, marginBottom: 12 }}>
        {data.meta.title ?? "a Booboo brain"} — every role its own agent, stacked in bands.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 13 }}>
        {data.meta.layers.map((l, i) => (
          <div key={l.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
            <span style={{ width: 7, height: 7, borderRadius: 7, background: l.color ?? T.dim, flex: "0 0 auto" }} />
            <span style={{ color: T.text }}>{(l.label ?? l.name).split("·").pop()?.trim()}</span>
            <span style={{ color: T.faint, fontSize: 10 }}>{i === 0 ? "top band" : i === data.meta.layers.length - 1 ? "the floor" : ""}</span>
          </div>
        ))}
      </div>
      {worst && (
        <button
          onClick={() => { onJump(worst.id); dismiss(); }}
          style={{ width: "100%", textAlign: "left", background: "rgba(208,90,90,.09)", border: `1px solid ${FLAG_HUE[worst.kind] ?? T.line}`, borderRadius: 6, padding: "9px 11px", cursor: "pointer", marginBottom: 8 }}
        >
          <div style={{ fontFamily: T.mono, fontSize: 9, letterSpacing: 1.6, textTransform: "uppercase", color: FLAG_HUE[worst.kind] ?? T.dim, marginBottom: 3 }}>
            Start here · {flags.length} flag{flags.length > 1 ? "s" : ""}
          </div>
          <div style={{ color: T.text, fontSize: 12, lineHeight: 1.4 }}>{worst.label}</div>
        </button>
      )}
      <div style={{ display: "flex", gap: 12, fontSize: 10, color: T.faint, fontFamily: T.mono }}>
        <span>{touch ? "tap any node" : "click any node"}</span>
        <button onClick={onAsk} style={{ background: "none", border: "none", padding: 0, color: T.dim, cursor: "pointer", fontFamily: T.mono, fontSize: 10, textDecoration: "underline dotted" }}>{touch ? "search" : "press / to find"}</button>
      </div>
    </div>
  );
}

/* ── the concierge palette: one input — find a node, jump to it ── */
function Palette({ data, layerColor, onJump, onClose }: { data: BoobooGraph; layerColor: Record<string, string>; onJump: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const hit = (n: BNode) => n.label.toLowerCase().includes(s) || n.id.toLowerCase().includes(s);
    const isObs = (n: BNode) => n.type === "obs" || n.type === "observation" || n.type === "memory";
    const prim = data.nodes.filter((n) => !isObs(n) && hit(n)).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    const sec = data.nodes.filter((n) => isObs(n) && hit(n));
    return [...prim, ...sec].slice(0, 14);
  }, [q, data]);
  useEffect(() => setHi(0), [q]);
  const pick = (i: number) => { const r = results[i]; if (r) onJump(r.id); };
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(4,6,10,0.55)", backdropFilter: "blur(3px)", zIndex: 30 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "16%", left: "50%", transform: "translateX(-50%)", width: 540, maxWidth: "92%", background: T.panelSolid, border: `1px solid ${T.line}`, borderRadius: 10, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", overflow: "hidden" }}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter") pick(hi);
          }}
          placeholder="Find anything in the house…"
          style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", outline: "none", color: T.text, fontFamily: T.mono, fontSize: 14, padding: "14px 16px", borderBottom: results.length ? `1px solid ${T.line}` : "none" }}
        />
        {results.length > 0 && (
          <div style={{ maxHeight: 380, overflowY: "auto", padding: 6 }}>
            {results.map((r, i) => (
              <div key={r.id} onClick={() => pick(i)} onMouseEnter={() => setHi(i)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", borderRadius: 6, cursor: "pointer", background: i === hi ? "#141926" : "transparent" }}>
                <span style={{ width: 7, height: 7, borderRadius: 7, flex: "0 0 auto", background: layerColor[r.layer] ?? T.dim }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: T.text, fontSize: 12.5 }}>{r.icon ? r.icon + " " : ""}{r.label}</span>
                <span style={{ marginLeft: "auto", flex: "0 0 auto", color: T.faint, fontSize: 9.5, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 6px", letterSpacing: 0.4 }}>{r.type}</span>
              </div>
            ))}
          </div>
        )}
        {q.trim().length >= 2 && results.length === 0 && (
          <div style={{ padding: "12px 16px", color: T.dim, fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}>
            No matches — the house also answers questions over MCP.
            <button onClick={() => copy(`${location.origin}/mcp`)} style={{ ...btn(), fontSize: 9.5, flex: "0 0 auto" }}>copy endpoint</button>
          </div>
        )}
        <div style={{ padding: "7px 16px", borderTop: `1px solid ${T.line}`, color: T.faint, fontSize: 9.5, letterSpacing: 0.5, display: "flex", gap: 14 }}>
          <span>↑↓ move</span><span>↵ open</span><span>esc close</span>
        </div>
      </div>
    </div>
  );
}

/* ── Controls: collapsible left drawer (never collides with the right menu) ── */
function Controls({
  data,
  cfg,
  setCfg,
  resetCfg,
}: {
  data: BoobooGraph;
  cfg: BoobooCfg;
  setCfg: (patch: Partial<BoobooCfg> | ((p: BoobooCfg) => BoobooCfg)) => void;
  resetCfg: () => void;
}) {
  // CRAFT §4: a converting surface shows four buttons (the PresetBar above),
  // not fourteen sliders — this drawer is the "pro controls", closed by default.
  const [open, setOpen] = useState(false);
  const layerVisible = (name: string) => cfg.layers[name] !== false;
  const toggleLayer = (name: string) => setCfg((p) => ({ ...p, layers: { ...p.layers, [name]: !layerVisible(name) } }));
  const setSize = (name: string, v: number) => setCfg((p) => ({ ...p, sizes: { ...p.sizes, [name]: v } }));
  const copyWallpaper = () => copy(`${location.origin}${location.pathname}?cfg=${encodeURIComponent(JSON.stringify(cfg))}`);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title="pro controls — fourteen sliders behind the four presets above" style={{ position: "absolute", bottom: 22, left: 20, background: T.panel, border: `1px solid ${T.line}`, color: T.dim, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontFamily: T.sans, fontSize: 11, letterSpacing: 0.5, backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 13 }}>⚙</span> pro controls
      </button>
    );
  }
  return (
    <div style={{ position: "absolute", bottom: 22, left: 20, width: 236, maxHeight: "calc(100vh - 44px)", overflowY: "auto", zIndex: 10, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10, fontSize: 11, color: T.dim, backdropFilter: "blur(10px)", boxShadow: "0 12px 40px rgba(0,0,0,0.45)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: T.text, letterSpacing: 1, fontSize: 11, fontWeight: 600 }}>pro controls</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setCfg({ orbit: 0, drift: 0 })} title="pause spin + drift" style={btn()}>❄ still</button>
          <button onClick={resetCfg} style={btn()}>reset</button>
          <button onClick={() => setOpen(false)} title="hide" style={{ ...btn(), padding: "3px 8px" }}>✕</button>
        </div>
      </div>
      <Section label="scene">
        <Slider label="⟳ drift" v={cfg.drift} min={0} max={2.5} step={0.05} on={(v) => setCfg({ drift: v })} />
        <Toggle on={cfg.orbit > 0} onClick={() => setCfg({ orbit: cfg.orbit > 0 ? 0 : 1 })} label="✦ spin" tone="green" />
        <Slider label="spin" v={cfg.orbit} min={0} max={2.5} step={0.05} on={(v) => setCfg({ orbit: v })} />
        <Slider label="≋ fog" v={cfg.fog} min={0} max={2} step={0.05} on={(v) => setCfg({ fog: v })} />
        <Slider label="◐ film" v={cfg.cinematic} min={-0.8} max={1.6} step={0.05} on={(v) => setCfg({ cinematic: v })} />
        <Slider label="peel" v={cfg.peel} min={0.2} max={2.5} step={0.05} on={(v) => setCfg({ peel: v })} />
      </Section>
      <Section label="display">
        <div style={{ display: "flex", gap: 6 }}>
          <Toggle on={cfg.labels} onClick={() => setCfg({ labels: !cfg.labels })} label="labels" tone="green" />
          <Toggle on={cfg.platforms} onClick={() => setCfg({ platforms: !cfg.platforms })} label="planes" tone="green" />
          <Toggle on={cfg.rings} onClick={() => setCfg({ rings: !cfg.rings })} label="rings" tone="green" />
        </div>
        <Slider label="glow" v={cfg.bloom} min={0} max={3} step={0.05} on={(v) => setCfg({ bloom: v })} />
        <Slider label="⟱ spines" v={cfg.spines} min={0} max={2} step={0.05} on={(v) => setCfg({ spines: v })} />
        <Slider label="lines" v={cfg.lines} min={0} max={2} step={0.02} on={(v) => setCfg({ lines: v })} />
        <Slider label="≈ pulse" v={cfg.flow} min={0} max={3} step={0.1} on={(v) => setCfg({ flow: v })} />
        <Slider label="size" v={cfg.nodeScale} min={0.3} max={2.5} step={0.05} on={(v) => setCfg({ nodeScale: v })} />
      </Section>
      <Section label="isolate layers">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {data.meta.layers.map((l) => {
            const on = layerVisible(l.name);
            return (
              <button key={l.name} onClick={() => toggleLayer(l.name)} style={{ flex: "1 0 44%", background: on ? "#161a24" : "transparent", border: `1px solid ${on ? l.color ?? "#888" : T.line}`, color: on ? l.color ?? "#ccc" : T.faint, borderRadius: 5, padding: "4px 5px", cursor: "pointer", fontFamily: T.sans, fontSize: 10, letterSpacing: 0.3, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: 6, background: on ? l.color ?? "#888" : T.faint }} />
                {l.label ?? l.name}
              </button>
            );
          })}
        </div>
      </Section>
      <Section label="node sizes">
        {data.meta.layers.map((l) => (
          <Slider key={l.name} label={l.label ?? l.name} v={cfg.sizes[l.name] ?? 1} min={0} max={8} step={0.1} on={(v) => setSize(l.name, v)} />
        ))}
      </Section>
      <button onClick={copyWallpaper} title="copy a link that reopens this exact view" style={{ ...btn(), padding: "7px", marginTop: 2 }}>⊕ copy wallpaper link</button>
    </div>
  );
}

/* ── health blend ──
   Reads `data.health` (green|amber|red — the convention a Booboo dataset
   emits) and falls back to `status_pill` for graphs built by the older
   Dionisos adapter. Reading ONLY the legacy key is the bug this replaced:
   the Pemberton carries `health` on every agent and the dossier showed
   nothing but weight/tier/cluster/parent. */
function healthOf(status: string | null, p0: number | null): { score: number; color: string; label: string } {
  let score = status === "green" ? 1 : status === "amber" ? 0.6 : status === "red" ? 0.25 : 0.5;
  if (p0 != null && p0 > 0) score = Math.min(score, 0.28);
  const color = score > 0.72 ? T.green : score > 0.42 ? T.amber : T.red;
  const base = status === "green" ? "healthy" : status === "amber" ? "watch" : status === "red" ? "critical" : "—";
  const label = p0 != null && p0 > 0 ? `${p0} P0 · ${score <= 0.42 ? "critical" : base}` : base;
  return { score, color, label };
}

/** "3h ago" / "2 days ago" / "14 months ago" — undated returns "". */
/* ── Dossier: the node menu — health-first, tabbed ── */
// Shared with the focus camera, which has to know how much of the frame this
// covers to put a focused node in the middle of what is actually SEEN.
const DOSSIER_W = 420;
function Dossier({
  n,
  byId,
  rels,
  reports,
  accent,
  onClose,
  onJump,
}: {
  n: BNode;
  byId: Map<string, BNode>;
  rels: Rel[];
  /** this agent's own filed reports, newest first */
  reports: BNode[];
  accent: string;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  // relations grouped BY VERB, count-sorted — "owns 12 · reads 3 · escalates_to 1"
  const groups = useMemo(() => {
    const g = new Map<string, Rel[]>();
    for (const r of rels) {
      const a = g.get(r.rel);
      if (a) a.push(r);
      else g.set(r.rel, [r]);
    }
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rels]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const d = (n.data ?? {}) as Record<string, unknown>;
  const str = (k: string): string | null => (typeof d[k] === "string" && (d[k] as string).trim() ? (d[k] as string) : null);
  // `health` is the Booboo convention; `status_pill` is the legacy Dionisos key.
  const status = str("health") ?? str("status_pill");
  const p0raw = d.p0_count;
  const p0 = p0raw == null || p0raw === "" ? null : Number(p0raw);
  const persona = str("desc");
  const note = str("note");
  const lastBoot = str("lastBoot");
  const roleLine = str("role");
  const phase = d.phase != null ? String(d.phase) : null;
  const lastMove = d.last_move != null && String(d.last_move).trim() ? String(d.last_move) : null;
  const nextPlan = d.next_plan != null && String(d.next_plan).trim() ? String(d.next_plan) : null;
  const hasHealth = status != null || (p0 != null && !Number.isNaN(p0));

  // the authority path: root → … → this node, walked up `parent`
  const chain = useMemo(() => {
    const out: BNode[] = [];
    const guard = new Set<string>();
    let cur: BNode | undefined = n;
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      out.unshift(cur);
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return out;
  }, [n, byId]);

  // reach, derived from the graph's own verbs — no second access mechanism
  const reach = useMemo(() => {
    const buckets: string[] = [], rules: string[] = [];
    for (const r of rels) {
      if (r.dir !== "out") continue;
      if (r.rel === "owns" || r.rel === "reads") buckets.push(r.other);
      else if (r.rel === "inherits") rules.push(r.other);
    }
    return { buckets, rules };
  }, [rels]);

  // this node IS a report: show who filed it and who received it
  const repTo = str("to");
  const repFrom = str("agent");
  const repStatus = str("status");
  const repSummary = str("summary");

  const RESERVED = new Set(["status_pill", "p0_count", "phase", "last_move", "next_plan", "desc", "note", "lastBoot", "role", "health", "to", "agent", "status", "summary", "at", "bucket"]);
  const promptEntries = Object.entries(d).filter(
    ([k, v]) => !RESERVED.has(k) && typeof v === "string" && (k.toLowerCase().includes("prompt") || ["system", "instructions"].includes(k.toLowerCase()) || (v as string).length > 120),
  ) as [string, string][];
  const dataEntries = Object.entries(d).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v, null, 2)] as [string, string]);

  const tabs = ["overview", promptEntries.length ? "prompt" : null, rels.length ? "relations" : null, dataEntries.length ? "data" : null].filter(Boolean) as string[];
  const [tab, setTab] = useState("overview");

  return (
    // z 20 (tokens z-map): the 3D label portals render inside the canvas
    // container and would otherwise bleed through the panel.
    <div style={{ position: "absolute", top: 0, right: 0, width: DOSSIER_W, maxWidth: "94%", height: "100%", zIndex: 20, background: T.panelSolid, borderLeft: `1px solid ${T.line}`, color: T.text, display: "flex", flexDirection: "column", boxShadow: "-18px 0 50px rgba(0,0,0,0.45)" }}>
      {/* fixed header + tabs */}
      <div style={{ flex: "0 0 auto", background: T.panelSolid, borderBottom: `1px solid ${T.line}`, borderLeft: `3px solid ${accent}` }}>
        <div style={{ padding: "16px 18px 12px", position: "relative" }}>
          <button onClick={onClose} title="close" style={{ position: "absolute", top: 12, right: 14, background: "none", border: "none", color: T.dim, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: T.dim }}>
            <span style={{ width: 8, height: 8, borderRadius: 8, background: accent }} />
            {n.type} · {n.layer}
          </div>
          <div style={{ fontSize: 19, marginTop: 8, color: "#f5ebd4", wordBreak: "break-word", fontWeight: 600, lineHeight: 1.25 }}>
            {n.icon ? n.icon + " " : ""}
            {n.label}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <code style={{ fontFamily: T.mono, fontSize: 11, color: T.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.id}</code>
            <button onClick={() => copy(n.id)} title="copy id" style={{ ...btn(), padding: "2px 7px", fontSize: 9, flex: "0 0 auto" }}>copy</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, padding: "0 14px" }}>
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === t ? accent : "transparent"}`, color: tab === t ? T.text : T.dim, padding: "8px 9px", cursor: "pointer", fontFamily: T.sans, fontSize: 11, letterSpacing: 0.4, textTransform: "capitalize" }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 28px", fontSize: 12 }}>
        {tab === "overview" && (
          <>
            {/* character before metrics — a dossier should read like a person's file */}
            {persona && (
              <div style={{ color: T.text, fontSize: 13.5, lineHeight: 1.55, fontStyle: "italic", marginBottom: 14, paddingLeft: 11, borderLeft: `2px solid ${accent}` }}>
                {persona}
              </div>
            )}
            {!persona && roleLine && <div style={{ color: T.dim, fontSize: 12.5, marginBottom: 14 }}>{roleLine}</div>}

            {hasHealth && <HealthBar status={status} p0={p0} />}
            {/* the REASON, not just the colour — an amber with no cause teaches nothing */}
            {note && (
              <div style={{ marginTop: 9, background: "rgba(214,162,62,.07)", border: `1px solid ${T.line}`, borderLeft: `2px solid ${T.amber}`, borderRadius: 6, padding: "9px 11px", color: T.text, fontSize: 12, lineHeight: 1.5 }}>
                {note}
              </div>
            )}

            {/* THIS node is a report — say plainly who filed it and who got it */}
            {n.type === "report" && (
              <div style={{ marginTop: 12, background: T.card, border: `1px solid ${T.line}`, borderRadius: 8, padding: "11px 12px" }}>
                {repSummary && <div style={{ color: T.text, fontSize: 12.5, lineHeight: 1.55, marginBottom: 10 }}>{repSummary}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11, fontFamily: T.mono }}>
                  {repFrom && <JumpChip label={`from ${byId.get("agent:" + repFrom)?.label ?? repFrom}`} onClick={() => onJump("agent:" + repFrom)} accent={T.dim} />}
                  <span style={{ color: T.faint }}>→</span>
                  {repTo && <JumpChip label={`to ${byId.get(repTo)?.label ?? repTo}`} onClick={() => onJump(repTo)} accent={accent} />}
                  {repStatus && <span style={{ marginLeft: "auto", color: repStatus === "ok" ? T.green : repStatus === "warn" ? T.amber : T.red }}>{repStatus}</span>}
                </div>
              </div>
            )}

            {phase && <Card label="current phase" value={phase} accent={accent} mono />}
            {lastMove && <Card label="last move" value={lastMove} accent={accent} scroll />}
            {nextPlan && <Card label="next plan" value={nextPlan} accent={accent} scroll />}

            {/* chain of command — who this answers to, all the way up */}
            {chain.length > 1 && (
              <Block label="chain of command" accent={accent}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 6px", fontSize: 11.5 }}>
                  {chain.map((c, i) => (
                    <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {i > 0 && <span style={{ color: T.faint, fontFamily: T.mono }}>›</span>}
                      {c.id === n.id ? (
                        <b style={{ color: accent, fontWeight: 600 }}>{c.label}</b>
                      ) : (
                        <button onClick={() => onJump(c.id)} style={{ background: "none", border: "none", padding: 0, color: T.dim, cursor: "pointer", fontSize: 11.5, fontFamily: T.sans, textDecoration: "underline dotted" }}>{c.label}</button>
                      )}
                    </span>
                  ))}
                </div>
              </Block>
            )}

            {/* what it has actually closed, and where each one went */}
            {reports.length > 0 && (
              <Block label={`reports filed · ${reports.length}`} accent={accent}>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {reports.slice(0, expanded.reports ? 25 : 4).map((r) => {
                    const rd = (r.data ?? {}) as Record<string, unknown>;
                    const st = typeof rd.status === "string" ? rd.status : null;
                    const to = typeof rd.to === "string" ? rd.to : null;
                    return (
                      <div key={r.id} onClick={() => onJump(r.id)} style={{ background: T.card, border: `1px solid ${T.line}`, borderLeft: `2px solid ${st === "warn" ? T.amber : st === "fail" ? T.red : T.green}`, borderRadius: 6, padding: "8px 10px", cursor: "pointer" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                          <span style={{ color: T.goldHi, fontSize: 9.5, fontFamily: T.mono }}>{relTime(rd.at)}</span>
                          {to && <span style={{ marginLeft: "auto", color: T.faint, fontSize: 9.5, fontFamily: T.mono, whiteSpace: "nowrap" }}>→ {byId.get(to)?.label ?? to}</span>}
                        </div>
                        <div style={{ color: T.text, fontSize: 11.5, lineHeight: 1.45 }}>{typeof rd.summary === "string" ? rd.summary : r.label}</div>
                      </div>
                    );
                  })}
                </div>
                {reports.length > 4 && (
                  <button onClick={() => setExpanded((x) => ({ ...x, reports: !x.reports }))} style={{ ...btn(), marginTop: 7, fontSize: 9.5 }}>
                    {expanded.reports ? "show fewer" : `+${reports.length - 4} more, back to ${relTime((reports[reports.length - 1].data as Record<string, unknown>)?.at)}`}
                  </button>
                )}
              </Block>
            )}

            {/* reach: the memory it can read, and the law it is bound by */}
            {(reach.buckets.length > 0 || reach.rules.length > 0) && (
              <Block label="reach" accent={accent}>
                {reach.buckets.length > 0 && (
                  <>
                    <div style={{ color: T.faint, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 5 }}>memory it can read</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: reach.rules.length ? 11 : 0 }}>
                      {reach.buckets.map((b) => <JumpChip key={b} label={byId.get(b)?.label ?? b} onClick={() => onJump(b)} accent={T.teal} />)}
                    </div>
                  </>
                )}
                {reach.rules.length > 0 && (
                  <>
                    <div style={{ color: T.faint, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", marginBottom: 5 }}>law it is bound by</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {reach.rules.map((r) => <JumpChip key={r} label={byId.get(r)?.label ?? r} onClick={() => onJump(r)} accent={T.gold} />)}
                    </div>
                  </>
                )}
              </Block>
            )}

            {lastBoot && (
              <div style={{ marginTop: 14, color: T.faint, fontSize: 10.5, fontFamily: T.mono }}>
                last booted {relTime(lastBoot)}
              </div>
            )}
          </>
        )}

        {tab === "prompt" && promptEntries.map(([k, v]) => <EditableBlock key={k} label={k} value={v} accent={accent} />)}

        {tab === "relations" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {groups.map(([verb, list]) => {
              const cap = expanded[verb] ? list.length : 10;
              return (
                <div key={verb}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                    <span style={{ color: accent, fontSize: 11, fontWeight: 600, letterSpacing: 0.6, fontFamily: T.mono }}>{verb}</span>
                    <span style={{ color: T.faint, fontSize: 10.5, fontFamily: T.mono }}>{list.length}</span>
                    <span style={{ flex: 1, height: 1, background: T.line }} />
                  </div>
                  {list.slice(0, cap).map((r, i) => {
                    const o = byId.get(r.other);
                    return (
                      <div key={i} onClick={() => onJump(r.other)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", cursor: "pointer", borderRadius: 6 }} onMouseEnter={(e) => (e.currentTarget.style.background = "#12161f")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                        <span title={r.dir === "out" ? "outgoing" : "incoming"} style={{ color: T.faint, flex: "0 0 auto", fontFamily: T.mono, fontSize: 12 }}>{r.dir === "out" ? "→" : "←"}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: T.text }}>{o?.icon ? o.icon + " " : ""}{o?.label ?? r.other}</span>
                      </div>
                    );
                  })}
                  {list.length > 10 && (
                    <button onClick={() => setExpanded((x) => ({ ...x, [verb]: !x[verb] }))} style={{ ...btn(), marginTop: 3, fontSize: 9.5 }}>
                      {expanded[verb] ? "show fewer" : `+${list.length - 10} more`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "data" &&
          dataEntries.map(([k, v]) => (v.includes("\n") || v.length > 70 ? <EditableBlock key={k} label={k} value={v} accent={accent} /> : <Row key={k} k={k} v={v} />))}
      </div>
    </div>
  );
}

function HealthBar({ status, p0 }: { status: string | null; p0: number | null }) {
  const h = healthOf(status, p0);
  return (
    <div style={{ marginBottom: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: T.dim, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase" }}>
          <span className="bb-pulse" style={{ width: 8, height: 8, borderRadius: 8, background: h.color }} /> health
        </span>
        <span style={{ color: h.color, fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>{h.label}</span>
      </div>
      <div style={{ height: 6, borderRadius: 6, background: "#171b24", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round(h.score * 100)}%`, background: h.color, borderRadius: 6, transition: "width .3s ease" }} />
      </div>
    </div>
  );
}

/* a titled section of the dossier — one rule, one label, then content */
function Block({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
        <span style={{ color: accent, fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 600, fontFamily: T.mono }}>{label}</span>
        <span style={{ flex: 1, height: 1, background: T.line }} />
      </div>
      {children}
    </div>
  );
}

/* a chip that jumps the selection to another node */
function JumpChip({ label, onClick, accent }: { label: string; onClick: () => void; accent: string }) {
  return (
    <button
      onClick={onClick}
      style={{ background: "transparent", border: `1px solid ${T.line}`, color: accent, borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontFamily: T.mono, fontSize: 10, letterSpacing: 0.2, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = accent)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = T.line)}
    >
      {label}
    </button>
  );
}

function Card({ label, value, accent, scroll, mono }: { label: string; value: string; accent: string; scroll?: boolean; mono?: boolean }) {
  return (
    <div style={{ marginTop: 12, background: T.card, border: `1px solid ${T.line}`, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ color: accent, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 5 }}>{label}</div>
      <div style={{ color: T.text, fontSize: 12.5, lineHeight: 1.5, fontFamily: mono ? T.mono : T.sans, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: scroll ? 96 : undefined, overflowY: scroll ? "auto" : undefined }}>{value}</div>
    </div>
  );
}

function EditableBlock({ label, value, accent }: { label: string; value: string; accent: string }) {
  const [text, setText] = useState(value);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setText(value);
    setCopied(false);
  }, [value]);
  const edited = text !== value;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ color: accent, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: 600 }}>{label}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {edited && <button onClick={() => setText(value)} title="revert edits" style={{ ...btn(), padding: "2px 7px", fontSize: 9 }}>revert</button>}
          <button onClick={() => { copy(text); setCopied(true); }} style={{ ...btn(), padding: "2px 9px", fontSize: 9, color: copied ? T.green : T.dim, borderColor: copied ? "#3a5a44" : T.line }}>{copied ? "✓ copied" : "copy"}</button>
        </div>
      </div>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setCopied(false); }} spellCheck={false} rows={Math.min(18, Math.max(4, text.split("\n").length + 1))} style={{ width: "100%", boxSizing: "border-box", background: "#0d111a", border: `1px solid ${edited ? accent : T.line}`, borderRadius: 7, color: T.text, fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.5, padding: "9px 11px", resize: "vertical", outline: "none" }} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "6px 0", borderBottom: `1px solid ${T.line}` }}>
      <span style={{ color: T.dim, flex: "0 0 auto" }}>{k}</span>
      <span style={{ textAlign: "right", wordBreak: "break-word", color: T.text, fontFamily: T.mono, fontSize: 11.5 }}>{v}</span>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ color: T.faint, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase" }}>{label}</div>
      {children}
    </div>
  );
}

function btn(): React.CSSProperties {
  return { background: "transparent", border: `1px solid ${T.line}`, color: T.dim, borderRadius: 5, padding: "3px 9px", cursor: "pointer", fontFamily: T.sans, fontSize: 10, letterSpacing: 0.3 };
}

function Toggle({ on, onClick, label, tone }: { on: boolean; onClick: () => void; label: string; tone: "gold" | "green" }) {
  const c = tone === "green" ? { bg: "#16241a", bd: "#3a5a44", fg: "#9ed3b0" } : { bg: "#221c10", bd: "#5a4a28", fg: T.goldHi };
  return (
    <button onClick={onClick} style={{ flex: 1, background: on ? c.bg : "transparent", border: `1px solid ${on ? c.bd : T.line}`, color: on ? c.fg : T.faint, borderRadius: 6, padding: "5px 6px", cursor: "pointer", fontFamily: T.sans, fontSize: 10.5, letterSpacing: 0.4 }}>
      {label}
    </button>
  );
}

function Slider({ label, v, min, max, step, on }: { label: string; v: number; min: number; max: number; step: number; on: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ width: 48, color: T.dim, fontSize: 10, flex: "0 0 auto" }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(parseFloat(e.target.value))} style={{ flex: 1, accentColor: T.gold, minWidth: 0 }} />
      <span style={{ color: T.text, width: 30, textAlign: "right", fontFamily: T.mono, fontSize: 10.5, flex: "0 0 auto" }}>{v.toFixed(2)}</span>
    </div>
  );
}
