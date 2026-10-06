import Phaser from 'phaser';
import { vignette, ambient } from './fx';
import { data, maps, region, speciesByName, spriteUrl, dungeon as dungeonData, overlord as overlordData } from '../core/data';
import { S, save, questEvent, hash, exploreState, reveal, rollGem, grantPrize } from '../core/state';
import type { Spot } from '../core/types';
import { wildEncounter, breederEncounter, overlordEncounter, rareEncounter } from '../core/encounters';
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
const FOG_R = 420;          // radius of the clearing around each explored spot (world px)
const MINI_W = 256, MINI_H = 144;

export class RegionScene extends Phaser.Scene {
  constructor() { super('Region'); }
  private token!: Phaser.GameObjects.Container;
  private moving = false;
  private markers = new Map<number, Phaser.GameObjects.Container>();
  private fog!: Phaser.GameObjects.RenderTexture;
  private view?: Phaser.GameObjects.Graphics;
  private WW = 2560;
  private WH = 1440;
  private drag = { on: false, moved: false, x: 0, y: 0, sx: 0, sy: 0, mini: false };
  private keys?: Phaser.Types.Input.Keyboard.CursorKeys;

  private P(s: Spot) { return { x: s.x * this.WW, y: s.y * this.WH }; }
  private seen(id: number) { return exploreState(S.location.region).seen.includes(id); }
  private isDone(s: Spot) { return exploreState(S.location.region).done.includes(s.id); }
  /** Spots the token walks through without stopping: wild areas and discoveries already claimed. */
  private passable(s: Spot) { return s.kind === 'field' || (DISCOVERY.has(s.kind) && this.isDone(s)); }

  create() {
    this.view = undefined;
    this.keys = undefined;
    loadMap(this, S.location.region, () => this.build());
  }

  private build() {
    const r = region(S.location.region);
    const m = maps()[r.id];
    const { width, height } = this.scale;
    music('world');
    this.moving = false;
    this.markers.clear();
    this.view = undefined;
    // the 4K painting is shown at full resolution: the region is a world three screens wide that scrolls
    const bg = this.add.image(0, 0, `map_${r.id}`).setOrigin(0);
    const k = Math.max(width * 3 / bg.width, height * 3 / bg.height);
    bg.setScale(k);
    this.WW = bg.width * k;
    this.WH = bg.height * k;
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.WW, this.WH);
    const vig = vignette(this, 0.45).setScrollFactor(0);
    const amb = ambient(this, 0xffffff, 14).setScrollFactor(0);
    cam.fadeIn(350);

    // where you stand, the roads out of it and any quest targets are always known
    const questSpots = new Map<number, string>();
    for (const q of S.quests) if (q.goal.kind === 'battle' && q.goal.region === r.id && q.progress < 1 && q.goal.spot != null) questSpots.set(q.goal.spot, q.id);
    const here0 = m.spots[S.location.spot] ?? m.spots[0];
    reveal(r.id, [here0.id, ...this.neighbours(here0.id), ...questSpots.keys()]);

    for (const s of m.spots) this.markers.set(s.id, this.marker(s, questSpots.has(s.id)));

    // fog of war: a dark layer with soft clearings punched out around every explored spot
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
    for (const id of exploreState(r.id).seen) this.clearFog(m.spots[id]);

