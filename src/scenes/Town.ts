import Phaser from 'phaser';
import { data, maps, region, regionByName, species, speciesByName, spriteUrl, town as townData } from '../core/data';
import { S, save, buildQuest, questDone, questEvent, heroLevel, rollGem, findMon, allMonsters, fuse, partySize } from '../core/state';
import { arenaEncounter, breederTeam } from '../core/encounters';
import { h, layer, modal, toast, dialogue, confirmBox, stars, fill, anyModal } from '../ui/dom';
import { hud, openMenu, questGoalText, openEgg, monCard, elChip } from '../ui/menus';
import { music, sfx } from '../audio';
import { toRegion, toTown } from '../nav';
import { fight } from '../flow';
import { Rng } from '../core/rng';
import { displayName } from '../core/monster';
import { type WalkGrid, type Pt } from '../core/walkgrid';
import { planTown, pickPlate, townGrid, groundLine, scaleAt, type TownArt, type TownPlan, type Placed, type PlateId } from '../core/townplan';
import '../ui/town.css';

const SPEED = 330;   // hero walking speed (world px per second)
const NEAR = 70;     // how close to a door (world px) its action shows in the action bar
const LABEL_PX = 15; // name plate text size on screen (px)
const LABEL_MIN_CSS = 11; // …and never smaller than this on the device (CSS px), however small the canvas is shown
const HINT_MS = 5000; // how long the "tap to walk" hint stays after arriving

/** Where to put the hero back after a battle started from town (the Arena, the tournament board). */
let resume: { town: string; x: number; y: number } | null = null;

const at = (p: Pt, x: number, y: number) => { p.x = x; p.y = y; return p; };

type Keys = Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;

export class TownScene extends Phaser.Scene {
  constructor() { super('Town'); }
  private name = '';
  private ready = false;
  private alive = false;
  private frozen = false;
  private plan?: TownPlan;
  private grid!: WalkGrid;
  private hero!: Phaser.GameObjects.Container;
  private heroImg!: Phaser.GameObjects.Image;
  private heroShadow!: Phaser.GameObjects.Image;
  private heroH = 88;
  private heroW = 30;
  /** reused for walk-grid lookups, so walking allocates nothing per frame */
  private probe: Pt = { x: 0, y: 0 };
  private route: Pt[] = [];
  private target?: Placed;
  private near?: Placed;
  private walking = false;
  private walkT = 0;
  private uses: Placed[] = [];
  private walls: Placed[] = [];
  private keys?: Keys;
  private drag = { on: false, moved: false, x: 0, y: 0, sx: 0, sy: 0 };
  private labels = new Map<Placed, Phaser.GameObjects.Container>();
  private plates: { x: number; y: number; w: number; h: number }[] = [];
  private plateW = 2736;
  /** the bottom action bar, refilled in place when the nearest door changes (the HUD stays untouched) */
  private actionsEl?: HTMLElement;
  private hintUntil = 0;
  private moved = false;
  /** the camera follows the hero until the map is dragged; any new walk picks it up again */
  private following = false;
  /** a full-screen DOM layer (Monster Keep, Monsterpedia, a dialogue) is open: its keys are not for walking */
  private uiBlock = false;
  private uiWatch?: MutationObserver;

  init(d: { name: string }) {
    this.name = d.name;
    this.alive = true;
    this.ready = this.frozen = this.walking = false;
    this.plan = undefined;
    this.route = [];
    this.target = this.near = undefined;
    this.uses = [];
    this.walls = [];
    this.labels.clear();
    this.plates = [];
    this.actionsEl = undefined;
    this.moved = this.following = this.uiBlock = false;
    this.hintUntil = 0;
  }

  create() {
    music('town');
    this.events.once('shutdown', () => { this.alive = false; this.ready = false; this.uiWatch?.disconnect(); });
    // watch the UI root once per visit instead of querying the DOM every frame
    const root = document.getElementById('ui');
    const check = () => { this.uiBlock = !!document.querySelector('[data-layer="team"], [data-layer="book"], [data-layer="dialogue"]'); };
    if (root) { this.uiWatch = new MutationObserver(check); this.uiWatch.observe(root, { childList: true }); }
    check();
    const t = townData(this.name)!;
    const reg = regionByName(t.region)!;
    const spot = maps()[reg.id].spots.find((s) => s.kind === 'town' && s.ref === this.name);
    if (spot) { S.location = { region: reg.id, spot: spot.id }; S.lastTown = { ...S.location }; }
    questEvent('visit', this.name);
    save();
    this.cameras.main.setBackgroundColor('#0b1420');
    this.render();
    const ready = S.quests.filter(questDone).filter((q) => q.town === this.name);
    if (ready.length) toast(`${ready.length} quest(s) ready to turn in at the Guild!`, 'assets/ui/orig/bk/btn_scroll.png');
    const hasDock = maps()[reg.id].spots.some((s) => s.kind === 'dock');
    this.loadArt(pickPlate(this.name, hasDock, !!t.arena), () => this.build());
  }

