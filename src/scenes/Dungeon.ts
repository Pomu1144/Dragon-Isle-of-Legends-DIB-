import Phaser from 'phaser';
import { data, dungeon as dungeonData, maps, regionByName, regionPool, species, speciesByName } from '../core/data';
import { S, save, rollGem, hash, heroLevel } from '../core/state';
import { dungeonEncounter, dungeonBoss, FINALE } from '../core/encounters';
import type { Species } from '../core/types';
import { hud, openMenu } from '../ui/menus';
import { h, layer, toast, dialogue, anyModal } from '../ui/dom';
import { music, sfx } from '../audio';
import { toDungeon, toRegion } from '../nav';
import { fight } from '../flow';
import { Rng } from '../core/rng';
import { loadSprites } from './Boot';

type Room = { id: number; gx: number; gy: number; kind: 'start' | 'battle' | 'chest' | 'empty' | 'stairs' | 'boss'; done: boolean };
type Prefab = 'room_a' | 'room_b' | 'room_tall' | 'room_wide';
/** Per prefab (public/assets/dungeon/layout.json): the interior inside the rim, the back wall's share of it, and the floor grid. */
type PrefabInfo = { w: number; h: number; inner: [number, number, number, number]; wallFrac: number; cells: [number, number] };
type Pt = { x: number; y: number };
/** A room as drawn: world rect, the flagstone floor inside it and the props standing on it. */
interface View {
  room: Room; img: Phaser.GameObjects.Image; x: number; y: number; w: number; h: number;
  inner: Phaser.Geom.Rectangle; floor: Phaser.Geom.Rectangle; cols: number; rows: number;
  props: { mon?: Phaser.GameObjects.Image; chest?: Phaser.GameObjects.Image; stairs?: Phaser.GameObjects.Image; portal?: Phaser.GameObjects.Image };
  pulse?: Phaser.Tweens.Tween;
}

const COLS = 5, ROWS = 3;
const TILE = 88;   // on-screen size of a floor flagstone, as in the original (about an eighth of the screen height)
const GAP = 16;    // rim to rim length of a corridor
const SPEED = 430; // hero walking speed, px/s
const ART = ['room_a', 'room_b', 'room_tall', 'room_wide', 'hero', 'portal', 'chest', 'stairs'];
const DIM = 0x5c5c5c;
// rooms cleared on the current visit survive battles (scene restarts)
let visit: { key: string; rooms: Room[]; at: number } | null = null;

export class DungeonScene extends Phaser.Scene {
  constructor() { super('Dungeon'); }
  private name = '';
  private floor = 1;
  private views = new Map<number, View>();
  private hero!: Phaser.GameObjects.Container;
  private heroImg!: Phaser.GameObjects.Image;
  private moving = false;
  private drag = { on: false, moved: false, x: 0, y: 0, sx: 0, sy: 0 };
  init(d: { name: string; floor: number }) { this.name = d.name; this.floor = d.floor; }

  preload() {
    // streamed in on the first visit instead of at boot; already-loaded keys are skipped
    this.load.json('dun_layout', 'assets/dungeon/layout.json');
    for (const k of ART) this.load.image(`dun_${k}`, `assets/dungeon/${k}.png`);
    this.load.image('dun_floor', 'assets/dungeon/floor_tile.png');
  }

  layout(): Room[] {
    const r = new Rng(hash(`${this.name}:${this.floor}`));
    const d = dungeonData(this.name)!;
    const last = this.floor >= d.floors;
    const hasBoss = !!dungeonBoss(this.name, this.floor, new Rng(1));
    const rooms: Room[] = [];
    let id = 0;
    for (let gx = 0; gx < COLS; gx++) for (let gy = 0; gy < ROWS; gy++) {
      // the middle row is never left out, so every room (and the stairs) can be reached from the start
      if (gx > 0 && gx < COLS - 1 && gy !== 1 && r.chance(0.18)) continue;
      const kind: Room['kind'] = r.chance(0.55) ? 'battle' : r.chance(0.35) ? 'chest' : 'empty';
      rooms.push({ id: id++, gx, gy, kind, done: false });
    }
    const start = rooms.find((x) => x.gx === 0 && x.gy === 1) ?? rooms[0];
    start.kind = 'start';
    start.done = true;
    // stairs send you down as soon as you step in, so the guardian and the stairs are put in far-column rooms you can
    // walk into straight from the column before; failing that the stairs go behind the guardian
    const far = rooms.filter((x) => x.gx === COLS - 1);
    const open = far.filter((x) => rooms.some((o) => o.gx === COLS - 2 && o.gy === x.gy));
    const end = open[r.int(0, open.length - 1)];
    // the Unknown Relic's last floor keeps its stairs: they lead down into the Underworld (see descend)
    end.kind = hasBoss ? 'boss' : last && this.name !== 'Unknown Relic' ? 'empty' : 'stairs';
    if (hasBoss && !last) {
      const st = open.find((x) => x !== end) ?? far.find((x) => x !== end)!;
      st.kind = 'stairs';
    }
    return rooms;
  }

