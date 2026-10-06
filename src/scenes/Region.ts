import Phaser from 'phaser';
import { vignette, ambient } from './fx';
import { data, maps, region, speciesByName, spriteUrl, dungeon as dungeonData, overlord as overlordData } from '../core/data';
import { S, save, questEvent, hash } from '../core/state';
import type { Spot } from '../core/types';
import { wildEncounter, breederEncounter, overlordEncounter } from '../core/encounters';
import { hud, openMenu, elChip } from '../ui/menus';
import { h, layer, toast, confirmBox, dialogue, starsHtml, anyModal } from '../ui/dom';
import { music, sfx } from '../audio';
import { toTown, toDungeon, toWorld, toRegion, go } from '../nav';
import { fight } from '../flow';
import { loadSprites } from './Boot';
import { species } from '../core/data';
import { rng } from '../core/rng';

const KIND_STYLE: Record<Spot['kind'], { color: number; icon: string; label: string }> = {
  field: { color: 0x4cd964, icon: '', label: 'Wild area' },
  town: { color: 0x4aa3ff, icon: '🏰', label: 'Town' },
  dungeon: { color: 0xff5a5a, icon: '⛰', label: 'Dungeon' },
  overlord: { color: 0xb46bff, icon: '🐲', label: 'Dragon Overlord' },
  exit: { color: 0xf6c453, icon: '➜', label: 'Road' },
};

export class RegionScene extends Phaser.Scene {
  constructor() { super('Region'); }
  private token!: Phaser.GameObjects.Container;
  private moving = false;
  private markers = new Map<number, Phaser.GameObjects.Container>();

