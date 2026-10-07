import Phaser from 'phaser';
import { data, maps } from '../core/data';
import { S, save } from '../core/state';
import type { Region } from '../core/types';
import { hud, openMenu } from '../ui/menus';
import { h, layer, toast, anyModal } from '../ui/dom';
import { music, sfx } from '../audio';
import { toRegion } from '../nav';
import { loadWorld } from './Boot';

const MINI_W = 256;
const realmOf = (r: Region) => r.realm ?? 'isle';

/**
 * One huge painted world (six Higgsfield panels stitched by tools/stitch_world.py) that you drag and
 * zoom around. Every region is a pin on its own stretch of land; a minimap shows the whole world.
 */
export class WorldScene extends Phaser.Scene {
  constructor() { super('World'); }
  private W = 1;
  private H = 1;
  private pins: Phaser.GameObjects.Container[] = [];
  private view?: Phaser.GameObjects.Graphics;
  private drag = { on: false, moved: false, x: 0, y: 0, sx: 0, sy: 0, mini: false };
  private keys?: Phaser.Types.Input.Keyboard.CursorKeys;

  create() {
    music('world');
    this.pins = [];
    this.view = undefined;
    loadWorld(this, (lay) => this.build(lay));
  }

  private build(lay: { width: number; height: number; tiles: { file: string; x: number }[] }) {
    const { width, height } = this.scale;
    this.W = lay.width;
    this.H = lay.height;
    for (const t of lay.tiles) this.add.image(t.x, 0, `wt_${t.file}`).setOrigin(0);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.W, this.H);
    const minZoom = Math.max(width / this.W, height / this.H);
    cam.setZoom(0.55);
    cam.fadeIn(400);

    const wm = (maps() as any)._worldmap as { pos: Record<string, [number, number]> } | undefined;
    const cur = data().regions.find((r) => r.id === S.location.region)!;
    const P = (r: Region) => { const p = wm?.pos[r.id] ?? [0.5, 0.5]; return { x: p[0] * this.W, y: p[1] * this.H }; };
    for (const r of data().regions) this.pins.push(this.pin(r, P(r), cur));
    const here = P(cur);
    cam.centerOn(here.x, here.y);

    // minimap of the whole world, with the current view outlined
    const MINI_H = Math.round((MINI_W * this.H) / this.W);
    const mx = width - MINI_W - 14, my = 70;
    // bronze-framed slate strip from the painted UI set, nine-sliced around the minimap
    const frame = this.add.nineslice(mx + MINI_W / 2, my + MINI_H / 2, 'btn_strip_slate', undefined, MINI_W + 22, MINI_H + 22, 26, 26, 20, 20)
      .setScrollFactor(0).setDepth(80);
    const view = this.add.graphics().setDepth(90);
    // the frame lives on an unzoomed UI camera (scroll-factor-0 objects still scale with camera zoom)
    const ui = this.cameras.add(0, 0, width, height);
    ui.inputEnabled = false;
    cam.ignore(frame);
    const mini = this.cameras.add(mx, my, MINI_W, MINI_H).setZoom(MINI_W / this.W).setBounds(0, 0, this.W, this.H);
    mini.centerOn(this.W / 2, this.H / 2);
    mini.inputEnabled = false;
    mini.ignore([frame, ...this.pins]);
    cam.ignore(view);
    this.view = view;
    // tiny painted medallions on the minimap mark each region, coloured like the pins
    const dots = data().regions.map((r) => {
      const p = P(r), size = r.id === cur.id ? 260 : 170;
      return this.add.image(p.x, p.y, r.id === cur.id ? 'btn_round_gold' : S.visited.includes(r.id) ? 'btn_round_ivory' : 'btn_round_slate').setDisplaySize(size, size).setDepth(91);
    });
    cam.ignore(dots);
    ui.ignore(this.children.list.filter((o) => o !== frame));

