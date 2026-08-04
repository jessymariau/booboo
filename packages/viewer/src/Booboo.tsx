import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping, HueSaturation, BrightnessContrast } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import type { BoobooGraph } from "@booboo-brain/spec";
import { layout, planeZ, PLANE_GAP, FLAG_COLOR, type Laid, type Flagged } from "./layout";
import { truncateLabel } from "./label";

// Effect intensities are numbers (sliders): 0 = off, 1 = default, >1 = more.
export type BoobooCfg = {
  orbit: number; // spin speed (wandering); 0 = off
  drift: number; // slow z-roll
  lines: number; // pulse-river edge intensity; 0 = off
  flow: number; // pulse travel speed
  nodeScale: number; // global node size
  sizes: Record<string, number>; // per-layer size
  layers: Record<string, boolean>; // per-layer visibility
  platforms: boolean; // the faint tier discs
  rings: boolean; // the glowing rim rings
  labels: boolean; // the floating tier labels
  bloom: number; // glow
  cinematic: number; // film grade (tone/contrast/vignette)
  fog: number; // frontier nebula
  peel: number; // tier spacing (z-scale)
  spines: number; // light-shaft intensity (CRAFT §2's signature element); 0 = off
};

export function defaultCfg(data: BoobooGraph): BoobooCfg {
  const layers: Record<string, boolean> = {};
  const sizes: Record<string, number> = {};
  data.meta.layers.forEach((l) => {
    layers[l.name] = true;
    sizes[l.name] = 1;
  });
  // bloom 0 is the signed-off default (the Atlas lesson: glow merges a dense field into
  // blobs). The sprite shader carries its own soft glow; bloom is an opt-in accent.
  // rings default OFF (2026-07-19, Jesse: "take out those big rings, not needed
  // here"). The disc rim-torus drew a hard bright ellipse around every band —
  // the brightest thing in frame after the flags, which inverts the luminance
  // ladder (CRAFT §1) for pure decoration. The engraved floor already says
  // where the band is. Kept as a flag, not removed: BoobooCfg is published API.
  // Defaults are the ratified direction, not the old look: no platform discs, no
  // in-space layer typography, no light-shaft spines, no blob nebula. A layer is
  // now expressed by depth, density and colour alone — reintroducing discs to
  // make bands legible is how the previous design comes back through the door.
  return { orbit: 1, drift: 1, lines: 0.28, flow: 1.1, nodeScale: 1, sizes, layers, platforms: false, rings: false, labels: false, bloom: 0.75, cinematic: 1, fog: 0, peel: 1.6, spines: 0 };
}

// ── node cloud: one draw call, per-point size + color from typed-array attributes ──
// Sprite design (CRAFT luminance law): a soft luminous core, a thin rim ring that only
// appears on large (landmark-scale) sprites, and a depth fade so the far field recedes.
// The sprite carries its own glow — the de-bloomed default look needs no postprocessing.
const VERT = /* glsl */ `
  attribute float size; attribute vec3 color; attribute float focus; attribute float aKind;
  uniform float uT; uniform float uZTop; uniform float uZSpan;
  varying vec3 vColor; varying float vFade; varying float vPx; varying float vKind;
  void main() { vColor = color * (0.45 + 0.55 * focus); vKind = aKind; vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // 340.0 was starving the deep field into nothing. At the framing distance
    // this scene actually uses (~2200 units) a ledger node came out UNDER ONE
    // PIXEL, so 2,111 of the graph's 2,839 nodes were mathematically present and
    // visually absent — which read as "the deep tiers are dim" and sent two
    // passes chasing brightness and colour that were never the problem.
    // Landmarks are meshes and scale correctly, so only the point cloud starved.
    // Clamped at the top end because the same constant, once large enough to be
    // seen far away, turns every near point into a blob on approach.
    // Cap raised from 30 to 190: every node is now drawn by this one sprite
    // system, landmarks included, so the ceiling has to allow a root or an agent
    // to be a real object on screen rather than a speck. Still capped, because
    // an uncapped point turns into a full-screen blob the moment you fly at it.
    float px = min(size * (1100.0 / -mv.z) * (0.8 + 0.26 * focus), 190.0);
    gl_PointSize = px; vPx = px;
    // entrance: the field wakes top-down after the spines (start 1.8s, wave 1.2s + 0.6s ease)
    float intro = clamp((uT - 1.8 - ((uZTop - position.z) / uZSpan) * 1.2) / 0.6, 0.0, 1.0);
    vFade = clamp(1.45 + mv.z / 9000.0, 0.3, 1.0) * (0.35 + 0.65 * focus) * intro;
    gl_Position = projectionMatrix * mv; }`;
