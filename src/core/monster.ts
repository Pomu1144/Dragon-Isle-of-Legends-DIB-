import { data, species, speciesByName } from './data';
import type { Element, MonsterInst, Species, StatKey, Stats } from './types';
import { Rng, rng as globalRng } from './rng';

export const RANKS = ['F-', 'F', 'E', 'D', 'C', 'B', 'A', 'S', 'S+', 'S+'] as const;
export const rankName = (r: number) => (r >= 8 ? 'S+' : RANKS[r]);
const rankMult = (r: number) => 0.85 + r * 0.04; // F- 0.85 .. S+ 1.17
export const MAX_LEVEL = 150;
export const STAT_KEYS: StatKey[] = ['hp', 'atk', 'mag', 'spd', 'def', 'res'];
export const STAT_LABEL: Record<StatKey, string> = { hp: 'HP', atk: 'Attack', mag: 'Magic', spd: 'Speed', def: 'Defense', res: 'Resist' };

let uidCounter = Date.now() % 1e9;
export const newUid = () => ++uidCounter;

export function makeMonster(sp: Species | number | string, level: number, r: Rng = globalRng, rank?: number): MonsterInst {
  const s = typeof sp === 'object' ? sp : typeof sp === 'number' ? species(sp) : speciesByName(sp)!;
  const rk = rank ?? Math.min(8, Math.max(0, Math.round(r.range(-0.5, 5.5) + (r.chance(0.08) ? 3 : 0))));
  return { uid: newUid(), species: s.id, level: Math.max(1, Math.min(MAX_LEVEL, Math.round(level))), xp: 0, rank: rk, soul: null };
}

/** Bonus (fractional) a soul stone grants to each stat. */
export function soulBonus(m: MonsterInst): Partial<Stats> {
  if (!m.soul) return {};
  const keys = data().soulStones[m.soul.element] ?? [];
  const out: Partial<Stats> = {};
  for (const k of keys) out[k] = m.soul.power / Math.max(1, keys.length * 0.6);
  return out;
}

export function statsOf(m: MonsterInst, gem: Partial<Stats> = {}): Stats {
  const s = species(m.species);
  const g = data().growth;
  const lv = 1 + g * (m.level - 1) * (1 + m.level / 220);
  const soul = soulBonus(m);
  const out = {} as Stats;
  for (const k of STAT_KEYS) {
    const v = s.base[k] * lv * rankMult(m.rank) * (k === 'hp' ? 1.6 : 1) + (k === 'hp' ? 12 : 2);
    out[k] = Math.round(v * (1 + (soul[k] ?? 0) + (gem[k] ?? 0)));
  }
  return out;
}

export const xpForLevel = (lv: number) => Math.round(12 * lv ** 2.15);
export const xpToNext = (m: MonsterInst) => xpForLevel(m.level + 1) - xpForLevel(m.level);

/**
 * Experience for defeating (or capturing) a monster. The flat part (40 + 8 per level) matters only early on:
 * it lets a Lv 5 starter gain ~5 levels in about 15-25 wild battles near Corova (tests/balance.test.ts),
 * while at Lv 50+ the level term dominates and it adds little more than a tenth.
 */
export function xpYield(defeated: MonsterInst) {
  const s = species(defeated.species);
  return Math.round(40 + 8 * defeated.level + defeated.level ** 1.9 * (0.9 + s.stars * 0.35));
}

/** Add XP; returns levels gained. */
export function gainXp(m: MonsterInst, amount: number): number {
  let gained = 0;
  m.xp += amount;
  while (m.level < MAX_LEVEL && m.xp >= xpToNext(m)) {
    m.xp -= xpToNext(m);
    m.level++;
    gained++;
  }
  if (m.level >= MAX_LEVEL) m.xp = 0;
  return gained;
}

export function canEvolve(m: MonsterInst): Species | null {
  const s = species(m.species);
  if (!s.evolveLevel || !s.evolveInto || m.level < s.evolveLevel) return null;
  return speciesByName(s.evolveInto) ?? null;
}

export function evolve(m: MonsterInst): Species | null {
  const into = canEvolve(m);
  if (into) m.species = into.id;
  return into;
}

export const displayName = (m: MonsterInst) => m.nick || species(m.species).name;

/** Strength of the soul stone produced by destroying a monster. */
export function soulFrom(m: MonsterInst): { element: Element; power: number } {
  const s = species(m.species);
  return { element: s.element, power: Math.round((0.04 + m.level / 600 + s.stars / 120) * 1000) / 1000 };
}

/** Rough combat power used for UI sorting and AI team building. */
export function power(m: MonsterInst) {
  const st = statsOf(m);
  return Math.round(st.hp / 4 + st.atk + st.mag + st.spd * 0.6 + st.def * 0.8 + st.res * 0.8);
}