    const inMini = (p: Phaser.Input.Pointer) => p.x >= mx && p.x <= mx + MINI_W && p.y >= my && p.y <= my + MINI_H;
    const jump = (p: Phaser.Input.Pointer) => cam.centerOn(((p.x - mx) / MINI_W) * this.W, ((p.y - my) / MINI_H) * this.H);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.drag = { on: true, moved: false, x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY, mini: inMini(p) };
      if (this.drag.mini) { this.drag.moved = true; jump(p); }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag.on || !p.isDown || anyModal()) return;
      if (this.drag.mini) return jump(p);
      const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 8) return;
      this.drag.moved = true;
      cam.setScroll(this.drag.sx - dx / cam.zoom, this.drag.sy - dy / cam.zoom);
    });
    this.input.on('pointerup', () => { this.drag.on = false; });
    const zoomBy = (f: number) => { cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, minZoom, 1.2)); this.fitPins(); };
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => zoomBy(dy > 0 ? 0.88 : 1.14));
    this.keys = this.input.keyboard?.createCursorKeys();
    this.fitPins();

    const refresh = () => hud((k) => openMenu(k, refresh), [h('button', { class: 'btn small', onClick: () => toRegion() }, h('img', { class: 'flip', src: 'assets/ui/orig/bk/arrow.png', alt: '' }), 'Back to region')]);
    refresh();
    layer('scene', h('div', {},
      h('div', { class: 'region-actions' },
        h('button', { class: 'btn icon', title: 'Zoom in', 'aria-label': 'Zoom in', onClick: () => zoomBy(1.3) }, '+'),
        h('button', { class: 'btn icon', title: 'Zoom out', 'aria-label': 'Zoom out', onClick: () => zoomBy(1 / 1.3) }, '−'),
        h('button', { class: 'btn icon', title: 'Centre on me', 'aria-label': 'Centre on me', onClick: () => cam.pan(here.x, here.y, 500, 'Sine.easeInOut') }, h('img', { src: 'assets/ui/orig/bk/fx_target.png', alt: '' })),
        h('span', { class: 'chip panel' }, 'Drag to explore the world · scroll or +/− to zoom · tap a region to travel')),
      h('div', { class: 'region-info panel', style: { width: 'auto' } }, h('b', {}, 'The World'),
        h('div', { class: 'muted' }, `${S.visited.length} of ${data().regions.length} regions discovered`))));
  }

  update() {
    const cam = this.cameras.main;
    const k = this.keys;
    if (k && !anyModal()) {
      const vx = (k.right.isDown ? 1 : 0) - (k.left.isDown ? 1 : 0), vy = (k.down.isDown ? 1 : 0) - (k.up.isDown ? 1 : 0);
      if (vx || vy) cam.setScroll(cam.scrollX + (vx * 16) / cam.zoom, cam.scrollY + (vy * 16) / cam.zoom);
    }
    const v = cam.worldView;
    const w = this.W / MINI_W;
    this.view?.clear().lineStyle(w * 2.2, 0x3a2410, 0.9).strokeRect(v.x, v.y, v.width, v.height).lineStyle(w * 1.2, 0xd9a441, 1).strokeRect(v.x, v.y, v.width, v.height);
  }

  /** Pins keep a constant on-screen size whatever the zoom. */
  private fitPins() {
    const z = this.cameras.main.zoom;
    const k = (1 / z) * Phaser.Math.Clamp(z / 0.45, 0.62, 1);
    for (const p of this.pins) p.setScale(k);
  }

  private pin(r: Region, at: { x: number; y: number }, cur: Region) {
    const visited = S.visited.includes(r.id);
    const here = r.id === cur.id;
    const adjacent = !r.sea && !cur.sea && realmOf(r) === realmOf(cur) && Math.abs(r.x - cur.x) + Math.abs(r.y - cur.y) === 1;
    const c = this.add.container(at.x, at.y).setDepth(10);
    // pins are painted bronze medallions: gold where you are, ivory once visited, slate while undiscovered
    const ring = this.add.image(0, 0, here ? 'btn_round_gold' : visited ? 'btn_round_ivory' : 'btn_round_slate').setDisplaySize(30, 30);
    if (here) {
      // the kit's painted magic ring, tinted gold and laid flat, pulses under where you are
      const halo = this.add.image(0, 8, 'bk_fx_ring').setTint(0xffd54f).setBlendMode('ADD').setScale(0.5, 0.3);
      c.add(halo);
      this.tweens.add({ targets: halo, scaleX: 0.8, scaleY: 0.48, alpha: 0, duration: 1200, repeat: -1 });
    }
    c.add(ring);
    const name = visited || adjacent || here ? r.name : '???';
    const label = this.add.text(0, -20, name, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold', fontSize: '17px', color: here ? '#ffe9a8' : '#ffffff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 1);
    const sub = [`Lv ${r.levels[0]}–${r.levels[1]}`, ...r.towns].join(' · ');
    const info = this.add.text(0, 18, visited || here ? sub : `Lv ${r.levels[0]}–${r.levels[1]}`, { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', color: '#e8f4ff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0);
    c.add([label, info]);
    if (r.overlords.length) {
      // the overlord emblem from the region maps, greyed out once every overlord here is beaten
      const ol = this.add.image(18, -8, 'town_warp_emblem').setDisplaySize(22, 17);
      if (r.overlords.every((o) => S.overlords.includes(o))) ol.setTint(0x888888).setAlpha(0.5);
      c.add(ol);
    }
    ring.setInteractive({ useHandCursor: true });
    ring.on('pointerover', () => c.setScale(c.scale * 1.12)).on('pointerout', () => this.fitPins());
    ring.on('pointerup', () => {
      if (this.drag.moved) return;
      if (here) return toRegion();
      if (r.sea && !visited) return toast(`${r.name} lies across the sea. Sail there from a dock.`);
      if (!visited && !adjacent) return toast(realmOf(r) === 'frontier' ? 'The Frontier lies across the sea. Board a boat at the dock in Forest of Mangal or Endergate.' : 'Travel overland through neighbouring regions to reach this area.');
      // fast travel: arrive at the town (visited regions), else at the road from where we came
      const m = maps()[r.id];
      const town = m.spots.find((s) => s.kind === 'town');
      const entry = m.spots.find((s) => s.kind === 'exit' && s.ref === cur.id) ?? m.spots.find((s) => s.kind === 'dock') ?? town ?? m.spots[0];
      if (!visited && r.levels[0] > Math.max(...S.party.map((p) => p.level)) + 12) toast(`Careful — monsters in ${r.name} are around Lv ${r.levels[0]}!`);
      S.location = { region: r.id, spot: (visited && town ? town : entry).id };
      if (!S.visited.includes(r.id)) S.visited.push(r.id);
      save();
      sfx('step');
      toRegion();
    });
    return c;
  }
}
