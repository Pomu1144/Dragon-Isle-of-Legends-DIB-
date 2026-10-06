import { data, maps, region, regionByName, species, speciesByName, town } from './data';
import { makeMonster, gainXp, canEvolve, evolve, soulFrom, newUid, displayName } from './monster';
import type { Element, MonsterInst, Species, StatKey, Stats } from './types';
import { Rng, rng } from './rng';

export const SAVE_KEY = 'dragon-isle-save-v1';

export interface Gem { id: number; shape: 'Oval' | 'Square' | 'Tear' | 'Star'; stats: Partial<Record<StatKey, number>> }
export interface QuestState {
  id: string; town: string; title: string; type: string; text: string;
  goal: { kind: 'capture' | 'battle' | 'defeat' | 'soulstone' | 'fuse' | 'visit' | 'evolve'; species?: string; count?: number; region?: string; spot?: number; npc?: string; town?: string };
  progress: number; reward: { silver: number; gold?: number; egg?: 'egg' | 'golden' };
}
export interface SaveData {
  version: 1;
  hero: string;
  created: number;
  party: MonsterInst[];
  storage: MonsterInst[];
  silver: number;
  gold: number;
  items: { card: number; silver: number; gold: number; egg: number; golden: number };
  souls: { id: number; element: Element; power: number }[];
  gems: Gem[];
  equippedGems: (number | null)[]; // per shape slot
  heroXp: number;
  skill: Partial<Record<StatKey, number>>;
  bestLevel: Record<number, number>; // species -> best level reached (drives hero level)
  seen: number[];
  caught: number[];
  license: number; // index into licenses, -1 = none
  quests: QuestState[];
  questsDone: string[];
  questCount: number;
  overlords: string[];
  dungeons: Record<string, { best: number; cleared: boolean }>;
  location: { region: string; spot: number };
  lastTown: { region: string; spot: number };
  visited: string[];
  stats: { battles: number; wins: number; captures: number; defeated: number };
  ending: boolean;
  settings: { speed: number; auto: boolean; music: boolean; sfx: boolean };
}

export let S: SaveData;
type Listener = () => void;
const listeners = new Set<Listener>();
export const onChange = (f: Listener) => (listeners.add(f), () => listeners.delete(f));
export const emit = () => listeners.forEach((f) => f());

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}
export function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch { /* storage full or blocked */ }
  emit();
}
export function load(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    S = JSON.parse(raw);
    return true;
  } catch { return false; }
}
export const exportSave = () => btoa(unescape(encodeURIComponent(JSON.stringify(S))));
export function importSave(code: string) {
  S = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  save();
}

export const STARTERS = ['Fire Hatchling', 'Water Hatchling', 'Spark Hatchling', 'Gold Hatchling'];

export function newGame(hero: string, starter: string) {
  const start = maps()['southern_alvalon'].spots.find((s) => s.ref === 'Corova')!;
  const m = makeMonster(starter, 5, rng, 5);
  S = {
    version: 1, hero, created: Date.now(), party: [m], storage: [], silver: 300, gold: 10,
    items: { card: 5, silver: 1, gold: 0, egg: 0, golden: 0 }, souls: [], gems: [], equippedGems: [null, null, null, null],
    heroXp: 0, skill: {}, bestLevel: {}, seen: [m.species], caught: [m.species], license: -1,
    quests: [], questsDone: [], questCount: 0, overlords: [], dungeons: {},
    location: { region: 'southern_alvalon', spot: start.id }, lastTown: { region: 'southern_alvalon', spot: start.id },
    visited: ['southern_alvalon'], stats: { battles: 0, wins: 0, captures: 0, defeated: 0 }, ending: false,
    settings: { speed: 1, auto: false, music: true, sfx: true },
  };
  recordLevel(m);
  save();
}

