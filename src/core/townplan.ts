/**
 * Walkable towns: which buildings stand where, and where the hero can walk.
 *
 * A town is one of three painted grounds ("plates": a canal plaza, a harbour quay, a garden green) with
 * buildings, trees, lamps and townsfolk from the user's Azurelake kit standing on it. The places they can go
 * are hand-authored per plate in public/assets/town/layouts.json (building slots, the gate, the arrival point,
 * spots for townsfolk and props, the walkable ground); which service lands in which slot, and which filler
 * pieces appear, is drawn from a generator seeded by the town's name, so every town is different but always
 * the same. Pure data: the Town scene draws a plan, and tests check every door is reachable.
 */
import { WalkGrid, type Pt } from './walkgrid';
import { Rng } from './rng';

export type PlateId = 'plaza' | 'harbor' | 'garden';
export type Service = 'guild' | 'market' | 'lab' | 'warp' | 'keep' | 'hero' | 'pedia' | 'arena' | 'board' | 'gate' | 'npc';

/** kit.json: world size in kit units (a townsperson is ~80 tall), ground anchor, collision box. */
export interface KitPiece { cat: string; w: number; h: number; origin: [number, number]; footprint?: { x: number; y: number; w: number; h: number } | null }
/**
 * Per-piece tuning in layouts.json. `k` is the piece's size against the townsfolk at the same depth, fixed once
 * per piece (a building is drawn at scaleAt(y) * k wherever it stands, so its doors stay a little taller than
 * the hero). `door` is where the hero stands to use it, `deep` the depth of its footprint, `span` the part of
 * its width (kit units from the anchor) that blocks walking, `pass` an archway you walk through, `wet` marks
 * art with canal water baked in.
 */
export interface PieceTune { k?: number; door?: [number, number]; deep?: number; span?: [number, number]; pass?: [number, number]; glow?: [number, number]; wet?: boolean }
/** bases.json: a building's ground line, one sample every `dx` kit units from `x0` (null = no wall there). */
export interface Base { x0: number; dx: number; y: (number | null)[] }

/**
 * A place for a building. `maxW`/`maxH` (world px) are only a fit test: a piece that would be drawn bigger is
 * not offered for the slot. `arena` slots may hold the Grand Arena; `open` slots stand free on the square and
 * take only the small free-standing pieces (`only`); `wet` slots are at the water's edge; `doorX` is where on
 * the walkable ground (world x) a door may open; `minW` makes sure a building covers what it stands on (a
 * mosaic) completely; `filler` slots hold only homes and trees, no doors to reach.
 */
export interface Slot { id: string; x: number; y: number; maxW: number; maxH: number; excludes?: string[]; flip?: boolean; arena?: boolean; open?: boolean; wet?: boolean; only?: string[]; doorX?: [number, number]; minW?: number; filler?: boolean }
export interface PropSpot { x: number; y: number; kind: string; p?: number; flip?: boolean }
export interface PlateLayout {
  /** sprite size per world px along the plate's depth: [y, scale] stops (the paintings have some perspective) */
  scale: [number, number][];
  zoom: number;
  /** painted features (mosaics, stepping stones, fountain rims…) no building may stand on or hide */
  keep?: number[][];
  /** painted features that buildings may cover completely, but never leave half hidden */
  cover?: number[][];
  /** polygons (flat x,y lists): ground you can walk on; painted things in the way; shade the painting colours blue */
  walk: number[][];
  blocks: number[][];
  dry?: number[][];
  gate: { x: number; y: number; flip?: boolean };
  arrive: [number, number];
  slots: Slot[];
  npcs: [number, number][];
  board: [number, number][];
  props: PropSpot[];
}
export interface Layouts { cell: number; pieces: Record<string, PieceTune>; plates: Record<PlateId, PlateLayout> }
export interface TownArt {
  layouts: Layouts;
  kit: Record<string, KitPiece>;
  /** art.json: the service buildings the kit lacks (guild, arena, keep, gate) and the hero */
  art: Record<string, { w: number; h: number }>;
  bases: Record<string, Base>;
}
export interface TownInfo { name: string; region: string; arena?: boolean; tournament?: boolean }

