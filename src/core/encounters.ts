import { data, dungeon, overlord, region, regionPool, speciesByName } from './data';
import { makeMonster } from './monster';
import type { MonsterInst, Region, Species } from './types';
import { Rng, rng as R } from './rng';
import { heroLevel } from './state';

export interface Encounter {
  kind: 'wild' | 'breeder' | 'overlord' | 'boss' | 'arena' | 'spirit';
  name?: string;
  team: MonsterInst[];
  bg: string;
  capturable: boolean;
  canFlee: boolean;
  bossHp?: number;
  statMult?: number;
  reward: { silver: number; gold?: number; egg?: 'egg' | 'golden' };
  intro?: string;
  /** experience multiplier (the Abyss is where breeders farm experience) */
  xpMult?: number;
}

const TERRAIN_BG: Record<string, string[]> = {
  meadow: ['meadow', 'river'], forest: ['forest', 'swamp'], mountain: ['mountain'], snow: ['snow', 'mountain'],
  beach: ['beach', 'meadow'], river: ['river', 'meadow'], volcano: ['volcano', 'magma'], underworld: ['abyss', 'ruins', 'swamp'],
  frost: ['snow', 'glacier'], glacier: ['glacier', 'snow'], ash: ['volcano', 'magma', 'ruins'], hell: ['hell', 'magma'],
  deepforest: ['deepforest', 'forest'], graveyard: ['graveyard', 'ruins', 'swamp'],
};

export function regionBg(r: Region, spot = 0) {
  const opts = TERRAIN_BG[r.terrain] ?? ['meadow'];
  return opts[spot % opts.length];
}

function levelFor(r: Region, spot: number, rng: Rng) {
  const [lo, hi] = r.levels;
  return Math.round(lo + ((hi - lo) * (spot % 15)) / 14 + rng.range(-1.5, 1.5));
}

function pickWeighted(pool: Species[], rng: Rng) {
  // stronger species are rarer
  return rng.weighted(pool, (s) => 1 / (0.6 + s.stars ** 1.35));
}

export function wildEncounter(regionId: string, spot: number, rng: Rng = R): Encounter {
  const r = region(regionId);
  const pool = regionPool(r);
  const size = r.tier === 0 ? (rng.chance(0.75) ? 1 : 2) : r.tier <= 2 ? rng.int(1, 3) : rng.int(1, Math.min(6, 2 + Math.ceil(r.tier / 3)));
  const swarm = r.tier > 0 && rng.chance(0.12);
  const first = pickWeighted(pool, rng);
  const team = Array.from({ length: size }, () => makeMonster(swarm ? first : pickWeighted(pool, rng), levelFor(r, spot, rng), rng, rng.int(0, 5)));
  const silver = team.reduce((a, m) => a + 4 + m.level * 2, 0);
  return { kind: 'wild', team, bg: regionBg(r, spot), capturable: true, canFlee: true, reward: { silver } };
}

/** A lone, strong monster guarding a rare spot: picked from the region's strongest species, capturable. */
export function rareEncounter(regionId: string, seed: number): Encounter {
  const rng = new Rng(seed);
  const r = region(regionId);
  const pool = [...regionPool(r)].sort((a, b) => b.stars - a.stars);
  const sp = rng.pick(pool.slice(0, Math.max(1, Math.ceil(pool.length / 4))));
  const team = [makeMonster(sp, r.levels[1] + 3, rng, rng.int(5, 9))];
  return {
    kind: 'wild', name: sp.name, team, bg: regionBg(r, seed), capturable: true, canFlee: true,
    reward: { silver: 80 + r.tier * 60, gold: 3 + r.tier }, intro: `A rare ${sp.name} blocks the way!`,
  };
}

export function breederTeam(regionId: string, rng: Rng, size: number, bonus = 2, prefer?: string): MonsterInst[] {
  const r = region(regionId);
  const pool = regionPool(r);
  const lv = r.levels[1] + bonus;
  const team: MonsterInst[] = [];
  const p = prefer ? speciesByName(prefer) : null;
  for (let i = 0; i < size; i++) team.push(makeMonster(p && i % 2 === 0 ? p : pickWeighted(pool, rng), lv + rng.int(-1, 1), rng, rng.int(3, 7)));
  return team;
}

export function breederEncounter(regionId: string, name: string, seed: number, prefer?: string): Encounter {
  const rng = new Rng(seed);
  const r = region(regionId);
  const size = Math.min(8, 3 + Math.floor(r.tier / 2));
  return {
    kind: 'breeder', name, team: breederTeam(regionId, rng, size, 2, prefer), bg: regionBg(r, seed),
    capturable: false, canFlee: false, reward: { silver: 150 + r.tier * 120 },
    intro: `${name} challenges you with ${size} monsters!`,
  };
}

export function overlordEncounter(name: string): Encounter {
  const o = overlord(name)!;
  const r = data().regions.find((x) => x.name === o.region)!;
  const form = speciesByName(o.form) ?? speciesByName('Red Wyrm')!;
  const lv = r.levels[1] + 8;
  const boss = makeMonster(form, lv, new Rng(lv), 8);
  boss.nick = o.name;
  return {
    kind: 'overlord', name: o.name, team: [boss], bg: r.terrain === 'volcano' ? 'volcano' : r.terrain === 'snow' ? 'snow' : 'mountain',
    capturable: false, canFlee: true, bossHp: 7 + r.tier * 0.4, statMult: 1.15,
    reward: { silver: 500 + r.tier * 300, gold: 30 + r.tier * 5, egg: 'golden' },
    intro: `The Dragon Overlord ${o.name} descends!`,
  };
}