  create() {
    const r = region(S.location.region);
    const m = maps()[r.id];
    const { width, height } = this.scale;
    music('world');
    this.moving = false;
    this.markers.clear();
    const bg = this.add.image(width / 2, height / 2, `map_${r.id}`);
    bg.setScale(Math.max(width / bg.width, height / bg.height));
    vignette(this, 0.45);
    ambient(this, 0xffffff, 14);
    this.cameras.main.fadeIn(350);
    const P = (s: Spot) => ({ x: s.x * width, y: s.y * height });

    // paths
    const g = this.add.graphics().setDepth(2);
    for (const [a, b] of m.edges) {
      const pa = P(m.spots[a]), pb = P(m.spots[b]);
      const len = Phaser.Math.Distance.Between(pa.x, pa.y, pb.x, pb.y);
      for (let d = 0; d < len; d += 14) {
        const t = d / len;
        g.fillStyle(0x000000, 0.35).fillCircle(pa.x + (pb.x - pa.x) * t + 1, pa.y + (pb.y - pa.y) * t + 2, 3.2);
        g.fillStyle(0xfff3d0, 0.85).fillCircle(pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t, 2.6);
      }
    }
    const questSpots = new Map<number, string>();
    for (const q of S.quests) if (q.goal.kind === 'battle' && q.goal.region === r.id && q.progress < 1 && q.goal.spot != null) questSpots.set(q.goal.spot, q.id);

    for (const s of m.spots) {
      const st = KIND_STYLE[s.kind];
      const p = P(s);
      const c = this.add.container(p.x, p.y).setDepth(3);
      const defeatedOverlord = s.kind === 'overlord' && s.ref && S.overlords.includes(s.ref);
      const field = s.kind === 'field';
      const ring = this.add.circle(0, 0, field ? 11 : 30, st.color, field ? (defeatedOverlord ? 0.35 : 0.9) : 0.001);
      if (field) ring.setStrokeStyle(3, 0xffffff, 0.95);
      c.add(this.add.ellipse(2, field ? 6 : 14, field ? 34 : 70, field ? 14 : 22, 0x000000, field ? 0.35 : 0.22));
      c.add(ring);
      // towns, dungeons, overlords and roads use the original game's map art instead of plain markers
      const art = (key: string, sc: number, x = 0, y = 0) => { const im = this.add.image(x, y, key).setScale(sc).setOrigin(0.5, 0.85); c.add(im); return im; };
      if (s.kind === 'town') { art('town_house_a', 0.32, -26, 6); art('town_house_b', 0.3, 26, 2); art('town_warp_house', 0.3, 0, 22); }
      if (s.kind === 'dungeon') { const v = art('bk_fx_web', 0.42, 0, 14); this.tweens.add({ targets: v, angle: 360, duration: 12000, repeat: -1 }); v.setOrigin(0.5); }
      if (s.kind === 'overlord') { const e = art('town_warp_emblem', 0.42, 0, 10); if (defeatedOverlord) e.setAlpha(0.45).setTint(0x888888); }
      if (s.kind === 'exit') art('town_signpost', 0.38, 0, 14);
      if (s.kind === 'field') {
        const flag = this.add.text(-2, -30, '⚑', { fontSize: '26px', color: '#3bdc6a', stroke: '#063', strokeThickness: 3 }).setOrigin(0.5);
        c.add(flag);
        this.tweens.add({ targets: flag, angle: { from: -6, to: 6 }, duration: 900 + (s.id % 5) * 120, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      }
      if (questSpots.has(s.id)) {
        const q = this.add.text(0, -40, '⚔', { fontSize: '28px', color: '#ff5050', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5);
        c.add(q);
        this.tweens.add({ targets: q, y: -48, duration: 600, yoyo: true, repeat: -1 });
      }
      if (s.kind !== 'field') {
        const label = s.kind === 'exit' ? `→ ${region(s.ref!).name}` : s.ref!;
        c.add(this.add.text(0, 28, label, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold', fontSize: '15px', color: '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0));
      }
      ring.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.clickSpot(s));
      ring.on('pointerover', () => c.setScale(1.15)).on('pointerout', () => c.setScale(1));
      this.markers.set(s.id, c);
    }

    // player token = lead monster
    const lead = S.party[0];
    const sp = species(lead.species);
    const here = P(m.spots[S.location.spot] ?? m.spots[0]);
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

    if (!S.visited.includes(r.id)) { S.visited.push(r.id); save(); }
    this.ui();
    if (questSpots.size) toast('⚔ marks a quest target in this region.');
  }

  ui() {
    const r = region(S.location.region);
    const spot = maps()[r.id].spots[S.location.spot];
    const refresh = () => this.ui();
    hud((k) => openMenu(k, refresh), [h('button', { class: 'btn small gold', onClick: () => toWorld() }, '🗺 World')]);
    const pool = r.monsters.slice(0, 14).map((n) => speciesByName(n)).filter(Boolean);
    layer('scene', h('div', {},
      h('div', { class: 'region-title' }, h('h2', {}, r.name), h('div', {}, `Wild monsters Lv ${r.levels[0]}–${r.levels[1]}`)),
      h('div', { class: 'region-actions' },
        spot?.kind === 'field' ? h('button', { class: 'btn green', onClick: () => this.hunt() }, '⚔ Hunt here') : null,
        spot?.kind === 'town' ? h('button', { class: 'btn gold', onClick: () => toTown(spot.ref!) }, `Enter ${spot.ref}`) : null,
        spot?.kind === 'dungeon' ? h('button', { class: 'btn red', onClick: () => this.enterDungeon(spot.ref!) }, `Enter ${spot.ref}`) : null,
        spot?.kind === 'overlord' && !S.overlords.includes(spot.ref!) ? h('button', { class: 'btn red', onClick: () => this.challengeOverlord(spot.ref!) }, `Challenge ${spot.ref}`) : null,
        h('span', { class: 'chip panel' }, 'Tap a connected marker to travel')),
      h('div', { class: 'region-info panel' },
        h('b', {}, 'Monsters sighted'),
        h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '.25em', marginTop: '.4em' } },
          ...pool.map((s) => h('img', { src: spriteUrl(s!), title: `${s!.name} ${starsHtml(s!.stars)}`, style: { height: '2.4em', filter: S.seen.includes(s!.id) ? '' : 'brightness(0) opacity(.5)' } }))),
        r.overlords.length ? h('div', { class: 'muted', style: { marginTop: '.4em' } }, `Overlord: ${r.overlords.map((o) => `${o}${S.overlords.includes(o) ? ' ✔' : ''}`).join(', ')}`) : null)));
    void elChip;
  }

  neighbours(id: number) {
    const m = maps()[S.location.region];
    return m.edges.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));
  }

  clickSpot(s: Spot) {
    if (this.moving || anyModal()) return;
    if (s.id === S.location.spot) return this.arrive(s, true);
    const path = this.route(S.location.spot, s.id);
    if (!path) return;
    this.walk(path);
  }

  route(from: number, to: number): number[] | null {
    const prev = new Map<number, number>([[from, -1]]);
    const q = [from];
    while (q.length) {
      const c = q.shift()!;
      if (c === to) break;
      for (const n of this.neighbours(c)) if (!prev.has(n)) { prev.set(n, c); q.push(n); }
    }
    if (!prev.has(to)) return null;
    const path: number[] = [];
    for (let c = to; c !== from; c = prev.get(c)!) path.unshift(c);
    return path;
  }

  /** Walk spot by spot; wild areas along the way may interrupt with an encounter. */
  walk(path: number[]) {
    const m = maps()[S.location.region];
    const { width, height } = this.scale;
    this.moving = true;
    const stepTo = (i: number) => {
      const s = m.spots[path[i]];
      sfx('step');
      this.tweens.add({
        targets: this.token, x: s.x * width, y: s.y * height, duration: 380, ease: 'Sine.inOut',
        onComplete: () => {
          S.location.spot = s.id;
          const last = i === path.length - 1;
          if (s.kind === 'field' && (last || rng.chance(0.18))) {
            this.moving = false;
            save();
            return this.arrive(s, false);
          }
          if (last || s.kind !== 'field') {
            this.moving = false;
            save();
            return this.arrive(s, false);
          }
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
    switch (s.kind) {
      case 'field':
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
