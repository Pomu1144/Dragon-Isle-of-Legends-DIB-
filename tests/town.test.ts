import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPng } from './png';
import { data, maps, regionByName } from '../src/core/data';
import { planTown, pickPlate, townGrid, plateGrid, groundLine, inPoly, scaleAt, kOf, FOLK, type PlateId, type TownArt, type Service, type Placed, type TownPlan } from '../src/core/townplan';

const T = 'public/assets/town/';
const json = (f: string) => JSON.parse(readFileSync(T + f, 'utf8'));
const A: TownArt = { layouts: json('layouts.json'), kit: json('kit.json'), art: json('art.json'), bases: json('bases.json') };
const PLATES: PlateId[] = ['plaza', 'harbor', 'garden'];

const MASK = Object.fromEntries(PLATES.map((p) => [p, readPng(`${T}walk_${p}.png`)]));
const hasArenaSlot = (p: PlateId) => A.layouts.plates[p].slots.some((s) => s.arena);

/** Every town of the game on its own plate, and each plate with every mix of the optional services it can hold. */
const cases: { name: string; region: string; arena: boolean; tournament: boolean; plate: PlateId }[] = [];
for (const t of data().towns) {
  const hasDock = maps()[regionByName(t.region)!.id].spots.some((s) => s.kind === 'dock');
  cases.push({ name: t.name, region: t.region, arena: !!t.arena, tournament: !!t.tournament, plate: pickPlate(t.name, hasDock, !!t.arena) });
}
for (const plate of PLATES)
  for (let i = 0; i < 12; i++) cases.push({ name: `Testville ${i}`, region: 'Southern Alvalon', arena: hasArenaSlot(plate) && i % 2 === 0, tournament: i % 3 === 0, plate });

const plans = new Map<(typeof cases)[number], TownPlan>(cases.map((c) => [c, planTown(c, c.plate, A)]));
const solid = (p: TownPlan) => p.items.filter((i) => i.kind === 'building' || i.kind === 'gate');
const left = (i: Placed) => i.x - i.ox * i.w;
const top = (i: Placed) => i.y - i.oy * i.h;
/** A polygon's corners and the middles of its sides. */
const outline = (k: number[]) => {
  const pts: [number, number][] = [];
  for (let i = 0; i < k.length; i += 2) {
    const j = (i + 2) % k.length;
    pts.push([k[i], k[i + 1]], [(k[i] + k[j]) / 2, (k[i + 1] + k[j + 1]) / 2]);
  }
  return pts;
};

