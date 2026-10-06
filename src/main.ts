import Phaser from 'phaser';
import './style.css';
import { loadData } from './core/data';
import { BootScene } from './scenes/Boot';
import { TitleScene } from './scenes/Title';
import { WorldScene } from './scenes/World';
import { RegionScene } from './scenes/Region';
import { BattleScene } from './scenes/Battle';
import { TownScene } from './scenes/Town';
import { DungeonScene } from './scenes/Dungeon';
import { loadingMessage } from './ui/loading';
import * as nav from './nav';
import * as state from './core/state';
import * as enc from './core/encounters';
import * as flow from './flow';
import * as menus from './ui/menus';
import * as dom from './ui/dom';

async function start() {
  try {
    await loadData();
  } catch (e) {
    loadingMessage('Could not load the game data. Please check your connection and reload.');
    throw e;
  }
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 1280,
    height: 720,
    backgroundColor: '#0b1020',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, pixelArt: false },
    scene: [BootScene, TitleScene, WorldScene, RegionScene, BattleScene, TownScene, DungeonScene],
  });
  if (import.meta.env.DEV) Object.assign(window as any, { __game: game, __nav: nav, __state: state, __enc: enc, __flow: flow, __menus: menus, __dom: dom });
}
start();