  /** The town art is streamed in the first time a town is shown (and the plate whenever it changes). */
  private loadArt(plate: PlateId, done: () => void) {
    const J = [['town_layouts', 'layouts'], ['town_kit', 'kit'], ['town_art', 'art'], ['town_bases', 'bases']];
    const step2 = () => {
      if (!this.alive) return;
      const A = this.art();
      const t = townData(this.name)!;
      this.plan = planTown({ name: this.name, region: t.region, arena: !!t.arena, tournament: !!t.tournament }, plate, A);
      // one plate in GPU memory at a time
      for (const p of ['plaza', 'harbor', 'garden']) if (p !== plate && this.textures.exists(`tw_plate_${p}`)) this.textures.remove(`tw_plate_${p}`);
      const need: [string, string][] = [[`tw_plate_${plate}`, `assets/town/plate_${plate}.jpg`], [`tw_walk_${plate}`, `assets/town/walk_${plate}.png`], ['tw_hero', 'assets/town/hero.webp']];
      for (const it of this.plan.items) need.push([`tp_${it.piece}`, it.url]);
      const todo = need.filter(([k]) => !this.textures.exists(k));
      if (!todo.length) return done();
      const seen = new Set<string>();
      for (const [k, u] of todo) if (!seen.has(k)) { seen.add(k); this.load.image(k, u); }
      this.load.once('complete', () => { if (this.alive) done(); });
      this.load.start();
    };
    const missing = J.filter(([k]) => !this.cache.json.exists(k));
    if (!missing.length) return step2();
    for (const [k, f] of missing) this.load.json(k, `assets/town/${f}.json`);
    this.load.once('complete', step2);
    this.load.start();
  }

  private art(): TownArt {
    const j = (k: string) => this.cache.json.get(k);
    return { layouts: j('town_layouts'), kit: j('town_kit'), art: j('town_art'), bases: j('town_bases') };
  }

  /** Lay the town out on its plate: buildings, trees, townsfolk, the hero; then fade in. */
  private build() {
    const plan = this.plan!;
    const lay = plan.layout;
    const cam = this.cameras.main;
    const plate = this.add.image(0, 0, `tw_plate_${plan.plate}`).setOrigin(0).setDepth(-10);
    const PW = plate.width, PH = plate.height;
    this.plateW = PW;

    // the walk grid, read from the plate's walk mask (one pixel per cell)
    const src = this.textures.get(`tw_walk_${plan.plate}`).getSourceImage() as HTMLImageElement;
    const cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0);
    const cell = this.art().layouts.cell;
    this.grid = townGrid(plan, ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, cell);