  create() {
    music('dungeon');
    this.views.clear();
    this.moving = false;
    this.cameras.main.setBackgroundColor(0x000000);
    const key = `${this.name}:${this.floor}`;
    if (!visit || visit.key !== key) visit = { key, rooms: this.layout(), at: -1 };
    const rec = (S.dungeons[this.name] ??= { best: 1, cleared: false });
    if (this.floor > rec.best) { rec.best = this.floor; save(); }
    if (visit.at < 0) visit.at = visit.rooms.find((x) => x.kind === 'start')!.id;
    const sprites = visit.rooms.filter((r) => !r.done && (r.kind === 'battle' || r.kind === 'boss')).map((r) => this.monsterOf(r).sprite);
    loadSprites(this, sprites, () => this.build());
  }

  /** The monster standing in a battle room: picked per room from the dungeon's list, so it is stable across visits. */
  monsterOf(r: Room): Species {
    if (r.kind === 'boss') return species(dungeonBoss(this.name, this.floor, new Rng(1))!.team[0].species);
    const d = dungeonData(this.name)!;
    let pool = d.monsters.map((n) => speciesByName(n)).filter(Boolean) as Species[];
    const reg = regionByName(d.region);
    if (pool.length < 4 && reg) pool = pool.concat(regionPool(reg));
    return this.roll(r, 'monster').pick(pool);
  }

  /** A generator seeded per room, so shapes, mirroring and monsters stay the same across visits and battles. */
  private roll(r: Room, what: string) { return new Rng(hash(`${this.name}:${this.floor}:${r.id}:${what}`)); }

  prefab(r: Room): Prefab {
    if (r.kind === 'boss') return 'room_wide';
    if (r.kind === 'stairs') return 'room_tall';
    return this.roll(r, 'shape').pick(r.kind === 'battle' ? ['room_a', 'room_b', 'room_tall'] : ['room_a', 'room_b']);
  }

