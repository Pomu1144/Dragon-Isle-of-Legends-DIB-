import Phaser from 'phaser';
import { vignette, ambient } from './fx';
import { data, maps, region, speciesByName, spriteUrl, dungeon as dungeonData, overlord as overlordData } from '../core/data';
import { S, save, questEvent, hash, exploreState, reveal, rollGem, grantPrize } from '../core/state';
import type { Spot } from '../core/types';
import { wildEncounter, breederEncounter, overlordEncounter, overlordLevel, rareEncounter, resumeFloor } from '../core/encounters';
import { WalkGrid, FOREST, GRASS, type Pt } from '../core/walkgrid';
import { hud, openMenu, elChip } from '../ui/menus';
import { h, layer, toast, confirmBox, dialogue, starsHtml, anyModal } from '../ui/dom';
import { music, sfx } from '../audio';
import { toTown, toDungeon, toWorld, toRegion, go } from '../nav';
import { fight } from '../flow';
import { loadSprites, loadMap } from './Boot';
import { species } from '../core/data';
import { rng } from '../core/rng';

const KIND_STYLE: Record<Spot['kind'], { color: number; label: string }> = {
  field: { color: 0x4cd964, label: 'Wild area' },
  town: { color: 0x4aa3ff, label: 'Town' },
  dungeon: { color: 0xff5a5a, label: 'Dungeon' },
  overlord: { color: 0xb46bff, label: 'Dragon Overlord' },
  exit: { color: 0xf6c453, label: 'Road' },
  dock: { color: 0x42a5f5, label: 'Dock' },
  treasure: { color: 0xffd54f, label: 'Treasure' },
  rare: { color: 0xb05cff, label: 'Monster Lair' },
  breeder: { color: 0xff8a50, label: 'Breeder Camp' },
  lookout: { color: 0x9be7ff, label: 'Lookout' },
};
const DISCOVERY = new Set<Spot['kind']>(['treasure', 'rare', 'breeder', 'lookout']);
const DISC_ART: Partial<Record<Spot['kind'], string>> = { treasure: 'disc_chest', rare: 'disc_lair', breeder: 'disc_tent', lookout: 'disc_tower' };
const BREEDERS = ['Rowan the Wanderer', 'Old Mira', 'Kestrel', 'Brannoc', 'Sable', 'Tamsin', 'Hollis', 'Wren'];
const FOG_R = 420;          // radius of the clearing around the hero and every explored spot (world px)
const MINI_W = 256, MINI_H = 144;
// free roaming
const CELL = 24;            // walk-grid cell (world px); the grid is read from the painting itself
const SPEED = 300;          // hero walking speed (world px per second)
const REVEAL_R = 340;       // landmarks this close to the hero come out of the fog
const TRAIL = 160;          // walked ground is remembered on a grid this coarse, so its fog stays lifted
const TOUCH_R = 70;         // standing this close to a landmark offers its actions
const SAFE_R = 330;         // no wild monsters this close to a town
const ENCOUNTER_GAP = 36;   // cells to walk after a battle before the next one can start
const ENCOUNTER_P = 0.016;  // chance per cell walked through meadow (forest x1.6, roads and rock x0.3)
const grids = new Map<string, WalkGrid>();
let stepsSinceBattle = ENCOUNTER_GAP; // module level: survives the scene restart a battle causes

export class RegionScene extends Phaser.Scene {
  constructor() { super('Region'); }
  private token!: Phaser.GameObjects.Container;
  private heroImg?: Phaser.GameObjects.Image;
  private markers = new Map<number, Phaser.GameObjects.Container>();
  private fog!: Phaser.GameObjects.RenderTexture;
  private view?: Phaser.GameObjects.Graphics;
  private grid!: WalkGrid;
  private ready = false;
  private frozen = false;     // a battle or scene change is under way
  private walking = false;
  private route: Pt[] = [];
  private target?: Spot;      // landmark tapped: its action runs on arrival
  private near?: Spot;        // landmark within reach
  private lastCell = -1;
  private lastTrail = -1;
  private skipSpot = -1;      // a discovery just declined: not offered again until you step away
  private hereKey = '';
  private WW = 2560;
  private WH = 1440;
  private drag = { on: false, moved: false, x: 0, y: 0, sx: 0, sy: 0, mini: false };
  private keys?: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  /** a full-screen DOM layer (Monster Keep, Monsterpedia, a dialogue) is open: the hero stands still under it */
  private uiBlock = false;
  private uiWatch?: MutationObserver;

  private P(s: Spot) { return { x: s.x * this.WW, y: s.y * this.WH }; }
  private seen(id: number) { return exploreState(S.location.region).seen.includes(id); }
  private isDone(s: Spot) { return exploreState(S.location.region).done.includes(s.id); }
  private here(): Pt { return { x: this.token.x, y: this.token.y }; }
  private spots() { return maps()[S.location.region].spots; }
  private dist(a: Pt, b: Pt) { return Math.hypot(a.x - b.x, a.y - b.y); }