// Every node type is DRAWN, not dotted. The artwork set was designed component
// by component in the lab (03_Marketing/booboo-node-lab) against the ratified
// direction, and this is where it meets real data.
//
// TWO FAMILIES, and the split carries the semantics:
//   LIVING  (agent, bucket, observation, report) — soft, translucent, lit from
//           within. These are the things that DO something.
//   WRITTEN (contract, document) — mineral: hard edges, ruled lines, still.
//           These are what the living things are BOUND BY.
// That is what lets a law be told from an agent at two pixels, which is the only
// test that matters once 2,839 of them share a frame.
//
// Detail is gated on vPx on purpose. A sprite three pixels across cannot show a
// comb row or a clause rule, and paying for them is how a dense field turns to
// mush — so the far field collapses to core+halo and the near field earns its
// structure. Same atom, honest at both ends.
const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor; varying float vFade; varying float vPx; varying float vKind;

  float bellHalf(float t){
    float crown = pow(max(0.0, 1.0 - pow(max(0.0, t - 0.30) / 0.74, 2.3)), 0.62);
    return 0.34 * crown * smoothstep(0.0, 0.40, t);
  }

  void main() {
    vec2 uv = gl_PointCoord;
    vec2 p = vec2(uv.x - 0.5, 1.0 - uv.y);   // p.y: 0 at base, 1 at crown
    float t = p.y;
    float r = length(vec2(p.x, p.y - 0.5)) * 2.0;
    int k = int(vKind + 0.5);

    // Below ~9px no artwork survives; draw the honest thing instead of a smear.
    float detail = smoothstep(9.0, 20.0, vPx);
    float lum = 0.0;

    if (detail < 0.02) {
      // THE FAMILY HAS TO SURVIVE THE FALLBACK. This branch used to draw one
      // generic round dot for every kind, which meant the living/written split —
      // the entire organising idea — vanished below 9px. That is precisely where
      // it matters most: 2,717 of 2,839 nodes spend their whole life at this
      // size, so "report and document are indistinguishable at depth" was not a
      // shader detail, it was the fallback erasing the design.
      // Living things stay round and soft. Written things stay a crisp upright
      // tick. Two pixels is enough to carry that, and nothing else needs to.
      if (k == 1 || k == 4) {
        if (abs(p.x) > 0.17 || abs(p.y - 0.5) > 0.46) discard;
        lum = (1.0 - smoothstep(0.0, 0.17, abs(p.x))) * (1.0 - smoothstep(0.30, 0.46, abs(p.y - 0.5))) * 1.05;
      } else {
        if (r > 1.0) discard;
        lum = exp(-r * r * 5.0) * 0.95;
      }
    } else if (k == 2) {                      // observation — 2,100 of them
      float d = length(vec2(p.x, (p.y - 0.5) * 1.3));
      lum = exp(-d * d * 46.0) + exp(-d * d * 6.0) * 0.22;
    } else if (k == 1 || k == 4) {            // contract / document — WRITTEN
      float w = (k == 1) ? 0.15 : 0.085;
      float ch = min(smoothstep(0.0, 0.10, t), smoothstep(1.0, 0.90, t));
      float hw = w * ch; if (hw <= 5e-4) discard;
      float q = abs(p.x) / hw; if (q >= 1.06) discard;
      float fill = (0.14 + 0.18 * q * q) * smoothstep(1.0, 0.93, q);
      float edge = smoothstep(0.90, 1.0, q) * (1.0 - smoothstep(1.0, 1.05, q)) * 0.95;
      float rule = pow(max(0.0, sin(t * (k == 1 ? 34.0 : 22.0))), 12.0)
                 * smoothstep(0.10, 0.20, t) * smoothstep(0.94, 0.84, t) * 0.45 * detail;
      lum = fill + edge + rule;
    } else if (k == 3) {                      // report — living, but it carries writing
      float hw = 0.11 * smoothstep(0.24, 0.40, t) * smoothstep(0.90, 0.76, t);
      if (hw <= 5e-4) discard;
      float q = abs(p.x) / hw; if (q >= 1.0) discard;
      lum = (0.22 + 0.32 * q * q) * smoothstep(1.0, 0.90, q)
          + pow(max(0.0, sin((t - 0.24) * 40.0)), 14.0) * 0.34 * detail;
    } else if (k == 5) {                      // bucket — a membrane with a swarm in it
      vec2 e = vec2(p.x / 0.30, (p.y - 0.5) / 0.40); float rr = length(e);
      if (rr > 1.2) discard;
      lum = smoothstep(0.84, 1.0, rr) * (1.0 - smoothstep(1.0, 1.12, rr)) * 0.55
          + (1.0 - smoothstep(0.0, 1.0, rr)) * 0.10;
      for (int i = 0; i < 8; i++) {
        float fi = float(i);
        vec2 q = vec2(fract(sin(fi * 12.9898) * 43758.5453) * 2.0 - 1.0,
                      fract(sin(fi * 78.233) * 43758.5453) * 2.0 - 1.0) * 0.72;
        lum += exp(-pow(length(e - q) * 5.0, 2.0)) * 0.5 * detail;
      }
    } else if (k == 6) {                      // root — exactly one exists
      vec2 e = vec2(p.x, p.y - 0.5); float rr = length(e);
      float a2 = atan(e.y, e.x);
      lum = exp(-rr * rr * 420.0) * 1.7 + exp(-rr * rr * 16.0) * 0.40
          + pow(max(0.0, cos(a2 * 7.0)), 28.0) * exp(-rr * rr * 7.0) * 0.5 * detail;
      // gl_PointCoord spans exactly the sprite's quad, so anything still emitting
      // at rr = 0.5 gets sliced off SQUARE. Every other kind self-limits — the
      // bells discard outside their silhouette, the written marks are tight — but
      // the root is the one sprite with a wide radial halo and rays, and both are
      // far above the 0.004 discard floor when they reach the edge (the rays hit
      // it at ~0.09). The result was a hard rectangle with squared corners around
      // the brightest object in the frame, which is the first thing any eye goes
      // to. Retuning the falloffs to die inside the quad would shorten the rays
      // and change the artwork, so window it instead: the shape is untouched and
      // the light now ends in the water rather than on an edge.
      lum *= 1.0 - smoothstep(0.30, 0.50, rr);
    } else {                                  // agent — the bell
      float hw = bellHalf(t); if (hw <= 5e-4) discard;
      float q = abs(p.x) / hw; if (q >= 1.05) discard;
      lum = (0.13 + 0.34 * pow(q, 2.4)) * smoothstep(1.0, 0.88, q)
          + smoothstep(0.84, 0.99, q) * (1.0 - smoothstep(0.99, 1.05, q))
            * (0.12 + 0.44 * smoothstep(0.06, 0.34, t) * smoothstep(1.0, 0.66, t))
          + pow(max(0.0, cos((p.x / max(hw, 1e-4)) * 22.0)), 4.0)
            * smoothstep(0.04, 0.26, t) * smoothstep(1.0, 0.70, t) * 0.30 * detail
          + exp(-(p.x * p.x + pow(p.y - 0.86, 2.0)) * 1400.0) * 1.2;
    }

    float a = lum * vFade;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * (0.85 + lum * 0.55), clamp(a, 0.0, 1.0)); }`;

// ── pulse-river edges: a light travels source→target along each (static) link ──
const PULSE_VERT = /* glsl */ `
  attribute vec3 aColor; attribute float aDist; attribute float aPhase; attribute float aFocus;
  uniform float uT; uniform float uZTop; uniform float uZSpan;
  varying vec3 vColor; varying float vDist; varying float vPhase; varying float vFocus; varying float vIntro;
  void main(){ vColor=aColor; vDist=aDist; vPhase=aPhase; vFocus=aFocus;
    // entrance: spines ignite top-down first — the law flows down (start 0.9s, wave 1.2s)
    vIntro = clamp((uT - 0.9 - ((uZTop - position.z) / uZSpan) * 1.2) / 0.5, 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const PULSE_FRAG = /* glsl */ `
  precision mediump float; uniform float uTime,uBase,uPulse,uSpeed,uWidth;
  varying vec3 vColor; varying float vDist; varying float vPhase; varying float vFocus; varying float vIntro;
  void main(){ float head=fract(uTime*uSpeed+vPhase); float d=abs(vDist-head); d=min(d,1.0-d);
    float pulse=exp(-(d*d)/(uWidth*uWidth)); float a=(uBase+uPulse*pulse)*(0.15+0.85*vFocus)*vIntro;
    gl_FragColor=vec4(vColor*(1.0+pulse*1.5)*(0.55+0.9*vFocus), a); }`;

type IntroUni = { uT: { value: number }; uZTop: { value: number }; uZSpan: { value: number } };
type IntroBox = React.MutableRefObject<{ t0: number | null; skip: boolean; t: number }>;

// Drives the entrance clock: one shared set of uniform objects, written once per frame.
function IntroDriver({ uni, box }: { uni: IntroUni; box: IntroBox }) {
  const advance = useThree((s) => s.advance);
  useFrame(({ clock }) => {
    const b = box.current;
    if (b.t0 == null) b.t0 = clock.getElapsedTime();
    b.t = b.skip ? 1000 : clock.getElapsedTime() - b.t0;
    uni.uT.value = b.t;
  });
  // Backstop: a tab that stops rendering frames (hidden, or occlusion-starved while its
  // pixels stay on screen) strands the last composited frame mid-entrance — useFrame
  // never runs there, and the skip listeners are gone after 4.2s, so nothing in-app can
  // recover it. Settle by wall clock and force ONE out-of-rAF frame so the composited
  // frame left behind is the settled scene, not a half-born one.
  useEffect(() => {
    if (box.current.skip) return;
    const id = setTimeout(() => {
      const b = box.current;
      if (b.skip || b.t >= 3.6) return; // entrance finished on its own
      b.skip = true;
      advance(performance.now());
    }, 4500);
    return () => clearTimeout(id);
  }, [advance, box]);
  return null;
}

function Field({ laid, cfg, onPick, focus, introUni }: { laid: Laid; cfg: BoobooCfg; onPick?: (i: number) => void; focus?: Float32Array | null; introUni: IntroUni }) {
  // Sizes are baked into the geometry (not mutated via needsUpdate, which didn't reliably
  // re-upload) so the cloud rebuilds — and re-renders — whenever a size/scale/visibility
  // slider changes. Rebuild only on size-affecting cfg, not on every cfg tick.
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(laid.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(laid.colors, 3));
    // ONE sprite system now draws EVERY node. Landmarks used to be zeroed out of
    // this cloud and re-drawn as brass meshes, which meant two renderers, two
    // material languages and a hard seam between them at tier 1/2. The redesign
    // makes them the same kind of thing at different scales, so the mesh path is
    // deleted and the tier only decides how big the artwork is drawn.
    // Tier 3 lifted from 1.0 to 1.7: 2,717 ledger nodes were rendering as thin
    // dust rather than a floor. The fix is presence per point, not more spread —
    // spreading the same count over a wider area is what made it dust in the
    // first place.
    //
    // Tier 2 lifted 1.9 → 2.9, and this one is arithmetic rather than taste. The
    // fragment shader gives up on artwork below 9px (`smoothstep(9.0, 20.0, vPx)`)
    // and falls back to the two-pixel family mark. At 1.9 a typical mid-band node
    // (weight ~0.3, so laid size ~9.2) reached the framing distance at 9.3px —
    // landing ON the cliff, detail ≈ 0.02, which is the fallback in all but name.
    // So "the mid-band bells are sparse" was never about how many there are: the
    // bells were being drawn as ticks. 2.9 puts them at ~14px, detail ≈ 0.4, far
    // enough up the ramp to read as their own form while staying clearly smaller
    // than a tier-1 head. Anything that changes framing distance or the weight
    // curve moves this cliff, so check vPx before re-tuning by eye.
    const TIER = [7.4, 4.3, 2.9, 1.7];
    const sizeArr = new Float32Array(laid.count);
    const kindArr = new Float32Array(laid.count);
    for (let i = 0; i < laid.count; i++) {
      const layer = laid.nodeLayer[i];
      const vis = cfg.layers[layer] !== false;
      const tier = Math.max(0, Math.min(3, laid.nodeTier[i]));
      sizeArr[i] = vis ? laid.sizes[i] * TIER[tier] * cfg.nodeScale * (cfg.sizes[layer] ?? 1) : 0;
      kindArr[i] = laid.nodeKind[i];
    }
    g.setAttribute("size", new THREE.BufferAttribute(sizeArr, 1));
    g.setAttribute("aKind", new THREE.BufferAttribute(kindArr, 1));
    // torch focus: 1 = lit (selection + neighbourhood), sub-1 = dimmed. All-ones when idle.
    g.setAttribute("focus", new THREE.BufferAttribute(focus ?? new Float32Array(laid.count).fill(1), 1));
    return g;
  }, [laid, cfg.nodeScale, cfg.sizes, cfg.layers, focus]);
  useEffect(() => () => geo.dispose(), [geo]);
  // Additive glow is gorgeous on sparse graphs but saturates dense clusters to white.
  // In the de-bloomed look (bloom 0) fall back to normal blending so a 16k-node layer
  // reads as a coloured mass, not a blown-out core (matches the Operational Atlas cloud).
  // de-bloomed look (bloom 0) → normal blending so a dense layer reads as a colour mass, not a white core
  const mat = useMemo(() => new THREE.ShaderMaterial({ uniforms: { uT: introUni.uT, uZTop: introUni.uZTop, uZSpan: introUni.uZSpan }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: cfg.bloom > 0 ? THREE.AdditiveBlending : THREE.NormalBlending }), [cfg.bloom > 0, introUni]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <points geometry={geo} material={mat} frustumCulled={false} onClick={(e) => { if (e.index != null && onPick) { onPick(e.index); e.stopPropagation(); } }} />;
}

function PulseLinks({ laid, cfg, focus, introUni }: { laid: Laid; cfg: BoobooCfg; focus?: Float32Array | null; introUni: IntroUni }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const geo = useMemo(() => {
    const m = laid.linkCount;
    const aDist = new Float32Array(m * 2), aPhase = new Float32Array(m * 2);
    for (let i = 0; i < m; i++) { aDist[i * 2] = 0; aDist[i * 2 + 1] = 1; const ph = (i * 0.61803398875) % 1; aPhase[i * 2] = ph; aPhase[i * 2 + 1] = ph; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(laid.linkPos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(laid.linkColors, 3));
    g.setAttribute("aDist", new THREE.BufferAttribute(aDist, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
    g.setAttribute("aFocus", new THREE.BufferAttribute(focus ?? new Float32Array(m * 2).fill(1), 1));
    return g;
  }, [laid, focus]);
  useEffect(() => () => geo.dispose(), [geo]);
  const uni = useMemo(() => ({ uTime: { value: 0 }, uBase: { value: 0.05 }, uPulse: { value: 0.5 }, uSpeed: { value: 0.2 }, uWidth: { value: 0.14 }, uT: introUni.uT, uZTop: introUni.uZTop, uZSpan: introUni.uZSpan }), [introUni]);
  useFrame(({ clock }) => {
    const u = matRef.current?.uniforms; if (!u) return;
    u.uTime.value = clock.getElapsedTime();
    u.uBase.value = 0.09 * cfg.lines; u.uPulse.value = 0.6 * cfg.lines; u.uSpeed.value = 0.2 * cfg.flow;
  });
  if (cfg.lines <= 0 || laid.linkCount === 0) return null;
  return (
    <lineSegments geometry={geo} frustumCulled={false}>
      <shaderMaterial ref={matRef} uniforms={uni} vertexShader={PULSE_VERT} fragmentShader={PULSE_FRAG} transparent depthWrite={false} blending={cfg.bloom > 0 ? THREE.AdditiveBlending : THREE.NormalBlending} />
    </lineSegments>
  );
}

// ── flags: luminance rank 1, the brightest thing on screen (CRAFT §1). A ringed
// beacon that breathes, sits above its node, and ignites LAST in the entrance so
// the eye lands on the problem rather than wandering to it. If a frame's brightest
// pixel is not one of these (or a badge), the frame fails QA.
function Flags({ flags, onSelect, introBox, reduced }: { flags: Flagged[]; onSelect?: (id: string | null) => void; introBox: IntroBox; reduced: boolean }) {
  const grp = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = grp.current; if (!g) return;
    const t = introBox.current.t;
    const e = Math.min(1, Math.max(0, (t - 2.8) / 0.7)); // last beat of the entrance
    g.visible = e > 0.01;
    // a slow pulse — alarm, not disco. Reduced-motion holds it steady and lit.
    const pulse = reduced ? 1 : 0.82 + 0.18 * Math.sin(clock.getElapsedTime() * 2.1);
    const s = (1 - Math.pow(1 - e, 3)) * pulse;
    g.children.forEach((c) => c.scale.setScalar(Math.max(0.001, s)));
  });
  if (!flags.length) return null;
  return (
    <group ref={grp}>
      {flags.map((f) => {
        const col = FLAG_COLOR[f.kind];
        return (
          <group key={f.id} position={f.pos}>
            {/* A flag is the node BURNING, not a ring drawn around it. The two
                concentric rings this replaces read as a rifle sight — targeting
                chrome borrowed from HUDs, which is the one visual idiom a
                bioluminescent colony cannot survive. An alarm here is heat in
                cold water: a hard core bleeding outward, no outline at all.
                Warm exists in exactly two places in this scene, and this is one. */}
            <mesh
              onClick={(e) => { e.stopPropagation(); onSelect?.(f.id); }}
              onPointerOver={() => { document.body.style.cursor = "pointer"; }}
              onPointerOut={() => { document.body.style.cursor = "auto"; }}
            >
              <circleGeometry args={[10, 24]} />
              <meshBasicMaterial color={col} transparent opacity={0.98} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            {/* the bleed: three soft shells, each wider and fainter, so the heat
                falls off into the water instead of ending on an edge */}
            <mesh raycast={() => null}>
              <circleGeometry args={[21, 24]} />
              <meshBasicMaterial color={col} transparent opacity={0.30} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh raycast={() => null}>
              <circleGeometry args={[38, 24]} />
              <meshBasicMaterial color={col} transparent opacity={0.13} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh raycast={() => null}>
              <circleGeometry args={[64, 24]} />
              <meshBasicMaterial color={col} transparent opacity={0.05} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ── light-shaft spines (CRAFT §2, the signature element — specified, protected
// in writing, never built until now). Authority = light falling: a spotlight
// cone from each structural parent down onto its child, narrow at the source,
// widening as it falls. One merged, baked BufferGeometry (matches the Field /
// PulseLinks pattern — one draw call, no per-instance shader complexity for a
// count this small). Scope: tier<=2 nodes only (the org's authority chain —
// GM → heads → SOPs → named staff), never the dense tier-3 field beneath it,
// mirroring the edge-culling law used everywhere else in this scene.
const SPINE_VERT = /* glsl */ `
  attribute float aT; attribute vec3 aNormal; attribute vec3 aColor;
  uniform float uT; uniform float uZTop; uniform float uZSpan;
  varying float vT; varying vec3 vColor; varying vec3 vNormal; varying vec3 vViewDir; varying float vIntro; varying vec3 vObj;
  // GLSL normalize() on a near-zero vector is 0/0 = NaN (unlike three.js's
  // JS-side Vector3.normalize, which guards it) — one NaN fragment here fed
  // Bloom's mip blur and washed the entire frame white. Never trust normalize()
  // on a runtime-derived vector again without this guard.
  vec3 safeNormalize(vec3 v) { float l = length(v); return l > 0.0001 ? v / l : vec3(0.0, 1.0, 0.0); }
  void main() {
    vT = aT; vColor = aColor; vNormal = safeNormalize(normalMatrix * aNormal);
    vObj = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewDir = safeNormalize(-mv.xyz);
    // ignite top-down, source-first (CRAFT §3: "1.2s spines ignite top-down —
    // the law flows down"). uZTop/uZSpan are shared with the other entrance
    // waves so every element reads off the same clock.
    vIntro = clamp((uT - 1.0 - ((uZTop - position.z) / uZSpan) * 1.2) / 0.6, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }`;
const SPINE_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime; uniform float uDrift; uniform float uIntensity;
  varying float vT; varying vec3 vColor; varying vec3 vNormal; varying vec3 vViewDir; varying float vIntro; varying vec3 vObj;
  float hash13(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    // fresnel: the beam's silhouette catches light, its face stays a whisper —
    // a cone reads as a shaft of light, not a solid pipe. vNormal/vViewDir are
    // already safely normalized (or interpolated between safe unit vectors),
    // so a plain dot product is enough here.
    float fresnel = pow(1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0), 2.2);
    // gradient alpha: dense at the source (parent, t=0), diffusing as it falls.
    float grad = pow(1.0 - clamp(vT, 0.0, 1.0), 1.6);
    // Dust in a light shaft. The previous line claimed to be exactly that and
    // was the opposite: ONE sine at a fixed 26 cycles, ±45%, depending only on
    // vT — so every beam in the scene banded at the same places, in phase, with
    // hard regular edges. That is corduroy, and close up it made the brass
    // beams read as corrugated cardboard and the sheaves as striped drinking
    // straws (Jesse, 2026-08-03: "our own graph looks childish"). A texture is
    // regular; motes are not.
    //
    // Three things fix it and all three are necessary. A PER-BEAM PHASE from a
    // hash of the (coarsely quantised) object position, so beams stop banding
    // together. TWO incommensurate frequencies, so the pattern never repeats
    // along a shaft. And an amplitude of ±11% rather than ±45%, because the
    // grain is meant to be felt, not read. highp because the higher frequency
    // aliases into visible steps under mediump.
    float seed = hash13(floor(vObj * 0.05));
    float d1 = sin((vT * 173.0 + seed * 61.0 - uTime * uDrift * 2.6) * 6.2831853);
    float d2 = sin((vT * 67.0 - seed * 23.0 - uTime * uDrift * 1.3) * 6.2831853);
    float grain = 0.89 + 0.11 * (d1 * 0.55 + d2 * 0.45);
    float a = (0.10 + grad * 0.34) * (0.4 + fresnel * 0.9) * grain * uIntensity * vIntro;
    gl_FragColor = vec4(vColor * (1.15 + fresnel * 0.6), a);
  }`;

type SpinePair = { ax: number; ay: number; az: number; bx: number; by: number; bz: number; cr: number; cg: number; cb: number };

function buildSpinePairs(data: BoobooGraph, laid: Laid): SpinePair[] {
  const out: SpinePair[] = [];
  for (const n of data.nodes) {
    if ((n.tier ?? 2) > 2 || !n.parent) continue;
    const pi = laid.index.get(n.parent);
    const ci = laid.index.get(n.id);
    if (pi == null || ci == null || pi === ci) continue;
    out.push({
      ax: laid.positions[pi * 3], ay: laid.positions[pi * 3 + 1], az: laid.positions[pi * 3 + 2],
      bx: laid.positions[ci * 3], by: laid.positions[ci * 3 + 1], bz: laid.positions[ci * 3 + 2],
      cr: laid.colors[pi * 3], cg: laid.colors[pi * 3 + 1], cb: laid.colors[pi * 3 + 2],
    });
  }
  return out;
}

// A spotlight-cone frustum per pair, baked directly into world-space vertex
// positions (no instancing): narrow at the parent (the source), wide at the
// child (the light landing) — RADIUS_TOP < RADIUS_BOTTOM, the inverse of a
// pointed cone.
const RADIUS_TOP = 2.2;
const RADIUS_BOTTOM = 11;
const RIM_SEG = 7;
function buildSpineGeometry(pairs: SpinePair[]): THREE.BufferGeometry {
  const verts = pairs.length * RIM_SEG * 6; // 2 triangles per segment quad
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 3);
  const aT = new Float32Array(verts);
  let w = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const axisTmp = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (const p of pairs) {
    axisTmp.set(p.bx - p.ax, p.by - p.ay, p.bz - p.az);
    const len = axisTmp.length();
    if (len < 1e-4) continue;
    axisTmp.normalize();
    // any vector not parallel to axis, projected off it, gives a stable basis
    u.copy(Math.abs(axisTmp.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : up).cross(axisTmp).normalize();
    v.crossVectors(axisTmp, u).normalize();
    // belt + braces: a degenerate cross (u or v collapsed to zero) must never
    // reach the GPU as a zero-length normal — see safeNormalize's comment.
    if (u.lengthSq() < 1e-8 || v.lengthSq() < 1e-8) continue;
    for (let s = 0; s < RIM_SEG; s++) {
      const a0 = (s / RIM_SEG) * Math.PI * 2, a1 = ((s + 1) / RIM_SEG) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      // four corners of this quad: top-a, top-b, bottom-a, bottom-b
      const corners = [
        { r: RADIUS_TOP, c: c0, s: s0, t: 0, base: p }, { r: RADIUS_TOP, c: c1, s: s1, t: 0, base: p },
        { r: RADIUS_BOTTOM, c: c0, s: s0, t: 1, base: p }, { r: RADIUS_BOTTOM, c: c1, s: s1, t: 1, base: p },
      ];
      const pts = corners.map((cc) => {
        const along = cc.t * len;
        const rx = u.x * cc.c * cc.r + v.x * cc.s * cc.r;
        const ry = u.y * cc.c * cc.r + v.y * cc.s * cc.r;
        const rz = u.z * cc.c * cc.r + v.z * cc.s * cc.r;
        return {
          x: cc.base.ax + axisTmp.x * along + rx, y: cc.base.ay + axisTmp.y * along + ry, z: cc.base.az + axisTmp.z * along + rz,
          nx: rx, ny: ry, nz: rz, t: cc.t,
        };
      });
      // two triangles: top0-top1-bot0, top1-bot1-bot0
      const tri = [pts[0], pts[1], pts[2], pts[1], pts[3], pts[2]];
      for (const pt of tri) {
        position[w * 3] = pt.x; position[w * 3 + 1] = pt.y; position[w * 3 + 2] = pt.z;
        const nl = Math.hypot(pt.nx, pt.ny, pt.nz) || 1;
        normal[w * 3] = pt.nx / nl; normal[w * 3 + 1] = pt.ny / nl; normal[w * 3 + 2] = pt.nz / nl;
        color[w * 3] = p.cr; color[w * 3 + 1] = p.cg; color[w * 3 + 2] = p.cb;
        aT[w] = pt.t;
        w++;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(position.subarray(0, w * 3), 3));
  g.setAttribute("aNormal", new THREE.BufferAttribute(normal.subarray(0, w * 3), 3));
  g.setAttribute("aColor", new THREE.BufferAttribute(color.subarray(0, w * 3), 3));
  g.setAttribute("aT", new THREE.BufferAttribute(aT.subarray(0, w), 1));
  return g;
}

function Spines({ data, laid, intensity, bloom, introUni }: { data: BoobooGraph; laid: Laid; intensity: number; bloom: boolean; introUni: IntroUni }) {
  const pairs = useMemo(() => buildSpinePairs(data, laid), [data, laid]);
  const geo = useMemo(() => buildSpineGeometry(pairs), [pairs]);
  useEffect(() => () => geo.dispose(), [geo]);
  const uni = useMemo(() => ({ uTime: { value: 0 }, uDrift: { value: 0.06 }, uIntensity: { value: intensity }, uT: introUni.uT, uZTop: introUni.uZTop, uZSpan: introUni.uZSpan }), [introUni]);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  useFrame(({ clock }) => {
    const u2 = matRef.current?.uniforms; if (!u2) return;
    u2.uTime.value = clock.getElapsedTime();
    u2.uIntensity.value = intensity;
  });
  if (intensity <= 0 || pairs.length === 0) return null;
  // De-bloomed default (the cosmos lesson, same rule Field/PulseLinks follow):
  // dozens of these beams overlap near every department head, and unconditional
  // AdditiveBlending summed them past white across most of the frame — the
  // luminance ladder is a law, not a per-element choice. FrontSide halves the
  // overdraw a hollow double-sided tube would otherwise cost.
  return (
    <mesh geometry={geo} frustumCulled={false} raycast={() => null}>
      <shaderMaterial ref={matRef} uniforms={uni} vertexShader={SPINE_VERT} fragmentShader={SPINE_FRAG} transparent depthWrite={false} side={THREE.FrontSide} blending={bloom ? THREE.AdditiveBlending : THREE.NormalBlending} />
    </mesh>
  );
}

// ── landmarks (CRAFT: objects, not dots): tier<=1 nodes as faceted brass studs with a
// soft contact shadow on their band's floor. One InstancedMesh each; instance-picked.
const GOLD = new THREE.Color("#c9a04a");
function Landmarks({ data, laid, cfg, focus, sel, onSelect, introBox }: { data: BoobooGraph; laid: Laid; cfg: BoobooCfg; focus: Float32Array | null; sel?: string | null; onSelect?: (id: string | null) => void; introBox: IntroBox }) {
  const layerIdx = useMemo(() => {
    const m: Record<string, number> = {};
    data.meta.layers.forEach((l, i) => (m[l.name] = i));
    return m;
  }, [data]);
  const nL = Math.max(1, data.meta.layers.length);
  const items = useMemo(() => {
    const out: { i: number; r: number; z: number }[] = [];
    for (let i = 0; i < laid.count; i++) {
      if (laid.nodeTier[i] > 1) continue;
      if (cfg.layers[laid.nodeLayer[i]] === false) continue;
      out.push({ i, r: Math.max(6.5, laid.sizes[i] * 0.85), z: planeZ(layerIdx[laid.nodeLayer[i]] ?? 0, nL) });
    }
    return out;
  }, [laid, cfg.layers, layerIdx, nL]);
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const shadowRef = useRef<THREE.InstancedMesh>(null);
  const M = useMemo(() => new THREE.Matrix4(), []);
  // matrices + colours: once per items/focus change (a few hundred instances, trivial)
  useEffect(() => {
    const body = bodyRef.current, shadow = shadowRef.current;
    if (!body || !shadow) return;
    const c = new THREE.Color();
    for (let k = 0; k < items.length; k++) {
      const { i, r, z } = items[k];
      const x = laid.positions[i * 3], y = laid.positions[i * 3 + 1], zz = laid.positions[i * 3 + 2];
      M.makeScale(r, r, r).setPosition(x, y, zz);
      body.setMatrixAt(k, M);
      M.makeScale(r * 1.7, r * 1.7, 1).setPosition(x, y, z + 0.9);
      shadow.setMatrixAt(k, M);
      c.setRGB(laid.colors[i * 3], laid.colors[i * 3 + 1], laid.colors[i * 3 + 2]).lerp(GOLD, 0.3);
      const f = focus ? focus[i] : 1;
      c.multiplyScalar(0.35 + 0.75 * f);
      body.setColorAt(k, c);
    }
    body.instanceMatrix.needsUpdate = true;
    shadow.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    body.count = items.length;
    shadow.count = items.length;
  }, [items, laid, focus, M]);
  // entrance: the cast arrives after the floors, before the field wakes (1.0 → 1.8s)
  useFrame(() => {
    const body = bodyRef.current; if (!body) return;
    const t = introBox.current.t;
    const e = Math.min(1, Math.max(0, (t - 1.0) / 0.8));
    const s = 1 - Math.pow(1 - e, 3);
    body.visible = s > 0.02;
    if (shadowRef.current) shadowRef.current.visible = body.visible;
    body.scale.setScalar(Math.max(0.001, s));
  });
  if (items.length === 0) return null;
  return (
    <>
      <instancedMesh
        ref={bodyRef}
        args={[undefined, undefined, Math.max(1, items.length)]}
        frustumCulled={false}
        onClick={(e) => { const iid = e.instanceId; if (iid != null && onSelect) { onSelect(laid.ids[items[iid].i]); e.stopPropagation(); } }}
      >
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial metalness={0.82} roughness={0.34} flatShading emissive="#1a1408" emissiveIntensity={0.6} />
      </instancedMesh>
      <instancedMesh ref={shadowRef} args={[undefined, undefined, Math.max(1, items.length)]} frustumCulled={false} raycast={() => null}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.32} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

// ── the observatory floor (CRAFT): glass disc with a radial gradient, etched concentric
// rules, the band name ENGRAVED on the surface clock-face style, a thin rim, and a slow
// breath. Luminance ladder: disc 0.06 · etchings 0.10 — substrate, never spectacle.
const DISC_FRAG = /* glsl */ `
  precision mediump float; varying vec2 vUv; uniform vec3 uTint; uniform float uOp;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    // glass: dark well at the centre lifting to a tinted mid, easing off before the rim
    float grad = smoothstep(0.05, 0.8, r) * (1.0 - 0.45 * smoothstep(0.86, 1.0, r));
    // etched rules at quarter radii — hairlines, not rings of their own
    float q = fract(r * 4.0); float rule = 1.0 - smoothstep(0.0, 0.016, min(q, 1.0 - q));
    // fine minute-ticks just inside the rim: 60 thin marks, whisper-level
    float ang = atan(vUv.y - 0.5, vUv.x - 0.5);
    float td = abs(fract(ang * 9.5493) - 0.5) * 2.0;
    float tick = smoothstep(0.9, 0.985, td)
               * smoothstep(0.948, 0.956, r) * (1.0 - smoothstep(0.982, 0.996, r));
    float a = uOp * (grad + rule * 0.3 + tick * 0.4);
    gl_FragColor = vec4(uTint * (1.0 + rule * 0.22 + tick * 0.25), a);
  }`;
const DISC_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// The band name drawn along an arc into a CanvasTexture — engraved into the floor.
function arcLabelTexture(label: string, color: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const S = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d");
  if (!x) return null;
  const rad = S * 0.40;
  // scale with label length so long band names hold a dignified ~90° arc, never a pile
  const px = S * Math.min(0.044, 0.6 / Math.max(8, label.length));
  x.font = `600 ${px}px ui-monospace, SFMono-Regular, monospace`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  const chars = (label.toUpperCase()) .split("");
  const step = (px * 1.18) / rad; // arc advance per character (incl. tracking)
  let a = -Math.PI / 2 - (step * (chars.length - 1)) / 2;
  for (const ch of chars) {
    x.save();
    x.translate(S / 2 + Math.cos(a) * rad, S / 2 + Math.sin(a) * rad);
    x.rotate(a + Math.PI / 2);
    x.fillStyle = "rgba(0,0,0,0.85)"; x.fillText(ch, 1.5, 1.5); // engrave shadow
    x.fillStyle = color; x.fillText(ch, 0, 0);
    x.restore();
    a += step;
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

function Platform({ z, color, label, radius, planes, rings, labels, introBox, introDelay = 0 }: { z: number; color: string; label: string; radius: number; planes: boolean; rings: boolean; labels: boolean; introBox?: IntroBox; introDelay?: number }) {
  const grp = useRef<THREE.Group>(null);
  const tint = useMemo(() => new THREE.Color(color), [color]);
  const uni = useMemo(() => ({ uTint: { value: tint }, uOp: { value: 0.055 } }), [tint]);
  // floor engraving carries only the short rank word; the rim label + legend carry the rest
  const engraved = useMemo(() => label.split("·")[0].trim() || label, [label]);
  const tex = useMemo(() => (labels ? arcLabelTexture(engraved, color) : null), [labels, engraved, color]);
  useEffect(() => () => { tex?.dispose(); }, [tex]);
  // breath ±0.3% phase-offset per band; entrance rises each disc into place bottom-up
  useFrame(({ clock }) => {
    const g = grp.current; if (!g) return;
    const t = introBox?.current.t ?? 1000;
    const e = Math.min(1, Math.max(0, (t - introDelay) / 0.7));
    const ease = 1 - Math.pow(1 - e, 3); // settle
    const s = (1 + Math.sin(clock.getElapsedTime() * 0.35 + z * 0.011) * 0.003) * (0.94 + 0.06 * ease);
    g.scale.set(s, s, 1);
    g.position.z = z - 50 * (1 - ease);
    g.visible = e > 0.001;
  });
  return (
    <group ref={grp} position={[0, 0, z]}>
      {planes && (
        <mesh>
          <circleGeometry args={[radius, 96]} />
          <shaderMaterial vertexShader={DISC_VERT} fragmentShader={DISC_FRAG} uniforms={uni} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}
      {rings && <mesh><torusGeometry args={[radius, radius * 0.0028, 8, 140]} /><meshBasicMaterial color={color} transparent opacity={0.55} toneMapped={false} /></mesh>}
      {/* zIndexRange caps drei's default 16,777,271 so 3D labels sit BELOW the
          chrome layers (hud 10 / dossier 20 / palette 30 in the token z-map) */}
      {labels && tex && (
        <mesh position={[0, 0, 0.6]}>
          <circleGeometry args={[radius * 1.0, 64]} />
          <meshBasicMaterial map={tex} transparent opacity={0.48} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {labels && (
        <Html position={[radius * 1.04, 0, 0]} center zIndexRange={[9, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ color, font: "10px var(--font-jetbrains, ui-monospace), monospace", letterSpacing: 3, opacity: 0.55, whiteSpace: "nowrap", textShadow: "0 0 8px rgba(0,0,0,.95)" }}>{label}</div>
        </Html>
      )}
    </group>
  );
}

// Faint void of distant stars (cosmic depth), scaled to the graph extent.
function Starfield({ scale }: { scale: number }) {
  const ref = useRef<THREE.Points>(null);
  const { geo, mat } = useMemo(() => {
    const N = 1300, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), r = (50 + Math.random() * 38) * scale;
      pos[i * 3] = Math.cos(a) * Math.sin(ph) * r; pos[i * 3 + 1] = Math.sin(a) * Math.sin(ph) * r; pos[i * 3 + 2] = Math.cos(ph) * r * 0.7;
      const tw = 0.4 + Math.random() * 0.6; c.setHSL(0.58 + Math.random() * 0.12, 0.25, 0.55 * tw);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 0.16 * scale, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false });
    return { geo: g, mat: m };
  }, [scale]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.z += dt * 0.003; });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} />;
}

// Soft drifting clouds at the edge of the known graph.
const FOG_VERT = /* glsl */ `attribute float aSize; attribute vec3 aColor; varying vec3 vC;
  void main(){ vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0);
    gl_PointSize=aSize*(60.0/-mv.z); gl_Position=projectionMatrix*mv; }`;
const FOG_FRAG = /* glsl */ `precision mediump float; uniform float uOp; varying vec3 vC;
  void main(){ vec2 d=gl_PointCoord-vec2(0.5); float r=length(d);
    if(r>0.5) discard; float a=smoothstep(0.5,0.0,r)*uOp; gl_FragColor=vec4(vC,a); }`;
function FrontierFog({ scale, amount }: { scale: number; amount: number }) {
  const ref = useRef<THREE.Points>(null);
  const { geo, mat } = useMemo(() => {
    const COUNT = 700;
    const pos = new Float32Array(COUNT * 3), col = new Float32Array(COUNT * 3), siz = new Float32Array(COUNT);
    const pal = [new THREE.Color("#4a6cb8"), new THREE.Color("#7152a8"), new THREE.Color("#3a72a8"), new THREE.Color("#8a6a48"), new THREE.Color("#5a82c0")];
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), r = (11 + Math.random() * 13) * scale;
      pos[i * 3] = Math.cos(a) * Math.sin(ph) * r; pos[i * 3 + 1] = Math.sin(a) * Math.sin(ph) * r * 0.85; pos[i * 3 + 2] = Math.cos(ph) * r * 0.6;
      const c = pal[(Math.random() * pal.length) | 0]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      siz[i] = (100 + Math.random() * 150) * scale;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(siz, 1));
    const m = new THREE.ShaderMaterial({ uniforms: { uOp: { value: 0.3 } }, vertexShader: FOG_VERT, fragmentShader: FOG_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { geo: g, mat: m };
  }, [scale]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(({ clock }, dt) => { if (ref.current) { ref.current.rotation.z += dt * 0.012; (ref.current.material as THREE.ShaderMaterial).uniforms.uOp.value = 0.3 * amount; } });
  if (amount <= 0) return null;
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} />;
}

// The house is a WIDE disc, and three.js `fov` is the VERTICAL angle — so the
// horizontal one is whatever the aspect ratio leaves you. At 1600×1000 that is
// a comfortable ~37°; at 390×844 it collapses to ~11° and the camera ends up
// INSIDE the building, looking at three cones edge-on. That single fact is why
// /viewer/ on a phone had never looked like anything (GAPS C9), and why the
// first recorded hero loop was a close-up of some geometry.
//
// Fixed by dollying BACK rather than widening the lens: holding the horizontal
// half-angle constant costs a 73° vertical fov on a phone, and that much
// perspective distortion turns a measured orrery into a fisheye. Distance is
// the free variable, so use it.
const FIT_ASPECT = 1.6;   // the aspect the framing was composed at
const FIT_MAX = 3.0;      // past this the house is a speck; crop instead
function AspectFit({ base }: { base: [number, number, number] }) {
  const { camera, size } = useThree();
  const applied = useRef<number | null>(null);
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const k = Math.min(FIT_MAX, Math.max(1, FIT_ASPECT / aspect));
    // Only move on a real change in fit. Without this, every window resize —
    // including the one a desktop user causes by dragging a pane — would snap
    // the camera back and silently throw away their zoom and pan.
    if (applied.current !== null && Math.abs(applied.current - k) < 0.01) return;
    applied.current = k;
    camera.position.set(base[0] * k, base[1] * k, base[2] * k);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, base[0], base[1], base[2]]);
  return null;
}

// The graph + platforms spin together (slow wandering turn so every face shows). peel = z-scale (tier spacing).
function Spin({ orbit, drift, peel, children }: { orbit: number; drift: number; peel: number; children: React.ReactNode }) {
  const grp = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    const g = grp.current; if (!g) return;
    // Halved 2026-07-19 (Jesse: "spinning slightly too fast"). Applied to the
    // base rates rather than the cfg defaults on purpose — a saved cfg or a
    // preset that sets orbit:1 must also get the calmer speed, and a grand
    // house should turn like a slow orrery, not a screensaver.
    g.rotation.z += dt * 0.003 * drift;
    if (orbit <= 0) return;
    const t = clock.getElapsedTime();
    const wy = 0.065 + 0.085 * Math.sin(t * 0.047) + 0.05 * Math.sin(t * 0.019 + 1.3) + 0.025 * Math.sin(t * 0.101 + 2.1);
    g.rotation.y += dt * orbit * wy;
  });
  return <group ref={grp} scale={[1, 1, Math.max(0.05, peel)]}>{children}</group>;
}

// ── focus: fly the camera to ONE node and hold it there ────────────────────
// The claim this thing makes is that it finds the one that matters out of
// thousands. A selection alone cannot make that claim: `sel` torches a
// neighbourhood where it already stands, so a host can say "the night porter"
// and the reader still has to hunt the frame for what changed. This moves the
// camera, which is the difference between naming a node and pointing at it.
//
// The marker is a real Object3D parented INSIDE Spin, so getWorldPosition
// inherits the group's wandering rotation AND its peel z-scale for free.
// Recomputing that by hand drifts the instant orbit or peel changes, and it
// changes on almost every beat of a scroll-driven descent.
//
// It HANDS THE CAMERA BACK. Focus cleared -> ease home, then stop touching it
// entirely: a viewer that was never focused keeps its own framing, and a user
// who grabs the controls afterwards is not fought for the rest of the session.
// Slower than it wants to be. The move is the whole flex, so it has to read as
// a decision rather than a snap; 0.055 arrived before the reader's eye did.
// Expressed per 60fps frame and CONVERTED BY DELTA TIME below, because the
// marker it chases is inside the drifting Spin group: a raw per-frame lerp
// closes at whatever rate the client happens to render, so on a slow client the
// target trails a node that never stops moving and the frame slides forever
// instead of settling. Watched it happen at ~1fps.
const FOCUS_EASE = 0.032;

// Multiples of the graph radius, TUNED BY SHOOTING IT. Closer stopped meaning
// clearer several hundred units out: at 0.5r the camera sits INSIDE the
// 2,717-node memory floor and the frame is a wash of out-of-focus blobs, and
// 1.15r is no better. Even 2.2r lands dim rather than composed. The colony has
// to stay whole for "one out of 2,839" to mean anything — the torch does the
// isolating, the camera only aims.
const FOCUS_DIST = 3;

function FocusDriver({ pos, homeDist, near, panelPx = 0, bias }: { pos: [number, number, number] | null; homeDist: number; near: number; panelPx?: number; bias?: number }) {
  const marker = useRef<THREE.Object3D>(null);
  const { camera, controls, size } = useThree();
  const engaged = useRef(false);
  const world = useMemo(() => new THREE.Vector3(), []);
  const arm = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const ctrl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (!ctrl?.target) return;
    if (pos) engaged.current = true;
    if (!engaged.current) return;
    // dt is clamped: a backgrounded tab hands back one enormous delta on return,
    // and closing the whole distance in a single frame is a cut, not a move.
    const k = 1 - Math.pow(1 - FOCUS_EASE, Math.min(dt, 0.1) * 60);

    if (pos && marker.current) marker.current.getWorldPosition(world);
    else world.set(0, 0, 0);

    const want = pos ? near : homeDist;

    // THE CANVAS CENTRE IS NOT THE CENTRE OF WHAT IS SEEN. The dossier covers
    // the right of the frame, so a node centred in the canvas reads visibly
    // off-centre — shot and confirmed, and it is the whole difference between
    // "the camera moved" and "it is pointing at THIS".
    //
    // `bias` is where the node should LAND, as a signed fraction of canvas
    // width from centre (negative = left). Default: half the dossier to the
    // left, which centres it in the field the panel leaves. A host overrides
    // it, because only the host knows its own frame — an embed that crops the
    // chrome off and runs a copy column down the left wants the node on the
    // RIGHT, which is the opposite correction, and the viewer cannot see any
    // of that from in here.
    const b = bias ?? -Math.min(panelPx / size.width, 0.5) / 2;
    if (pos && Math.abs(b) > 0.001) {
      const cam = camera as THREE.PerspectiveCamera;
      const visW = 2 * Math.tan((cam.fov * Math.PI) / 360) * want * cam.aspect;
      right.setFromMatrixColumn(cam.matrix, 0);
      world.addScaledVector(right, -Math.max(-0.45, Math.min(0.45, b)) * visW);
    }

    ctrl.target.lerp(world, k);
    arm.copy(camera.position).sub(ctrl.target);
    const d = arm.length();
    if (d > 1e-4) {
      arm.setLength(d + (want - d) * k);
      camera.position.copy(ctrl.target).add(arm);
    }
    ctrl.update();

    if (!pos && ctrl.target.lengthSq() < 1 && Math.abs(d - homeDist) < homeDist * 0.02) engaged.current = false;
  });
  return pos ? <object3D ref={marker} position={pos} /> : null;
}

// Absolute cap on DOM label portals: many sparse layers could otherwise spawn thousands of
// per-frame <Html> portals. Keep the per-layer count gate; cap the total at top-N by weight.
const MAX_LABELS = 150;

// Labels for nodes in sparse tiers (+ the root) — the structural nodes. Dense tiers stay unlabelled (no clutter).
function NodeLabels({ data, laid }: { data: BoobooGraph; laid: Laid }) {
  const items = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of data.nodes) counts[n.layer] = (counts[n.layer] ?? 0) + 1;
    let out: { id: string; label: string; pos: [number, number, number]; weight: number }[] = [];
    for (const n of data.nodes) {
      if ((counts[n.layer] ?? 0) > 12 && n.id !== data.meta.root) continue; // ponytail: count gate, no de-clutter solver
      const i = laid.index.get(n.id);
      if (i == null) continue;
      out.push({ id: n.id, label: truncateLabel(n.label), pos: [laid.positions[i * 3], laid.positions[i * 3 + 1], laid.positions[i * 3 + 2]], weight: n.weight ?? 0 });
    }
    if (out.length > MAX_LABELS) out = out.sort((a, b) => b.weight - a.weight).slice(0, MAX_LABELS); // global cap: top-N by weight
    return out;
  }, [data, laid]);
  return (
    <>
      {items.map((it) => (
        <Html key={it.id} position={it.pos} center zIndexRange={[9, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ color: "#E8DCC4", font: "11px var(--font-jetbrains, ui-monospace), monospace", letterSpacing: 0.4, whiteSpace: "nowrap", textShadow: "0 0 7px rgba(0,0,0,.95)", transform: "translateY(-14px)" }}>{it.label}</div>
        </Html>
      ))}
    </>
  );
}

/** The core scene. Give it a Booboo graph (+ optional cfg); it lays out + renders the tiered field. */
export function Booboo({ data, cfg, onSelect, sel, focusId, focusDist = FOCUS_DIST, focusPanelPx = 0, focusBias, intro = true }: { data: BoobooGraph; cfg?: BoobooCfg; onSelect?: (id: string | null) => void; sel?: string | null; focusId?: string | null; focusDist?: number; focusPanelPx?: number; focusBias?: number; intro?: boolean }) {
  const laid = useMemo(() => layout(data), [data]);
  const c = useMemo(() => cfg ?? defaultCfg(data), [cfg, data]);
  const nL = Math.max(1, data.meta.layers.length);
  // ── entrance (CRAFT): discs rise bottom-up → spines ignite top-down → field wakes.
  // Skippable on any input; prefers-reduced-motion gets the final frame immediately.
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const introBox: IntroBox = useRef({ t0: null, skip: !intro || !!reduced, t: 0 });
  const introUni = useMemo<IntroUni>(() => ({
    uT: { value: 1000 },
    uZTop: { value: ((nL - 1) / 2) * PLANE_GAP },
    uZSpan: { value: Math.max(1, (nL - 1) * PLANE_GAP) },
  }), [nL]);
  useEffect(() => {
    if (introBox.current.skip) return;
    const skip = () => { introBox.current.skip = true; };
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    const done = setTimeout(() => {
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    }, 4200);
    return () => { clearTimeout(done); window.removeEventListener("pointerdown", skip); window.removeEventListener("keydown", skip); };
  }, []);
  const radius = laid.bounds;
  const platR = radius * 1.06;
  const half = ((nL - 1) / 2) * PLANE_GAP * c.peel;
  const cam = radius * 4.0 + half * 1.0 + 300;
  // ── torch focus (CRAFT): selection lights its neighbourhood; the rest recedes.
  // One O(links) scan per selection change → per-node + per-link-vertex focus buffers.
  const focus = useMemo(() => {
    if (!sel) return { node: null as Float32Array | null, link: null as Float32Array | null };
    const si = laid.index.get(sel);
    if (si == null) return { node: null, link: null };
    const nf = new Float32Array(laid.count).fill(0.12);
    nf[si] = 1;
    const lf = new Float32Array(laid.linkCount * 2).fill(0.06);
    let k = 0;
    for (const l of data.links) {
      const a = laid.index.get(l.source), b = laid.index.get(l.target);
      if (a == null || b == null) continue;
      const na = data.nodes[a], nb = data.nodes[b];
      const spine = l.type === "spine" || l.type === "tether";
      if (!spine && (na.tier ?? 2) > 1 && (nb.tier ?? 2) > 1) continue; // mirrors layout culling
      if (a === si || b === si) {
        lf[k * 2] = 1; lf[k * 2 + 1] = 1;
        nf[a] = Math.max(nf[a], 0.95); nf[b] = Math.max(nf[b], 0.95);
      }
      k++;
    }
    return { node: nf, link: lf };
  }, [sel, laid, data]);
  // Local coords only — FocusDriver's marker lives inside Spin, which applies
  // the rotation and the peel z-scale on top.
  const focusPos = useMemo<[number, number, number] | null>(() => {
    if (!focusId) return null;
    const i = laid.index.get(focusId);
    if (i == null) return null;
    return [laid.positions[i * 3], laid.positions[i * 3 + 1], laid.positions[i * 3 + 2]];
  }, [focusId, laid]);
  return (
    <Canvas
      camera={{ position: [0, -cam * 0.55, cam * 0.82], far: cam * 22, near: cam * 0.02, fov: 24 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      dpr={[1, 2]}
      raycaster={{ params: { Points: { threshold: Math.max(6, radius * 0.012) } } as THREE.RaycasterParameters }}
      onPointerMissed={() => onSelect?.(null)}
    >
      <color attach="background" args={["#06080e"]} />
      {/* lights exist for the brass landmarks only — every other material is Basic/Shader */}
      <hemisphereLight args={["#2a3350", "#06080e", 0.85]} />
      <directionalLight position={[radius * 0.6, -radius * 1.2, radius * 1.6]} intensity={1.25} color="#fff4e0" />
      <directionalLight position={[-radius, radius * 0.5, radius * 0.4]} intensity={0.35} color="#c9a04a" />
      <AspectFit base={[0, -cam * 0.55, cam * 0.82]} />
      <IntroDriver uni={introUni} box={introBox} />
      <Starfield scale={radius / 12} />
      <FrontierFog scale={radius / 12} amount={c.fog} />
      {/* The scene is now: filaments, the drawn node field, and the alarms. The
          platform discs, the light-shaft spines and the brass landmark meshes
          are all still rendered ONLY when their cfg asks for them, and all three
          default off — they belong to the previous visual language, where a few
          brass objects were the subject and 2,700 nodes were background. In the
          ratified direction the field IS the subject, so switching them on is
          opting back into the old look rather than adding to this one. */}
      <Spin orbit={c.orbit} drift={c.drift} peel={c.peel}>
        {c.platforms && data.meta.layers.map((l, i) => (
          (c.layers[l.name] !== false) && <Platform key={l.name} z={planeZ(i, nL)} color={l.color || "#7a8aa0"} label={l.label || l.name} radius={platR} planes={c.platforms} rings={c.rings} labels={c.labels} introBox={introBox} introDelay={(nL - 1 - i) * 0.18} />
        ))}
        <Spines data={data} laid={laid} intensity={c.spines} bloom={c.bloom > 0} introUni={introUni} />
        <PulseLinks laid={laid} cfg={c} focus={focus.link} introUni={introUni} />
        <Field laid={laid} cfg={c} onPick={(i) => onSelect?.(laid.ids[i])} focus={focus.node} introUni={introUni} />
        {c.rings && <Landmarks data={data} laid={laid} cfg={c} focus={focus.node} sel={sel} onSelect={onSelect} introBox={introBox} />}
        <Flags flags={laid.flags} onSelect={onSelect} introBox={introBox} reduced={!!reduced} />
        {c.labels && <NodeLabels data={data} laid={laid} />}
        {/* NOT a dive — see FOCUS_DIST. The pointing is done by re-centring on
            the node while the graph stays whole; `sel` dims everything outside
            its neighbourhood to 12%, so the torch isolates and the camera only
            has to aim. */}
        <FocusDriver pos={focusPos} homeDist={cam} near={radius * focusDist} panelPx={focusPanelPx} bias={focusBias} />
      </Spin>
      <OrbitControls autoRotate={false} enableRotate enableZoom enablePan screenSpacePanning enableDamping dampingFactor={0.08} target={[0, 0, 0]} minPolarAngle={0} maxPolarAngle={Math.PI} makeDefault />
      <EffectComposer>
        {/* selective bloom: threshold 0.62 (the Atlas value) so only assigned emissives
            — flags, pulses, the root — catch it when bloom is enabled at all */}
        <Bloom mipmapBlur intensity={c.bloom} luminanceThreshold={0.62} luminanceSmoothing={0.3} radius={0.7} />
        <HueSaturation saturation={0.12 * c.cinematic} />
        <BrightnessContrast brightness={0} contrast={0.08 * c.cinematic} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette eskil={false} offset={0.28} darkness={0.7 * Math.max(0, c.cinematic)} />
      </EffectComposer>
    </Canvas>
  );
}
