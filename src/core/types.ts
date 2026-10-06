export type Element = 'Fire' | 'Water' | 'Air' | 'Earth' | 'Life' | 'Death' | 'Arcane';
export type StatKey = 'hp' | 'atk' | 'mag' | 'spd' | 'def' | 'res';
export type Stats = Record<StatKey, number>;
export type Target = 'foe' | 'twoFoes' | 'allFoes' | 'self' | 'ally' | 'allAllies' | 'all' | 'passive';
export type StatusType = 'stun' | 'sleep' | 'paralyze' | 'confuse' | 'doom' | 'taunt' | 'disguise' | 'noguard' | 'berserk';

export interface Ability {
  name: string;
  tu: number | null;
  target: Target;
  text?: string;
  kind?: 'physical' | 'magical';
  element?: Element | null;
  power?: number;
  healPower?: number;
  drain?: number;
  mods?: Partial<Record<'atk' | 'mag' | 'def' | 'res' | 'spd', number>>;
  status?: { type: StatusType; tu: number };
  poison?: { tu: number; power: number; element?: Element | null };
  haste?: number;
  vs?: Record<string, number>;
  perKill?: number;
  perTU?: [number, number];
  alone?: number;
  recoil?: number;
  reflect?: number;
  selfSacrifice?: number;
  sacrificeBench?: boolean;
  summonRandom?: boolean;
  clone?: boolean;
  escape?: boolean;
  cleanse?: 'all' | 'bad';
  immune?: boolean;
  scout?: boolean;
  defToAtk?: boolean;
  passive?: boolean;
}

export interface Species {
  id: number;
  name: string;
  element: Element;
  stars: number;
  evolveLevel: number | null;
  evolveInto: string | null;
  location: string;
  obtain: string;
  lore: string;
  base: Stats;
  abilities: Ability[];
  types: string[];
  sprite: string;
  icon?: string;
}

export interface Region {
  name: string; id: string; x: number; y: number; tier: number; levels: [number, number]; sea?: boolean;
  terrain: string; monsters: string[]; towns: string[]; dungeons: string[]; overlords: string[]; about: string;
}
export interface Quest { title: string; type: string; text: string }
export interface Town { name: string; region: string; quests: Quest[]; about: string; arena: boolean; tournament: boolean }
export interface Dungeon {
  name: string; region: string; floors: number; specials: Record<string, string>; monsters: string[];
  spirit: string[]; captureChallenge: string[]; about: string; bg: string;
}
export interface Overlord { name: string; form: string; region: string; about: string; stats: Stats | null }
export interface Recipe { result: string; parts: [string, string] }
export interface License { name: string; slots: number; quests: number; heroLevel: number; text: string }
export interface ShopItem { item: string; price: number; currency: 'silver' | 'gold'; desc: string }

export interface GameData {
  monsters: Species[]; regions: Region[]; towns: Town[]; dungeons: Dungeon[]; overlords: Overlord[];
  recipes: Recipe[]; shop: ShopItem[]; licenses: License[]; eggs: { egg: string[]; golden: string[] };
  spirits: string[]; soulStones: Record<string, StatKey[]>; growth: number;
  quests: Record<string, { obtained: string; text: string; how: string; reward: string; town: string | null }>;
  characters: Record<string, string>;
}

export interface Spot { id: number; x: number; y: number; kind: 'field' | 'town' | 'dungeon' | 'overlord' | 'exit' | 'dock'; ref?: string; exit?: string }
export type Maps = Record<string, { spots: Spot[]; edges: [number, number][] }>;

/** A monster the player (or an NPC) owns. */
export interface MonsterInst {
  uid: number;
  species: number;
  level: number;
  xp: number;
  rank: number; // 0..9 => F- .. S+
  nick?: string;
  soul?: { element: Element; power: number } | null;
  locked?: boolean;
}