describe('walkable towns', () => {
  it('uses the harbour for towns with a dock, unless they need the Grand Arena', () => {
    expect(pickPlate('Anywhere', true)).toBe('harbor');
    expect(['plaza', 'garden']).toContain(pickPlate('Anywhere', true, true));
    expect(['plaza', 'garden']).toContain(pickPlate('Corova', false));
    // every plate an arena town can get has ground for it
    for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) expect(hasArenaSlot(pickPlate(n, n < 'D', true))).toBe(true);
  });

  it.each(cases)('$name on the $plate: every door and the gate can be walked to from the arrival point', (c) => {
    const plan = plans.get(c)!;
    const m = MASK[c.plate];
    const grid = townGrid(plan, m.px, m.w, m.h, A.layouts.cell);
    const services = new Set(plan.items.map((i) => i.service).filter(Boolean) as Service[]);
    for (const s of ['guild', 'market', 'lab', 'warp', 'keep', 'hero', 'pedia', 'gate'] as Service[]) expect(services, s).toContain(s);
    expect(services.has('arena')).toBe(c.arena);
    expect(services.has('board')).toBe(c.tournament);
    expect(grid.canStand(plan.arrive), 'arrival point').toBe(true);
    for (const it of plan.items) {
      if (!it.service || !it.door) continue;
      const path = grid.path(plan.arrive, it.door);
      expect(path, `${it.service} (${it.piece})`).not.toBeNull();
      const end = path![path!.length - 1];
      // the walk ends at the door, or within a step of it when the door itself is on the building's edge
      expect(Math.hypot(end.x - it.door.x, end.y - it.door.y), `${it.service} door`).toBeLessThan(A.layouts.cell * 2.5);
    }
  });

  it('draws every building at its own fixed size against the townsfolk, the Guild Hall from guild.webp', () => {
    for (const [c, plan] of plans) {
      for (const b of solid(plan)) {
        const rel = b.scale / scaleAt(plan.layout, b.y) / kOf(b.piece, A);
        expect(Math.abs(rel - 1), `${c.name}: ${b.piece} drawn at ${rel.toFixed(2)} of its size`).toBeLessThan(0.1);
        expect(kOf(b.piece, A), b.piece).toBeGreaterThanOrEqual(0.85);
        expect(kOf(b.piece, A), b.piece).toBeLessThanOrEqual(1.35);
      }
      expect(plan.items.find((i) => i.service === 'guild')!.piece, c.name).toBe('guild');
    }
  });

  it('has the Scholar and two or three different neighbours in every town', () => {
    const bad: string[] = [];
    for (const [c, plan] of plans) {
      const folk = plan.items.filter((i) => i.service === 'npc' || i.service === 'pedia');
      if (folk.length < 3 || folk.length > 4) bad.push(`${c.name} on the ${c.plate}: ${folk.length} townsfolk`);
      if (folk.filter((f) => f.service === 'pedia').length !== 1) bad.push(`${c.name}: no Scholar`);
      if (new Set(folk.map((f) => f.piece)).size !== folk.length) bad.push(`${c.name}: a face repeats`);
      for (const f of folk) expect(FOLK).toContain(f.piece);
    }
    expect(bad).toEqual([]);
  });

  it('keeps buildings apart: neighbours on the same row never overlap', () => {
    const bad = new Set<string>();
    for (const [c, plan] of plans) {
      const b = solid(plan);
      for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
        const p = b[i], q = b[j];
        if (Math.abs(p.y - q.y) > 100) continue;
        const overlap = Math.min(left(p) + p.w, left(q) + q.w) - Math.max(left(p), left(q));
        if (overlap >= 30) bad.add(`${c.plate}: ${p.piece}@${p.x},${p.y} / ${q.piece}@${q.x},${q.y} overlap ${overlap | 0}`);
      }
    }
    expect([...bad]).toEqual([]);
  });

  it('stands nothing on water, and hides no painted feature that must stay in view', () => {
    const bad = new Set<string>();
    const grids = Object.fromEntries(PLATES.map((p) => [p, plateGrid(A.layouts.plates[p], MASK[p].px, MASK[p].w, MASK[p].h, A.layouts.cell)]));
    for (const [c, plan] of plans) {
      const g = grids[c.plate];
      const lay = plan.layout;
      for (const it of plan.items) {
        if (it.kind === 'fx' || it.kind === 'npc') continue;
        // the ground it stands on: along a building's base, or the prop's footprint
        const feet: [number, number][] = [];
        if (it.base) {
          for (let x = left(it) + 8; x < left(it) + it.w - 8; x += 12) {
            const gy = groundLine(it, x);
            if (gy != null && (!it.base.span || (x >= it.base.span[0] && x <= it.base.span[1]))) feet.push([x, gy - 6]);
          }
        } else if (it.foot) {
          const f = it.foot;
          feet.push([f.x, f.y + f.h], [f.x + f.w, f.y + f.h], [f.x + f.w / 2, f.y + f.h / 2], [f.x, f.y], [f.x + f.w, f.y]);
        }
        for (const [x, y] of feet) {
          if (x < 0 || x >= g.cols * g.cell || y < 0 || y >= g.rows * g.cell) continue;
          if (!g.canStand({ x, y })) bad.add(`${c.plate}: ${it.piece}@${it.x | 0},${it.y | 0} stands on water at ${x | 0},${y | 0}`);
          for (const k of lay.keep ?? []) if (inPoly(k, x, y)) bad.add(`${c.plate}: ${it.piece}@${it.x | 0},${it.y | 0} stands on a painted feature`);
        }
        // no painted feature disappears behind it (points of the feature behind its ground line, under its
        // sprite); the ones it may cover, it covers whole
        const hidden = (x: number, y: number) => {
          if (x < left(it) + it.w * 0.08 || x > left(it) + it.w * 0.92 || y < top(it)) return false;
          const gy = it.base ? groundLine(it, x) : it.y;
          return gy != null && y < gy - 4;
        };
        for (const k of lay.keep ?? []) for (const [x, y] of outline(k))
          if (hidden(x, y)) bad.add(`${c.plate}: ${it.piece}@${it.x | 0},${it.y | 0} hides a painted feature at ${x | 0},${y | 0}`);
        for (const k of lay.cover ?? []) {
          const n = outline(k).filter(([x, y]) => hidden(x, y)).length;
          if (n && n < outline(k).length) bad.add(`${c.plate}: ${it.piece}@${it.x | 0},${it.y | 0} half hides a painted feature at ${k[0]},${k[1]}`);
        }
      }
    }
    expect([...bad]).toEqual([]);
  });

  it('is the same town every visit, and towns differ', () => {
    const a = planTown({ name: 'Corova', region: 'Southern Alvalon' }, 'garden', A);
    const b = planTown({ name: 'Corova', region: 'Southern Alvalon' }, 'garden', A);
    const c = planTown({ name: 'Longdale', region: 'South Earlsome' }, 'garden', A);
    const sig = (p: typeof a) => p.items.map((i) => `${i.piece}@${i.x},${i.y}`).join('|');
    expect(sig(a)).toBe(sig(b));
    expect(sig(a)).not.toBe(sig(c));
  });

  it('falls back to the kit residence for the Guild Hall only while guild.webp is missing', () => {
    const noGuild: TownArt = { ...A, art: Object.fromEntries(Object.entries(A.art).filter(([k]) => k !== 'guild')) };
    const plan = planTown({ name: 'Corova', region: 'Southern Alvalon' }, 'plaza', noGuild);
    expect(plan.items.find((i) => i.service === 'guild')!.piece).toBe('architecture_waterside-residence_upper-terrace-06');
  });
});
