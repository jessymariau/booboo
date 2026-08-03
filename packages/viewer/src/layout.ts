import type { BoobooGraph } from "@booboo-brain/spec";

// O(n) deterministic layout → flat typed arrays. Scale-first: no per-node objects, no force sim.
// Position = f(layer-plane, cluster-sector, tier-radius, hash(id)). Same input → same output.

// Alarm + verb palettes come from the generated token module — the single
// source (design/tokens.json). They were hand-mirrored here for one commit,
// which is exactly the drift rule zero exists to prevent.
export { FLAG_ORDER, FLAG_COLOR, VERB_COLOR, type FlagKind } from "./tokens";
import { FLAG_ORDER, type FlagKind, VERB_COLOR } from "./tokens";

export type Flagged = { id: string; index: number; kind: FlagKind; label: string; pos: [number, number, number] };

export type Laid = {
  ids: string[];
  index: Map<string, number>;
  nodeLayer: string[]; // layer name per node index (for layer-isolation toggles)
  nodeTier: Int8Array; // tier per node index (landmarks = tier <= 1)
  // Which ARTWORK draws this node. The redesign gives every node type its own
  // designed form rather than one generic dot, so the type has to reach the
  // shader as a number: 0 agent · 1 contract · 2 observation · 3 report ·
  // 4 document · 5 bucket · 6 root.
  nodeKind: Uint8Array;
  flags: Flagged[]; // every alarm in the graph, worst first — the "where's the problem" set
  positions: Float32Array; // n*3
  colors: Float32Array; // n*3
  sizes: Float32Array; // n
  linkPos: Float32Array; // k*6 (two endpoints, dangling dropped)
  linkColors: Float32Array; // k*6
  bounds: number; // rough half-extent for camera framing
  count: number;
  linkCount: number;
};

export const PLANE_GAP = 170; // gap between the stacked tier planes (along Z); a labelled platform sits at each plane

/** Z of a layer's plane. Apex (index 0) on top → highest Z; the last layer sits at the floor. */
export const planeZ = (layerIndex: number, nLayers: number) => ((nLayers - 1) / 2 - layerIndex) * PLANE_GAP;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000000) / 1000000;
}

