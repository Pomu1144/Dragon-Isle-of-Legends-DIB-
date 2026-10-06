import Phaser from 'phaser';
import { data } from '../core/data';
import { setGame, go } from '../nav';
import { hideLoadingScreen } from '../ui/loading';

export const BGS = ['abyss', 'arena', 'beach', 'castle', 'cave', 'forest', 'lighthouse', 'magma', 'meadow', 'mountain', 'piratecave', 'river', 'ruins', 'sanctuary', 'snow', 'swamp', 'title', 'town', 'volcano', 'glacier', 'hell', 'graveyard', 'deepforest'];

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() {
    setGame(this.game);
    // the HTML loading screen (index.html) stays up while these load
    this.load.image('title', 'assets/bg/title.jpg');
    for (const b of BGS) this.load.image(`bg_${b}`, `assets/bg/${b}.jpg`);
    // original-game UI pieces (tools/ref_ui/slice_town_battle.py)
    for (const k of ['panel', 'panel_cards', 'hpbar', 'coin', 'qframe', 'qbar', 'orb', 'ghost'])
      this.load.image(`ui_${k}`, `assets/ui/orig/battle/${k}.png`);
    for (const k of ['bar_red', 'bar_orange', 'bar_empty', 'qbar_red', 'qbar_orange', 'coin', 'minicard', 'actor_box', 'card_tail', 'card_outrage',
      'card_flame', 'card_locked', 'info', 'btn_flee', 'btn_monsters', 'btn_scroll', 'fx_tornado', 'fx_ring', 'fx_sparkle', 'fx_silver', 'fx_web', 'fx_red',
      'fx_green', 'fx_target', 'candle_small', 'candle_tall', 'candle_double'])
      this.load.image(`bk_${k}`, `assets/ui/orig/bk/${k}.png`);
    for (const k of ['menu_m', 'leave', 'shop', 'hero', 'warp_emblem', 'emblem_house', 'house_a', 'warp_house', 'house_b', 'monsterpedia', 'monsters', 'signpost', 'trees', 'bigtree', 'bushes', 'farm', 'dock'])
      this.load.image(`town_${k}`, `assets/ui/orig/town/${k}.png`);
    // painted medallions and room tiles for map markers (tools/ref_ui/slice_buttons.py)
    for (const k of ['round_blue', 'round_gold', 'round_red', 'round_slate', 'round_green', 'round_purple', 'round_ivory', 'round_orange',
      'room_dark', 'room_lit', 'room_gold', 'room_locked', 'strip_slate']) this.load.image(`btn_${k}`, `assets/ui/btn/${k}.png`);
    // discovery markers on the region maps (tools/ref_ui/discoveries.py)
    for (const k of ['chest', 'tent', 'tower', 'lair']) this.load.image(`disc_${k}`, `assets/ui/orig/disc/${k}.png`);
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
  create() {
    go('Title');
    hideLoadingScreen();
  }
}

/** Ensure monster sprites are loaded before use. */
/**
 * Region paintings are 4K, so they are streamed in when a region is entered instead of at boot,
 * and the least recently used ones are dropped to keep GPU memory in check.
 */
const mapLru: string[] = [];
const mapLoading = new Set<string>();
export function loadMap(scene: Phaser.Scene, id: string, done: () => void) {
  const key = `map_${id}`;
  const touch = () => {
    mapLru.splice(mapLru.indexOf(key), 1);
    mapLru.push(key);
    while (mapLru.length > 3) { const old = mapLru.shift()!; if (scene.textures.exists(old)) scene.textures.remove(old); }
    done();
  };
  if (!mapLru.includes(key)) mapLru.push(key);
  if (scene.textures.exists(key)) return touch();
  // another scene is already streaming this painting (e.g. leaving town before it finished): wait for it
  if (mapLoading.has(key)) return void scene.textures.once(Phaser.Textures.Events.ADD_KEY + key, touch);
  mapLoading.add(key);
  scene.load.image(key, `assets/maps/${id}.jpg`);
  scene.load.once('complete', () => { mapLoading.delete(key); touch(); });
  scene.load.start();
}

/** The stitched world map, cut into tiles that fit in a WebGL texture (tools/stitch_world.py). */
export interface WorldLayout { width: number; height: number; tiles: { file: string; x: number; w: number }[] }
export function loadWorld(scene: Phaser.Scene, done: (lay: WorldLayout) => void) {
  const go = () => {
    const lay = scene.cache.json.get('world_layout') as WorldLayout;
    const need = lay.tiles.filter((t) => !scene.textures.exists(`wt_${t.file}`));
    if (!need.length) return done(lay);
    need.forEach((t) => scene.load.image(`wt_${t.file}`, `assets/maps/${t.file}`));
    scene.load.once('complete', () => done(lay));
    scene.load.start();
  };
  if (scene.cache.json.exists('world_layout')) return go();
  scene.load.json('world_layout', 'assets/maps/world_layout.json');
  scene.load.once('complete', go);
  scene.load.start();
}

export function loadSprites(scene: Phaser.Scene, files: string[], done: () => void) {
  const need = [...new Set(files)].filter((f) => !scene.textures.exists(`spr_${f}`));
  if (!need.length) return done();
  need.forEach((f) => scene.load.image(`spr_${f}`, `assets/sprites/${f}`));
  scene.load.once('complete', done);
  scene.load.start();
}
