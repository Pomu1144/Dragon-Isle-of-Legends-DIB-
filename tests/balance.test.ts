import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { makeMonster } from '../src/core/monster';
import { Rng } from '../src/core/rng';
import { STARTERS } from '../src/core/state';
import { wildEncounter, overlordEncounter, overlordLevel } from '../src/core/encounters';
import { species } from '../src/core/data';
import { arashi, fight, opening } from './sim';

function sim(b: Battle) {
  for (let i = 0; i < 500 && b.over === null; i++) {
    const c = b.next([]);
    if (!c) break;
    const ch = b.choose(c);
    b.act(c, ch.ability, ch.target);
  }
  return b.over;
}
const median = (a: number[]) => a.slice().sort((x, y) => x - y)[a.length >> 1];

describe('early game balance', () => {
  it('a fresh Lv5 starter usually beats wild packs in Southern Alvalon', () => {
    const rng = new Rng(42);
    for (const st of STARTERS) {
      let wins = 0;
      for (let i = 0; i < 200; i++) {
        const enc = wildEncounter('southern_alvalon', rng.int(0, 14), rng);
        const b = new Battle([makeMonster(st, 5, rng, 5)], enc.team, { rng, gem: { hp: 0.15, atk: 0.15, mag: 0.15, spd: 0.05, def: 0.15, res: 0.15 } });
        if (sim(b) === 0) wins++;
      }
      expect(wins / 200).toBeGreaterThan(0.8);
    }
  });

  it('early wild fights near Corova are winnable but not trivial', () => {
    const rng = new Rng(1);
    let wins = 0, hpLost = 0, n = 0;
    for (const st of STARTERS) for (const depth of [0, 0.5, 1]) for (let i = 0; i < 100; i++) {
      const { b, outcome } = fight([makeMonster(st, 5, rng, 5)], wildEncounter('southern_alvalon', 0, rng, depth), rng);
      n++;
      if (outcome === 0) { wins++; hpLost += 1 - b.all[0].pool.hp / b.all[0].pool.max; }
    }
    // measured: ~92% wins, ~26% of the starter's HP lost per won fight
    expect(wins / n).toBeGreaterThan(0.8);
    expect(wins / n).toBeLessThan(0.98);
    expect(hpLost / wins).toBeGreaterThan(0.15);
  });

  it('a starter gains ~5 levels in roughly 15-25 wild battles', () => {
    const rng = new Rng(2);
    const team: number[] = [], solo: number[] = [];
    for (let i = 0; i < 40; i++) {
      const st = STARTERS[i % 4];
      team.push(opening(st, 10, rng, 2).battles);
      solo.push(opening(st, 10, rng, 0).battles);
    }
    // measured medians: ~23 battles sharing XP with two catches, ~13 alone (was ~76 / ~45)
    expect(median(team)).toBeGreaterThanOrEqual(17);
    expect(median(team)).toBeLessThanOrEqual(28);
    expect(median(solo)).toBeGreaterThanOrEqual(10);
    expect(median(solo)).toBeLessThanOrEqual(20);
  });

  it('Arashi is a fair first overlord for a Lv 10-12 starter with a catch or two', () => {
    // before the rebalance (7x HP, +15% stats) this was 0% at every level
    const enc = overlordEncounter('Arashi');
    expect(species(enc.team[0].species).name).toBe('Red Dragonling');
    expect(enc.team[0].level).toBe(overlordLevel('Arashi'));
    expect(overlordLevel('Arashi')).toBe(13);
    const rng = new Rng(3);
    const rate: Record<number, number> = {};
    for (const lv of [10, 11, 12]) {
      let wins = 0, n = 0;
      for (let i = 0; i < 40; i++) {
        const { party } = opening(STARTERS[i % 4], lv, rng, 1 + (i % 2));
        for (let k = 0; k < 4; k++, n++) if (arashi(party, rng)) wins++;
      }
      rate[lv] = wins / n;
    }
    // measured: ~0.34 at Lv 10, ~0.50 at Lv 11, ~0.55 at Lv 12; a water starter has the edge, two catches help a lot
    const all = (rate[10] + rate[11] + rate[12]) / 3;
    expect(all).toBeGreaterThan(0.38);
    expect(all).toBeLessThan(0.72);
    expect(rate[10]).toBeGreaterThan(0.2);
    expect(rate[12]).toBeLessThan(0.85);
    expect(rate[12]).toBeGreaterThan(rate[10]);
  });

  it('an untrained starter cannot beat Arashi', () => {
    const rng = new Rng(4);
    let wins = 0;
    for (let i = 0; i < 80; i++) if (arashi([makeMonster(STARTERS[i % 4], 6, rng, 5)], rng)) wins++;
    expect(wins / 80).toBeLessThan(0.1);
  });
});