/** Floors get deeper and harder; the Abyss keeps going. */
export function dungeonLevel(name: string, floor: number) {
  const d = dungeon(name)!;
  const r = data().regions.find((x) => x.name === d.region)!;
  if (name === 'The Abyss') return Math.min(150, 20 + floor * 1.3);
  return Math.round(r.levels[0] + (r.levels[1] - r.levels[0]) * 0.6 + floor * 1.6);
}

export function dungeonEncounter(name: string, floor: number, rng: Rng = R): Encounter {
  const d = dungeon(name)!;
  const r = data().regions.find((x) => x.name === d.region)!;
  let pool = d.monsters.map((n) => speciesByName(n)).filter(Boolean) as Species[];
  if (pool.length < 4) pool = pool.concat(regionPool(r));
  const lv = dungeonLevel(name, floor);
  const size = rng.int(2, Math.min(7, 3 + Math.floor(floor / 3)));
  const team = Array.from({ length: size }, () => makeMonster(pickWeighted(pool, rng), lv + rng.int(-2, 2), rng));
  // nothing in the Abyss can be captured, but its battles pay extra experience
  const abyss = name === 'The Abyss';
  return { kind: 'wild', team, bg: d.bg, capturable: !abyss, canFlee: true, reward: { silver: team.reduce((a, m) => a + 6 + m.level * 3, 0) }, xpMult: abyss ? 1.5 : undefined };
}

/**
 * Save points let a dungeon be resumed from deep floors. Ordinary dungeons have waypoints on floors
 * 1, 6, 11, ...; the Abyss, as in the original, has a teleport save point every 10 floors (10, 20, ...).
 */
export const savePointStep = (name: string) => (name === 'The Abyss' ? 10 : 5);
export function isSavePoint(name: string, floor: number) {
  return name === 'The Abyss' ? floor % 10 === 0 : floor > 1 && floor % 5 === 1;
}
/** Deepest save point at or above the best floor reached: where the dungeon entrance sends you. */
export function resumeFloor(name: string, best: number) {
  return name === 'The Abyss' ? Math.max(1, Math.floor(best / 10) * 10) : Math.max(1, Math.floor((best - 1) / 5) * 5 + 1);
}
/** The next save point below this floor (shown as "Next bonus at floor: N"). */
export function nextSavePoint(name: string, floor: number) {
  return name === 'The Abyss' ? (Math.floor(floor / 10) + 1) * 10 : Math.floor((floor - 1) / 5) * 5 + 6;
}

export const FINALE = [
  { npc: 'Cornelius', team: ['White Wyrm', 'White Wyrm', 'White Dragoon'], lv: 72 },
  { npc: 'Xin', team: ['Blue Wyrm', 'Blue Wyrm', 'Blue Dragoon'], lv: 74 },
  { npc: 'Raiden', team: ['Gold Wyrm', 'Gold Wyrm', 'Gold Dragoon'], lv: 76 },
  { npc: 'Enya', team: ['Red Wyrm', 'Red Wyrm', 'Red Dragoon'], lv: 79 },
  { npc: 'Beatrice', team: ['Blue Wyrm', 'Cryohydra', 'White Wyrm'], lv: 81 },
  { npc: 'Caius', team: ['Red Wyrm', 'Pyrohydra', 'Gold Wyrm'], lv: 85 },
];

export function dungeonBoss(name: string, floor: number, rng: Rng = R): Encounter | null {
  const d = dungeon(name)!;
  const lv = dungeonLevel(name, floor) + 4;
  if (name === 'Sanctuary' && floor <= FINALE.length) {
    const f = FINALE[floor - 1];
    return {
      kind: 'boss', name: f.npc, bg: 'sanctuary', capturable: false, canFlee: false, statMult: 1.1,
      team: f.team.map((n) => makeMonster(n, f.lv, rng, 7)), reward: { silver: 4000, gold: 40, egg: floor === FINALE.length ? 'golden' : 'egg' },
      intro: `${f.npc} guards floor ${floor} of the Sanctuary.`,
    };
  }
  if (name === 'The Abyss' && floor % 10 === 0 && floor >= 50) {
    const f = makeMonster('Bone Dragon', lv + 10, rng, 8);
    f.nick = 'Fafnir';
    return { kind: 'boss', name: 'Fafnir', team: [f], bg: 'abyss', capturable: false, canFlee: true, bossHp: 6, statMult: 1.2, reward: { silver: 5000, gold: 50, egg: 'golden' }, intro: 'Fafnir, the black dragon of the Abyss, awakens!' };
  }
  if (floor === d.floors && d.spirit.length) {
    const sp = speciesByName(d.spirit[0])!;
    return { kind: 'spirit', name: sp.name, team: [makeMonster(sp, lv + 3, rng, 6)], bg: d.bg, capturable: true, canFlee: true, bossHp: 2.5, reward: { silver: 1500, gold: 20 }, intro: `The spirit ${sp.name} manifests!` };
  }
  return null;
}

export function arenaEncounter(licenseIdx: number, rng: Rng = R): Encounter {
  const lic = data().licenses[licenseIdx];
  const tierRegion = data().regions.slice().sort((a, b) => a.tier - b.tier)[Math.min(15, 1 + licenseIdx * 3)];
  const team = breederTeam(tierRegion.id, rng, 3 + licenseIdx, 3);
  return {
    kind: 'arena', name: licenseIdx % 2 ? 'Arena Master May' : 'Arena Master Herald', team, bg: 'arena', capturable: false, canFlee: false,
    reward: { silver: 500 * (licenseIdx + 1), gold: 10 * (licenseIdx + 1) }, intro: `License Test: ${lic.name}`,
  };
}

export const recommendLevel = (r: Region) => r.levels[0];
export { heroLevel };
