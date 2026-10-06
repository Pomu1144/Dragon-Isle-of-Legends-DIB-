import { describe, expect, it } from 'vitest';
import { Battle } from '../src/core/battle';
import { makeMonster } from '../src/core/monster';
import { Rng } from '../src/core/rng';
import { STARTERS } from '../src/core/state';
import { wildEncounter } from '../src/core/encounters';

function sim(b: Battle) {
  for (let i = 0; i < 500 && b.over === null; i++) {
    const c = b.next([]);
    if (!c) break;
    const ch = b.choose(c);
    b.act(c, ch.ability, ch.target);
  }
  return b.over;
}

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
      console.log(st, wins / 200);
      expect(wins / 200).toBeGreaterThan(0.8);
    }
  });
});