// ------------------------------------------------------------------ hero & license
export const heroLevelFromXp = (xp: number) => Math.floor(Math.pow(xp / 14, 1 / 1.55)) + 1;
export const heroLevel = () => Math.min(99, heroLevelFromXp(S.heroXp));
export const heroXpFor = (lv: number) => Math.ceil(14 * Math.pow(lv - 1, 1.55));
export const skillPoints = () => heroLevel() - 1 - Object.values(S.skill).reduce((a, b) => a + (b ?? 0), 0);
export const partySize = () => Math.min(10, 3 + (S.license + 1) + Math.floor(heroLevel() / 6));
export const GEM_SHAPES = ['Oval', 'Square', 'Tear', 'Star'] as const;
export const gemSlotsUnlocked = () => [S.license >= 0, S.license >= 1, S.license >= 3, S.license >= 4];

/** Global stat bonus from hero gems + skill points, applied to all player monsters. */
export function heroBonus(): Partial<Stats> {
  // trained monsters fight better than wild ones ("breeder bond")
  const out: Partial<Stats> = { hp: 0.15, atk: 0.15, mag: 0.15, spd: 0.05, def: 0.15, res: 0.15 };
  for (const [k, v] of Object.entries(S.skill)) out[k as StatKey] = (out[k as StatKey] ?? 0) + (v ?? 0) * 0.01;
  S.equippedGems.forEach((id, i) => {
    if (id == null || !gemSlotsUnlocked()[i]) return;
    const g = S.gems.find((x) => x.id === id);
    if (g) for (const [k, v] of Object.entries(g.stats)) out[k as StatKey] = (out[k as StatKey] ?? 0) + (v ?? 0);
  });
  return out;
}

export function recordLevel(m: MonsterInst): number {
  const prev = S.bestLevel[m.species] ?? 0;
  if (m.level > prev) {
    S.bestLevel[m.species] = m.level;
    const before = heroLevel();
    S.heroXp += m.level - prev;
    return heroLevel() - before;
  }
  return 0;
}

export function markSeen(id: number) { if (!S.seen.includes(id)) S.seen.push(id); }
export function markCaught(id: number) { markSeen(id); if (!S.caught.includes(id)) S.caught.push(id); }

export function allMonsters() { return [...S.party, ...S.storage]; }
export function findMon(uid: number) { return allMonsters().find((m) => m.uid === uid); }

export function addMonster(m: MonsterInst): 'party' | 'storage' {
  markCaught(m.species);
  recordLevel(m);
  if (S.party.length < partySize()) { S.party.push(m); return 'party'; }
  S.storage.push(m);
  return 'storage';
}

export function removeMonster(uid: number) {
  S.party = S.party.filter((m) => m.uid !== uid);
  S.storage = S.storage.filter((m) => m.uid !== uid);
}

export interface LevelReport { uid: number; name: string; from: number; to: number; evolved?: string; hero?: number }

/** Award XP to the given monsters and run evolutions. */
export function awardXp(uids: number[], total: number): LevelReport[] {
  const out: LevelReport[] = [];
  const share = Math.max(1, Math.round(total / Math.max(1, Math.sqrt(uids.length))));
  for (const uid of uids) {
    const m = findMon(uid);
    if (!m) continue;
    const from = m.level;
    const name = displayName(m);
    gainXp(m, share);
    let evolved: string | undefined;
    while (canEvolve(m)) {
      evolved = evolve(m)!.name;
      markCaught(m.species);
    }
    const hero = recordLevel(m);
    if (m.level !== from || evolved) out.push({ uid, name, from, to: m.level, evolved, hero });
  }
  return out;
}

export function destroyForSoul(uid: number) {
  const m = findMon(uid);
  if (!m || (S.party.length <= 1 && S.party.includes(m))) return null;
  const soul = { id: newUid(), ...soulFrom(m) };
  removeMonster(uid);
  S.souls.push(soul);
  questEvent('soulstone');
  return soul;
}

export function equipSoul(uid: number, soulId: number) {
  const m = findMon(uid);
  const i = S.souls.findIndex((s) => s.id === soulId);
  if (!m || i < 0) return;
  const [s] = S.souls.splice(i, 1);
  if (m.soul) S.souls.push({ id: newUid(), ...m.soul });
  m.soul = { element: s.element, power: s.power };
}