function hex2rgb(hex?: string | null): [number, number, number] {
  if (!hex) return [0.7, 0.7, 0.7];
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// A cluster's angular identity. Falls back parent → type so ungrouped data still buckets.
const clusterKey = (nd: BoobooGraph["nodes"][number]) => nd.cluster ?? nd.parent ?? nd.type;

// Above this many clusters, a single even ring degenerates into thin spokes;
// switch to phyllotaxis centroids (even 2D packing at any count).
const RING_MAX = 16;

export function layout(g: BoobooGraph): Laid {
  const nodes = g.nodes;
  const n = nodes.length;
  const index = new Map<string, number>();
  const ids: string[] = new Array(n);
  const nodeLayer: string[] = new Array(n);
  const nodeTier = new Int8Array(n);
  const nodeKind = new Uint8Array(n);
  const KIND: Record<string, number> = { agent: 0, contract: 1, observation: 2, report: 3, document: 4, bucket: 5 };
  for (let i = 0; i < n; i++) {
    index.set(nodes[i].id, i);
    ids[i] = nodes[i].id;
    nodeLayer[i] = nodes[i].layer;
    nodeTier[i] = (nodes[i].tier ?? 2) as number;
    // The root gets its own artwork (6) whatever its declared type — there is
    // exactly one and it must be the brightest thing in any frame containing it.
    nodeKind[i] = nodes[i].id === g.meta.root ? 6 : (KIND[nodes[i].type ?? ""] ?? 2);
  }

  const layerOrder: Record<string, number> = {};
  g.meta.layers.forEach((l, i) => (layerOrder[l.name] = i));
  const nLayers = Math.max(1, g.meta.layers.length);
  const layerColor: Record<string, [number, number, number]> = {};
  g.meta.layers.forEach((l) => (layerColor[l.name] = hex2rgb(l.color)));

  // ── The axis law (ported from the Atlas cosmos): each visual channel carries ONE variable.
  //    Z      = layer (the categorical band)
  //    angle  = cluster identity — ENUMERATED over a sorted list, never hashed
  //    radius = constant per ring; importance (tier) = pull toward the cluster's core
  // A cluster's centroid is the SAME (x,y) on every plane, so a cluster reads as a
  // vertical column through the stack. Hash(angle) + radius(tier) — the old scheme —
  // spread every cluster across every ring, which guaranteed interleaved soup.
  const members = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const nd = nodes[i];
    if (nd.id === g.meta.root || (nd.x != null && nd.y != null)) continue;
    const k = clusterKey(nd);
    members.set(k, (members.get(k) ?? 0) + 1);
  }
  const keys = [...members.keys()].sort(); // name-sorted: stable across rebuilds
  const nClusters = Math.max(1, keys.length);
  const R = Math.max(380, Math.sqrt(n) * 5.5); // disc radius grows gently with population
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  const centroidX = new Map<string, number>();
  const centroidY = new Map<string, number>();
  let scatterCap: number;
  if (nClusters <= RING_MAX) {
    // Few clusters: one even ring (the cosmos look — Pemberton's nine departments).
    keys.forEach((k, i) => {
      const a = (i / nClusters) * Math.PI * 2 - Math.PI / 2;
      centroidX.set(k, Math.cos(a) * R);
      centroidY.set(k, Math.sin(a) * R * 0.92);
    });
    scatterCap = Math.min(((Math.PI * 2 * R) / nClusters) * 0.42, R * 0.55);
  } else {
    // Many clusters: phyllotaxis field — deterministic even packing at any count.
    keys.forEach((k, i) => {
      const a = i * GOLDEN;
      const r = R * Math.sqrt((i + 0.5) / nClusters);
      centroidX.set(k, Math.cos(a) * r);
      centroidY.set(k, Math.sin(a) * r * 0.92);
    });
    scatterCap = 0.85 * (R / Math.sqrt(nClusters));
  }
  let maxMembers = 1;
  members.forEach((c) => { if (c > maxMembers) maxMembers = c; });

  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  let bounds = 1;

  for (let i = 0; i < n; i++) {
    const nd = nodes[i];
    const li = layerOrder[nd.layer] ?? 0;
    // Each layer is a disc in its own plane; planes stack along Z (apex on top, floor at bottom).
    const pz = planeZ(li, nLayers);
    let x: number, y: number, z: number;

    if (nd.x != null && nd.y != null) {
      x = nd.x;
      y = nd.y;
      z = nd.z != null ? nd.z : pz;
    } else if (nd.id === g.meta.root) {
      x = 0;
      y = 0;
      z = pz;
    } else {
      const k = clusterKey(nd);
      const cx = centroidX.get(k) ?? 0;
      const cy = centroidY.get(k) ?? 0;
      // Cluster footprint scales with membership but never crowds its neighbour.
      const sr = scatterCap * Math.max(0.25, Math.sqrt((members.get(k) ?? 1) / maxMembers));
      // Importance = closeness to the cluster core: structure at the centre, noise at the rim.
      const tier = nd.tier ?? 2;
      const pull = tier <= 0 ? 0.15 : tier === 1 ? 0.45 : tier === 2 ? 0.8 : 1;
      const lr = sr * pull * (0.15 + 0.85 * Math.sqrt(hash(nd.id + "r")));
      const la = hash(nd.id + "a") * Math.PI * 2;
      // MOUND, NOT A STACK OF EQUAL DISCS (2026-08-03, direction C).
      //
      // Cluster centroids are computed ONCE per cluster, not per layer, so every
      // band used to sit at the same radius and a cluster read as a VERTICAL
      // COLUMN through the stack — which is what the original layout says it
      // wants. The visible consequence, once the deep field was actually drawn,
      // was 2,111 ledger nodes bunched into little halos directly beneath their
      // own department head, scattered across the frame. Never a mass.
      //
      // C's silhouette is a mound: almost nothing at the apex, fanning wider and
      // denser with every band, so the deepest layer is one continuous shelf.
      // Scaling BOTH the centroid and the local scatter by depth gets that in one
      // move, and keeps the semantics honest — a department's children still fan
      // out directly below it, they just spread as they descend instead of
      // stacking. The exponent shapes the flare: below 1 opens early and keeps
      // the lower bands generous, which is what makes the base read as a floor
      // rather than a cone.
      const depth = nLayers > 1 ? li / (nLayers - 1) : 1;
      // Max spread pulled to 0.78 so the mound is TIGHTER. Density is points per
      // area: the deepest band holds 2,717 nodes and only reads as a seabed if
      // they are concentrated. A wider floor with the same count is always dust.
      const spread = 0.08 + 0.70 * Math.pow(depth, 0.75);
      // MELD: the fan alone still left every cluster as its own tidy halo, so the
      // deepest band read as a dozen separate swarms rather than one floor. A
      // cluster's footprint has to grow faster than the gap to its neighbour, so
      // the bottom bands BLEED INTO EACH OTHER and become continuous. Upper bands
      // are untouched (depth^1.5 is ~0 there) and stay legible as distinct
      // departments, which is the part that still has to be readable.
      // Pulled back from 2.6 — that value dispersed the deep bands so far that
      // the same node count covered a much larger area and the floor read as
      // scattered dust instead of a seabed. Density is points per area, so the
      // mound has to get TIGHTER, not wider.
      const meld = 1 + 1.5 * Math.pow(depth, 1.5);
      let px = (cx + Math.cos(la) * lr * meld) * spread;
      let py = (cy + Math.sin(la) * lr * meld * 0.92) * spread;

      // ONE FLOOR, NOT NINE DISCS.
      //
      // Every node is placed around its own cluster's centroid, so each
      // department becomes its own little disc and the deepest band read as nine
      // separate swarms with visible gaps between them — rings, not a seabed.
      // Widening the scatter did not fix it and could not: the clusters just
      // became bigger discs. The floor has to stop being cluster-shaped at all.
      //
      // So deep nodes are blended toward a GLOBAL phyllotaxis position — the
      // same even-packing used for the cluster centroids, applied across every
      // node at once. Phyllotaxis has no seams and no preferred direction, which
      // is exactly what a continuous shelf needs. The blend is depth-squared, so
      // the upper bands keep their department structure intact (you can still
      // see which head owns what) and only the ledger dissolves into one mass.
      // That is also true to the data: nobody reads 2,717 observations by
      // department, they read them as the floor the house sits on.
      const gA = i * GOLDEN;
      const gR = R * 0.92 * Math.sqrt((i + 0.5) / n);
      const merge = 0.72 * depth * depth;
      x = px + (Math.cos(gA) * gR - px) * merge;
      y = py + (Math.sin(gA) * gR * 0.92 - py) * merge;
      // Thin Z jitter keeps each band a crisp shelf (was ±45; ±20 reads sharper).
      z = pz + (hash(nd.id + "z") - 0.5) * 40;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    if (Math.abs(x) > bounds) bounds = Math.abs(x);
    if (Math.abs(y) > bounds) bounds = Math.abs(y);

    // PALETTE: cool monochrome, graded by depth. The data still carries the old
    // gold / silver / bronze / ledger-purple layer colours and they are what made
    // the redesigned field read warm — a bioluminescent colony cannot have four
    // hues of metal in it. Colour now says DEPTH, not category: bone-white at the
    // apex cooling to deep cyan on the floor. Type is carried by the ARTWORK and
    // urgency by the flags, which are the only warm thing left in the scene, so
    // nothing is lost by taking the hue away from the layer.
    const dpt = nLayers > 1 ? (layerOrder[nd.layer] ?? 0) / (nLayers - 1) : 0;
    const col: [number, number, number] = [
      0.92 - 0.30 * dpt,
      0.96 - 0.16 * dpt,
      1.00 - 0.02 * dpt,
    ];
    // TIER-DIM, INVERTED 2026-08-03 (Jesse ratified redesign direction C).
    //
    // This line used to read `>= 3 ? 0.34 : === 2 ? 0.6 : 1.05` under the rule
    // "deep-tier noise recedes, structure lifts". That was coherent for the old
    // look, where a few brass landmarks were the subject and the 2,111 ledger
    // nodes were background. It is the opposite of what the new direction is:
    // the deep field IS the subject — a dense luminous seabed of thousands of
    // points, with delicate forms above it — and the mass belongs at the bottom.
    //
    // Worth saying plainly because it explains why months of tuning never got
    // there: the deep field was not badly drawn, it was deliberately suppressed
    // by 3x in brightness and ~4x in size. No amount of material work on the
    // beams could fix a composition that had been inverted on purpose.
    const tier = nd.tier ?? 2;
    const dim = tier >= 3 ? 1.0 : tier === 2 ? 0.86 : 1.05;
    colors[i * 3] = col[0] * dim;
    colors[i * 3 + 1] = col[1] * dim;
    colors[i * 3 + 2] = col[2] * dim;

    // Size: weight SQUARED made the apex enormous and the floor invisible. The
    // seabed wants thousands of small-but-present points, so the floor rises and
    // the exponent softens. Landmarks (tier<=1) are zeroed out of this cloud and
    // drawn as meshes, so raising the floor costs the apex nothing.
    const w = nd.weight ?? 0.3;
    sizes[i] = 6.5 + w * w * 30;
  }

  // links — one buffer, dangling dropped
  const m = g.links.length;
  const linkPos = new Float32Array(m * 6);
  const linkColors = new Float32Array(m * 6);
  let k = 0;
  for (let j = 0; j < m; j++) {
    const l = g.links[j];
    const a = index.get(l.source);
    const b = index.get(l.target);
    if (a == null || b == null) continue;
    // edge declutter (from the Atlas): keep structural spines + backbone-touching "rivers";
    // drop deep-to-deep edges so the graph reads as structure, not a hairball.
    const spine = l.type === "spine" || l.type === "tether";
    const ta = nodes[a].tier ?? 2, tb = nodes[b].tier ?? 2;
    if (!spine && ta > 1 && tb > 1) continue;
    linkPos[k * 6] = positions[a * 3];
    linkPos[k * 6 + 1] = positions[a * 3 + 1];
    linkPos[k * 6 + 2] = positions[a * 3 + 2];
    linkPos[k * 6 + 3] = positions[b * 3];
    linkPos[k * 6 + 4] = positions[b * 3 + 1];
    linkPos[k * 6 + 5] = positions[b * 3 + 2];
    // colour precedence: explicit link.color → verb token → neutral fallback.
    // Without this every relation renders identically and the graph says nothing
    // about WHAT connects two things (0 of 397 Pemberton links carry a colour).
    // FILAMENTS ARE COOL, AND THE VERB IS CARRIED BY BEHAVIOUR NOT HUE.
    // The verb palette gave every relation its own colour, which is a sound idea
    // and the wrong one here: a rainbow of threads destroys the cool field the
    // whole direction rests on, and it was what kept the redesigned graph reading
    // warm even after the nodes went cold. Warmth is now reserved for two things
    // — the flags, and `amends`, which occurs exactly ONCE in 397 links (the
    // § 14 amendment, the bottom rewriting the top) and has earned the right to
    // be the one thread that breaks the palette.
    const amends = l.type === "amends";
    // declares and covers were not separable from inherits — all three arrived as
    // the same faint cool thread. They keep the palette but take a colder, paler
    // cast and more light, which is enough to tell an authored relation (a law
    // DECLARING, a policy COVERING) from the structural backbone without
    // reintroducing a hue per verb.
    const authored = l.type === "declares" || l.type === "covers" || l.type === "audits";
    const base: [number, number, number] = amends ? [1.0, 0.46, 0.28]
      : authored ? [0.80, 0.90, 1.0]
      : [0.62, 0.78, 0.88];
    // inherits is 214 of 397 links. If the backbone is the brightest thing in the
    // scene it BECOMES the scene, so structure is quiet and events carry light.
    const boost = amends ? 1.5 : authored ? 0.85 : spine ? 0.34 : ta <= 1 || tb <= 1 ? 0.55 : 0.30;
    // direction is carried by a gradient: the source end sits darker than the
    // target end, so a still frame still reads which way the relation points.
    for (let e = 0; e < 2; e++) {
      const dir = e === 0 ? 0.55 : 1.15;
      linkColors[k * 6 + e * 3] = base[0] * boost * dir;
      linkColors[k * 6 + e * 3 + 1] = base[1] * boost * dir;
      linkColors[k * 6 + e * 3 + 2] = base[2] * boost * dir;
    }
    k++;
  }

  // ── flags: the top of the luminance ladder. A node earns one from an explicit
  // data.flag, or from data.health amber/red (a department in trouble is an alarm
  // even when nobody tagged it). Sorted worst-first so the eye is led in order.
  const flags: Flagged[] = [];
  for (let i = 0; i < n; i++) {
    const d = (nodes[i].data ?? {}) as Record<string, unknown>;
    const explicit = typeof d.flag === "string" ? (d.flag as string) : null;
    const health = typeof d.health === "string" ? (d.health as string) : null;
    const kind = (explicit ?? (health === "red" ? "critical" : health === "amber" ? "overdue" : null)) as FlagKind | null;
    if (!kind || !FLAG_ORDER.includes(kind)) continue;
    flags.push({
      id: nodes[i].id,
      index: i,
      kind,
      label: nodes[i].label,
      pos: [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]],
    });
  }
  flags.sort((a, b) => FLAG_ORDER.indexOf(a.kind) - FLAG_ORDER.indexOf(b.kind));

  return {
    ids,
    index,
    nodeLayer,
    nodeTier,
    nodeKind,
    flags,
    positions,
    colors,
    sizes,
    linkPos: linkPos.subarray(0, k * 6),
    linkColors: linkColors.subarray(0, k * 6),
    bounds,
    count: n,
    linkCount: k,
  };
}