    // player token = lead monster
    const lead = S.party[0];
    const sp = species(lead.species);
    const here = this.P(here0);
    this.token = this.add.container(here.x, here.y).setDepth(10);
    const halo = this.add.circle(0, 0, 26, 0xf6c453, 0.25).setStrokeStyle(2, 0xf6c453);
    this.token.add(halo);
    this.tweens.add({ targets: halo, scale: 1.3, alpha: 0.1, duration: 1100, repeat: -1 });
    loadSprites(this, [sp.sprite], () => {
      const img = this.add.image(0, -24, `spr_${sp.sprite}`);
      img.setScale(Math.min(64 / img.width, 64 / img.height)).setFlipX(true);
      this.token.add(img);
      this.tweens.add({ targets: img, y: -30, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    });
    cam.centerOn(here.x, here.y);

    // minimap: a second camera that sees the whole region, with the main view outlined on it
    const mx = width - MINI_W - 14, my = 60;
    const frame = this.add.graphics().setScrollFactor(0).setDepth(80);
    frame.fillStyle(0x000000, 0.55).fillRoundedRect(mx - 6, my - 6, MINI_W + 12, MINI_H + 12, 8);
    frame.lineStyle(3, 0xf6d27a, 1).strokeRoundedRect(mx - 4, my - 4, MINI_W + 8, MINI_H + 8, 6);
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
    this.input.on('pointerup', () => { this.drag.on = false; });
    this.keys = this.input.keyboard?.createCursorKeys();

    if (!S.visited.includes(r.id)) S.visited.push(r.id);
    save();
    this.ui();
    if (questSpots.size) toast('⚔ marks a quest target in this region.');
    else if (exploreState(r.id).seen.length <= 5) toast('Drag the map to look around. Unexplored land is hidden in fog.');
  }

  update() {
    const cam = this.cameras.main;
    const k = this.keys;
    if (k && !anyModal()) {
      const vx = (k.right.isDown ? 1 : 0) - (k.left.isDown ? 1 : 0), vy = (k.down.isDown ? 1 : 0) - (k.up.isDown ? 1 : 0);
      if (vx || vy) { cam.stopFollow(); cam.setScroll(cam.scrollX + vx * 14, cam.scrollY + vy * 14); }
    }
    const v = cam.worldView;
    this.view?.clear().lineStyle((this.WW / MINI_W) * 2, 0xffffff, 0.95).strokeRect(v.x, v.y, v.width, v.height);
  }

  private marker(s: Spot, quest: boolean) {
    const st = KIND_STYLE[s.kind];
    const p = this.P(s);
    const c = this.add.container(p.x, p.y).setDepth(3).setVisible(this.seen(s.id));
    const defeatedOverlord = s.kind === 'overlord' && s.ref && S.overlords.includes(s.ref);
    const field = s.kind === 'field';
    const done = DISCOVERY.has(s.kind) && this.isDone(s);
    const ring = this.add.circle(0, 0, field ? 11 : 30, st.color, field ? (defeatedOverlord ? 0.35 : 0.9) : 0.001);
    if (field) ring.setStrokeStyle(3, 0xffffff, 0.95);
    c.add(this.add.ellipse(2, field ? 6 : 14, field ? 34 : 70, field ? 14 : 22, 0x000000, field ? 0.35 : 0.22));
    c.add(ring);
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
    if (field) {
      const flag = this.add.text(-2, -30, '⚑', { fontSize: '26px', color: '#3bdc6a', stroke: '#063', strokeThickness: 3 }).setOrigin(0.5);
      c.add(flag);
      this.tweens.add({ targets: flag, angle: { from: -6, to: 6 }, duration: 900 + (s.id % 5) * 120, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    if (quest) {
      const q = this.add.text(0, -40, '⚔', { fontSize: '28px', color: '#ff5050', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5);
      c.add(q);
      this.tweens.add({ targets: q, y: -48, duration: 600, yoyo: true, repeat: -1 });
    }
    if (!field) {
      const label = s.kind === 'exit' ? `→ ${region(s.ref!).name}` : s.kind === 'dock' ? `⛵ ${region(s.ref!).name}`
        : DISCOVERY.has(s.kind) ? `${st.label}${done ? ' ✔' : ''}` : s.ref!;
      c.add(this.add.text(0, 28, label, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold', fontSize: '15px', color: done ? '#cfd6dd' : '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0));
    }
    // taps fire on release so dragging the map across a marker doesn't send you walking
    ring.setInteractive({ useHandCursor: true }).on('pointerup', () => { if (!this.drag.moved) this.clickSpot(s); });
    ring.on('pointerover', () => c.setScale(1.15)).on('pointerout', () => c.setScale(1));
    return c;
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
      toast(`🗺 ${r.name} fully explored! +${silver} Silver and a Golden Egg`);
    }
    save();
    this.ui();
  }

  ui() {
    const r = region(S.location.region);
    const m = maps()[r.id];
    const spot = m.spots[S.location.spot];
    const refresh = () => this.ui();
    const e = exploreState(r.id);
    const pct = Math.round((e.seen.length / m.spots.length) * 100);
    const found = m.spots.filter((s) => DISCOVERY.has(s.kind) && e.done.includes(s.id)).length;
    const total = m.spots.filter((s) => DISCOVERY.has(s.kind)).length;
    const doneDisc = !!spot && DISCOVERY.has(spot.kind) && this.isDone(spot);
    hud((k) => openMenu(k, refresh), [h('button', { class: 'btn small gold', onClick: () => toWorld() }, '🗺 World')]);
    const pool = r.monsters.slice(0, 14).map((n) => speciesByName(n)).filter(Boolean);
    layer('scene', h('div', {},
      h('div', { class: 'region-title' }, h('h2', {}, r.name), h('div', {}, `Wild monsters Lv ${r.levels[0]}–${r.levels[1]}`),
        h('div', { class: 'explore-bar' }, h('i', { style: { width: `${pct}%` } }), h('span', {}, `Explored ${pct}% · Discoveries ${found}/${total}`))),
      h('div', { class: 'region-actions' },
        spot?.kind === 'field' || doneDisc ? h('button', { class: 'btn green', onClick: () => this.hunt() }, '⚔ Hunt here') : null,
        spot && DISCOVERY.has(spot.kind) && !doneDisc ? h('button', { class: 'btn gold', onClick: () => this.discover(spot) }, `✦ ${KIND_STYLE[spot.kind].label}`) : null,
        spot?.kind === 'town' ? h('button', { class: 'btn gold', onClick: () => toTown(spot.ref!) }, `Enter ${spot.ref}`) : null,
        spot?.kind === 'dungeon' ? h('button', { class: 'btn red', onClick: () => this.enterDungeon(spot.ref!) }, `Enter ${spot.ref}`) : null,
        spot?.kind === 'overlord' && !S.overlords.includes(spot.ref!) ? h('button', { class: 'btn red', onClick: () => this.challengeOverlord(spot.ref!) }, `Challenge ${spot.ref}`) : null,
        spot?.kind === 'dock' ? h('button', { class: 'btn gold', onClick: () => this.sail(spot.ref!) }, `⛵ Sail to ${region(spot.ref!).name}`) : null,
        h('button', { class: 'btn small', onClick: () => this.recenter() }, '◎ Me'),
        h('span', { class: 'chip panel' }, 'Drag to look around · tap a marker to travel')),
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

  neighbours(id: number) {
    const m = maps()[S.location.region];
    return m.edges.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));
  }

  clickSpot(s: Spot) {
    if (this.moving || anyModal() || !this.seen(s.id)) return;
    if (s.id === S.location.spot) return this.arrive(s, true);
    const path = this.route(S.location.spot, s.id);
    if (!path) return toast('No known road leads there yet — explore closer.');
    this.walk(path);
  }

  /** Shortest road through explored spots. */
  route(from: number, to: number): number[] | null {
    const prev = new Map<number, number>([[from, -1]]);
    const q = [from];
    while (q.length) {
      const c = q.shift()!;
      if (c === to) break;
      for (const n of this.neighbours(c)) if (!prev.has(n) && this.seen(n)) { prev.set(n, c); q.push(n); }
    }
    if (!prev.has(to)) return null;
    const path: number[] = [];
    for (let c = to; c !== from; c = prev.get(c)!) path.unshift(c);
    return path;
  }

  /** Walk spot by spot with the camera following; each step lifts the fog around it. */
  walk(path: number[]) {
    const m = maps()[S.location.region];
    const cam = this.cameras.main;
    this.moving = true;
    cam.startFollow(this.token, false, 0.08, 0.08);
    const stop = (s: Spot) => {
      this.moving = false;
      cam.stopFollow();
      save();
      this.arrive(s, false);
    };
    const stepTo = (i: number) => {
      const s = m.spots[path[i]];
      const p = this.P(s);
      sfx('step');
      this.tweens.add({
        targets: this.token, x: p.x, y: p.y, duration: 380, ease: 'Sine.inOut',
        onComplete: () => {
          S.location.spot = s.id;
          this.explore([s.id, ...this.neighbours(s.id)]);
          const last = i === path.length - 1;
          if (last || !this.passable(s) || (s.kind === 'field' && rng.chance(0.18))) return stop(s);
          stepTo(i + 1);
        },
      });
    };
    stepTo(0);
  }

  arrive(s: Spot, tapped: boolean) {
    this.ui();
    const r = region(S.location.region);
    const quest = S.quests.find((q) => q.goal.kind === 'battle' && q.goal.region === r.id && q.goal.spot === s.id && q.progress < 1);
    if (quest) {
      const enc = breederEncounter(r.id, quest.goal.npc ?? 'Rogue Breeder', hash(quest.id), quest.goal.species);
      return dialogue([{ who: quest.goal.npc, text: `So the Guild sent you? Let's see what your monsters are made of!` }]).then(() =>
        fight(enc, (res) => {
          if (res.outcome === 0) { quest.progress = 1; save(); toast(`Quest target defeated! Report back to ${quest.town}.`); }
          toRegion();
        }));
    }
    if (DISCOVERY.has(s.kind) && !this.isDone(s)) return void this.discover(s);
    switch (s.kind) {
      case 'field': case 'treasure': case 'rare': case 'breeder': case 'lookout':
        if (tapped || rng.chance(0.62)) this.hunt();
        else toast('All quiet… for now.');
        break;
      case 'town':
        S.lastTown = { region: r.id, spot: s.id };
        save();
        questEvent('visit', s.ref);
        toTown(s.ref!);
        break;
      case 'dungeon': this.enterDungeon(s.ref!); break;
      case 'overlord':
        if (!S.overlords.includes(s.ref!)) this.challengeOverlord(s.ref!);
        else toast(`${s.ref} has already been defeated.`);
        break;
      case 'dock':
        this.sail(s.ref!);
        break;
      case 'exit': {
        const next = region(s.ref!);
        const nm = maps()[next.id];
        const entry = nm.spots.find((x) => x.kind === 'exit' && x.ref === r.id) ?? nm.spots[0];
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
        toast(`🧰 You opened a treasure chest: ${prize}!`);
        this.refreshMarker(s);
        this.ui();
        break;
      }
      case 'rare': {
        const enc = rareEncounter(r.id, seed);
        if (!(await confirmBox(`Something big stirs in the lair… a rare ${enc.name} (Lv ${enc.team[0].level})! Fight it?`, 'Fight!'))) return;
        fight(enc, (res) => {
          if (res.outcome === 0) { this.claim(s); toast('The lair falls quiet.'); }
          toRegion();
        });
        break;
      }
      case 'breeder': {
        const name = BREEDERS[seed % BREEDERS.length];
        await dialogue([{ who: name, text: `A traveller out here? I raise monsters in the wilds of ${r.name}. Beat my team and I'll give you an egg from my camp!` }]);
        fight(breederEncounter(r.id, name, seed), (res) => {
          if (res.outcome === 0) { this.claim(s); S.items.egg += 1; save(); toast(`${name} hands you a Monster Egg 🥚`); }
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
        toast(`🔭 All of ${r.name} is now on your map.`);
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
    this.cameras.main.once('camerafadeoutcomplete', () => { toast(`⛵ Arrived in ${dest.name}`); toRegion(); });
  }

  hunt() {
    sfx('encounter');
    this.cameras.main.flash(250, 255, 255, 255);
    const enc = wildEncounter(S.location.region, S.location.spot);
    this.time.delayedCall(250, () => fight(enc));
  }

  async enterDungeon(name: string) {
    const d = dungeonData(name)!;
    if (name === 'Unknown Relic' && !S.ending) return toast('A strange seal blocks the entrance… perhaps after the Final Battle.');
    if (await confirmBox(`${name}: ${d.about || 'A dangerous dungeon.'} Enter?`, 'Enter')) {
      const best = S.dungeons[name]?.best ?? 1;
      const wp = Math.max(1, Math.floor((best - 1) / 5) * 5 + 1);
      toDungeon(name, wp);
    }
  }

  async challengeOverlord(name: string) {
    const o = overlordData(name)!;
    await dialogue([{ who: name, text: o.about ? o.about.slice(0, 220) : `I am ${name}, Dragon Overlord of ${o.region}. Turn back, little breeder.` }]);
    if (!(await confirmBox(`Battle the Dragon Overlord ${name}? (a ${o.form} of immense power)`, 'Fight!'))) return;
    fight(overlordEncounter(name), (res) => {
      if (res.outcome === 0 && !S.overlords.includes(name)) {
        S.overlords.push(name);
        save();
        toast(`🐲 ${name} has been defeated! (${S.overlords.length}/${data().overlords.length})`);
      }
      toRegion();
    });
  }
}
void go;