export interface Placed {
  piece: string;
  url: string;
  kind: 'building' | 'prop' | 'tree' | 'npc' | 'fx' | 'gate';
  x: number; y: number;          // ground anchor (world px)
  scale: number;                 // world px per kit unit
  w: number; h: number;          // drawn size (world px)
  ox: number; oy: number;        // anchor within the image (0..1)
  flip: boolean;
  depth: number;
  service?: Service;
  label?: string; sub?: string;
  door?: Pt;                     // where the hero stands to use it
  /** ground line (world px) for depth sorting and the footprint, sampled every `dx` from `x0` */
  base?: { x0: number; dx: number; y: Float32Array; deep: number; span?: [number, number]; pass?: [number, number] };
  foot?: { x: number; y: number; w: number; h: number };
  glow?: Pt;
  who?: string; line?: string;   // townsfolk
}
export interface TownPlan { plate: PlateId; items: Placed[]; arrive: Pt; zoom: number; layout: PlateLayout }

export const RESIDENCES = [
  'architecture_waterside-residence_gable-01', 'architecture_waterside-residence_terrace-02', 'architecture_waterside-residence_left-facing-03',
  'architecture_waterside-residence_right-facing-04', 'architecture_waterside-residence_corner-townhouse-07', 'architecture_stair-top-cottage_main-01',
  'architecture_waterside-residence_upper-terrace-06', 'architecture_waterside-residence_narrow-townhouse-05',
];
const TREES = ['vegetation_white-blossom-tree_mature-01', 'vegetation_white-blossom-tree_slender-02', 'vegetation_white-tree_01'];
const PROPS: Record<string, string[]> = {
  tree: TREES,
  shade: ['vegetation_shade-tree_dark-leafy-01', 'vegetation_white-blossom-tree_mature-01'],
  cypress: ['vegetation_cypress-shrub_tall-01'],
  lamp: ['props_ward-lamppost_single-01'],
  planter: ['props_flower-planter_stone-01', 'props_flower-pot_round-01', 'vegetation_flowering-shrub_low-01'],
  bench: ['props_limestone-bench_main-01'],
  crates: ['props_artisan-crate-stack_tools-01', 'props_market-storage-cluster_barrels-baskets-01', 'prop_dock-crate_01'],
  cafe: ['props_cafe-table-set_two-seat-01'],
  hedge: ['vegetation_terrace-hedge_dense-01', 'vegetation_flowering-shrub_low-01'],
};
export const FOLK = ['npcs_baker_idle-south-01', 'npcs_artisan_idle-south-01', 'npcs_resident_idle-south-01', 'npcs_apothecary_idle-south-01'];
const FOLK_NAME: Record<string, string> = {
  'npcs_baker_idle-south-01': 'Baker', 'npcs_artisan_idle-south-01': 'Artisan', 'npcs_resident_idle-south-01': 'Townsperson', 'npcs_apothecary_idle-south-01': 'Herbalist',
};

interface ServiceDef { pieces: string[]; label: string; sub: string }
/** The kit residence that stands in for the Guild Hall only while guild.webp is missing. */
export const GUILD_FALLBACK = 'architecture_waterside-residence_upper-terrace-06';
const SERVICES: Partial<Record<Service, ServiceDef>> = {
  arena: { pieces: ['arena'], label: 'Grand Arena', sub: 'Licenses · Trials' },
  guild: { pieces: ['guild'], label: 'Guild Hall', sub: 'Quests · Rewards' },
  keep: { pieces: ['keep'], label: 'Monster Keep', sub: 'Your monsters' },
  lab: { pieces: ['architecture_apothecary-shop_main-01'], label: 'Recipe Lab', sub: 'Fuse monsters' },
  market: { pieces: ['architecture_bakery-cafe_main-01', 'architecture_market-stall_01'], label: 'Market', sub: 'Cards · Eggs · Gems' },
  warp: { pieces: ['architecture_healing-spring-pavilion_main-01'], label: 'Warp Shrine', sub: 'Travel to towns' },
  hero: { pieces: RESIDENCES, label: "Hero's House", sub: 'Skills · Gems' },
};
/** Placement order: the pickiest first so everything finds a slot. */
const ORDER: Service[] = ['arena', 'guild', 'keep', 'lab', 'hero', 'market', 'warp'];

