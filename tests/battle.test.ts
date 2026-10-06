import { describe, expect, it } from 'vitest';
import { Battle, BattleEvent } from '../src/core/battle';
import { data } from '../src/core/data';
import { makeMonster } from '../src/core/monster';
import { Rng } from '../src/core/rng';

function run(b: Battle, maxTurns = 600) {
  let turns = 0;
  const events: BattleEvent[] = [];
  while (b.over === null && turns < maxTurns) {
    const ev: BattleEvent[] = [];
    const c = b.next(ev);
    events.push(...ev);
    if (!c) break;
    const { ability, target } = b.choose(c);
    events.push(...b.act(c, ability, target));
    turns++;
  }
  return { turns, events };
}

describe('battle engine', () => {
  it('every species can fight without crashing or producing NaN', () => {
    const rng = new Rng(7);
    for (const s of data().monsters) {
      const lv = rng.int(1, 120);
      const foe = rng.pick(data().monsters);
      const b = new Battle([makeMonster(s, lv, rng), makeMonster(rng.pick(data().monsters), lv, rng)],
        [makeMonster(foe, lv, rng), makeMonster(rng.pick(data().monsters), lv, rng)], { rng });
      const { turns, events } = run(b);
      for (const e of events) if (e.t === 'damage' || e.t === 'heal') expect(Number.isFinite(e.amount)).toBe(true);
      expect(turns).toBeLessThan(600);
      expect(b.over).not.toBeNull();
    }
  });

  it('a monster takes a handful of hits to defeat at equal level', () => {
    const rng = new Rng(3);
    const hits: number[] = [];
    for (let i = 0; i < 300; i++) {
      const a = rng.pick(data().monsters), d = rng.pick(data().monsters);
      const lv = rng.int(5, 100);
      const b = new Battle([makeMonster(a, lv, rng, 4)], [makeMonster(d, lv, rng, 4)], { rng });
      const att = b.field(0)[0], def = b.field(1)[0];
      const ab = b.usable(att).find((x) => x.power && x.kind);
      if (!ab) continue;
      hits.push(def.pool.max / b.damage(att, def, ab).amount);
    }
    hits.sort((x, y) => x - y);
    const median = hits[Math.floor(hits.length / 2)];
    expect(median).toBeGreaterThan(2);
    expect(median).toBeLessThan(9);
  });

  it('higher level teams usually win', () => {
    const rng = new Rng(11);
    let wins = 0;
    for (let i = 0; i < 100; i++) {
      const team = (lv: number) => Array.from({ length: 3 }, () => makeMonster(rng.pick(data().monsters), lv, rng));
      const b = new Battle(team(40), team(25), { rng });
      run(b);
      if (b.over === 0) wins++;
    }
    expect(wins).toBeGreaterThan(70);
  });

  it('captures remove the monster and gold cards always work', () => {
    const rng = new Rng(5);
    const b = new Battle([makeMonster('Fire Hatchling', 5, rng)], [makeMonster('Goblin', 3, rng), makeMonster('Slime', 3, rng)], { rng });
    const goblin = b.field(1)[0];
    const ev = b.tryCapture(goblin.key, 'gold');
    expect(ev.find((e) => e.t === 'capture' && e.success)).toBeTruthy();
    expect(b.captured.length).toBe(1);
    expect(b.tryCapture(goblin.key, 'gold').length).toBe(0);
  });
});
