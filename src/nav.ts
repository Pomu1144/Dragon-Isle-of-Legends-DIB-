import type Phaser from 'phaser';
import { clearLayer, closeAllModals } from './ui/dom';
import type { Encounter } from './core/encounters';

export type BattleResult = { outcome: 0 | 1 | 'fled'; captured: number };
export interface BattleReq { enc: Encounter; after: (r: BattleResult) => void }

let game: Phaser.Game;
export const setGame = (g: Phaser.Game) => (game = g);

const SCENES = ['Title', 'World', 'Region', 'Battle', 'Town', 'Dungeon'];
export function go(key: string, data?: object) {
  closeAllModals();
  for (const l of ['hud', 'scene', 'dialogue', 'battle', 'battlemenu', 'abinfo', 'title']) clearLayer(l);
  for (const k of SCENES) if (k !== key && game.scene.isActive(k)) game.scene.stop(k);
  game.scene.start(key, data);
}
export const toRegion = () => go('Region');
export const toWorld = () => go('World');
export const toTown = (name: string) => go('Town', { name });
export const toDungeon = (name: string, floor = 1) => go('Dungeon', { name, floor });
export const toBattle = (req: BattleReq) => go('Battle', req);