  private build() {
    const L = this.cache.json.get('dun_layout') as Record<Prefab, PrefabInfo>;
    const rooms = visit!.rooms;
    // every prefab is scaled so its flagstones come out TILE px
    const size = new Map<number, { p: Prefab; s: number; w: number; h: number }>();
    for (const r of rooms) {
      const p = this.prefab(r), info = L[p];
      const [x0, y0, x1, y1] = info.inner;
      const cw = ((x1 - x0) * info.w) / info.cells[0], ch = ((y1 - y0) * info.h * (1 - info.wallFrac)) / info.cells[1];
      const s = TILE / Math.sqrt(cw * ch);
      size.set(r.id, { p, s, w: info.w * s, h: info.h * s });
    }
    const colW = Array.from({ length: COLS }, (_, i) => Math.max(260, ...rooms.filter((r) => r.gx === i).map((r) => size.get(r.id)!.w)));
    const colX = colW.map((_, i) => colW.slice(0, i).reduce((a, b) => a + b + GAP, 0));
    const tops = this.stack(rooms, (r) => size.get(r.id)!.h);
    const worldW = colX[COLS - 1] + colW[COLS - 1], worldH = Math.max(...rooms.map((r) => tops.get(r.id)! + size.get(r.id)!.h));

    for (const r of rooms) {
      const { p, s, w, h: hh } = size.get(r.id)!;
      const info = L[p];
      // columns are a table; the outer ones hug their inner neighbour so the wide guardian hall keeps its corridor short
      const x = r.gx === 0 ? colX[0] + colW[0] - w : r.gx === COLS - 1 ? colX[r.gx] : colX[r.gx] + (colW[r.gx] - w) / 2;
      const y = tops.get(r.id)!;
      // half the rooms are mirrored so candles, doorways and fossils don't repeat
      const flip = this.roll(r, 'flip').chance(0.5);
      const img = this.add.image(x + w / 2, y + hh / 2, `dun_${p}`).setScale(s).setFlipX(flip).setDepth(2);
      const [ix0, iy0, ix1, iy1] = flip ? [1 - info.inner[2], info.inner[1], 1 - info.inner[0], info.inner[3]] : info.inner;
      const inner = new Phaser.Geom.Rectangle(x + ix0 * w, y + iy0 * hh, (ix1 - ix0) * w, (iy1 - iy0) * hh);
      const wall = inner.height * info.wallFrac;
      const floor = new Phaser.Geom.Rectangle(inner.x, inner.y + wall, inner.width, inner.height - wall);
      const v: View = { room: r, img, x, y, w, h: hh, inner, floor, cols: info.cells[0], rows: info.cells[1], props: {} };
      this.views.set(r.id, v);
      this.furnish(v);
      img.setInteractive({ useHandCursor: true }).on('pointerup', () => { if (!this.drag.moved) this.tap(r); });
    }
    for (const a of rooms) for (const b of rooms) if (a.id < b.id && this.adj(a, b)) this.corridor(this.views.get(a.id)!, this.views.get(b.id)!);

    // the hero: a small figure standing on the floor of the current room, breathing gently
    const cur = this.views.get(visit!.at)!;
    const spot = this.spot(cur);
    this.heroImg = this.add.image(0, 0, 'dun_hero').setOrigin(0.5, 0.96);
    this.heroImg.setScale((TILE * 0.66) / this.heroImg.height);
    this.hero = this.add.container(spot.x, spot.y, [this.heroImg]).setDepth(10);
    this.tweens.add({ targets: this.heroImg, y: -2.5, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    // the floor is a world bigger than the screen: the camera follows the hero and the player can drag it around
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    cam.setBounds(-width * 0.42, -height * 0.4, worldW + width * 0.84, worldH + height * 0.8);
    cam.centerOn(spot.x, spot.y);
    cam.startFollow(this.hero, false, 0.08, 0.08);
    cam.fadeIn(300);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { this.drag = { on: true, moved: false, x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY }; });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag.on || !p.isDown || anyModal()) return;
      const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 8) return;
      this.drag.moved = true;
      cam.stopFollow();
      cam.setScroll(this.drag.sx - dx, this.drag.sy - dy);
    });
    this.input.on('pointerup', () => { this.drag.on = false; });
    this.refresh();
  }

  /**
   * Room tops: each column stacks its rooms GAP apart, so corridors stay as short as the original's whatever mix of
   * square and tall rooms it holds; then rooms are nudged down until they overlap their side neighbours by enough
   * to fit a corridor between them.
   */
  private stack(rooms: Room[], hOf: (r: Room) => number) {
    const top = new Map<number, number>();
    const at = (gx: number, gy: number) => rooms.find((r) => r.gx === gx && r.gy === gy);
    const MIN = TILE * 1.7;
    for (let gy = 0; gy < ROWS; gy++) {
      const row = rooms.filter((r) => r.gy === gy).sort((a, b) => a.gx - b.gx);
      const above = (r: Room) => rooms.filter((o) => o.gx === r.gx && o.gy < r.gy).map((o) => top.get(o.id)! + hOf(o) + GAP);
      const want = row.filter((r) => at(r.gx, gy - 1)).map((r) => Math.max(...above(r)));
      const base = want.length ? Math.min(...want) : Math.max(0, ...rooms.filter((o) => o.gy < gy).map((o) => top.get(o.id)! + hOf(o) + GAP));
      const tall = Math.max(...row.map(hOf));
      for (const r of row) top.set(r.id, gy === 0 ? tall - hOf(r) : Math.max(base, ...above(r)));
      for (let k = 0; k < 4; k++) for (const r of row) {
        const n = at(r.gx + 1, gy);
        if (!n) continue;
        const a = top.get(r.id)!, b = top.get(n.id)!;
        const short = MIN - (Math.min(a + hOf(r), b + hOf(n)) - Math.max(a, b));
        if (short > 0) top.set(a < b ? r.id : n.id, Math.min(a, b) + short);
      }
    }
    return top;
  }

  /** Monsters, the chest, the stairs and the portal stand on the room's flagstones. */
  private furnish(v: View) {
    const r = v.room, F = v.floor;
    const cell = (i: number, j: number) => ({ x: F.x + ((i + 0.5) * F.width) / v.cols, y: F.y + ((j + 0.5) * F.height) / v.rows });
    const put = (key: string, x: number, y: number, maxW: number, maxH: number, oy = 0.5) => {
      const im = this.add.image(x, y, key).setOrigin(0.5, oy);
      im.setScale(Math.min(maxW / im.width, maxH / im.height)).setDepth(3 + y / 1e5);
      return im;
    };
    if (r.kind === 'battle' || r.kind === 'boss') {
      const boss = r.kind === 'boss';
      const m = put(`spr_${this.monsterOf(r).sprite}`, F.centerX, F.y + F.height * (boss ? 0.8 : 0.66), TILE * (boss ? 2.7 : 1.5), TILE * (boss ? 1.75 : 1.3), 0.94);
      if (boss) {
        // guardians are outlined in red, like the boss in the original's Pirate's Cave
        m.preFX?.setPadding(12);
        const glow = m.preFX?.addGlow(0xff2412, 2, 0, false, 0.1, 8);
        if (glow) this.tweens.add({ targets: glow, outerStrength: 3.4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      }
      v.props.mon = m;
    }
    if (r.kind === 'chest') {
      const c = cell(v.cols - 1, v.rows - 1);
      v.props.chest = put('dun_chest', c.x, c.y, TILE * 0.8, TILE * 0.8);
    }
    if (r.kind === 'stairs') {
      const s = cell(0, 0), p = cell(v.cols - 1, v.rows - 1);
      v.props.stairs = put('dun_stairs', s.x, s.y, TILE * 0.68, TILE * 0.68);
      v.props.portal = put('dun_portal', p.x, p.y, TILE * 0.95, TILE * 0.95);
      this.tweens.add({ targets: v.props.portal, angle: 360, duration: 14000, repeat: -1 });
    }
  }

  /** A short straight passage one flagstone wide, tucked under both rims and centred on the walls that face each other. */
  private corridor(a: View, b: View) {
    const horiz = a.room.gy === b.room.gy;
    const [p, q] = (horiz ? a.x < b.x : a.y < b.y) ? [a, b] : [b, a];
    const tuck = TILE * 0.3;
    let x: number, y: number, w: number, hh: number;
    if (horiz) {
      const c = (Math.max(p.y, q.y) + Math.min(p.y + p.h, q.y + q.h)) / 2;
      x = p.x + p.w - tuck; w = q.x + tuck - x; y = c - TILE / 2; hh = TILE;
    } else {
      const c = (Math.max(p.x, q.x) + Math.min(p.x + p.w, q.x + q.w)) / 2;
      y = p.y + p.h - tuck; hh = q.y + tuck - y; x = c - TILE / 2; w = TILE;
    }
    this.add.tileSprite(x, y, w, hh, 'dun_floor').setOrigin(0).setTileScale(TILE / 144).setDepth(1);
    // darker edges along both walls of the passage
    const g = this.add.graphics().setDepth(1.1);
    g.fillStyle(0x000000, 0.18).fillRect(x, y, w, hh);
    for (const [d, al] of [[TILE * 0.16, 0.22], [TILE * 0.07, 0.45]] as const) {
      g.fillStyle(0x000000, al);
      if (horiz) { g.fillRect(x, y, w, d); g.fillRect(x, y + hh - d, w, d); } else { g.fillRect(x, y, d, hh); g.fillRect(x + w - d, y, d, hh); }
    }
  }

  adj(a: Room, b: Room) { return Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy) === 1; }
  private cur() { return visit!.rooms.find((x) => x.id === visit!.at)!; }

  /** Where the hero stands in a room: just in front of the back wall, in the middle. */
  private spot(v: View): Pt { return { x: v.floor.centerX, y: v.floor.y + Math.min(v.floor.height * 0.42, TILE * 0.72) }; }

  /** The point where a corridor meets a room's interior. */
  private mouth(v: View, to: View): Pt {
    const I = v.inner;
    if (v.room.gy === to.room.gy) {
      const top = Math.max(v.y, to.y), bot = Math.min(v.y + v.h, to.y + to.h);
      return { x: to.x > v.x ? I.right : I.x, y: Phaser.Math.Clamp((top + bot) / 2, v.floor.y + TILE * 0.35, v.floor.bottom - 4) };
    }
    const l = Math.max(v.x, to.x), r = Math.min(v.x + v.w, to.x + to.w);
    return { x: (l + r) / 2, y: to.y > v.y ? I.bottom : I.y };
  }

  tap(r: Room) {
    if (this.moving || anyModal()) return;
    const cur = this.cur();
    if (r === cur) return this.enter(r);
    if (!this.adj(r, cur)) return;
    const a = this.views.get(cur.id)!, b = this.views.get(r.id)!;
    const out = this.mouth(a, b), inn = this.mouth(b, a);
    // into a room still holding a monster the hero only steps through the doorway before the fight starts
    const t = Phaser.Math.Angle.Between(inn.x, inn.y, b.floor.centerX, b.floor.centerY);
    const end = !r.done && (r.kind === 'battle' || r.kind === 'boss') ? { x: inn.x + Math.cos(t) * TILE * 0.4, y: inn.y + Math.sin(t) * TILE * 0.4 } : this.spot(b);
    this.walk([out, inn, end], () => this.enter(r));
  }

  private walk(path: Pt[], done: () => void) {
    this.moving = true;
    this.cameras.main.startFollow(this.hero, false, 0.08, 0.08);
    const sway = this.tweens.add({ targets: this.heroImg, angle: { from: -5, to: 5 }, duration: 170, yoyo: true, repeat: -1 });
    sfx('step');
    const step = (i: number) => {
      if (i >= path.length) {
        sway.stop();
        this.heroImg.setAngle(0);
        this.moving = false;
        return done();
      }
      const p = path[i];
      const d = Phaser.Math.Distance.Between(this.hero.x, this.hero.y, p.x, p.y);
      if (Math.abs(p.x - this.hero.x) > 2) this.heroImg.setFlipX(p.x < this.hero.x);
      this.tweens.add({ targets: this.hero, x: p.x, y: p.y, duration: Math.max(60, (d / SPEED) * 1000), ease: i === path.length - 1 ? 'Sine.out' : 'Linear', onComplete: () => step(i + 1) });
    };
    step(0);
  }

  /** Brightness, highlights and props follow the visit; the HUD is redrawn. */
  refresh() {
    if (!this.views.size) return;
    const cur = this.cur();
    const boss = visit!.rooms.find((x) => x.kind === 'boss');
    for (const v of this.views.values()) {
      const r = v.room, here = r === cur, near = this.adj(r, cur);
      const show = (o: Phaser.GameObjects.Image | undefined, on: boolean) => o?.setVisible(on || (!!o.getData('leaving') && o.alpha > 0));
      show(v.props.mon, !r.done);
      show(v.props.chest, !r.done);
      show(v.props.portal, !boss || boss.done);
      // unexplored rooms are in shadow; the ones you can walk to now are lit with a soft warm glow
      const lit = r.done || here || near;
      for (const o of [v.img, ...Object.values(v.props)]) o?.setTint(lit ? 0xffffff : DIM);
      if (r.kind === 'boss') v.props.mon?.setTint(lit ? 0xffcfc4 : 0x5c4844);
      v.pulse?.remove();
      v.pulse = undefined;
      v.img.preFX?.clear();
      if (near && v.img.preFX) {
        v.img.preFX.setPadding(14);
        const glow = v.img.preFX.addGlow(0xffdf9a, 0.4, 0, false, 0.1, 10);
        v.pulse = this.tweens.add({ targets: glow, outerStrength: 1.7, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      }
      v.img.input!.cursor = near || here ? 'pointer' : 'default';
    }
    this.ui();
  }

  ui() {
    const d = dungeonData(this.name)!;
    const refresh = () => this.refresh();
    const bar = hud((k) => openMenu(k, refresh), [h('button', { class: 'btn small red dun-leave', onClick: () => { visit = null; toRegion(); } }, 'Leave dungeon')]);
    bar.classList.add('dun');
    const challenge = d.captureChallenge.map((n) => speciesByName(n)).filter(Boolean) as Species[];
    // waypoints (where the next visit can resume) are floors 1, 6, 11, …
    const next = Math.floor((this.floor - 1) / 5) * 5 + 6;
    layer('scene', h('div', { class: 'dun-ui' },
      challenge.length ? h('div', { class: 'dun-caught' }, `Caught ${challenge.filter((s) => S.caught.includes(s.id)).length}/${challenge.length}`) : null,
      h('div', { class: 'dun-plaque' }, h('span', { class: this.name.length > 16 ? 'long' : '' }, `Lv:${this.floor} ${this.name}`)),
      this.floor < d.floors && next <= d.floors ? h('div', { class: 'dun-bonus' }, h('span', {}, `Next bonus at floor: ${next}`)) : null,
      h('div', { class: 'dun-lv' }, h('span', {}, `Lv ${heroLevel()}`))));
  }

  enter(r: Room) {
    sfx('step');
    visit!.at = r.id;
    if (r.done) { this.refresh(); if (r.kind === 'stairs') this.descend(); return; }
    switch (r.kind) {
      case 'battle': {
        const enc = dungeonEncounter(this.name, this.floor);
        enc.team[0].species = this.monsterOf(r).id; // the monster you saw in the room leads the pack
        fight(enc, () => { r.done = true; toDungeon(this.name, this.floor); });
        break;
      }
      case 'chest': {
        r.done = true;
        const chest = this.views.get(r.id)?.props.chest;
        if (chest) {
          chest.setData('leaving', true);
          this.tweens.add({ targets: chest, alpha: 0, scale: chest.scale * 1.3, y: chest.y - 10, duration: 420, ease: 'Sine.in', onComplete: () => chest.setVisible(false) });
        }
        const rng = new Rng();
        if (this.name === 'The Abyss' || rng.chance(0.2)) {
          const g = rollGem(this.floor > 30 ? 'Star' : this.floor > 15 ? 'Tear' : this.floor > 6 ? 'Square' : 'Oval', rng.chance(0.3));
          S.gems.push(g);
          toast(`🎁 Found a ${g.shape} gem!`);
        } else if (rng.chance(0.15)) { S.items.silver += 1; toast('🎁 Found a Silver Card!'); }
        else { const s = 80 + this.floor * 40; S.silver += s; toast(`🎁 Found ${s} silver!`); }
        sfx('coin');
        save();
        this.refresh();
        break;
      }
      case 'stairs':
        r.done = true;
        this.descend();
        break;
      case 'boss': {
        this.refresh();
        const enc = dungeonBoss(this.name, this.floor)!;
        dialogue([{ who: enc.name, text: enc.intro ?? 'You will go no further!' }]).then(() => fight(enc, (res) => {
          if (res.outcome === 0) {
            r.done = true;
            const d = dungeonData(this.name)!;
            if (this.name === 'Sanctuary' && this.floor === FINALE.length && !S.ending) return this.ending();
            if (this.floor >= d.floors) { S.dungeons[this.name].cleared = true; save(); toast(`🏆 ${this.name} cleared!`); }
          }
          toDungeon(this.name, this.floor);
        }));
        break;
      }
      default:
        r.done = true;
        this.refresh();
    }
  }

  descend() {
    const d = dungeonData(this.name)!;
    if (this.name === 'Unknown Relic' && this.floor >= d.floors) {
      // as in the original, the Unknown Relic's last stairs lead down into the Underworld
      const m = maps()['underworld'];
      S.location = { region: 'underworld', spot: (m.spots.find((s) => s.kind === 'dungeon' && s.ref === 'Ruins') ?? m.spots[0]).id };
      if (!S.visited.includes('underworld')) S.visited.push('underworld');
      save();
      visit = null;
      toast('The stairs lead down into the Underworld…');
      this.cameras.main.fadeOut(500);
      this.cameras.main.once('camerafadeoutcomplete', () => toRegion());
      return;
    }
    if (this.floor >= d.floors) { toast('This is the deepest floor.'); return; }
    visit = null;
    this.cameras.main.fadeOut(300);
    this.cameras.main.once('camerafadeoutcomplete', () => toDungeon(this.name, this.floor + 1));
  }

  async ending() {
    S.ending = true;
    save();
    music('title');
    await dialogue([
      { who: 'Caius', text: 'Impossible… the Sanctuary has fallen to a single breeder?' },
      { who: 'Old Sage', text: `You did it, ${S.hero}. The plot against Olympia is crushed, and every breeder on Dragon Island will know your name.` },
      { who: 'Old Sage', text: 'Yet the island still hides secrets — the Unknown Relic in Swinedene has unsealed, and the Abyss beneath Wesburn has no bottom…' },
      { who: '', text: `★ THE END ★  — You are a Legend of Dragon Isle. (${S.caught.length}/${data().monsters.length} monsters caught, ${S.overlords.length}/12 Overlords defeated)` },
    ]);
    toRegion();
  }
}
