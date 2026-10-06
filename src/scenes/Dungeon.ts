import Phaser from 'phaser';
import { coverBg, vignette, ambient } from './fx';
import { data, dungeon as dungeonData, maps } from '../core/data';
import { S, save, rollGem, hash } from '../core/state';
import { dungeonEncounter, dungeonBoss, FINALE } from '../core/encounters';
import { hud, openMenu } from '../ui/menus';
import { h, layer, toast, dialogue } from '../ui/dom';
import { music, sfx } from '../audio';
import { toDungeon, toRegion } from '../nav';
import { fight } from '../flow';
import { Rng } from '../core/rng';

type Room = { id: number; gx: number; gy: number; kind: 'start' | 'battle' | 'chest' | 'empty' | 'stairs' | 'boss'; done: boolean };

const COLS = 5, ROWS = 3;
// rooms cleared on the current visit survive battles (scene restarts)
let visit: { key: string; rooms: Room[]; at: number } | null = null;

export class DungeonScene extends Phaser.Scene {
  constructor() { super('Dungeon'); }
  private name = '';
  private floor = 1;
  init(d: { name: string; floor: number }) { this.name = d.name; this.floor = d.floor; }

  layout(): Room[] {
    const r = new Rng(hash(`${this.name}:${this.floor}`));
    const d = dungeonData(this.name)!;
    const last = this.floor >= d.floors;
    const hasBoss = !!dungeonBoss(this.name, this.floor, new Rng(1));
    const rooms: Room[] = [];
    let id = 0;
    for (let gx = 0; gx < COLS; gx++) for (let gy = 0; gy < ROWS; gy++) {
      if (gx > 0 && gx < COLS - 1 && r.chance(0.18)) continue;
      const kind: Room['kind'] = r.chance(0.55) ? 'battle' : r.chance(0.35) ? 'chest' : 'empty';
      rooms.push({ id: id++, gx, gy, kind, done: false });
    }
    const start = rooms.find((x) => x.gx === 0 && x.gy === 1) ?? rooms[0];
    start.kind = 'start';
    start.done = true;
    const end = rooms.filter((x) => x.gx === COLS - 1)[r.int(0, rooms.filter((x) => x.gx === COLS - 1).length - 1)];
    end.kind = hasBoss ? 'boss' : last ? 'empty' : 'stairs';
    if (hasBoss && !last) {
      const st = rooms.find((x) => x.gx === COLS - 1 && x !== end) ?? rooms.find((x) => x.gx === COLS - 2)!;
      st.kind = 'stairs';
    }
    return rooms;
  }

  create() {
    const d = dungeonData(this.name)!;
    music('dungeon');
    coverBg(this, `bg_${d.bg}`);
    this.add.rectangle(640, 360, 1280, 720, 0x000000, 0.45);
    ambient(this, 0x9fb8ff, 16);
    vignette(this, 0.7);
    this.cameras.main.fadeIn(300);
    const key = `${this.name}:${this.floor}`;
    if (!visit || visit.key !== key) visit = { key, rooms: this.layout(), at: 0 };
    const rec = (S.dungeons[this.name] ??= { best: 1, cleared: false });
    if (this.floor > rec.best) { rec.best = this.floor; save(); }
    if (visit.at === 0) visit.at = visit.rooms.find((x) => x.kind === 'start')!.id;
    this.draw();
  }