    if (!this.textures.exists('tw_shadow')) {
      const c = this.textures.createCanvas('tw_shadow', 64, 32)!;
      const g = c.getContext();
      g.setTransform(1, 0, 0, 0.5, 0, 0);
      const r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      r.addColorStop(0, 'rgba(10,14,30,0.55)');
      r.addColorStop(1, 'rgba(10,14,30,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
      c.refresh();
    }
    if (!this.textures.exists('tw_cast')) {
      // the cast shadow of buildings and props: a wide soft oval, darkest a little off its middle
      const c = this.textures.createCanvas('tw_cast', 128, 64)!;
      const g = c.getContext();
      g.setTransform(1, 0, 0, 0.5, 0, 0);
      const r = g.createRadialGradient(60, 66, 6, 64, 64, 64);
      r.addColorStop(0, 'rgba(12,16,34,0.62)');
      r.addColorStop(0.55, 'rgba(12,16,34,0.38)');
      r.addColorStop(1, 'rgba(12,16,34,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 128, 128);
      c.refresh();
    }

    // camera: the plate fills the screen; on phones the view is a little closer
    const { width, height } = this.scale;
    const cover = Math.max(width / PW, height / PH);
    const k = Math.max(Math.min(width / 1280, height / 720), Math.min(width / 390, height / 844) * 0.95);
    // shown on a phone the 1280x720 canvas shrinks to a strip: look closer so the town stays legible
    const phone = this.scale.displaySize.width > 0 && this.scale.displaySize.width < 600;
    const zoom = Math.max(cover, lay.zoom * Math.min(1.2, k) * (phone ? 1.35 : 1));
    cam.setZoom(zoom).setBounds(0, 0, PW, PH);

    for (const it of plan.items) this.drawItem(it, zoom);

    // the hero, coming in through the gate (or back from the Arena)
    const A = this.art();
    const gate = plan.items.find((i) => i.service === 'gate');
    let start: Pt = gate?.door ?? plan.arrive;
    let walkIn = true;
    if (resume && resume.town === this.name) { start = { x: resume.x, y: resume.y }; walkIn = false; }
    resume = null;
    this.heroH = A.art.hero.h;
    this.heroW = A.art.hero.w;
    this.hero = this.add.container(start.x, start.y);
    this.heroShadow = this.add.image(0, 0, 'tw_shadow');
    this.heroImg = this.add.image(0, 0, 'tw_hero').setOrigin(0.5, 0.98);
    this.hero.add([this.heroShadow, this.heroImg]);
    this.sizeHero();
    this.heroDepth();
    cam.centerOn(walkIn ? plan.arrive.x : start.x, walkIn ? plan.arrive.y : start.y);
    if (walkIn) this.route = this.grid.path(start, plan.arrive) ?? [];

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { this.drag = { on: true, moved: false, x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY }; });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag.on || !p.isDown || anyModal()) return;
      const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 8) return;
      this.drag.moved = true;
      cam.stopFollow();
      this.following = false;
      cam.setScroll(this.drag.sx - dx / cam.zoom, this.drag.sy - dy / cam.zoom);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      const tap = this.drag.on && !this.drag.moved;
      this.drag.on = false;
      if (!tap || anyModal() || this.frozen) return;
      const it = over.length ? (over[0].getData('item') as Placed | undefined) : undefined;
      if (it) return this.goUse(it);
      const w = cam.getWorldPoint(p.x, p.y);
      this.goTo({ x: w.x, y: w.y });
    });
    this.keys = this.input.keyboard?.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D' }, false) as Keys;

    this.ready = true;
    this.hintUntil = this.time.now + HINT_MS;
    this.time.delayedCall(HINT_MS + 50, () => this.renderActions());
    this.renderActions();
    cam.fadeIn(450);
  }

  /** One piece of the town: its sprite, and for the places you can use, a name plate and a tap target. */
  private drawItem(it: Placed, zoom: number) {
    if (it.kind !== 'npc' && it.kind !== 'fx') this.castShadow(it);
    const img = this.add.image(it.x, it.y, `tp_${it.piece}`).setOrigin(it.ox, it.oy).setFlipX(it.flip).setDepth(it.depth);
    img.setDisplaySize(it.w, it.h);
    if (it.base) this.walls.push(it);
    if (it.kind === 'npc') {
      const sh = this.add.image(it.x, it.y, 'tw_shadow').setDepth(it.depth - 0.01);
      sh.setDisplaySize(it.w * 1.9, it.w * 0.55);
      // townsfolk breathe a little
      this.tweens.add({ targets: img, scaleY: img.scaleY * 1.012, duration: 1500 + (it.x % 7) * 120, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    if (it.piece.startsWith('effects_healing-crystal')) {
      // the shrine's crystal pulses with light
      const glow = this.add.image(it.x, it.y - it.h * 0.45, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0x8fe3ff).setDepth(it.depth + 0.01);
      glow.setDisplaySize(it.w * 2.6, it.w * 2.6);
      this.tweens.add({ targets: glow, alpha: { from: 0.55, to: 1 }, scale: glow.scale * 1.12, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.tweens.add({ targets: img, alpha: { from: 0.8, to: 1 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    if (it.glow) {
      const g = this.add.image(it.glow.x, it.glow.y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffa743).setDepth(it.depth + 0.01).setAlpha(0.6);
      g.setDisplaySize(150 * it.scale, 150 * it.scale);
      this.tweens.add({ targets: g, alpha: { from: 0.45, to: 0.7 }, duration: 1800 + (it.x % 5) * 200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    if (!it.service) return;
    this.uses.push(it);
    img.setData('item', it);
    img.setInteractive(it.kind === 'npc' ? { useHandCursor: true } : { useHandCursor: true, pixelPerfect: true, alphaTolerance: 60 });
    if (it.label) {
      const lab = this.nameplate(it, zoom);
      img.on('pointerover', () => lab.setScale(1.08)).on('pointerout', () => lab.setScale(1));
    }
  }

  /**
   * A soft shadow on the ground under a building or prop, cast toward the lower left like everything painted
   * into the plates (the evening light comes from the upper right).
   */
  private castShadow(it: Placed) {
    const b = it.base;
    const w = b ? (b.span ? b.span[1] - b.span[0] : it.w * 0.92) : it.foot ? Math.max(it.foot.w * 1.6, it.w * 0.55) : it.w * 0.6;
    const cx = b?.span ? (b.span[0] + b.span[1]) / 2 : it.x + (0.5 - it.ox) * it.w * (b ? 1 : 0);
    const deep = b ? b.deep : Math.max(it.foot?.h ?? 0, it.w * 0.12) * 1.6;
    const sh = this.add.image(cx - w * 0.12, it.y - deep * 0.25, 'tw_cast').setDepth(it.depth - 0.02);
    sh.setDisplaySize(w * 1.2, deep * 1.7).setAlpha(b ? 0.85 : 0.7);
  }

  /** A painted slate strip with the place's name, hung over it. */
  private nameplate(it: Placed, zoom: number) {
    // on a small screen the 1280x720 canvas is shown scaled down: the plates grow a little to stay legible
    const shown = this.scale.displaySize.width / this.scale.gameSize.width || 1;
    const fs = (Math.max(LABEL_PX, LABEL_MIN_CSS / shown) / zoom);
    const txt = this.add.text(0, 0, it.label!, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: '900', fontSize: `${fs}px`, color: '#ffffff', stroke: '#0a0f1c', strokeThickness: fs * 0.22 }).setOrigin(0.5, 0.52);
    txt.setResolution(Math.min(2, window.devicePixelRatio || 1) * zoom);
    const w = txt.width + fs * 1.9, hh = fs * 2.15;
    const s = Math.min(1, hh / 72);
    const strip = this.add.nineslice(0, 0, 'btn_strip_slate', undefined, w / s, 72, 30, 30, 20, 20).setScale(s);
    // above the roof ridge, so the painted facade, its sign and its goods stay in view
    let y = it.y - it.oy * it.h - hh * (it.kind === 'npc' ? 0.7 : 0.55);
    // the gate's plate hangs at its foot (where the road leaves town) unless that is the bottom edge of the plate
    const plateH = this.textures.get(`tw_plate_${this.plan!.plate}`).getSourceImage().height;
    if (it.kind === 'gate' && it.y + hh * 1.6 < plateH) y = it.y + hh * 0.9;
    let x = it.kind !== 'npc' && it.door ? Phaser.Math.Clamp(it.door.x, it.x - it.w * 0.25, it.x + it.w * 0.25) : it.x;
    // never on top of another plate
    for (let tries = 0; tries < 6; tries++) {
      const hit = this.plates.find((r) => Math.abs(r.x - x) < (r.w + w) / 2 + 6 && Math.abs(r.y - y) < (r.h + hh) / 2 + 4);
      if (!hit) break;
      y = hit.y - (hit.h + hh) / 2 - 6;
    }
    // a roof at the very top of the plate gets its plate a little lower, clear of the HUD and the town's name
    y = Math.max(hh * 0.6 + 72 / zoom, y);
    x = Phaser.Math.Clamp(x, w / 2 + 8, this.plateW - w / 2 - 8);
    this.plates.push({ x, y, w, h: hh });
    const c = this.add.container(x, y, [strip, txt]).setDepth(9000 + it.y * 0.01);
    this.labels.set(it, c);
    return c;
  }

  update(_t: number, delta: number) {
    if (!this.ready) return;
    const k = this.keys;
    const dt = Math.min(delta, 50) / 1000;
    // keys typed into a text field (naming a monster…) are not for walking
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    const busy = this.frozen || this.uiBlock || typing || anyModal();
    const vx = k && !busy ? (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0) : 0;
    const vy = k && !busy ? (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0) : 0;
    let moving = false;
    if (vx || vy) {
      this.route.length = 0;
      this.target = undefined;
      this.userMoved();
      const len = Math.hypot(vx, vy), s = SPEED * dt;
      moving = this.step((vx / len) * s, (vy / len) * s);
    } else if (!busy && this.route.length) {
      const t = this.route[0];
      const dx = t.x - this.hero.x, dy = t.y - this.hero.y, d = Math.hypot(dx, dy), s = SPEED * dt;
      moving = true;
      if (d <= s) {
        this.place(t.x, t.y);
        this.route.shift();
        if (!this.route.length) this.reached();
      } else this.place(this.hero.x + (dx / d) * s, this.hero.y + (dy / d) * s);
    }
    if (moving) {
      this.walkT += delta;
      this.heroImg.y = -Math.abs(Math.sin(this.walkT * 0.011)) * this.heroH * 0.05 * this.heroImg.scaleY * 1.5;
      if (!this.walking) this.walking = true;
      if (!this.following) this.follow();
    } else if (this.walking) {
      this.walking = false;
      this.heroImg.y = 0;
    }
  }

  // ---------------------------------------------------------------- walking
  private goTo(p: Pt, it?: Placed) {
    const path = this.grid.path({ x: this.hero.x, y: this.hero.y }, p);
    if (!path) return;
    this.route = path;
    this.target = it;
    this.userMoved();
    this.follow();
    if (!it) this.marker(p);
  }

  /** The camera goes back to the hero (after the map was dragged to look around). */
  private follow() {
    if (this.following) return;
    this.following = true;
    this.cameras.main.startFollow(this.hero, true, 0.1, 0.1);
  }

  /** The first step the player takes puts the "tap to walk" hint away. */
  private userMoved() {
    if (this.moved) return;
    this.moved = true;
    this.renderActions();
  }

  /** A small ripple where you tapped. */
  private marker(p: Pt) {
    const r = this.add.image(p.x, p.y, 'tw_shadow').setDepth(p.y - 1).setAlpha(0.9);
    r.setDisplaySize(40, 14);
    this.tweens.add({ targets: r, scaleX: r.scaleX * 2, scaleY: r.scaleY * 2, alpha: 0, duration: 450, onComplete: () => r.destroy() });
  }

  /** Tap a place: walk to its door, then use it (at once if already there). */
  private goUse(it: Placed) {
    sfx('select');
    const d = it.door ?? it;
    if (Phaser.Math.Distance.Between(this.hero.x, this.hero.y, d.x, d.y) < NEAR) { this.route.length = 0; return this.use(it); }
    this.goTo(d, it);
  }

  private step(dx: number, dy: number) {
    const x = this.hero.x, y = this.hero.y;
    const p = this.probe;
    if (this.grid.canStand(at(p, x + dx, y + dy))) this.place(x + dx, y + dy);
    else if (dx && this.grid.canStand(at(p, x + dx, y))) this.place(x + dx, y);
    else if (dy && this.grid.canStand(at(p, x, y + dy))) this.place(x, y + dy);
    else return false;
    return true;
  }

  private place(x: number, y: number) {
    const ox = this.hero.x;
    this.hero.setPosition(x, y);
    if (Math.abs(x - ox) > 0.3) this.heroImg.setFlipX(x < ox);
    this.sizeHero();
    this.heroDepth();
    // the nearest door in reach shows its action
    let best: Placed | undefined, bd = NEAR;
    for (const u of this.uses) {
      const d = u.door ?? u;
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bd) { bd = dist; best = u; }
    }
    if (best !== this.near) { this.near = best; this.renderActions(); }
  }

  /** The painting has some perspective: the hero grows a little nearer the bottom. */
  private sizeHero() {
    const s = scaleAt(this.plan!.layout, this.hero.y);
    this.heroImg.setDisplaySize(this.heroW * s, this.heroH * s);
    this.heroShadow.setDisplaySize(this.heroW * s * 1.9, this.heroW * s * 0.6);
  }

  /** Sorted by where the feet touch the ground; in front of a wall the hero stands in front of the building. */
  private heroDepth() {
    const x = this.hero.x, y = this.hero.y;
    let d = y;
    for (const b of this.walls) {
      if (y >= b.y) continue;
      const gl = groundLine(b, x);
      if (gl != null && y >= gl - 1 && b.depth + 0.5 > d) d = b.depth + 0.5;
    }
    this.hero.setDepth(d + 0.001);
  }

  private reached() {
    const it = this.target;
    this.target = undefined;
    if (it) this.use(it);
  }

  // ---------------------------------------------------------------- places
  private use(it: Placed) {
    const refresh = () => this.render();
    switch (it.service) {
      case 'guild': return this.guild();
      case 'market': return this.shop();
      case 'lab': return this.lab();
      case 'warp': return this.warp();
      case 'keep': return openMenu('team', refresh);
      case 'hero': return openMenu('hero', refresh);
      case 'arena': return this.arena();
      case 'board': return this.tournament();
      case 'pedia': return this.talk(it, () => openMenu('pedia', refresh));
      case 'npc': return this.talk(it);
      case 'gate': {
        this.frozen = true;
        resume = null;
        this.cameras.main.fadeOut(300, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => toRegion());
        return;
      }
    }
  }

  /** A fight started from town brings the hero back to where he stood (only once the fight really begins). */
  private keepSpot() {
    if (this.hero) resume = { town: this.name, x: this.hero.x, y: this.hero.y };
  }

  private async talk(it: Placed, then?: () => void) {
    this.frozen = true;
    // face whoever you talk to
    this.heroImg.setFlipX(it.x < this.hero.x);
    await dialogue([{ who: it.who, text: it.line ?? '' }]);
    this.frozen = false;
    then?.();
  }

  private actionLabel(it: Placed) {
    if (it.service === 'gate') return `Leave for ${townData(this.name)!.region}`;
    if (it.service === 'npc') return `Talk to the ${it.who}`;
    if (it.service === 'pedia') return 'Talk to the Scholar';
    if (it.service === 'board') return 'Read the Notice Board';
    return `Enter the ${it.label}`;
  }

  render() {
    const t = townData(this.name)!;
    const refresh = () => this.render();
    hud((k) => openMenu(k, refresh));
    const ready = S.quests.filter((q) => q.town === this.name && questDone(q)).length;
    this.actionsEl = h('div', { class: 'town-actions' });
    layer('scene', h('div', {},
      h('div', { class: 'town-name' }, this.name, ready ? h('span', { class: 'chip gold', style: { marginLeft: '.5em' } }, h('img', { class: 'chip-ic', src: 'assets/ui/orig/bk/btn_scroll.png', alt: '' }), `${ready} ready at the Guild`) : null),
      h('div', { class: 'town-sub' }, t.region),
      this.actionsEl));
    this.renderActions();
  }

  /**
   * The bottom action bar: the door in reach, else (only for the first moments in town) how to get about.
   * Refilled on its own, so walking past doors never rebuilds the HUD (or closes its open menu).
   */
  private renderActions() {
    const el = this.actionsEl;
    if (!el || !el.isConnected) return;
    const n = this.near;
    const hint = !n && this.ready && !this.moved && this.time.now < this.hintUntil;
    fill(el,
      n ? h('button', { class: `btn ${n.service === 'gate' ? 'green' : 'gold'}`, onClick: () => { sfx('select'); this.use(n); } }, this.actionLabel(n)) : null,
      n?.sub ? h('span', { class: 'chip panel town-what' }, n.sub) : null,
      hint ? h('span', { class: 'chip panel town-hint' }, 'Tap the ground to walk · tap a building to enter') : null);
  }

  // ---------------------------------------------------------------- Guild
  guild() {
    const t = townData(this.name)!;
    const root = h('div', { class: 'col' });
    const render = () => {
      const mine = S.quests.filter((q) => q.town === this.name);
      const offers = t.quests.map((_, i) => i).filter((i) => !S.questsDone.includes(`${this.name}#${i}`) && !S.quests.some((q) => q.id === `${this.name}#${i}`));
      fill(root, 
        h('div', { class: 'row' }, h('b', {}, `Active quests ${S.quests.length}/3`), h('span', { class: 'grow' }), h('span', { class: 'muted' }, `Completed: ${S.questCount}`)),
        ...mine.map((q) => h('div', { class: 'abil col' },
          h('div', { class: 'row' }, h('b', {}, q.title), h('span', { class: 'chip' }, q.type), h('span', { class: 'grow' }),
            questDone(q) ? h('button', { class: 'btn small gold', onClick: () => { this.turnIn(q.id); render(); } }, 'Turn in') :
              h('button', { class: 'btn small', onClick: () => { S.quests = S.quests.filter((x) => x !== q); save(); render(); } }, 'Drop')),
          h('div', { class: 'muted' }, q.text), h('div', {}, questGoalText(q)))),
        h('h3', {}, 'Requests'),
        ...offers.slice(0, 6).map((i) => {
          const q = buildQuest(this.name, i);
          return h('div', { class: 'abil col' },
            h('div', { class: 'row' }, h('b', {}, q.title), h('span', { class: 'chip' }, q.type), h('span', { class: 'grow' }),
              h('span', { class: 'muted' }, `Reward: ${q.reward.silver} silver${q.reward.gold ? ` + ${q.reward.gold} gold` : ''}${q.reward.egg ? ' + Egg' : ''}`),
              h('button', { class: 'btn small green', disabled: S.quests.length >= 3, onClick: () => { S.quests.push(q); save(); sfx('select'); render(); } }, 'Accept')),
            h('div', { class: 'muted' }, q.text), h('div', {}, questGoalText(q)));
        }),
        offers.length ? null : h('p', { class: 'muted' }, 'The Guild here has no more requests. Try other towns!'));
    };
    render();
    modal(`${this.name} Guild`, root, { width: '56em', onClose: () => this.render() });
  }

  turnIn(id: string) {
    const q = S.quests.find((x) => x.id === id)!;
    S.quests = S.quests.filter((x) => x !== q);
    S.questsDone.push(id);
    S.questCount++;
    S.silver += q.reward.silver;
    if (q.reward.gold) S.gold += q.reward.gold;
    if (q.reward.egg) S.items.egg++;
    sfx('coin');
    toast(`Quest complete! +${q.reward.silver} silver${q.reward.gold ? `, +${q.reward.gold} gold` : ''}${q.reward.egg ? ', +1 Egg' : ''}`);
    save();
  }

  // ---------------------------------------------------------------- Shop
  shop() {
    const root = h('div', { class: 'col' });
    const buy = (cost: number, cur: 'silver' | 'gold', fn: () => void) => {
      if (S[cur] < cost) return toast(`Not enough ${cur}.`);
      S[cur] -= cost;
      fn();
      sfx('coin');
      save();
      render();
    };
    const gemShape = (n: string) => (['Oval', 'Square', 'Tear', 'Star'].find((s) => n.includes(s)) ?? 'Oval') as 'Oval';
    const render = () => {
      const items = data().shop.map((it) => {
        let act: () => void = () => {};
        if (/^card$/i.test(it.item)) act = () => (S.items.card += 1);
        else if (/silver card/i.test(it.item)) act = () => (S.items.silver += 1);
        else if (/gold card/i.test(it.item)) act = () => (S.items.gold += 1);
        else if (/gem/i.test(it.item)) act = () => { const g = rollGem(gemShape(it.item), /imbued/i.test(it.item)); S.gems.push(g); toast(`Got a ${g.shape} gem!`); };
        else if (/golden egg/i.test(it.item)) act = () => (S.items.golden += 1);
        else if (/egg/i.test(it.item)) act = () => (S.items.egg += 1);
        else return null;
        // non-breaking hyphens: names wrap only at spaces
        return h('tr', {}, h('td', {}, h('b', {}, it.item.replace(/-/g, '\u2011'))), h('td', { class: 'muted' }, it.desc),
          h('td', { style: { whiteSpace: 'nowrap' } }, `${it.price.toLocaleString()} ${it.currency}`),
          h('td', {}, h('button', { class: 'btn small gold', disabled: S[it.currency] < it.price, onClick: () => buy(it.price, it.currency, act) }, 'Buy')),
          /card$/i.test(it.item) ? h('td', {}, h('button', { class: 'btn small gold', disabled: S[it.currency] < it.price * 10, onClick: () => buy(it.price * 10, it.currency, () => { for (let i = 0; i < 10; i++) act(); }) }, '×10')) : h('td', {}));
      }).filter(Boolean) as HTMLElement[];
      const eggRow = (n: string, price: number, fn: () => void) => h('tr', {}, h('td', {}, h('b', {}, n)), h('td', { class: 'muted' }, n === 'Egg' ? 'Spin the wheel for monsters and items.' : 'Rare monsters you have not caught yet, including hatchlings.'),
        h('td', { style: { whiteSpace: 'nowrap' } }, `${price} gold`), h('td', {}, h('button', { class: 'btn small gold', disabled: S.gold < price, onClick: () => buy(price, 'gold', fn) }, 'Buy')), h('td', {}));
      fill(root, 
        h('div', { class: 'row' }, h('span', { class: 'coin' }), h('b', {}, S.silver.toLocaleString()), h('span', { class: 'coin g' }), h('b', {}, S.gold.toLocaleString()),
          h('span', { class: 'grow' }), h('span', { class: 'muted' }, `Cards: ${S.items.card} · Silver ${S.items.silver} · Gold ${S.items.gold} · Eggs ${S.items.egg}/${S.items.golden}`)),
        h('table', { class: 'list', style: '--cols: minmax(7em, 1.3fr) 3fr auto auto 3.6em' }, ...items,
          data().shop.some((x) => /egg/i.test(x.item)) ? null : eggRow('Egg', 30, () => (S.items.egg += 1)),
          data().shop.some((x) => /golden egg/i.test(x.item)) ? null : eggRow('Golden Egg', 100, () => (S.items.golden += 1)),
          h('tr', {}, h('td', {}, h('b', {}, 'Exchange')), h('td', { class: 'muted' }, 'Trade 1,000 silver for 5 gold.'), h('td', { style: { whiteSpace: 'nowrap' } }, '1,000 silver'),
            h('td', {}, h('button', { class: 'btn small gold', disabled: S.silver < 1000, onClick: () => buy(1000, 'silver', () => (S.gold += 5)) }, 'Trade')), h('td', {}))),
        h('div', { class: 'row' }, S.items.egg ? h('button', { class: 'btn gold', onClick: () => openEgg('egg', render) }, `Open Egg (${S.items.egg})`) : null,
          S.items.golden ? h('button', { class: 'btn gold', onClick: () => openEgg('golden', render) }, `Open Golden Egg (${S.items.golden})`) : null));
    };
    render();
    modal(`${this.name} Shop`, root, { width: '58em', onClose: () => this.render() });
  }

  // ---------------------------------------------------------------- Lab
  lab() {
    const root = h('div', { class: 'col' });
    const render = () => {
      const owned = allMonsters();
      fill(root, h('p', { class: 'muted' }, 'Fuse two monsters (each Lv 15+) following a recipe to create a stronger species. Both ingredients are consumed. Recipes come straight from the Dragon Island Blue wiki.'),
        ...data().recipes.map((r) => {
          const a = owned.filter((m) => species(m.species).name === r.parts[0] && m.level >= 15).sort((x, y) => y.level - x.level);
          const b = owned.filter((m) => species(m.species).name === r.parts[1] && m.level >= 15).sort((x, y) => y.level - x.level);
          const pa = a[0], pb = b.find((m) => m !== pa);
          const res = speciesByName(r.result)!;
          const known = (n: string) => S.seen.includes(speciesByName(n)!.id);
          const img = (n: string) => h('img', { src: spriteUrl(speciesByName(n)!), style: { height: '3em', filter: known(n) ? '' : 'brightness(0) opacity(.4)' } });
          return h('div', { class: 'abil row' }, img(r.parts[0]), h('b', {}, '+'), img(r.parts[1]), h('b', {}, '='), img(r.result),
            h('div', { class: 'col grow', style: { gap: '0' } }, h('b', {}, `${r.parts[0]} + ${r.parts[1]} → ${r.result}`), h('span', { class: 'row' }, elChip(res.element), stars(res.stars))),
            h('button', { class: 'btn small gold', disabled: !(pa && pb), onClick: async () => {
              if (!(await confirmBox(`Fuse ${displayName(pa)} (Lv ${pa.level}) and ${displayName(pb!)} (Lv ${pb!.level}) into ${r.result}?`, 'Fuse'))) return;
              if (S.party.length <= 2 && S.party.includes(pa) && S.party.includes(pb!) && allMonsters().length <= 2) return toast('You need at least one other monster.');
              const m = fuse(pa.uid, pb!.uid, r.result);
              if (m) { sfx('evolve'); toast(`${r.result} was born!`); save(); render(); }
            } }, pa && pb ? 'Fuse' : 'Need both'));
        }));
    };
    render();
    modal('Recipe Lab', root, { width: '52em', onClose: () => this.render() });
  }

  // ---------------------------------------------------------------- Warp
  warp() {
    const towns = data().towns.filter((t) => S.visited.includes(regionByName(t.region)!.id) && t.name !== this.name);
    modal('Warp Gate', (close) => h('div', { class: 'col' }, h('p', { class: 'muted' }, 'Instantly travel to any town in a region you have visited. 20 silver per warp.'),
      ...towns.map((t) => h('button', { class: 'btn', onClick: () => {
        if (S.silver < 20) return toast('Not enough silver');
        S.silver -= 20;
        const reg = regionByName(t.region)!;
        const s = maps()[reg.id].spots.find((x) => x.kind === 'town' && x.ref === t.name)!;
        S.location = { region: reg.id, spot: s.id };
        save();
        close();
        sfx('magic');
        toTown(t.name);
      } }, `${t.name} — ${t.region}`)),
      towns.length ? null : h('p', {}, 'Explore more regions to unlock warp destinations.')), { width: '30em' });
  }

  // ---------------------------------------------------------------- Arena
  arena() {
    const next = S.license + 1;
    const lic = data().licenses[next];
    const body = h('div', { class: 'col' },
      h('p', {}, 'The Guild arena tests breeders for their licenses. Each license raises your party size and unlocks gem slots.'),
      lic ? h('div', { class: 'abil col' }, h('b', {}, `Next: ${lic.name} License`), h('div', { class: 'muted' }, lic.text),
        h('div', {}, `Requires Hero Lv ${lic.heroLevel} (you: ${heroLevel()}) and ${lic.quests} completed quests (you: ${S.questCount}).`),
        h('button', { class: 'btn gold', disabled: heroLevel() < lic.heroLevel || S.questCount < lic.quests, onClick: async () => {
          await dialogue([{ who: next % 2 ? 'Arena Master May' : 'Arena Master Herald', text: `So you seek the ${lic.name} license? Show me your bond with your monsters!` }]);
          this.keepSpot();
          fight(arenaEncounter(next), (r) => {
            if (r.outcome === 0) { S.license = next; save(); toast(`${lic.name} License earned! Party size is now ${partySize()}.`); }
            toTown(this.name);
          });
        } }, 'Take the test')) : h('p', {}, 'You hold the highest license — Grandmaster!'));
    modal('Arena', body, { width: '40em' });
  }

  // ---------------------------------------------------------------- Tournament
  tournament() {
    const CLASSES = ['J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
    const S2 = S as typeof S & { tourney?: number };
    const cls = S2.tourney ?? 0;
    const sorted = data().regions.slice().sort((a, b) => a.tier - b.tier);
    const body = h('div', { class: 'col' },
      h('p', {}, 'Battle through the tournament classes. Every win awards an egg; the final classes award Golden Eggs.'),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, ...CLASSES.map((c, i) => h('span', { class: `chip ${i < cls ? 'good' : i === cls ? 'gold' : ''}` }, `${c} class`))),
      cls < CLASSES.length ? h('button', { class: 'btn gold', onClick: () => {
        const reg = sorted[Math.min(15, Math.round(cls * 1.45))];
        const team = breederTeam(reg.id, new Rng(cls * 977), 3 + Math.floor(cls / 2), 4);
        this.keepSpot();
        fight({ kind: 'arena', name: `${CLASSES[cls]}-class champion`, team, bg: 'arena', capturable: false, canFlee: false,
          reward: { silver: 300 * (cls + 1), egg: cls >= 8 ? 'golden' : 'egg' }, intro: `Tournament — ${CLASSES[cls]} class` }, (r) => {
          if (r.outcome === 0) { S2.tourney = cls + 1; save(); toast(`${CLASSES[cls]} class cleared!`); }
          toTown(this.name);
        });
      } }, `Fight the ${CLASSES[cls]} class`) : h('p', {}, 'Tournament champion!'));
    modal('Tournament', body, { width: '40em' });
    void region; void findMon; void monCard;
  }
}
