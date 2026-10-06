import Phaser from 'phaser';
import { data } from '../core/data';
import { setGame, go } from '../nav';

export const BGS = ['abyss', 'arena', 'beach', 'castle', 'cave', 'forest', 'lighthouse', 'magma', 'meadow', 'mountain', 'piratecave', 'river', 'ruins', 'sanctuary', 'snow', 'swamp', 'title', 'town', 'volcano'];

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() {
    setGame(this.game);
    const { width, height } = this.scale;
    const bar = this.add.rectangle(width / 2 - 300, height / 2 + 40, 4, 14, 0xf6c453).setOrigin(0, 0.5);
    this.add.rectangle(width / 2, height / 2 + 40, 604, 18).setStrokeStyle(2, 0xf6c453, 0.6);
    this.add.text(width / 2, height / 2 - 20, 'DRAGON ISLE OF LEGENDS', { fontFamily: 'Cinzel, serif', fontSize: '40px', color: '#ffe2a0' }).setOrigin(0.5);
    this.load.on('progress', (p: number) => (bar.width = 600 * p));
    this.load.image('title', 'assets/bg/title.jpg');
    this.load.image('world', 'assets/maps/world.jpg');
    for (const r of data().regions) this.load.image(`map_${r.id}`, `assets/maps/${r.id}.jpg`);
    for (const b of BGS) this.load.image(`bg_${b}`, `assets/bg/${b}.jpg`);
    // original-game UI pieces (tools/ref_ui/slice_town_battle.py)
    for (const k of ['panel', 'panel_cards', 'hpbar', 'coin', 'qframe', 'qbar', 'orb', 'ghost'])
      this.load.image(`ui_${k}`, `assets/ui/orig/battle/${k}.png`);
    for (const k of ['bar_red', 'bar_orange', 'bar_empty', 'qbar_red', 'qbar_orange', 'coin', 'minicard', 'actor_box', 'card_tail', 'card_outrage',
      'card_flame', 'card_locked', 'info', 'btn_flee', 'btn_monsters', 'btn_scroll', 'fx_tornado', 'fx_ring', 'fx_sparkle', 'fx_silver', 'fx_web', 'fx_red',
      'fx_green', 'fx_target', 'candle_small', 'candle_tall', 'candle_double'])
      this.load.image(`bk_${k}`, `assets/ui/orig/bk/${k}.png`);
    for (const k of ['menu_m', 'leave', 'shop', 'hero', 'warp_emblem', 'emblem_house', 'house_a', 'warp_house', 'house_b', 'monsterpedia', 'monsters', 'signpost', 'trees', 'bigtree', 'bushes', 'farm'])
      this.load.image(`town_${k}`, `assets/ui/orig/town/${k}.png`);
    // soft particle textures
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    for (let r = 16; r > 0; r--) { g.fillStyle(0xffffff, (1 - r / 16) * 0.25); g.fillCircle(16, 16, r); }
    g.generateTexture('glow', 32, 32);
    g.clear();
    g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 4);
    g.generateTexture('dot', 8, 8);
    g.clear();
    g.fillStyle(0xffffff, 1); g.fillTriangle(6, 0, 12, 12, 0, 12);
    g.generateTexture('spark', 12, 12);
    g.destroy();
  }
  create() { go('Title'); }
}

/** Ensure monster sprites are loaded before use. */
export function loadSprites(scene: Phaser.Scene, files: string[], done: () => void) {
  const need = [...new Set(files)].filter((f) => !scene.textures.exists(`spr_${f}`));
  if (!need.length) return done();
  need.forEach((f) => scene.load.image(`spr_${f}`, `assets/sprites/${f}`));
  scene.load.once('complete', done);
  scene.load.start();
}