  create() {
    this.ready = false;
    this.events.once('shutdown', () => { this.ready = false; this.uiWatch?.disconnect(); });
    // watch the UI root instead of querying the DOM every frame (as the Town scene does)
    const check = () => { this.uiBlock = !!document.querySelector('[data-layer="team"], [data-layer="book"], [data-layer="dialogue"]'); };
    const root = document.getElementById('ui');
    this.uiWatch?.disconnect();
    if (root) { this.uiWatch = new MutationObserver(check); this.uiWatch.observe(root, { childList: true }); }
    check();
    this.view = undefined;
    this.keys = undefined;
    loadMap(this, S.location.region, () => this.build());
  }

  /** The walkable ground of a region, read from its painting once per session. */
  private walkGrid(id: string) {
    let g = grids.get(id);
    if (g) return g;
    const cols = Math.ceil(this.WW / CELL), rows = Math.ceil(this.WH / CELL);
    const cv = document.createElement('canvas');
    cv.width = cols;
    cv.height = rows;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.textures.get(`map_${id}`).getSourceImage() as CanvasImageSource, 0, 0, cols, rows);
    const m = maps()[id];
    g = WalkGrid.fromPixels(ctx.getImageData(0, 0, cols, rows).data, cols, rows, CELL, m.spots.map((s) => this.P(s)), m.edges);
    grids.set(id, g);
    return g;
  }

  private build() {
    const r = region(S.location.region);
    const m = maps()[r.id];
    const { width, height } = this.scale;
    music('world');
    this.markers.clear();
    this.view = undefined;
    this.frozen = false;
    this.walking = false;
    this.route = [];
    this.target = undefined;
    this.near = undefined;
    this.lastCell = this.lastTrail = this.skipSpot = -1;
    this.hereKey = '';
    // the 4K painting is shown at full resolution: the region is a world three screens wide that scrolls
    const bg = this.add.image(0, 0, `map_${r.id}`).setOrigin(0);
    const k = Math.max(width * 3 / bg.width, height * 3 / bg.height);
    bg.setScale(k);
    this.WW = bg.width * k;
    this.WH = bg.height * k;
    this.grid = this.walkGrid(r.id);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.WW, this.WH);
    const vig = vignette(this, 0.45).setScrollFactor(0);
    const amb = ambient(this, 0xffffff, 14).setScrollFactor(0);
    cam.fadeIn(350);

    // where the hero stands: the exact spot they last walked to, else the landmark they arrived at
    const here0 = m.spots[S.location.spot] ?? m.spots[0];
    let start: Pt = S.location.x != null && S.location.y != null ? { x: S.location.x * this.WW, y: S.location.y * this.WH } : this.P(here0);
    if (!this.grid.canStand(start)) {
      const c = this.grid.nearestWalkable(...this.grid.clampCell(start));
      if (c) start = this.grid.center(...c);
    }

    // what is around you and any quest targets are always known
    const questSpots = new Map<number, string>();
    for (const q of S.quests) if (q.goal.kind === 'battle' && q.goal.region === r.id && q.progress < 1 && q.goal.spot != null) questSpots.set(q.goal.spot, q.id);
    reveal(r.id, [here0.id, ...m.spots.filter((s) => this.dist(this.P(s), start) < REVEAL_R).map((s) => s.id), ...questSpots.keys()]);

    // open country has no marker of its own (monsters lurk anywhere wild); landmarks and quest targets do
    for (const s of m.spots) if (s.kind !== 'field' || questSpots.has(s.id)) this.markers.set(s.id, this.marker(s, questSpots.has(s.id)));

    // fog of war: a dark layer with soft clearings punched out around explored spots and walked ground
    if (!this.textures.exists('fog_brush')) {
      const c = this.textures.createCanvas('fog_brush', FOG_R * 2, FOG_R * 2)!;
      const ctx = c.getContext();
      const g = ctx.createRadialGradient(FOG_R, FOG_R, FOG_R * 0.35, FOG_R, FOG_R, FOG_R);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, FOG_R * 2, FOG_R * 2);
      c.refresh();
    }
    this.fog = this.add.renderTexture(0, 0, this.WW, this.WH).setOrigin(0).setDepth(6);
    this.fog.fill(0x0a1522, 0.82);
    const e = exploreState(r.id);
    for (const id of e.seen) this.clearFog(m.spots[id]);
    const tcols = Math.ceil(this.WW / TRAIL);
    for (const t of e.trail ?? []) this.fog.erase('fog_brush', (t % tcols + 0.5) * TRAIL - FOG_R, (Math.floor(t / tcols) + 0.5) * TRAIL - FOG_R);

    // the hero on the map = the lead monster, bobbing as it goes
    const lead = S.party[0];
    const sp = species(lead.species);
    this.token = this.add.container(start.x, start.y).setDepth(10);
    // the kit's painted magic ring, tinted gold and laid flat, pulses under the token
    const halo = this.add.image(0, 0, 'bk_fx_ring').setTint(0xf6c453).setBlendMode('ADD').setScale(0.7, 0.42);
    this.token.add(halo);
    this.tweens.add({ targets: halo, scaleX: 0.91, scaleY: 0.55, alpha: 0.2, duration: 1100, repeat: -1 });
    this.heroImg = undefined;
    loadSprites(this, [sp.sprite], () => {
      const img = this.add.image(0, -24, `spr_${sp.sprite}`);
      img.setScale(Math.min(64 / img.width, 64 / img.height)).setFlipX(true);
      this.token.add(img);
      this.heroImg = img;
      this.tweens.add({ targets: img, y: -30, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    });
    cam.centerOn(start.x, start.y);

    // minimap: a second camera that sees the whole region, with the main view outlined on it
    const mx = width - MINI_W - 14, my = 70;
    // bronze-framed slate strip from the painted UI set, nine-sliced around the minimap
    const frame = this.add.nineslice(mx + MINI_W / 2, my + MINI_H / 2, 'btn_strip_slate', undefined, MINI_W + 22, MINI_H + 22, 26, 26, 20, 20)
      .setScrollFactor(0).setDepth(80);
    const view = this.add.graphics().setDepth(90);
    const mini = this.cameras.add(mx, my, MINI_W, MINI_H).setZoom(MINI_W / this.WW).setBounds(0, 0, this.WW, this.WH);
    mini.centerOn(this.WW / 2, this.WH / 2);
    mini.inputEnabled = false;
    mini.ignore([vig, amb, frame]);
    cam.ignore(view);
    this.view = view;

    const inMini = (p: Phaser.Input.Pointer) => p.x >= mx && p.x <= mx + MINI_W && p.y >= my && p.y <= my + MINI_H;
    const jump = (p: Phaser.Input.Pointer) => { cam.stopFollow(); cam.centerOn(((p.x - mx) / MINI_W) * this.WW, ((p.y - my) / MINI_H) * this.WH); };
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
      cam.stopFollow();
      cam.setScroll(this.drag.sx - dx, this.drag.sy - dy);
    });
    // tapping open ground walks there; markers handle their own taps
    this.input.on('pointerup', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      const tap = this.drag.on && !this.drag.moved;
      this.drag.on = false;
      if (!tap || over.length || anyModal() || this.frozen) return;
      const w = cam.getWorldPoint(p.x, p.y);
      this.goTo({ x: w.x, y: w.y });
    });
    // movement keys are read without capturing them, so typing in text boxes still works
    this.keys = this.input.keyboard?.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D' }, false) as RegionScene['keys'];

    if (!S.visited.includes(r.id)) S.visited.push(r.id);
    delete S.location.town; // out on the map now
    save();
    this.ready = true;
    this.near = this.landmarkNear(start);
    this.ui();
    if (questSpots.size) toast('Red medallions mark quest targets in this region.');
    else if (!(e.trail ?? []).length) {
      toast(r.id === 'southern_alvalon'
        ? 'Tap the ground (or use the arrow keys) to walk. Wild monsters hide in the woods and meadows — the forest west of Corova is a good place to train.'
        : 'Tap the ground to walk. Wild monsters hide in the forests and open country.');
    }
  }

  update(_t: number, delta: number) {
    if (!this.ready) return;
    const cam = this.cameras.main;
    const k = this.keys;
    const dt = Math.min(delta, 50) / 1000;
    // keys typed into a text field (naming a monster…) are not for walking either
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    const busy = this.frozen || this.uiBlock || typing || anyModal();
    const vx = k ? (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0) : 0;
    const vy = k ? (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0) : 0;
    if (!busy && (vx || vy)) {
      this.route = [];
      this.target = undefined;
      const len = Math.hypot(vx, vy), s = SPEED * dt;
      this.step((vx / len) * s, (vy / len) * s);
    } else if (!busy && this.route.length) {
      const t = this.route[0];
      const dx = t.x - this.token.x, dy = t.y - this.token.y, d = Math.hypot(dx, dy), s = SPEED * dt;
      if (d <= s) {
        this.place(t.x, t.y);
        this.route.shift();
        if (!this.route.length && !this.frozen) this.reached();
      } else this.place(this.token.x + (dx / d) * s, this.token.y + (dy / d) * s);
    } else if (this.walking && !busy) this.stopped();
    const v = cam.worldView;
    const w = this.WW / MINI_W;
    this.view?.clear().lineStyle(w * 2.2, 0x3a2410, 0.9).strokeRect(v.x, v.y, v.width, v.height).lineStyle(w * 1.2, 0xd9a441, 1).strokeRect(v.x, v.y, v.width, v.height);
  }

  // ---------------------------------------------------------------- walking
  /** Walk to a point (around water and cliffs); with a landmark, use it on arrival. */
  goTo(p: Pt, spot?: Spot) {
    const path = this.grid.path(this.here(), p);
    if (!path) return toast('There is no way across from here.');
    this.route = path;
    this.target = spot;
  }

  /** Keyboard walking: slide along shores instead of stopping dead. */
  private step(dx: number, dy: number) {
    const x = this.token.x, y = this.token.y;
    if (this.grid.canStand({ x: x + dx, y: y + dy })) this.place(x + dx, y + dy);
    else if (dx && this.grid.canStand({ x: x + dx, y })) this.place(x + dx, y);
    else if (dy && this.grid.canStand({ x, y: y + dy })) this.place(x, y + dy);
  }

  private place(x: number, y: number) {
    const ox = this.token.x;
    this.token.setPosition(Phaser.Math.Clamp(x, 0, this.WW - 1), Phaser.Math.Clamp(y, 0, this.WH - 1));
    if (this.heroImg && Math.abs(x - ox) > 0.5) this.heroImg.setFlipX(x > ox);
    if (!this.walking) {
      this.walking = true;
      this.cameras.main.startFollow(this.token, true, 0.12, 0.12);
    }
    this.moved();
  }

  /** Everything that happens as the hero covers ground. */
  private moved() {
    const r = region(S.location.region);
    const p = this.here();
    // walked ground stays clear of fog
    const tcols = Math.ceil(this.WW / TRAIL);
    const tx = Math.floor(p.x / TRAIL), ty = Math.floor(p.y / TRAIL), t = ty * tcols + tx;
    if (t !== this.lastTrail) {
      this.lastTrail = t;
      const e = exploreState(r.id);
      e.trail ??= [];
      if (!e.trail.includes(t)) {
        e.trail.push(t);
        this.fog.erase('fog_brush', (tx + 0.5) * TRAIL - FOG_R, (ty + 0.5) * TRAIL - FOG_R);
      }
    }
    // landmarks come into view as you approach them
    const fresh = this.spots().filter((s) => !this.seen(s.id) && this.dist(this.P(s), p) < REVEAL_R).map((s) => s.id);
    if (fresh.length) this.explore(fresh);
    // walking into a hidden discovery or a quest target sets it off
    const quest = S.quests.find((q) => q.goal.kind === 'battle' && q.goal.region === r.id && q.progress < 1 && q.goal.spot != null
      && this.dist(this.P(this.spots()[q.goal.spot]), p) < TOUCH_R * 0.7);
    const disc = this.spots().find((s) => DISCOVERY.has(s.kind) && !this.isDone(s) && this.seen(s.id) && this.dist(this.P(s), p) < TOUCH_R * 0.7);
    const trigger = quest ? this.spots()[quest.goal.spot!] : disc;
    if (this.skipSpot >= 0 && this.dist(this.P(this.spots()[this.skipSpot]), p) > TOUCH_R) this.skipSpot = -1;
    if (trigger && !this.frozen && trigger.id !== this.skipSpot) {
      this.skipSpot = trigger.id;
      this.halt();
      S.location.spot = trigger.id;
      return this.arrive(trigger, false);
    }
    // wild monsters: a chance for every cell of open country crossed
    const [cx, cy] = this.grid.cellOf(p);
    const cell = cy * this.grid.cols + cx;
    if (cell !== this.lastCell) {
      this.lastCell = cell;
      stepsSinceBattle++;
      if (this.rollEncounter(p)) return;
    }
    const near = this.landmarkNear(p);
    const key = `${near?.id ?? -1}:${this.areaLabel(p)}`;
    if (key !== this.hereKey) { this.near = near; this.hereKey = key; this.ui(); }
  }

  private reached() {
    const s = this.target;
    this.target = undefined;
    this.stopped();
    if (s) {
      S.location.spot = s.id;
      this.arrive(s, true);
    }
  }

  private halt() {
    this.route = [];
    this.target = undefined;
    this.stopped();
  }

  private stopped() {
    this.walking = false;
    this.cameras.main.stopFollow();
    this.savePosition();
  }

  /** Remember exactly where the hero stands (and the nearest spot, for everything keyed by spot). */
  private savePosition() {
    const p = this.here();
    const nearest = this.spots().reduce((a, b) => (this.dist(this.P(b), p) < this.dist(this.P(a), p) ? b : a));
    S.location = { region: S.location.region, spot: nearest.id, x: +(p.x / this.WW).toFixed(4), y: +(p.y / this.WH).toFixed(4) };
    save();
  }

  private landmarkNear(p: Pt) {
    let best: Spot | undefined, bd = TOUCH_R;
    for (const s of this.spots()) {
      if (s.kind === 'field' || (DISCOVERY.has(s.kind) && this.isDone(s))) continue;
      const d = this.dist(this.P(s), p);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private nearTown(p: Pt) { return this.spots().some((s) => s.kind === 'town' && this.dist(this.P(s), p) < SAFE_R); }

  /** 0 at the edge of town … 1 far out in the wilds: wild monsters grow stronger the further you roam. */
  private depth(p: Pt) {
    const towns = this.spots().filter((s) => s.kind === 'town');
    if (!towns.length) return 0.5;
    const d = Math.min(...towns.map((s) => this.dist(this.P(s), p)));
    return Phaser.Math.Clamp((d - SAFE_R) / (Math.hypot(this.WW, this.WH) * 0.45), 0, 1);
  }

  private wildLevel(p: Pt) {
    const [lo, hi] = region(S.location.region).levels;
    return Math.round(lo + (hi - lo) * this.depth(p));
  }

  private areaLabel(p: Pt) {
    if (this.nearTown(p)) return 'Safe near town';
    const g = this.grid.groundAt(p);
    const name = g === FOREST ? 'Forest' : g === GRASS ? 'Meadow' : this.grid.bare ? 'Wilds' : 'Trail';
    return `${name} · monsters around Lv ${this.wildLevel(p)}`;
  }

  private rollEncounter(p: Pt) {
    if (this.frozen || stepsSinceBattle < ENCOUNTER_GAP || this.nearTown(p)) return false;
    const g = this.grid.groundAt(p);
    const f = g === FOREST ? 1.6 : g === GRASS || this.grid.bare ? 1 : 0.3;
    if (!rng.chance(ENCOUNTER_P * f)) return false;
    this.halt();
    this.hunt();
    return true;
  }

  private clearFog(s: Spot) {
    const p = this.P(s);
    this.fog.erase('fog_brush', p.x - FOG_R, p.y - FOG_R);
  }

  /** Mark spots as explored: lift the fog, fade their markers in and pay the full-map bonus. */
  private explore(ids: number[]) {
    const r = region(S.location.region);
    const m = maps()[r.id];
    const fresh = ids.filter((id) => !this.seen(id));
    if (!reveal(r.id, fresh)) return;
    for (const id of fresh) {
      this.clearFog(m.spots[id]);
      const c = this.markers.get(id);
      if (c) { c.setVisible(true).setAlpha(0); this.tweens.add({ targets: c, alpha: 1, duration: 500 }); }
    }
    const e = exploreState(r.id);
    if (e.seen.length >= m.spots.length && !e.done.includes(-1)) {
      e.done.push(-1);
      const silver = 250 * (r.tier + 1);
      S.silver += silver;
      S.items.golden += 1;
      sfx('magic');
      toast(`${r.name} fully explored! +${silver} Silver and a Golden Egg`, 'assets/ui/orig/bk/btn_scroll.png');
    }
    save();
    this.ui();
  }
  private marker(s: Spot, quest: boolean) {
    const st = KIND_STYLE[s.kind];
    const p = this.P(s);
    const c = this.add.container(p.x, p.y).setDepth(3).setVisible(this.seen(s.id));
    const defeatedOverlord = s.kind === 'overlord' && s.ref && S.overlords.includes(s.ref);
    const field = s.kind === 'field';
    const done = DISCOVERY.has(s.kind) && this.isDone(s);
    // invisible hit area; the visible marker is painted art
    const ring = this.add.circle(0, 0, field ? 18 : 30, 0x000000, 0.001);
    c.add(this.add.ellipse(2, field ? 9 : 14, field ? 30 : 70, field ? 11 : 22, 0x000000, field ? 0.35 : 0.22));
    c.add(ring);
    // wild areas are small bronze medallions with green enamel, like the kit's round buttons
    if (field) c.add(this.add.image(0, 0, 'btn_round_green').setDisplaySize(26, 26));
    // towns, dungeons, overlords, roads and discoveries use painted map art instead of plain markers
    const art = (key: string, sc: number, x = 0, y = 0) => { const im = this.add.image(x, y, key).setScale(sc).setOrigin(0.5, 0.85); c.add(im); return im; };
    if (s.kind === 'town') { art('town_house_a', 0.32, -26, 6); art('town_house_b', 0.3, 26, 2); art('town_warp_house', 0.3, 0, 22); }
    if (s.kind === 'dungeon') { const v = art('bk_fx_web', 0.42, 0, 14); this.tweens.add({ targets: v, angle: 360, duration: 12000, repeat: -1 }); v.setOrigin(0.5); }
    if (s.kind === 'overlord') { const e = art('town_warp_emblem', 0.42, 0, 10); if (defeatedOverlord) e.setAlpha(0.45).setTint(0x888888); }
    if (s.kind === 'exit') art('town_signpost', 0.38, 0, 14);
    if (s.kind === 'dock') { const d = art('town_dock', 0.3, 0, 18); this.tweens.add({ targets: d, y: d.y - 3, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' }); }
    const disc = DISC_ART[s.kind];
    if (disc) {
      const src = this.textures.get(disc).getSourceImage();
      const im = art(disc, 84 / Math.max(src.width, src.height, 1), 0, 16);
      if (done) im.setTint(0x8a8a8a).setAlpha(0.75);
      else {
        const glint = this.add.image(0, -8, 'glow').setScale(3.4).setTint(st.color).setBlendMode('ADD');
        c.addAt(glint, 1);
        this.tweens.add({ targets: glint, alpha: 0.3, scale: 2.4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      }
    }
    if (quest) {
      // quest targets: a red medallion with crossed swords bobbing over the spot
      const q = this.add.container(0, -40, [
        this.add.image(0, 0, 'btn_round_red').setDisplaySize(34, 34),
        this.add.text(0, 1, '⚔', { fontFamily: 'Arial, sans-serif', fontSize: '19px', color: '#fff', stroke: '#2a0a06', strokeThickness: 4 }).setOrigin(0.5),
      ]);
      c.add(q);
      this.tweens.add({ targets: q, y: -48, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    if (!field) {
      const label = s.kind === 'exit' ? `→ ${region(s.ref!).name}` : s.kind === 'dock' ? region(s.ref!).name
        : DISCOVERY.has(s.kind) ? `${st.label}${done ? ' ✔' : ''}` : s.ref!;
      c.add(this.add.text(0, 28, label, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold', fontSize: '15px', color: done ? '#cfd6dd' : '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0));
    }
    // taps fire on release so dragging the map across a marker doesn't send you walking
    ring.setInteractive({ useHandCursor: true }).on('pointerup', () => { if (!this.drag.moved) this.clickSpot(s); });
    ring.on('pointerover', () => c.setScale(1.15)).on('pointerout', () => c.setScale(1));
    return c;
  }

  ui() {
    if (!this.ready) return;
    const r = region(S.location.region);
    const m = maps()[r.id];
    const spot = this.near;
    const refresh = () => this.ui();
    const e = exploreState(r.id);
    const pct = Math.round((e.seen.length / m.spots.length) * 100);
    const found = m.spots.filter((s) => DISCOVERY.has(s.kind) && e.done.includes(s.id)).length;
    const total = m.spots.filter((s) => DISCOVERY.has(s.kind)).length;
    const p = this.here();
    const wild = !this.nearTown(p);
    hud((k) => openMenu(k, refresh), [h('button', { class: 'btn small', onClick: () => toWorld() }, h('img', { src: 'assets/ui/orig/bk/btn_scroll.png', alt: '' }), 'World')]);
    const pool = r.monsters.slice(0, 14).map((n) => speciesByName(n)).filter(Boolean);
    layer('scene', h('div', {},
      h('div', { class: 'region-title' }, h('h2', {}, r.name), h('div', { class: 'region-sub' }, `Wild monsters Lv ${r.levels[0]}–${r.levels[1]}`),
        h('div', { class: 'explore-bar' }, h('i', { style: { width: `${pct}%` } }), h('span', {}, `Explored ${pct}% · Discoveries ${found}/${total}`)),
        h('div', { class: 'region-here' }, this.areaLabel(p))),
      h('div', { class: 'region-actions' },
        spot?.kind === 'town' ? h('button', { class: 'btn gold', onClick: () => this.arrive(spot, true) }, `Enter ${spot.ref}`) : null,
        spot?.kind === 'dungeon' ? h('button', { class: 'btn red', onClick: () => this.enterDungeon(spot.ref!) }, `Enter ${spot.ref}`) : null,
        spot?.kind === 'overlord' && !S.overlords.includes(spot.ref!) ? h('button', { class: 'btn red', onClick: () => this.challengeOverlord(spot.ref!) }, `Challenge ${spot.ref}`) : null,
        spot?.kind === 'dock' ? h('button', { class: 'btn gold', onClick: () => this.sail(spot.ref!) }, h('img', { src: 'assets/ui/orig/town/dock.png', alt: '' }), `Sail to ${region(spot.ref!).name}`) : null,
        spot?.kind === 'exit' ? h('button', { class: 'btn gold', onClick: () => this.arrive(spot, true) }, h('img', { src: 'assets/ui/orig/bk/arrow.png', alt: '' }), region(spot.ref!).name) : null,
        spot && DISCOVERY.has(spot.kind) && !this.isDone(spot) ? h('button', { class: 'btn gold', onClick: () => this.discover(spot) }, KIND_STYLE[spot.kind].label) : null,
        wild ? h('button', { class: 'btn green', onClick: () => { this.halt(); this.hunt(); } }, 'Look for monsters') : null,
        h('button', { class: 'btn icon', title: 'Centre on me', 'aria-label': 'Centre on me', onClick: () => this.recenter() }, h('img', { src: 'assets/ui/orig/bk/fx_target.png', alt: '' })),
        h('span', { class: 'chip panel' }, 'Tap the ground to walk · arrow keys / WASD · drag to look around')),
      h('div', { class: 'region-info panel' },
        h('b', {}, 'Monsters sighted'),
        h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '.25em', marginTop: '.4em' } },
          ...pool.map((s) => h('img', { src: spriteUrl(s!), title: `${s!.name} ${starsHtml(s!.stars)}`, style: { height: '2.4em', filter: S.seen.includes(s!.id) ? '' : 'brightness(0) opacity(.5)' } }))),
        r.overlords.length ? h('div', { class: 'muted', style: { marginTop: '.4em' } }, `Overlord: ${r.overlords.map((o) => `${o}${S.overlords.includes(o) ? ' ✔' : ''}`).join(', ')}`) : null)));
    void elChip;
  }

  private recenter() {
    const cam = this.cameras.main;
    cam.stopFollow();
    cam.pan(this.token.x, this.token.y, 400, 'Sine.easeInOut');
  }

  /** Tap a landmark: walk to it and use it (or use it at once when already there). */
  clickSpot(s: Spot) {
    if (this.frozen || anyModal() || !this.seen(s.id)) return;
    if (this.dist(this.P(s), this.here()) < TOUCH_R) {
      this.halt();
      S.location.spot = s.id;
      return this.arrive(s, true);
    }
    this.goTo(this.P(s), s);
  }

  arrive(s: Spot, tapped: boolean) {
    if (this.frozen) return;
    this.ui();
    const r = region(S.location.region);
    const quest = S.quests.find((q) => q.goal.kind === 'battle' && q.goal.region === r.id && q.goal.spot === s.id && q.progress < 1);
    if (quest) {
      this.frozen = true;
      const enc = breederEncounter(r.id, quest.goal.npc ?? 'Rogue Breeder', hash(quest.id), quest.goal.species);
      return void dialogue([{ who: quest.goal.npc, text: `So the Guild sent you? Let's see what your monsters are made of!` }]).then(() =>
        fight(enc, (res) => {
          if (res.outcome === 0) { quest.progress = 1; save(); toast(`Quest target defeated! Report back to ${quest.town}.`); }
          toRegion();
        }));
    }
    if (DISCOVERY.has(s.kind) && !this.isDone(s)) return void this.discover(s);
    switch (s.kind) {
      case 'field': this.hunt(); break;
      case 'treasure': case 'rare': case 'breeder': case 'lookout':
        if (tapped) toast(`${KIND_STYLE[s.kind].label} — already explored.`);
        break;
      case 'town':
        if (!tapped) break;
        S.lastTown = { region: r.id, spot: s.id };
        save();
        questEvent('visit', s.ref);
        toTown(s.ref!);
        break;
      case 'dungeon': if (tapped) this.enterDungeon(s.ref!); break;
      case 'overlord':
        if (!tapped) break;
        if (!S.overlords.includes(s.ref!)) this.challengeOverlord(s.ref!);
        else toast(`${s.ref} has already been defeated.`);
        break;
      case 'dock':
        if (tapped) this.sail(s.ref!);
        break;
      case 'exit': {
        if (!tapped) break;
        const next = region(s.ref!);
        const nm = maps()[next.id];
        const entry = nm.spots.find((x) => x.kind === 'exit' && x.ref === r.id) ?? nm.spots[0];
        this.frozen = true;
        S.location = { region: next.id, spot: entry.id };
        save();
        this.cameras.main.fadeOut(300, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => toRegion());
        break;
      }
    }
  }


  private claim(s: Spot) {
    const e = exploreState(S.location.region);
    if (!e.done.includes(s.id)) e.done.push(s.id);
    save();
  }

  /** Hidden places found by exploring: each pays out once, then becomes an ordinary wild area. */
  async discover(s: Spot) {
    if (anyModal()) return;
    const r = region(S.location.region);
    const seed = hash(`${r.id}:${s.id}`);
    switch (s.kind) {
      case 'treasure': {
        const roll = rng.int(0, 3);
        const prize = roll === 0 ? grantPrize({ kind: 'silver', amount: 150 * (r.tier + 1) + rng.int(0, 60) })
          : roll === 1 ? grantPrize({ kind: 'card', amount: rng.int(3, 6) })
          : roll === 2 ? grantPrize({ kind: 'gem', gem: rollGem(rng.pick(['Oval', 'Square', 'Tear', 'Star'] as const), rng.chance(0.3)) })
          : ((S.items.egg += 1), 'a Monster Egg');
        this.claim(s);
        sfx('magic');
        this.cameras.main.flash(200, 255, 230, 140);
        toast(`You opened a treasure chest: ${prize}!`, 'assets/ui/orig/disc/chest.png');
        this.refreshMarker(s);
        this.ui();
        break;
      }
      case 'rare': {
        const enc = rareEncounter(r.id, seed);
        if (!(await confirmBox(`Something big stirs in the lair… a rare ${enc.name} (Lv ${enc.team[0].level})! Fight it?`, 'Fight!'))) return;
        this.frozen = true;
        fight(enc, (res) => {
          if (res.outcome === 0) { this.claim(s); toast('The lair falls quiet.'); }
          toRegion();
        });
        break;
      }
      case 'breeder': {
        const name = BREEDERS[seed % BREEDERS.length];
        this.frozen = true;
        await dialogue([{ who: name, text: `A traveller out here? I raise monsters in the wilds of ${r.name}. Beat my team and I'll give you an egg from my camp!` }]);
        fight(breederEncounter(r.id, name, seed), (res) => {
          if (res.outcome === 0) { this.claim(s); S.items.egg += 1; save(); toast(`${name} hands you a Monster Egg`, 'assets/ui/orig/disc/tent.png'); }
          toRegion();
        });
        break;
      }
      case 'lookout': {
        const m = maps()[r.id];
        await dialogue([{ who: 'Lookout', text: r.about ? r.about.slice(0, 240) : `From up here you can see all of ${r.name}.` }]);
        this.claim(s);
        this.refreshMarker(s);
        // the fog lifts in a wave spreading out from the tower; the minimap shows the whole region at once
        const me = this.P(s);
        const dist = (x: Spot) => { const q = this.P(x); return Math.hypot(q.x - me.x, q.y - me.y); };
        const order = [...m.spots].sort((a, b) => dist(a) - dist(b));
        order.forEach((x, i) => this.time.delayedCall(60 * i, () => this.explore([x.id])));
        toast(`All of ${r.name} is now on your map.`, 'assets/ui/orig/disc/tower.png');
        break;
      }
      default: break;
    }
  }

  private refreshMarker(s: Spot) {
    this.markers.get(s.id)?.destroy();
    this.markers.set(s.id, this.marker(s, false));
  }

  /** Board the boat at a dock and sail to the matching dock on the other side of the sea route. */
  async sail(to: string) {
    const dest = region(to);
    const here = region(S.location.region);
    const tough = dest.levels[0] > Math.max(...S.party.map((p) => p.level)) + 10;
    await dialogue([{ who: 'Ferryman', text: `Fair winds today! I can sail you from ${here.name} to ${dest.name}.${tough ? ` Mind you, the monsters there are around Lv ${dest.levels[0]}–${dest.levels[1]}.` : ''}` }]);
    if (!(await confirmBox(`Set sail for ${dest.name}?`, 'Set sail'))) return;
    this.frozen = true;
    const m = maps()[to];
    const pier = m.spots.find((x) => x.kind === 'dock' && x.ref === here.id) ?? m.spots[0];
    S.location = { region: to, spot: pier.id };
    if (!S.visited.includes(to)) S.visited.push(to);
    save();
    sfx('magic');
    // the boat crosses the sea, then the camera fades into the destination
    const boat = this.add.image(this.token.x, this.token.y, 'town_dock').setScale(0.3).setDepth(60);
    this.token.setVisible(false);
    this.cameras.main.stopFollow();
    this.tweens.add({ targets: boat, x: boat.x + (to === 'underworld' ? 700 : -700), y: boat.y + 60, duration: 1400, ease: 'Sine.in' });
    this.cameras.main.fadeOut(1400, 8, 20, 30);
    this.cameras.main.once('camerafadeoutcomplete', () => { toast(`Arrived in ${dest.name}`, 'assets/ui/orig/town/dock.png'); toRegion(); });
  }

  hunt() {
    if (this.frozen) return;
    this.frozen = true;
    stepsSinceBattle = 0;
    sfx('encounter');
    this.cameras.main.flash(250, 255, 255, 255);
    const enc = wildEncounter(S.location.region, S.location.spot, undefined, this.depth(this.here()));
    this.time.delayedCall(250, () => fight(enc));
  }

  async enterDungeon(name: string) {
    const d = dungeonData(name)!;
    if (name === 'Unknown Relic' && !S.ending) return toast('A strange seal blocks the entrance… perhaps after the Final Battle.');
    const wp = resumeFloor(name, S.dungeons[name]?.best ?? 1);
    const where = wp > 1 ? ` You will teleport to the save point on floor ${wp}.` : '';
    if (await confirmBox(`${name}: ${d.about || 'A dangerous dungeon.'}${where} Enter?`, 'Enter')) toDungeon(name, wp);
  }

  async challengeOverlord(name: string) {
    const o = overlordData(name)!;
    const lv = overlordLevel(name);
    const best = Math.max(...S.party.map((p) => p.level));
    await dialogue([{ who: name, text: o.about ? o.about.slice(0, 220) : `I am ${name}, Dragon Overlord of ${o.region}. Turn back, little breeder.` }]);
    const warn = best < lv - 3 ? ` Your strongest monster is only Lv ${best} — train in the wilds first!` : '';
    if (!(await confirmBox(`Battle Dragon Overlord ${name}? (${o.form}, Lv ${lv})${warn}`, 'Fight!', !!warn))) return;
    this.frozen = true;
    fight(overlordEncounter(name), (res) => {
      if (res.outcome === 0 && !S.overlords.includes(name)) {
        S.overlords.push(name);
        save();
        toast(`${name} has been defeated! (${S.overlords.length}/${data().overlords.length})`, 'assets/ui/orig/town/warp_emblem.png');
      }
      toRegion();
    });
  }
}
void go;