// ------------------------------------------------------------------ recipes
export function fuse(a: number, b: number, result: string) {
  const ma = findMon(a), mb = findMon(b);
  const res = speciesByName(result);
  if (!ma || !mb || !res || a === b) return null;
  const lv = Math.max(1, Math.round((ma.level + mb.level) / 4));
  const m = makeMonster(res, lv, rng, Math.max(ma.rank, mb.rank));
  const wasParty = S.party.findIndex((x) => x.uid === a || x.uid === b);
  removeMonster(a);
  removeMonster(b);
  if (wasParty >= 0) S.party.splice(Math.min(wasParty, S.party.length), 0, m), markCaught(m.species), recordLevel(m);
  else addMonster(m);
  questEvent('fuse');
  return m;
}

// ------------------------------------------------------------------ eggs & gems
export const SHAPE_POWER = { Oval: 0.03, Square: 0.06, Tear: 0.1, Star: 0.16 } as const;
export function rollGem(shape: Gem['shape'], imbued: boolean, r: Rng = rng): Gem {
  const keys: StatKey[] = ['hp', 'atk', 'mag', 'spd', 'def', 'res'];
  const stats: Gem['stats'] = {};
  const n = imbued ? 2 : 1;
  while (Object.keys(stats).length < n) stats[r.pick(keys)] = Math.round(SHAPE_POWER[shape] * r.range(0.7, 1.3) * 1000) / 1000;
  return { id: newUid(), shape, stats };
}

export type EggPrize = { kind: 'monster'; species: number; level: number } | { kind: 'silver' | 'gold' | 'card' | 'silverCard' | 'goldCard'; amount: number } | { kind: 'gem'; gem: Gem };
export function eggPrizes(type: 'egg' | 'golden', r: Rng = rng): EggPrize[] {
  const lvl = Math.max(3, Math.round(heroLevel() * 2.2));
  const pool = type === 'golden' ? data().eggs.golden : data().eggs.egg;
  const sp = pool.map((n) => speciesByName(n)).filter(Boolean) as Species[];
  const fresh = sp.filter((s) => !S.caught.includes(s.id));
  const mons = (fresh.length >= 4 ? fresh : sp).slice();
  const prizes: EggPrize[] = [];
  const nMon = type === 'golden' ? 8 : 4;
  for (let i = 0; i < nMon && mons.length; i++) {
    const s = mons.splice(r.int(0, mons.length - 1), 1)[0];
    prizes.push({ kind: 'monster', species: s.id, level: type === 'golden' ? lvl + 5 : lvl });
  }
  if (type === 'egg') {
    prizes.push({ kind: 'silver', amount: 300 + heroLevel() * 40 }, { kind: 'gold', amount: 20 }, { kind: 'silverCard', amount: 2 },
      { kind: 'goldCard', amount: 1 }, { kind: 'gem', gem: rollGem('Oval', false, r) }, { kind: 'card', amount: 5 });
  } else {
    prizes.push({ kind: 'gold', amount: 80 }, { kind: 'goldCard', amount: 2 }, { kind: 'gem', gem: rollGem('Tear', true, r) },
      { kind: 'silver', amount: 3000 });
  }
  return prizes.sort(() => r.next() - 0.5);
}

export function grantPrize(p: EggPrize): string {
  switch (p.kind) {
    case 'monster': {
      const m = makeMonster(p.species, p.level, rng);
      const where = addMonster(m);
      return `${species(p.species).name} (Lv ${m.level}) joined your ${where}!`;
    }
    case 'silver': S.silver += p.amount; return `${p.amount} Silver`;
    case 'gold': S.gold += p.amount; return `${p.amount} Gold`;
    case 'card': S.items.card += p.amount; return `${p.amount} Capture Cards`;
    case 'silverCard': S.items.silver += p.amount; return `${p.amount} Silver Cards`;
    case 'goldCard': S.items.gold += p.amount; return `${p.amount} Gold Cards`;
    case 'gem': S.gems.push(p.gem); return `${p.gem.shape} gem`;
  }
}

// ------------------------------------------------------------------ quests
const QUEST_ACTIONS = /arrest|defeat|battle|beat|stop|clear|eliminate|bounty|hunt|attack|wipe|deal with/i;