  pos(r: Room) { return { x: 200 + r.gx * 220, y: 200 + r.gy * 150 }; }
  adj(a: Room, b: Room) { return Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy) === 1; }

  draw() {
    this.children.list.filter((o) => (o as any).__room).forEach((o) => o.destroy());
    const rooms = visit!.rooms;
    const cur = rooms.find((x) => x.id === visit!.at)!;
    const g = this.add.graphics().setDepth(2);
    (g as any).__room = true;
    // corridors are bronze-edged passages, like the kit's frames
    for (const a of rooms) for (const b of rooms) if (a.id < b.id && this.adj(a, b)) {
      const pa = this.pos(a), pb = this.pos(b);
      g.lineStyle(18, 0x2a1a0c, 0.95).lineBetween(pa.x, pa.y, pb.x, pb.y);
      g.lineStyle(12, 0x9a6a34, 1).lineBetween(pa.x, pa.y, pb.x, pb.y);
      g.lineStyle(6, 0x3b3328, 1).lineBetween(pa.x, pa.y, pb.x, pb.y);
    }
    // rooms are painted stone tiles: gold-lit where you stand, lit once explored or reachable, dark otherwise
    const art: Partial<Record<Room['kind'], string>> = { chest: 'disc_chest', boss: 'disc_lair' };
    const glyph: Record<Room['kind'], string> = { start: '⌂', battle: '⚔', chest: '', empty: '', stairs: '▼', boss: '' };
    const T = 112;
    for (const r of rooms) {
      const p = this.pos(r);
      const reachable = this.adj(r, cur);
      const here = r === cur;
      const key = here ? 'btn_room_gold' : r.done || reachable ? 'btn_room_lit' : 'btn_room_dark';
      const tile = this.add.image(p.x, p.y, key).setDisplaySize(T, T).setDepth(3);
      (tile as any).__room = true;
      if (!here && !reachable && r.done) tile.setTint(0xb8b0a0);
      const cleared = r.done && r.kind !== 'stairs' && r.kind !== 'boss';
      const pic = cleared ? undefined : art[r.kind];
      if (pic) {
        const src = this.textures.get(pic).getSourceImage();
        const im = this.add.image(p.x, p.y + 4, pic).setScale(70 / Math.max(src.width, src.height)).setDepth(4);
        (im as any).__room = true;
      }
      const show = cleared ? (r.kind === 'start' ? '⌂' : '✓') : glyph[r.kind];
      if (show) {
        const t = this.add.text(p.x, p.y, show, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold', fontSize: cleared ? '30px' : '40px',
          color: r.kind === 'battle' && !cleared ? '#ffdfd0' : '#fff2c8', stroke: '#1a0e04', strokeThickness: 6 }).setOrigin(0.5).setDepth(4);
        if (cleared) t.setAlpha(0.7);
        (t as any).__room = true;
      }
      if (reachable || here) tile.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.enter(r));
      if (reachable) this.tweens.add({ targets: tile, alpha: 0.78, duration: 700, yoyo: true, repeat: -1 });
    }
    const refresh = () => this.draw();
    hud((k) => openMenu(k, refresh), [h('button', { class: 'btn small red', onClick: () => { visit = null; toRegion(); } }, '⬆ Leave dungeon')]);
    const d = dungeonData(this.name)!;
    layer('scene', h('div', {},
      h('div', { class: 'region-title' }, h('h2', {}, this.name), h('div', {}, `Floor ${this.floor}${d.floors < 999 ? ` / ${d.floors}` : ''}${this.floor % 5 === 1 && this.floor > 1 ? ' · Waypoint' : ''}`)),
      h('div', { class: 'region-info panel' }, h('b', {}, 'Dungeon'), h('div', { class: 'muted' }, 'Tap a glowing room next to you. ⚔ battles, a chest holds treasure, ▼ stairs lead down, the lair hides the guardian. Waypoints every 5 floors let you resume deeper next time.'))));
  }

  enter(r: Room) {
    sfx('step');
    visit!.at = r.id;
    if (r.done) { this.draw(); if (r.kind === 'stairs') this.descend(); return; }
    switch (r.kind) {
      case 'battle': {
        const enc = dungeonEncounter(this.name, this.floor);
        fight(enc, () => { r.done = true; toDungeon(this.name, this.floor); });
        break;
      }
      case 'chest': {
        r.done = true;
        const rng = new Rng();
        if (this.name === 'The Abyss' || rng.chance(0.2)) {
          const g = rollGem(this.floor > 30 ? 'Star' : this.floor > 15 ? 'Tear' : this.floor > 6 ? 'Square' : 'Oval', rng.chance(0.3));
          S.gems.push(g);
          toast(`🎁 Found a ${g.shape} gem!`);
        } else if (rng.chance(0.15)) { S.items.silver += 1; toast('🎁 Found a Silver Card!'); }
        else { const s = 80 + this.floor * 40; S.silver += s; toast(`🎁 Found ${s} silver!`); }
        sfx('coin');
        save();
        this.draw();
        break;
      }
      case 'stairs':
        r.done = true;
        this.descend();
        break;
      case 'boss': {
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
        this.draw();
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
