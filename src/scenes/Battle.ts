import Phaser from 'phaser';
import { Battle, BattleEvent, Combatant, FIELD } from '../core/battle';
import { data, species, spriteUrl } from '../core/data';
import { displayName, xpYield, rankName } from '../core/monster';
import type { Ability } from '../core/types';
import { S, save, heroBonus, awardXp, addMonster, questEvent, markSeen, LevelReport } from '../core/state';
import type { BattleReq } from '../nav';
import { coverBg, EL_COLOR, vignette } from './fx';
import { loadSprites } from './Boot';
import { h, layer, clearLayer, toast } from '../ui/dom';
import { music, sfx } from '../audio';
import { elChip } from '../ui/menus';

interface View {
  c: Combatant;
  root: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  hp: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Ellipse;
  home: { x: number; y: number };
  height: number;
  shownHp: number;
}

const POS: [number, number][] = [[400, 520], [235, 425], [215, 600]];
const STATUS_ICON: Record<string, string> = { stun: '💫', sleep: '💤', paralyze: '⚡', confuse: '❓', doom: '💀', taunt: '😤', disguise: '🫥', noguard: '🛡✖', berserk: '😡', poison: '☠' };

export class BattleScene extends Phaser.Scene {
  constructor() { super('Battle'); }
  private req!: BattleReq;
  private b!: Battle;
  private views = new Map<string, View>();
  private participants = new Set<number>();
  private choose: ((v: { ability: Ability; target?: string } | null) => void) | null = null;
  private pending: Ability | null = null;
  private capturing: 'card' | 'silver' | 'gold' | null = null;
  private actor: Combatant | null = null;
  private busy = false;
  private skipAnim = false;

  init(req: BattleReq) {
    this.req = req;
    this.views = new Map();
    this.participants = new Set();
    this.choose = null;
    this.pending = null;
    this.capturing = null;
    this.actor = null;
  }

  create() {
    const enc = this.req.enc;
    const boss = enc.kind === 'overlord' || enc.kind === 'boss' || enc.kind === 'arena';
    music(boss ? 'boss' : 'battle');
    const bg = coverBg(this, `bg_${enc.bg}`, false);
    bg.setScale(bg.scale * 1.15);
    this.tweens.add({ targets: bg, scale: bg.scale / 1.15, duration: 900, ease: 'Cubic.out' });
    vignette(this, 0.5);
    this.add.rectangle(640, 700, 1280, 200, 0x000000, 0.0).setDepth(1);
    const files = [...S.party, ...enc.team].map((m) => species(m.species).sprite);
    this.b = new Battle(S.party.slice(0, 10), enc.team, {
      capturable: enc.capturable, canFlee: enc.canFlee, gem: heroBonus(), bossHp: enc.bossHp, enemyStatMult: enc.statMult,
    });
    enc.team.forEach((m) => markSeen(m.species));
    loadSprites(this, files, () => this.begin());
  }

  private pos(c: Combatant) {
    const [x, y] = POS[c.slot];
    return c.side === 0 ? { x, y } : { x: 1280 - x, y };
  }

