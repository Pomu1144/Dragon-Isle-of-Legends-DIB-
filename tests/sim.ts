/** Headless play of the opening: a "sensible player" policy, XP sharing as in the Battle scene, and Arashi. */
import { Battle, elementMult, type Combatant } from '../src/core/battle';
import { makeMonster, xpYield, gainXp, canEvolve, evolve } from '../src/core/monster';
import { Rng } from '../src/core/rng';
import { wildEncounter, overlordEncounter, type Encounter } from '../src/core/encounters';
import type { Ability, MonsterInst } from '../src/core/types';

/** heroBonus() of a fresh save (the "breeder bond"). */
export const GEM = { hp: 0.15, atk: 0.15, mag: 0.15, spd: 0.05, def: 0.15, res: 0.15 };

/** Expected damage per time unit of an attack on a target (no crits, no variance). */
function dpt(b: Battle, c: Combatant, a: Ability, t: Combatant) {
  if (!a.power || !a.kind) return 0;
  const phys = a.kind === 'physical';
  const A = phys ? c.stats.atk + (a.defToAtk ? c.stats.def : 0) : c.stats.mag;
  const D = phys ? t.stats.def : t.stats.res;
  const n = a.target === 'allFoes' || a.target === 'all' ? b.foesOf(c).length : a.target === 'twoFoes' ? Math.min(2, b.foesOf(c).length) : 1;
  return (a.power * A * 1.55 * (A / (A + D)) * elementMult(a.element ?? c.sp.element, t.sp.element) * n) / (a.tu ?? 130);
}

/** A sensible player: heal an ally in trouble, otherwise the best damage per TU on the weakest foe. */
export function sensible(b: Battle, c: Combatant): { ability: Ability; target?: string } {
  const abilities = b.usable(c);
  const hurt = b.alliesOf(c).find((x) => x.pool.hp / x.pool.max < 0.4);
  const heal = abilities.find((a) => a.healPower && !a.power);
  if (hurt && heal) return { ability: heal, target: hurt.key };
  let best: { ability: Ability; target?: string; v: number } | null = null;
  for (const a of abilities) for (const t of b.foesOf(c)) {
    const v = dpt(b, c, a, t) * (1 + 0.5 * (1 - t.pool.hp / t.pool.max));
    if (!best || v > best.v) best = { ability: a, target: t.key, v };
  }
  return best && best.v > 0 ? best : b.choose(c);
}

export function run(b: Battle, player: 'sensible' | 'auto' = 'sensible') {
  for (let i = 0; i < 4000 && b.over === null; i++) {
    const c = b.next([]);
    if (!c) break;
    const ch = c.side === 0 && player === 'sensible' ? sensible(b, c) : b.choose(c);
    b.act(c, ch.ability, ch.target);
  }
  return b.over;
}

export function fight(team: MonsterInst[], enc: Encounter, rng: Rng, player: 'sensible' | 'auto' = 'sensible') {
  const b = new Battle(team, enc.team, { rng, gem: GEM, bossHp: enc.bossHp, enemyStatMult: enc.statMult, capturable: enc.capturable, canFlee: enc.canFlee });
  return { b, outcome: run(b, player) };
}

/** XP as the Battle scene hands it out: everything defeated, shared by everyone who took the field. */
export function award(b: Battle, enc: Encounter) {
  const xp = b.all.filter((c) => c.side === 1 && c.pool.hp <= 0 && !c.temp).reduce((a, c) => a + xpYield(c.inst) * (c.boss ? 4 : 1), 0)
    * (enc.kind === 'wild' ? 1 : 1.5) * (enc.xpMult ?? 1);
  const fought = b.all.filter((c) => c.side === 0 && !c.temp && (c.slot !== -1 || c.pool.hp <= 0));
  const share = Math.max(1, Math.round(xp / Math.max(1, Math.sqrt(fought.length))));
  for (const c of fought) { gainXp(c.inst, share); while (canEvolve(c.inst)) evolve(c.inst); }
}

/**
 * The opening of a run: a Lv 5 starter roams Southern Alvalon (depth = how far from Corova), catching a
 * monster in its 3rd and 8th battle, until the starter reaches `target`. Lost battles still count.
 */
export function opening(starter: string, target: number, rng: Rng, catches = 2) {
  const party = [makeMonster(starter, 5, rng, 5)];
  let battles = 0, losses = 0, toTen = 0;
  while (party[0].level < target && battles < 400) {
    battles++;
    const enc = wildEncounter('southern_alvalon', 0, rng, rng.range(0.1, 0.8));
    if ((battles === 3 && catches >= 1) || (battles === 8 && catches >= 2)) { party.push(enc.team[0]); continue; }
    const { b, outcome } = fight(party, enc, rng);
    if (outcome !== 0) { losses++; continue; }
    award(b, enc);
    if (!toTen && party[0].level >= 10) toTen = battles;
  }
  return { party, battles, losses, toTen };
}

export function arashi(party: MonsterInst[], rng: Rng) {
  return fight(party.map((m) => ({ ...m })), overlordEncounter('Arashi'), rng).outcome === 0;
}
