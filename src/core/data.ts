import type { GameData, Maps, Species, Region, Town, Dungeon, Overlord } from './types';

let GD: GameData;
let MAPS: Maps;
const byId = new Map<number, Species>();
const byName = new Map<string, Species>();

export function setData(gd: GameData, maps: Maps) {
  GD = gd;
  MAPS = maps;
  byId.clear();
  byName.clear();
  for (const m of gd.monsters) {
    byId.set(m.id, m);
    byName.set(m.name.toLowerCase(), m);
  }
}

export async function loadData(base = 'assets/data/') {
  const [gd, maps] = await Promise.all([
    fetch(base + 'gamedata.json').then((r) => r.json()),
    fetch(base + 'maps.json').then((r) => r.json()),
  ]);
  setData(gd, maps);
}

export const data = () => GD;
export const maps = () => MAPS;
export const species = (id: number) => byId.get(id)!;
export const speciesByName = (n: string) => byName.get(n.toLowerCase());
export const region = (id: string) => GD.regions.find((r) => r.id === id)!;
export const regionByName = (n: string) => GD.regions.find((r) => r.name === n);
export const town = (n: string): Town | undefined => GD.towns.find((t) => t.name === n);
export const dungeon = (n: string): Dungeon | undefined => GD.dungeons.find((d) => d.name === n);
export const overlord = (n: string): Overlord | undefined => GD.overlords.find((o) => o.name === n);
export const regionPool = (r: Region) => r.monsters.map(speciesByName).filter(Boolean) as Species[];
export const spriteUrl = (s: Species) => `assets/sprites/${s.sprite}`;