/** Same FNV-1a as core/state's hash (kept here so this module stays free of game state). */
export function hashName(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Harbour towns sit in regions with a dock; the rest get the plaza or the garden by their name. The quay has
 * no ground for the Grand Arena, so a town with an arena always gets the plaza or the garden.
 */
export function pickPlate(name: string, hasDock: boolean, arena = false): PlateId {
  if (hasDock && !arena) return 'harbor';
  return hashName(name) % 2 ? 'garden' : 'plaza';
}

/** Sprite scale at a depth of the plate (linear between the stops). */
export function scaleAt(lay: PlateLayout, y: number) {
  const st = lay.scale;
  if (y <= st[0][0]) return st[0][1];
  for (let i = 1; i < st.length; i++) {
    const [y1, s1] = st[i];
    if (y <= y1) { const [y0, s0] = st[i - 1]; return s0 + ((s1 - s0) * (y - y0)) / (y1 - y0); }
  }
  return st[st.length - 1][1];
}

export function inPoly(poly: number[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inAny = (polys: number[][] | undefined, x: number, y: number) => !!polys?.some((p) => inPoly(p, x, y));

export function pieceUrl(piece: string, A: TownArt) {
  return A.kit[piece] ? `assets/town/kit/${piece}.webp` : `assets/town/${piece}.webp`;
}
function dims(piece: string, A: TownArt) {
  const k = A.kit[piece];
  if (k) return { w: k.w, h: k.h, ox: k.origin[0], oy: k.origin[1] };
  const a = A.art[piece];
  return { w: a.w, h: a.h, ox: 0.5, oy: 1 };
}
const has = (piece: string, A: TownArt) => !!(A.kit[piece] || A.art[piece]);
/** The piece's fixed size factor against the townsfolk (see PieceTune.k). */
export const kOf = (piece: string, A: TownArt) => A.layouts.pieces[piece]?.k ?? 1;

/** Would the piece, at its one consistent scale, fit the slot (and stay on the plate, and off dry/wet ground it does not suit)? */
export function fitsSlot(piece: string, s: Slot, lay: PlateLayout, A: TownArt) {
  if (s.only && !s.only.includes(piece)) return false;
  if (!!A.layouts.pieces[piece]?.wet && !s.wet) return false;
  const d = dims(piece, A), sc = scaleAt(lay, s.y) * kOf(piece, A);
  const h = d.h * sc * d.oy;
  const dx = s.x + (A.layouts.pieces[piece]?.door?.[0] ?? 0) * sc;
  if (s.doorX && (dx < s.doorX[0] || dx > s.doorX[1])) return false;
  return d.w * sc <= s.maxW && d.w * sc >= (s.minW ?? 0) && h <= s.maxH && h <= s.y - 6;
}

/** Ground line of a building at a kit-unit offset from its anchor (kit units, + is down), if it has one. */
function baseAt(b: Base, dx: number): number | null {
  const f = (dx - b.x0) / b.dx - 0.5;
  const i = Math.floor(f);
  const a = b.y[Math.max(0, Math.min(b.y.length - 1, i))], c = b.y[Math.max(0, Math.min(b.y.length - 1, i + 1))];
  if (a == null) return c;
  if (c == null) return a;
  const t = Math.max(0, Math.min(1, f - i));
  return a + (c - a) * t;
}

/** Put one piece on the plate. */
function place(A: TownArt, lay: PlateLayout, piece: string, kind: Placed['kind'], x: number, y: number, o: { flip?: boolean; scale?: number } = {}): Placed {
  const d = dims(piece, A);
  const tune = A.layouts.pieces[piece] ?? {};
  const sc = o.scale ?? scaleAt(lay, y) * (tune.k ?? 1);
  const flip = !!o.flip;
  const fx = flip ? -1 : 1;
  const p: Placed = { piece, url: pieceUrl(piece, A), kind, x, y, scale: sc, w: d.w * sc, h: d.h * sc, ox: flip ? 1 - d.ox : d.ox, oy: d.oy, flip, depth: y };
  const b = A.bases[piece];
  if (kind === 'building' || kind === 'gate') {
    // the ground line: measured from the art when available, else a gentle V under the walls
    const n = b ? b.y.length : 24, step = b ? b.dx : d.w / 24, x0 = b ? b.x0 : -d.ox * d.w;
    const ys = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const kx = x0 + (i + 0.5) * step;
      const v = b ? baseAt(b, kx) : -Math.abs(kx) * 0.28;
      ys[i] = y + (v ?? 0) * sc;
    }
    const deep = (tune.deep ?? d.w * 0.33) * sc;
    // flipped art mirrors its ground line
    if (flip) ys.reverse();
    p.base = { x0: x + (flip ? -(x0 + n * step) : x0) * sc, dx: step * sc, y: ys, deep };
    // only the solid part of the width blocks walking (not an open canopy or tables at one side)
    if (tune.span) {
      const [a, c] = flip ? [-tune.span[1], -tune.span[0]] : tune.span;
      p.base.span = [x + a * sc, x + c * sc];
    }
    if (tune.pass) {
      const [a, c] = flip ? [-tune.pass[1], -tune.pass[0]] : tune.pass;
      p.base.pass = [x + a * sc, x + c * sc];
    }
    const door = tune.door ?? [0, 10];
    let dy = door[1];
    const line = b ? baseAt(b, door[0]) : -Math.abs(door[0]) * 0.28;
    if (line != null) dy = Math.max(dy, line + 10);
    p.door = { x: x + door[0] * sc * fx, y: y + dy * sc };
  } else if (kind !== 'fx') {
    // kit footprints are in kit units for the piece at its own size
    const f = A.kit[piece]?.footprint;
    if (f) p.foot = { x: x + (flip ? -(f.x + f.w) : f.x) * sc, y: y + f.y * sc, w: f.w * sc, h: f.h * sc };
  }
  if (tune.glow) p.glow = { x: x + tune.glow[0] * sc * fx, y: y + tune.glow[1] * sc };
  return p;
}

/** Ground line y (world px) of a placed building at world x, or null outside it. */
export function groundLine(p: Placed, x: number): number | null {
  const b = p.base;
  if (!b) return null;
  const i = Math.floor((x - b.x0) / b.dx);
  if (i < 0 || i >= b.y.length) return null;
  return b.y[i];
}

const HINTS = [
  'Wild monsters roam the countryside just outside the gate. Train your team there before you head further out.',
  'The Guild Hall posts requests from folk all over the island. Finish them for silver, gold, even eggs!',
  'Monsters you catch but cannot carry wait for you in the Monster Keep. You can swap your team there.',
  'Two monsters of level 15 or more can be fused into something new at the Recipe Lab, if you know the recipe.',
  'The Warp Shrine can carry you to any town in a region you have already visited. Only 20 silver a trip!',
  'Capture cards, eggs and gems are sold at the market. Silver cards catch the stubborn ones.',
  'The further you wander from town, the stronger the wild monsters get.',
  'Rest at your house and spend your skill points: every point makes all your monsters a little stronger.',
];

/** Lay out a town: buildings for its services in the plate's slots, then fillers, townsfolk and props. */
export function planTown(t: TownInfo, plate: PlateId, A: TownArt): TownPlan {
  const lay = A.layouts.plates[plate];
  const rng = new Rng(hashName(t.name));
  const items: Placed[] = [];
  const free = new Set(lay.slots.map((s) => s.id));
  const slot = (id: string) => lay.slots.find((s) => s.id === id)!;
  // slots that overlap exclude each other, whichever is filled first
  const take = (s: Slot) => {
    free.delete(s.id);
    for (const o of lay.slots) if (s.excludes?.includes(o.id) || o.excludes?.includes(s.id)) free.delete(o.id);
  };

  // the gate the hero arrived by
  const gate = place(A, lay, 'gate', 'gate', lay.gate.x, lay.gate.y, { flip: lay.gate.flip });
  gate.service = 'gate';
  gate.label = `To ${t.region}`;
  gate.sub = 'Leave town';
  items.push(gate);

  // services, each in a slot its building fits at its one consistent scale; a small search so every
  // service finds room whatever the seed picks first
  const want = ORDER.filter((s) => s !== 'arena' || t.arena);
  const choice = new Map<Service, [Slot, string]>();
  const optsFor = (svc: Service): [Slot, string][] => {
    const def = SERVICES[svc]!;
    const pieces = svc === 'guild' ? (has('guild', A) ? ['guild'] : [GUILD_FALLBACK]) : def.pieces.filter((p) => has(p, A));
    const used = new Set([...choice.values()].map(([, p]) => p));
    const out: [Slot, string][] = [];
    for (const id of free) {
      const s = slot(id);
      if ((svc === 'arena' && !s.arena) || s.filler) continue;
      for (const p of pieces) if (!used.has(p) && fitsSlot(p, s, lay, A)) out.push([s, p]);
    }
    // the open square is used only when the edges are full
    return shuffle(rng, out).sort((a, b) => +!!a[0].open - +!!b[0].open);
  };
  // a free-standing stall or shrine never hides the door of a building behind it
  const hidesDoor = () => {
    for (const [s, p] of choice.values()) {
      if (!s.open) continue;
      const d = dims(p, A), sc = scaleAt(lay, s.y) * kOf(p, A);
      const x0 = s.x - d.ox * d.w * sc, x1 = x0 + d.w * sc, y0 = s.y - d.oy * d.h * sc;
      for (const [o, q] of choice.values()) {
        if (o === s) continue;
        const door = A.layouts.pieces[q]?.door ?? [0, 10], oc = scaleAt(lay, o.y) * kOf(q, A);
        for (const fx of o.flip ? [1, -1] : [1]) {
          const dx = o.x + door[0] * oc * fx, dy = o.y + door[1] * oc;
          if (dy < s.y && dx > x0 - 20 && dx < x1 + 20 && dy > y0) return true;
        }
      }
    }
    return false;
  };
  const assign = (i: number): boolean => {
    if (i >= want.length) return !hidesDoor();
    const svc = want[i];
    for (const [s, p] of optsFor(svc)) {
      const before = [...free];
      take(s);
      choice.set(svc, [s, p]);
      if (assign(i + 1)) return true;
      choice.delete(svc);
      free.clear();
      for (const id of before) free.add(id);
    }
    return false;
  };
  if (!assign(0)) throw new Error(`${t.name}: no room for every service on the ${plate} plate`);
  for (const svc of want) {
    const [s, p] = choice.get(svc)!;
    const def = SERVICES[svc]!;
    const b = place(A, lay, p, 'building', s.x, s.y, { flip: s.flip && rng.chance(0.5) });
    b.service = svc;
    b.label = def.label;
    b.sub = def.sub;
    items.push(b);
    decorate(A, lay, b, rng, items);
  }

  // the rest of the slots: more homes, or a tree and a planter (the open square stays open)
  const used = new Set(items.map((i) => i.piece));
  const homes = shuffle(rng, RESIDENCES.filter((r) => !used.has(r)));
  for (const s of lay.slots) {
    if (!free.has(s.id) || s.open || s.arena) continue;
    take(s);
    const home = homes.findIndex((h) => fitsSlot(h, s, lay, A));
    if (home >= 0 && rng.chance(0.85)) {
      items.push(place(A, lay, homes.splice(home, 1)[0], 'building', s.x, s.y, { flip: s.flip && rng.chance(0.5) }));
    } else {
      items.push(place(A, lay, rng.pick(TREES), 'tree', s.x, s.y - 6, { flip: rng.chance(0.5) }));
      items.push(place(A, lay, rng.pick(PROPS.planter), 'prop', s.x + (rng.chance(0.5) ? -1 : 1) * 70 * scaleAt(lay, s.y), s.y + 16, { flip: rng.chance(0.5) }));
    }
  }

  // spots for townsfolk, the notice board and props must stand clear of the buildings (and of each other)
  const solid = items.filter((i) => i.kind === 'building' || i.kind === 'gate');
  // the crates and trees already standing (by the stall, in empty slots) count as taken ground too
  const taken: Pt[] = items.filter((i) => i.kind === 'prop' || i.kind === 'tree').map((i) => ({ x: i.x, y: i.y }));
  const clear = (x: number, y: number, r = 70) => !solid.some((b) => x > b.x - b.ox * b.w - 30 && x < b.x + (1 - b.ox) * b.w + 30 && y > b.y - b.oy * b.h && y < b.y + 50)
    && !taken.some((p) => Math.hypot(p.x - x, p.y - y) < r);

  // the tournament's notice board
  const boards = lay.board.filter(([x, y]) => clear(x, y));
  if (t.tournament && boards.length) {
    const [x, y] = rng.pick(boards);
    taken.push({ x, y });
    const b = place(A, lay, 'props_cafe-chalkboard_blank-01', 'prop', x, y);
    b.service = 'board';
    b.label = 'Notice Board';
    b.sub = 'Tournament';
    b.door = { x: x + 44 * b.scale, y: y + 14 * b.scale };
    items.push(b);
  }

  // townsfolk: the Scholar (Monsterpedia) and two to four neighbours with a word of advice
  const spots = shuffle(rng, lay.npcs.filter(([x, y]) => clear(x, y)));
  const hints = shuffle(rng, HINTS.slice());
  const folk = shuffle(rng, FOLK.filter((f) => f !== 'npcs_apothecary_idle-south-01'));
  // the Scholar and two or three neighbours, never the same face twice
  const count = Math.min(spots.length, 1 + folk.length, 3 + rng.int(0, 1));
  for (let i = 0; i < count; i++) {
    const [x, y] = spots[i];
    const piece = i === 0 ? 'npcs_apothecary_idle-south-01' : folk[i - 1];
    taken.push({ x, y });
    const n = place(A, lay, piece, 'npc', x, y, { flip: rng.chance(0.4) });
    n.service = i === 0 ? 'pedia' : 'npc';
    n.who = i === 0 ? 'Scholar' : FOLK_NAME[piece];
    n.line = i === 0 ? 'I study every monster on the island. Shall we open the Monsterpedia together?' : hints[i % hints.length];
    if (i === 0) { n.label = 'Scholar'; n.sub = 'Monsterpedia'; }
    // talk from a step in front of them
    n.door = { x: x + (n.flip ? -1 : 1) * 30 * n.scale, y: y + 22 * n.scale };
    items.push(n);
  }

  // trees, lamps, planters, benches… at the plate's prop spots
  for (const sp of lay.props) {
    if (sp.p != null && !rng.chance(sp.p)) continue;
    if (!clear(sp.x, sp.y, 110)) continue;
    taken.push({ x: sp.x, y: sp.y });
    const list = PROPS[sp.kind] ?? [sp.kind];
    const piece = rng.pick(list);
    if (!has(piece, A)) continue;
    const k: Placed['kind'] = TREES.includes(piece) || piece.startsWith('vegetation_shade') || piece.startsWith('vegetation_cypress') ? 'tree' : 'prop';
    items.push(place(A, lay, piece, k, sp.x, sp.y, { flip: sp.flip ?? rng.chance(0.5) }));
  }
  // anything standing in front of a building's walls (its ground line) is drawn over it
  const blds = items.filter((i) => i.base);
  for (const it of items) {
    if (it.base || it.kind === 'fx') continue;
    for (const b of blds) {
      if (it.y >= b.y) continue;
      const gl = groundLine(b, it.x);
      if (gl != null && it.y >= gl - 1) it.depth = Math.max(it.depth, b.depth + 0.5 + it.y * 1e-4);
    }
  }
  return { plate, items, arrive: { x: lay.arrive[0], y: lay.arrive[1] }, zoom: lay.zoom, layout: lay };
}

function shuffle<T>(rng: Rng, a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Extra pieces that make a service read at a glance: crates by the stall, the shrine's crystal glow, guild banners. */
function decorate(A: TownArt, lay: PlateLayout, b: Placed, rng: Rng, items: Placed[]) {
  const s = b.scale;
  if (b.piece === 'architecture_market-stall_01') {
    items.push(place(A, lay, 'props_market-storage-cluster_barrels-baskets-01', 'prop', b.x - 210 * s, b.y - 6 * s, { flip: rng.chance(0.5) }));
    items.push(place(A, lay, 'props_artisan-crate-stack_tools-01', 'prop', b.x + 205 * s, b.y + 4 * s, { flip: rng.chance(0.5) }));
  }
  if (b.piece === 'architecture_healing-spring-pavilion_main-01') {
    const g = place(A, lay, 'effects_healing-crystal-glow_idle-01', 'fx', b.x, b.y - 118 * s, { scale: s * 0.55 });
    g.depth = b.depth + 0.5;
    items.push(g);
  }
  if (b.service === 'guild' && b.piece !== 'guild') {
    // the kit's residence becomes the Guild Hall under the ward's navy banners
    for (const side of [-1, 1]) {
      const f = place(A, lay, 'props_ward-banner_navy-01', 'fx', b.x + side * 150 * s, b.y - 118 * s, { flip: side > 0, scale: s * 0.42 });
      f.depth = b.depth + 0.4;
      items.push(f);
    }
  }
}

/** The bare plate read like a region map: open water blocks the way (blue evening shade on stone does not). */
export function plateGrid(lay: PlateLayout, rgba: ArrayLike<number>, cols: number, rows: number, cell: number) {
  let px = rgba;
  if (lay.dry?.length) {
    const copy = Uint8ClampedArray.from(rgba as ArrayLike<number>);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      if (!inAny(lay.dry, (cx + 0.5) * cell, (cy + 0.5) * cell)) continue;
      const i = (cy * cols + cx) * 4;
      copy[i] = 196; copy[i + 1] = 184; copy[i + 2] = 168;
    }
    px = copy;
  }
  return WalkGrid.fromPixels(px, cols, rows, cell);
}

/**
 * The town's walk grid: the bare plate, limited to the authored walkable ground, minus painted obstacles
 * and the footprint of everything standing on it.
 */
export function townGrid(plan: TownPlan, rgba: ArrayLike<number>, cols: number, rows: number, cell: number) {
  const lay = plan.layout;
  const grid = plateGrid(lay, rgba, cols, rows, cell);
  grid.blockWhere((x, y) => !inAny(lay.walk, x, y) || inAny(lay.blocks, x, y));
  for (const p of plan.items) {
    if (p.base) {
      const b = p.base;
      // block whole grid columns under the building, from its ground line back by its depth
      const c0 = Math.floor(b.x0 / cell), c1 = Math.floor((b.x0 + b.dx * b.y.length) / cell);
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * cell;
        if (b.span && (cx < b.span[0] || cx > b.span[1])) continue;
        if (b.pass && cx > b.pass[0] && cx < b.pass[1]) continue;
        const gy = groundLine(p, cx);
        if (gy == null) continue;
        grid.blockRect(c * cell, gy - b.deep, cell, b.deep);
      }
    } else if (p.kind === 'npc') {
      // townsfolk stand their ground: a small oval around their feet (never thinner than a cell, so the
      // hero stops beside them instead of walking through), their door point stays just in front
      const w = Math.max(30 * p.scale, cell * 1.6), h = Math.max(14 * p.scale, cell * 1.2);
      grid.blockRect(p.x - w / 2, p.y - h * 0.75, w, h);
    } else if (p.foot) grid.blockRect(p.foot.x, p.foot.y, p.foot.w, p.foot.h);
  }
  return grid;
}