function questReward(tier: number, r: Rng) {
  return { silver: Math.round(120 * Math.pow(tier + 1, 1.55) / 10) * 10, gold: r.chance(0.35) ? 5 + tier * 3 : undefined, egg: r.chance(0.25) ? 'egg' as const : undefined };
}

/** Turn a wiki quest blurb into a concrete, trackable objective. */
export function buildQuest(townName: string, idx: number): QuestState {
  const t = town(townName)!;
  const q = t.quests[idx];
  const r = new Rng(hash(townName + idx));
  const home = regionByName(t.region)!;
  const mentioned = data().regions.find((x) => q.text.includes(x.name)) ?? home;
  const reg = Math.abs(mentioned.tier - home.tier) > 3 ? home : mentioned;
  const mons = data().monsters.filter((s) => new RegExp(`\\b${s.name}s?\\b`, 'i').test(q.text) || new RegExp(`\\b${s.name}\\b`, 'i').test(q.title));
  const type = q.type.toLowerCase();
  const fieldSpots = maps()[reg.id].spots.filter((s) => s.kind === 'field');
  const spot = fieldSpots[r.int(0, fieldSpots.length - 1)]?.id ?? 0;
  const npc = (q.title.match(/(?:arrest|beat|defeat|capture)\s+([A-Z][\w-]+)/i)?.[1]) ||
    (q.text.match(/(?:named|called)\s+([A-Z][\w-]+)/)?.[1]) || (q.text.match(/\b([A-Z][a-z]+(?:-[A-Z][a-z]+)?)\b(?= (?:has|is|was|who))/)?.[1]) || 'Rogue Breeder';
  let goal: QuestState['goal'];
  if (type.includes('capture') || /\bcatch|capture\b/i.test(q.text)) {
    const sp = mons.find((m) => reg.monsters.includes(m.name)) ?? mons[0];
    goal = sp ? { kind: 'capture', species: sp.name, count: 1, region: reg.id } : { kind: 'capture', count: 1, region: reg.id };
  } else if (type.includes('craft') || /soul ?stone/i.test(q.text)) goal = { kind: 'soulstone', count: 1 };
  else if (/recipe|creat|combin|fus/i.test(q.text + q.title)) goal = { kind: 'fuse', count: 1 };
  else if (type.includes('train') || /defeat \d+|defeat (ten|10)/i.test(q.text)) goal = { kind: 'defeat', count: Number(q.text.match(/(\d+)\s+monsters/)?.[1] ?? 10) };
  else if (/deliver|message|visit|go to|head to/i.test(q.title + type)) {
    const dest = data().towns.find((x) => x.name !== townName && (q.text.includes(x.name) || q.title.includes(x.name))) ?? data().towns[r.int(0, data().towns.length - 1)];
    goal = { kind: 'visit', town: dest.name };
  } else if (/evolv/i.test(q.title + q.text)) goal = { kind: 'evolve', count: 1 };
  else if (QUEST_ACTIONS.test(q.title + ' ' + q.text) || type.includes('battle')) goal = { kind: 'battle', region: reg.id, spot, npc, species: mons[0]?.name };
  else goal = { kind: 'defeat', count: 8 + r.int(0, 8) };
  return { id: `${townName}#${idx}`, town: townName, title: q.title || 'Guild Request', type: q.type || 'Battle', text: q.text, goal, progress: 0, reward: questReward(reg.tier, r) };
}

export function questEvent(kind: 'soulstone' | 'fuse' | 'evolve' | 'defeat' | 'capture' | 'visit', arg?: string | number, n = 1) {
  for (const q of S.quests) {
    if (q.goal.kind !== kind) continue;
    if (kind === 'capture' && q.goal.species && speciesByName(q.goal.species)?.id !== arg) continue;
    if (kind === 'visit' && q.goal.town !== arg) continue;
    q.progress += n;
  }
}

export const questDone = (q: QuestState) =>
  q.goal.kind === 'battle' || q.goal.kind === 'visit' ? q.progress >= 1 : q.progress >= (q.goal.count ?? 1);

export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function currentRegion() { return region(S.location.region); }
