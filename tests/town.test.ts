import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPng } from './png';
import { data, maps, regionByName } from '../src/core/data';
import { planTown, pickPlate, townGrid, type PlateId, type TownArt, type Service } from '../src/core/townplan';

const T = 'public/assets/town/';
const json = (f: string) => JSON.parse(readFileSync(T + f, 'utf8'));
const A: TownArt = { layouts: json('layouts.json'), kit: json('kit.json'), art: json('art.json'), bases: json('bases.json') };

const MASK = Object.fromEntries((['plaza', 'harbor', 'garden'] as PlateId[]).map((p) => [p, readPng(`${T}walk_${p}.png`)]));

/** Every town of the game on its own plate, and each plate with every mix of the optional services. */
const cases: { name: string; region: string; arena: boolean; tournament: boolean; plate: PlateId }[] = [];
for (const t of data().towns) {
  const hasDock = maps()[regionByName(t.region)!.id].spots.some((s) => s.kind === 'dock');
  cases.push({ name: t.name, region: t.region, arena: !!t.arena, tournament: !!t.tournament, plate: pickPlate(t.name, hasDock) });
}
for (const plate of ['plaza', 'harbor', 'garden'] as PlateId[])
  for (let i = 0; i < 12; i++) cases.push({ name: `Testville ${i}`, region: 'Southern Alvalon', arena: i % 2 === 0, tournament: i % 3 === 0, plate });

describe('walkable towns', () => {
  it('uses the harbour for towns with a dock', () => {
    expect(pickPlate('Anywhere', true)).toBe('harbor');
    expect(['plaza', 'garden']).toContain(pickPlate('Corova', false));
  });

  it.each(cases)('$name on the $plate: every door and the gate can be walked to from the arrival point', (c) => {
    const plan = planTown(c, c.plate, A);
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

  it('places buildings without overlapping each other badly', () => {
    for (const c of cases) {
      const plan = planTown(c, c.plate, A);
      const b = plan.items.filter((i) => i.kind === 'building' || i.kind === 'gate');
      for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
        const p = b[i], q = b[j];
        const dx = Math.abs(p.x - q.x), dy = Math.abs(p.y - q.y);
        // anchors of two buildings never sit on top of each other
        expect(dx > (p.w + q.w) * 0.3 || dy > 120, `${c.name}: ${p.piece} / ${q.piece}`).toBe(true);
      }
    }
  });

  it('is the same town every visit, and towns differ', () => {
    const a = planTown({ name: 'Corova', region: 'Southern Alvalon' }, 'garden', A);
    const b = planTown({ name: 'Corova', region: 'Southern Alvalon' }, 'garden', A);
    const c = planTown({ name: 'Longdale', region: 'South Earlsome' }, 'garden', A);
    const sig = (p: typeof a) => p.items.map((i) => `${i.piece}@${i.x},${i.y}`).join('|');
    expect(sig(a)).toBe(sig(b));
    expect(sig(a)).not.toBe(sig(c));
  });
});