  private makeView(c: Combatant, entering = false) {
    const p = this.pos(c);
    const sp = c.sp;
    const root = this.add.container(p.x, p.y).setDepth(10 + p.y / 10);
    const box = (c.boss ? 300 : 175) * (c.slot === 0 ? 1.05 : 0.92);
    const img = this.add.image(0, 0, `spr_${sp.sprite}`).setOrigin(0.5, 1);
    const scale = Math.min(box / img.width, box / img.height, c.boss ? 3 : 2.2);
    img.setScale(scale).setFlipX(c.side === 0);
    const height = img.height * scale;
    const ring = this.add.ellipse(0, 0, img.width * scale * 0.9, 26, 0xf6c453, 0).setStrokeStyle(3, 0xf6c453, 0);
    const shadow = this.add.ellipse(0, 2, img.width * scale * 0.8, 22, 0x000000, 0.4);
    const name = this.add.text(0, -height - 34, `${displayName(c.inst)}  Lv${c.inst.level}`, { fontFamily: 'Nunito', fontStyle: 'bold', fontSize: '15px', color: c.side ? '#ffd0d0' : '#d8ecff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
    const hp = this.add.graphics();
    const status = this.add.text(0, -height - 52, '', { fontSize: '16px' }).setOrigin(0.5);
    root.add([shadow, ring, img, hp, name, status]);
    const v: View = { c, root, img, hp, name, status, ring, home: p, height, shownHp: c.pool.hp };
    this.drawHp(v);
    this.views.set(c.key, v);
    img.setInteractive({ useHandCursor: true, pixelPerfect: false }).on('pointerdown', () => this.clickMon(c));
    this.tweens.add({ targets: img, scaleY: scale * 1.025, duration: 900 + Math.random() * 400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    if (entering) {
      root.x += c.side === 0 ? -400 : 400;
      root.alpha = 0;
      return this.tw({ targets: root, x: p.x, alpha: 1, duration: 420, ease: 'Back.out' });
    }
    if (c.side === 0) this.participants.add(c.inst.uid);
    return Promise.resolve();
  }

  private drawHp(v: View) {
    const w = 120, y = -v.height - 22;
    const pct = Math.max(0, v.shownHp / v.c.pool.max);
    v.hp.clear();
    v.hp.fillStyle(0x000000, 0.65).fillRoundedRect(-w / 2 - 2, y - 2, w + 4, 12, 5);
    const col = pct > 0.5 ? 0x5be38a : pct > 0.2 ? 0xffc542 : 0xff5d5d;
    v.hp.fillStyle(col, 1).fillRoundedRect(-w / 2, y, Math.max(0, w * pct), 8, 4);
    const st = Object.keys(v.c.statuses).map((k) => STATUS_ICON[k] ?? '').join('') + (v.c.poisons.length ? STATUS_ICON.poison : '');
    v.status.setText(st);
  }

  private tw(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    const sp = S.settings.speed;
    return new Promise((res) => {
      this.tweens.add({ ...cfg, duration: (cfg.duration as number ?? 300) / sp, onComplete: () => res() });
    });
  }
  private wait(ms: number) { return new Promise<void>((r) => this.time.delayedCall(ms / S.settings.speed, r)); }

  private async begin() {
    for (const c of this.b.all.filter((x) => x.slot >= 0)) await this.makeView(c, false);
    const enc = this.req.enc;
    this.banner(enc.intro ?? (enc.team.length > 1 ? `${enc.team.length} wild monsters appear!` : `A wild ${displayName(enc.team[0])} appears!`), enc.kind === 'wild' ? '#ffffff' : '#ffb4b4');
    if (enc.kind !== 'wild') this.cameras.main.shake(400, 0.006);
    this.ui();
    await this.wait(800);
    this.loop();
  }

  private banner(text: string, color = '#fff') {
    const t = this.add.text(640, 180, text, { fontFamily: 'Cinzel, serif', fontSize: '34px', color, stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(100).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: 170, duration: 250, yoyo: true, hold: 1100 / S.settings.speed, onComplete: () => t.destroy() });
  }

  private float(v: View, text: string, color: string, size = 30, dy = 0) {
    const t = this.add.text(v.root.x + Phaser.Math.Between(-20, 20), v.root.y - v.height * 0.6 + dy, text, {
      fontFamily: 'Nunito', fontStyle: '900', fontSize: `${size}px`, color, stroke: '#000', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(120).setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.out' });
    this.tweens.add({ targets: t, y: t.y - 60, alpha: 0, delay: 500 / S.settings.speed, duration: 700 / S.settings.speed, onComplete: () => t.destroy() });
  }

  private burst(x: number, y: number, color: number, n = 24, speed = 260) {
    const p = this.add.particles(x, y, 'glow', { speed: { min: speed * 0.3, max: speed }, lifespan: 600, scale: { start: 1.4, end: 0 }, tint: color, blendMode: 'ADD', emitting: false }).setDepth(110);
    p.explode(n);
    const s = this.add.particles(x, y, 'spark', { speed: { min: 100, max: speed * 1.4 }, lifespan: 450, scale: { start: 0.9, end: 0 }, rotate: { min: 0, max: 360 }, tint: [color, 0xffffff], emitting: false }).setDepth(111);
    s.explode(Math.round(n / 2));
    this.time.delayedCall(900, () => { p.destroy(); s.destroy(); });
  }

  // ---------------------------------------------------------------- main loop
  private async loop() {
    while (this.b.over === null) {
      const ev: BattleEvent[] = [];
      const actor = this.b.next(ev);
      await this.play(ev);
      if (!actor || this.b.over !== null) break;
      this.actor = actor;
      this.timeline();
      const v = this.views.get(actor.key);
      if (v) { v.ring.setStrokeStyle(3, actor.side ? 0xff6b6b : 0x6ad1ff, 1); }
      let choice: { ability: Ability; target?: string } | null;
      if (actor.side === 0 && !S.settings.auto) {
        choice = await new Promise((res) => { this.choose = res; this.ui(); });
        this.choose = null;
        if (this.b.over !== null) break;
        if (!choice) continue;
      } else {
        this.ui();
        await this.wait(actor.side ? 380 : 220);
        choice = this.b.choose(actor);
      }
      if (v) v.ring.setStrokeStyle(3, 0xf6c453, 0);
      const evs = this.b.act(actor, choice.ability, choice.target);
      this.busy = true;
      this.ui();
      await this.play(evs);
      this.busy = false;
    }
    this.finish();
  }

  private async play(evs: BattleEvent[]) {
    for (const e of evs) await this.playOne(e);
  }

  private async playOne(e: BattleEvent) {
    const V = (k: string) => this.views.get(k);
    switch (e.t) {
      case 'use': {
        const a = V(e.who);
        if (!a) return;
        const col = EL_COLOR[e.element ?? a.c.sp.element] ?? 0xffffff;
        const ab = a.c.sp.abilities.find((x) => x.name === e.ability);
        const label = this.add.text(a.root.x, a.root.y - a.height - 80, e.ability, { fontFamily: 'Cinzel, serif', fontStyle: 'bold', fontSize: '22px', color: '#fff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5).setDepth(130);
        this.tweens.add({ targets: label, alpha: 0, y: label.y - 20, delay: 700 / S.settings.speed, duration: 400, onComplete: () => label.destroy() });
        const targets = e.targets.map(V).filter(Boolean) as View[];
        const foe = targets.find((t) => t.c.side !== a.c.side);
        if (ab?.kind === 'physical' && foe) {
          sfx('select');
          const dx = (foe.root.x - a.root.x) * 0.55, dy = (foe.root.y - a.root.y) * 0.4;
          await this.tw({ targets: a.root, x: a.home.x + dx, y: a.home.y + dy, duration: 180, ease: 'Quad.in' });
          this.tw({ targets: a.root, x: a.home.x, y: a.home.y, duration: 260, ease: 'Quad.out' });
        } else if (ab?.kind === 'magical' && foe) {
          sfx('magic');
          const glow = this.add.image(a.root.x, a.root.y - a.height / 2, 'glow').setTint(col).setBlendMode('ADD').setScale(3).setDepth(105);
          this.tweens.add({ targets: glow, scale: 6, alpha: 0, duration: 400, onComplete: () => glow.destroy() });
          await Promise.all(targets.filter((t) => t.c.side !== a.c.side).map((t) => {
            const orb = this.add.particles(a.root.x, a.root.y - a.height / 2, 'glow', { speed: 20, lifespan: 300, scale: { start: 1.6, end: 0 }, tint: col, blendMode: 'ADD', frequency: 12 }).setDepth(112);
            return this.tw({ targets: orb, x: t.root.x, y: t.root.y - t.height / 2, duration: 320, ease: 'Sine.in' }).then(() => { orb.stop(); this.time.delayedCall(320, () => orb.destroy()); });
          }));
        } else {
          sfx(ab?.healPower ? 'heal' : ab?.mods && Object.values(ab.mods).some((x) => x! > 0) ? 'buff' : 'magic');
          const ring = this.add.circle(a.root.x, a.root.y - a.height / 2, 30, col, 0.0).setStrokeStyle(6, col, 0.9).setDepth(105);
          await this.tw({ targets: ring, scale: 3, alpha: 0, duration: 380 });
          ring.destroy();
        }
        break;
      }
      case 'damage': {
        const v = V(e.who);
        if (!v) return;
        const col = EL_COLOR[e.element ?? ''] ?? 0xffffff;
        if (!e.dot) {
          this.burst(v.root.x, v.root.y - v.height / 2, col, e.crit ? 40 : 22, e.crit ? 380 : 260);
          sfx(e.crit ? 'crit' : 'hit');
          v.img.setTintFill(0xffffff);
          this.time.delayedCall(70, () => v.img.clearTint());
          this.tweens.add({ targets: v.img, x: { from: -10, to: 0 }, duration: 60, repeat: 2, yoyo: true });
          if (e.crit || e.mult > 1) this.cameras.main.shake(e.crit ? 220 : 120, e.crit ? 0.01 : 0.005);
        } else {
          v.img.setTint(0xb05cff);
          this.time.delayedCall(160, () => v.img.clearTint());
        }
        const color = e.dot ? '#d79bff' : e.mult > 1 ? '#ffd23f' : e.mult < 1 ? '#a8b3c9' : '#ffffff';
        this.float(v, `${e.amount}`, color, e.crit ? 42 : 32);
        if (e.crit) this.float(v, 'CRITICAL!', '#ff8a3d', 20, -40);
        else if (e.mult > 1) this.float(v, 'Super effective!', '#ffd23f', 18, -40);
        else if (e.mult < 1) this.float(v, 'Resisted', '#9fb0d0', 16, -40);
        // shared HP pools (clones) update all views
        for (const o of this.views.values()) if (o.c.pool === v.c.pool) this.animHp(o);
        await this.wait(e.dot ? 280 : 380);
        break;
      }
      case 'heal': {
        const v = V(e.who);
        if (!v) return;
        sfx('heal');
        const p = this.add.particles(v.root.x, v.root.y - 10, 'glow', { speedY: { min: -160, max: -60 }, speedX: { min: -40, max: 40 }, lifespan: 700, scale: { start: 1, end: 0 }, tint: 0x8cff9e, blendMode: 'ADD', emitting: false }).setDepth(110);
        p.explode(20);
        this.time.delayedCall(800, () => p.destroy());
        this.float(v, `+${e.amount}`, '#6dff9c', 30);
        for (const o of this.views.values()) if (o.c.pool === v.c.pool) this.animHp(o);
        await this.wait(300);
        break;
      }
      case 'mod': {
        const v = V(e.who);
        if (!v) return;
        const up = e.amount > 0;
        sfx(up ? 'buff' : 'debuff');
        this.float(v, `${up ? '▲' : '▼'} ${e.stat.toUpperCase()}`, up ? '#7fe3ff' : '#ff9a9a', 20, 10);
        await this.wait(200);
        break;
      }
      case 'status': {
        const v = V(e.who);
        if (!v) return;
        this.drawHp(v);
        if (!e.on) return;
        const labels: Record<string, string> = { immune: 'Immune!', cleanse: 'Cleansed', poison: '☠ Poisoned' };
        this.float(v, labels[e.status] ?? `${STATUS_ICON[e.status] ?? ''} ${e.status[0].toUpperCase() + e.status.slice(1)}`, e.status === 'immune' ? '#cfd8ff' : '#ffb3ff', 22, 20);
        sfx(e.status === 'immune' || e.status === 'cleanse' ? 'buff' : 'debuff');
        await this.wait(260);
        break;
      }
      case 'skip': {
        const v = V(e.who);
        if (v) this.float(v, e.reason === 'asleep' ? '💤 Zzz…' : '❓ Confused', '#d0d8ff', 22);
        await this.wait(350);
        break;
      }
      case 'faint': {
        const v = V(e.who);
        if (!v) return;
        sfx('faint');
        this.views.delete(e.who);
        v.img.setTint(0x555555);
        await this.tw({ targets: v.root, alpha: 0, y: v.root.y + 30, duration: 450 });
        v.root.destroy();
        break;
      }
      case 'leave': {
        const v = V(e.who);
        if (!v) return;
        this.views.delete(e.who);
        await this.tw({ targets: v.root, x: v.root.x + (v.c.side ? 500 : -500), alpha: 0, duration: 400 });
        v.root.destroy();
        break;
      }
      case 'enter': {
        const c = this.b.get(e.who);
        const old = [...this.views.values()].find((x) => x.c.side === c.side && x.c.slot === c.slot && x.c !== c);
        if (old) { this.views.delete(old.c.key); old.root.destroy(); }
        await new Promise<void>((res) => loadSprites(this, [c.sp.sprite], () => res()));
        if (c.side === 1) markSeen(c.sp.id);
        await this.makeView(c, true);
        if (c.side === 0) this.participants.add(c.inst.uid);
        break;
      }
      case 'text':
        this.banner(e.msg);
        await this.wait(600);
        break;
      case 'capture':
        await this.captureAnim(e.who, e.success, e.chance);
        break;
      case 'end':
        break;
      case 'turn':
        break;
    }
  }

  private animHp(v: View) {
    const target = v.c.pool.hp;
    this.tweens.addCounter({ from: v.shownHp, to: target, duration: 350 / S.settings.speed, onUpdate: (t) => { v.shownHp = t.getValue() ?? target; this.drawHp(v); } });
  }

  private async captureAnim(key: string, ok: boolean, chance: number) {
    const v = this.views.get(key);
    if (!v) return;
    const card = this.add.rectangle(200, 720, 46, 62, 0xf0f4ff).setStrokeStyle(3, this.capturing === 'gold' ? 0xf6c453 : 0xffffff).setDepth(140);
    await this.tw({ targets: card, x: v.root.x, y: v.root.y - v.height / 2, angle: 720, duration: 450, ease: 'Quad.out' });
    this.burst(card.x, card.y, 0xffffff, 30);
    await this.tw({ targets: v.root, scale: 0.15, alpha: 0.4, duration: 300 });
    for (let i = 0; i < 3; i++) {
      sfx('spin');
      await this.tw({ targets: card, angle: { from: -18, to: 18 }, duration: 160, yoyo: true });
      if (!ok && i === Math.floor(chance * 3)) break;
    }
    if (ok) {
      sfx('capture');
      this.burst(card.x, card.y, 0xf6c453, 50, 400);
      this.float(v, 'Captured!', '#ffd23f', 34);
      await this.tw({ targets: card, y: card.y - 80, alpha: 0, duration: 500 });
    } else {
      sfx('fail');
      this.float(v, `Broke free! (${Math.round(chance * 100)}%)`, '#ff9a9a', 24);
      await this.tw({ targets: v.root, scale: 1, alpha: 1, duration: 250, ease: 'Back.out' });
      await this.tw({ targets: card, alpha: 0, duration: 200 });
    }
    card.destroy();
  }

  // ---------------------------------------------------------------- input
  private clickMon(c: Combatant) {
    if (!this.choose || this.busy) return;
    if (this.capturing) {
      if (c.side !== 1) return;
      const type = this.capturing;
      const have = { card: S.items.card, silver: S.items.silver, gold: S.items.gold }[type];
      if (have <= 0) return toast('No cards of that type left.');
      if (c.captureTried) return toast('You only get one capture attempt per monster.');
      this.capturing = null;
      if (type === 'card') S.items.card--; else if (type === 'silver') S.items.silver--; else S.items.gold--;
      const evs = this.b.tryCapture(c.key, type);
      this.busy = true;
      this.ui();
      this.play(evs).then(() => {
        this.busy = false;
        if (this.b.over !== null) this.choose?.(null);
        else this.ui();
      });
      return;
    }
    if (!this.pending || !this.actor) return;
    const a = this.pending;
    const ok = a.target === 'ally' ? c.side === this.actor.side : c.side !== this.actor.side;
    if (!ok) return;
    this.pending = null;
    this.choose({ ability: a, target: c.key });
  }

  private timeline() {
    const f = this.b.forecast(9);
    const el = document.querySelector('.bt-top');
    if (!el) return;
    el.replaceChildren(h('span', { class: 'muted', style: { fontSize: '.75em', marginRight: '.3em' } }, 'NEXT'),
      ...f.map((c) => h('div', { class: `tl s${c.side}`, title: displayName(c.inst), style: { backgroundImage: `url(${spriteUrl(c.sp)})` } })),
      h('span', { class: 'muted', style: { fontSize: '.75em', marginLeft: '.5em' } }, `Foes left: ${this.b.side(1).length}`));
  }

  private ui() {
    const actor = this.actor;
    const mine = actor && actor.side === 0 && !!this.choose && !this.busy;
    const abilities = mine ? this.b.usable(actor!) : [];
    const cardBtn = (t: 'card' | 'silver' | 'gold', n: number, label: string) =>
      h('button', { class: `card-btn ${t === 'card' ? '' : t}`, title: `${label} (${n})`, disabled: !mine || !n || !this.req.enc.capturable,
        onClick: () => { this.capturing = this.capturing === t ? null : t; this.pending = null; this.ui(); } }, `${n}`);
    const prompt = this.capturing ? 'Tap a wild monster to throw the card' : this.pending ? `Choose a target for ${this.pending.name}` : mine ? `${displayName(actor!.inst)}'s turn` : S.settings.auto ? 'Auto battle' : '';
    layer('battle', h('div', {},
      h('div', { class: 'bt-top panel' }),
      prompt ? h('div', { class: 'bt-prompt panel' }, prompt) : null,
      h('div', { class: 'bt-bottom' },
        h('div', { class: 'bt-abilities panel' },
          ...(mine ? abilities.map((a) => h('button', {
            class: 'ab-btn', style: this.pending === a ? { borderColor: 'var(--gold)', boxShadow: '0 0 0 2px var(--gold)' } : undefined,
            onClick: () => {
              if (!this.choose) return;
              this.capturing = null;
              const needsPick = (a.target === 'foe' || a.target === 'twoFoes') && this.b.foesOf(actor!).length > 1 && !(a.healPower && !a.power) || (a.target === 'ally' && this.b.alliesOf(actor!).length > 1);
              if (needsPick && this.pending !== a) { this.pending = a; this.ui(); return; }
              this.pending = null;
              this.choose({ ability: a });
            },
          }, h('div', { class: 'n' }, h('span', {}, a.name), h('span', { class: 'muted' }, `${a.tu ?? 130} TU`)),
            h('div', { class: 'd' }, `${a.element ? a.element + ' · ' : ''}${a.text ?? ''}`)))
            : [h('div', { class: 'muted', style: { padding: '.6em' } }, this.busy ? '…' : 'Waiting…')])),
        h('div', { class: 'bt-side panel' },
          h('div', { class: 'cards' }, cardBtn('card', S.items.card, 'Capture Card'), cardBtn('silver', S.items.silver, 'Silver Card'), cardBtn('gold', S.items.gold, 'Gold Card')),
          h('div', { class: 'row' },
            h('button', { class: `btn small ${S.settings.auto ? 'gold' : ''}`, onClick: () => { S.settings.auto = !S.settings.auto; save(); if (S.settings.auto && this.choose && this.actor) this.choose(this.b.choose(this.actor)); this.ui(); } }, 'Auto'),
            h('button', { class: 'btn small', onClick: () => { S.settings.speed = (S.settings.speed % 3) + 1; save(); this.ui(); } }, `${S.settings.speed}x`),
            h('button', { class: 'btn small red', disabled: !mine || !this.req.enc.canFlee, onClick: () => {
              const evs = this.b.flee();
              this.play(evs).then(() => { if (this.b.over !== null) this.choose?.(null); else if (this.actor) { this.choose?.(null); } });
            } }, 'Flee'))))));
    this.timeline();
  }

  // ---------------------------------------------------------------- results
  private finish() {
    const outcome = this.b.over!;
    const enc = this.req.enc;
    S.stats.battles++;
    const captured = this.b.captured;
    const reports: LevelReport[] = [];
    let silver = 0, gold = 0;
    let egg: string | undefined;
    if (outcome === 0) {
      S.stats.wins++;
      const defeated = this.b.all.filter((c) => c.side === 1 && c.pool.hp <= 0 && !c.temp && !captured.includes(c.inst));
      const xp = [...defeated, ...this.b.all.filter((c) => captured.includes(c.inst))].reduce((a, c) => a + xpYield(c.inst) * (c.boss ? 4 : 1), 0) * (enc.kind === 'wild' ? 1 : 1.5);
      reports.push(...awardXp([...this.participants], Math.round(xp)));
      reports.forEach((r) => r.evolved && questEvent('evolve'));
      S.stats.defeated += defeated.length;
      questEvent('defeat', undefined, defeated.length);
      silver = enc.reward.silver;
      gold = enc.reward.gold ?? 0;
      S.silver += silver;
      S.gold += gold;
      if (enc.reward.egg) { egg = enc.reward.egg; if (egg === 'golden') S.items.golden++; else S.items.egg++; }
      if (enc.kind === 'wild' && Math.random() < 0.06) { S.items.egg++; egg = egg ?? 'egg'; }
    }
    for (const m of captured) {
      m.uid = Date.now() + Math.floor(Math.random() * 1e6);
      addMonster(m);
      S.stats.captures++;
      questEvent('capture', m.species);
    }
    save();
    if (outcome === 0) { sfx('victory'); music(null); } else if (outcome === 1) { sfx('defeat'); music(null); }
    const title = outcome === 0 ? 'VICTORY' : outcome === 1 ? 'DEFEAT' : 'ESCAPED';
    const color = outcome === 0 ? '#ffd56b' : outcome === 1 ? '#ff7b7b' : '#cfd8ff';
    const t = this.add.text(640, 120, title, { fontFamily: 'Cinzel, serif', fontStyle: '800', fontSize: '84px', color, stroke: '#2a1600', strokeThickness: 10 }).setOrigin(0.5).setDepth(200).setScale(2).setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 500, ease: 'Back.out' });
    if (outcome === 0) for (let i = 0; i < 4; i++) this.time.delayedCall(i * 180, () => this.burst(Phaser.Math.Between(300, 980), Phaser.Math.Between(150, 350), [0xffd56b, 0x6ad1ff, 0xff7043, 0x9be15d][i], 40, 420));
    clearLayer('battle');
    this.time.delayedCall(700, () => {
      const rows = reports.map((r) => {
        const m = S.party.find((x) => x.uid === r.uid) ?? null;
        return h('div', { class: 'abil row' }, m ? h('img', { src: spriteUrl(species(m.species)), style: { height: '2.6em' } }) : null,
          h('b', {}, r.name), h('span', {}, r.to > r.from ? `Lv ${r.from} → ${r.to}` : ''),
          r.evolved ? h('span', { class: 'chip', style: { background: 'var(--gold)', color: '#241400' } }, `✨ Evolved into ${r.evolved}!`) : null,
          r.hero ? h('span', { class: 'chip' }, `Hero +${r.hero} Lv`) : null);
      });
      if (reports.some((r) => r.evolved)) sfx('evolve'); else if (reports.length) sfx('levelup');
      layer('battle', h('div', { class: 'modal-back' }, h('div', { class: 'modal panel', style: { width: 'min(92%, 40em)' } },
        h('header', {}, h('h2', {}, title)),
        h('div', { class: 'body col' },
          outcome === 0 ? h('div', { class: 'row' }, h('span', { class: 'coin' }), h('b', {}, `+${silver} silver`), gold ? h('span', { class: 'coin g' }) : null, gold ? h('b', {}, `+${gold} gold`) : null,
            egg ? h('span', { class: 'chip', style: { background: 'var(--gold)', color: '#241400' } }, egg === 'golden' ? '🥚 Golden Egg!' : '🥚 Egg!') : null) : null,
          outcome === 1 ? h('p', {}, 'Your monsters are exhausted. You retreat to the last town you visited.') : null,
          ...captured.map((m) => h('div', { class: 'abil row' }, h('img', { src: spriteUrl(species(m.species)), style: { height: '2.6em' } }),
            h('b', {}, `Captured ${species(m.species).name}!`), h('span', {}, `Lv ${m.level} · Rank ${rankName(m.rank)}`), elChip(species(m.species).element))),
          ...rows,
          h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn gold', 'data-testid': 'continue', onClick: () => {
            clearLayer('battle');
            this.req.after({ outcome, captured: captured.length });
          } }, 'Continue'))))));
    });
    void FIELD; void data;
  }
}
