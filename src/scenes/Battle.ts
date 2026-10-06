/**
 * Battle screen laid out like the original Dragon Island Blue (960x640 reference space):
 * enemies stand in the scene with coloured names and HP bars across the top, the turn queue
 * (time units until each monster acts) runs down the left, and the player's monsters sit in the
 * bottom panel between the ghost box and the hero portrait. UI art comes from the original sprite
 * sheet (public/assets/ui/orig, see tools/ref_ui/slice_town_battle.py).
 */
import Phaser from 'phaser';
import { Battle, BattleEvent, Combatant } from '../core/battle';
import { species, spriteUrl } from '../core/data';
import { displayName, xpYield, rankName } from '../core/monster';
import type { Ability } from '../core/types';
import { S, save, heroBonus, awardXp, addMonster, questEvent, markSeen, LevelReport } from '../core/state';
import type { BattleReq } from '../nav';
import { coverBg, EL_COLOR } from './fx';
import { loadSprites } from './Boot';
import { h, layer, clearLayer, toast } from '../ui/dom';
import { music, sfx } from '../audio';
import { elChip } from '../ui/menus';

// reference space -> Phaser world (1280x720): 960x640 scaled to the full height, centred
const K = 720 / 640;
const OX = (1280 - 960 * K) / 2;
const T = (x: number, y: number) => ({ x: OX + x * K, y: y * K });

const ENEMY_X = [295, 548, 812];
const ENEMY_FEET = 392;
// bottom panel (cropped sheet piece is 973x165): slot centres along its HP bars
const PANEL = { w: 973, h: 165 };
const PS = (960 * K) / PANEL.w; // panel piece -> world scale
const PANEL_Y = 720 - PANEL.h * PS;
const SLOT_X = [258, 416, 571, 723];
const BAR_Y = 135, BAR_W = 133;
const P = (x: number, y: number) => ({ x: OX + x * PS, y: PANEL_Y + y * PS });

const NAME_COLOR: Record<string, string> = { Water: '#8f8dff', Air: '#8f8dff', Fire: '#ff4b3b', Death: '#ff4b3b', Earth: '#52e052', Life: '#52e052', Arcane: '#ffd84a' };
const STATUS_ICON: Record<string, string> = { stun: '💫', sleep: '💤', paralyze: '⚡', confuse: '❓', doom: '💀', taunt: '😤', disguise: '🫥', noguard: '🛡', berserk: '😡', poison: '☠' };
const FONT = { fontFamily: '"Arial Black", Arial, Helvetica, sans-serif', fontStyle: 'bold' } as const;

interface View {
  c: Combatant;
  img: Phaser.GameObjects.Image;
  home: { x: number; y: number };
  center: () => { x: number; y: number };
  bar: Phaser.GameObjects.Graphics;
  barBox: { x: number; y: number; w: number; h: number };
  name: Phaser.GameObjects.Text;
  hpText?: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  extras: Phaser.GameObjects.GameObject[];
  shownHp: number;
  baseScale: number;
}

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
  private queue: Phaser.GameObjects.Container[] = [];
  private coinText!: Phaser.GameObjects.Text;
  private nextView: Phaser.GameObjects.Container | null = null;
  private activeMark!: Phaser.GameObjects.Image;

  init(req: BattleReq) {
    this.req = req;
    this.views = new Map();
    this.participants = new Set();
    this.choose = null;
    this.pending = null;
    this.capturing = null;
    this.actor = null;
    this.queue = [];
    this.nextView = null;
  }

  create() {
    const enc = this.req.enc;
    const boss = enc.kind === 'overlord' || enc.kind === 'boss' || enc.kind === 'arena';
    music(boss ? 'boss' : 'battle');
    const bg = coverBg(this, `bg_${enc.bg}`, false);
    bg.setScale(bg.scale * 1.12);
    this.tweens.add({ targets: bg, scale: bg.scale / 1.12, duration: 900, ease: 'Cubic.out' });
    // bottom panel from the original sheet: ghost box | party slots | hero portrait
    this.add.image(OX, PANEL_Y, 'ui_panel').setOrigin(0, 0).setScale(PS).setDepth(40);
    const ghostHit = this.add.zone(...Object.values(P(0, 0)) as [number, number], 168 * PS, PANEL.h * PS).setOrigin(0, 0).setDepth(45).setInteractive({ useHandCursor: true });
    ghostHit.on('pointerdown', () => this.battleMenu());
    const heroHit = this.add.zone(P(800, 0).x, P(800, 0).y, 173 * PS, PANEL.h * PS).setOrigin(0, 0).setDepth(45).setInteractive({ useHandCursor: true });
    heroHit.on('pointerdown', () => this.toggleAuto());
    const c = T(925, 34);
    this.add.image(c.x, c.y, 'ui_coin').setDisplaySize(52 * K, 54 * K).setDepth(40);
    this.coinText = this.add.text(c.x, c.y, '0', { ...FONT, fontSize: `${30 * K}px`, color: '#ffffff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5).setDepth(41);
    this.activeMark = this.add.image(0, 0, 'ui_orb').setDepth(46).setVisible(false).setScale(0.8);
    this.tweens.add({ targets: this.activeMark, scale: 1.05, alpha: 0.6, duration: 500, yoyo: true, repeat: -1 });
    const files = [...S.party, ...this.req.enc.team].map((m) => species(m.species).sprite);
    this.b = new Battle(S.party.slice(0, 10), enc.team, {
      capturable: enc.capturable, canFlee: enc.canFlee, gem: heroBonus(), bossHp: enc.bossHp, enemyStatMult: enc.statMult,
    });
    enc.team.forEach((m) => markSeen(m.species));
    loadSprites(this, files, () => this.begin());
  }

  // ---------------------------------------------------------------- views
  private makeView(c: Combatant, entering = false): Promise<void> {
    const sp = c.sp;
    let v: View;
    if (c.side === 1) {
      const col = c.slot;
      const feet = T(ENEMY_X[col], ENEMY_FEET);
      const img = this.add.image(feet.x, feet.y, `spr_${sp.sprite}`).setOrigin(0.5, 1).setDepth(20 + col);
      const box = (c.boss ? 360 : 250) * K;
      const sc = Math.min(box / img.height, (box * 1.15) / img.width, c.boss ? 3.4 : 2.6);
      img.setScale(sc);
      const shadow = this.add.ellipse(feet.x, feet.y - 4, img.displayWidth * 0.75, 26, 0x000000, 0.35).setDepth(19);
      const top = T(ENEMY_X[col], 30);
      const name = this.add.text(top.x, top.y, displayName(c.inst), { ...FONT, fontSize: `${23 * K}px`, color: NAME_COLOR[sp.element] ?? '#fff', stroke: '#1a1030', strokeThickness: 6 }).setOrigin(0.5).setDepth(41);
      const barPos = T(ENEMY_X[col], 54);
      const frame = this.add.image(barPos.x, barPos.y, 'ui_hpbar').setDisplaySize(158 * K, 26 * K).setDepth(41);
      const bar = this.add.graphics().setDepth(42);
      const status = this.add.text(barPos.x, barPos.y + 22 * K, '', { fontSize: '18px' }).setOrigin(0.5, 0).setDepth(42);
      const lv = this.add.text(barPos.x + 80 * K, barPos.y, `${c.inst.level}`, { ...FONT, fontSize: '14px', color: '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0, 0.5).setDepth(42);
      v = {
        c, img, home: { x: feet.x, y: feet.y }, center: () => ({ x: img.x, y: img.y - img.displayHeight / 2 }),
        bar, barBox: { x: barPos.x - 66 * K, y: barPos.y - 5 * K, w: 132 * K, h: 10 * K }, name, status, extras: [shadow, frame, lv], shownHp: c.pool.hp, baseScale: sc,
      };
      this.tweens.add({ targets: img, scaleY: sc * 1.02, duration: 1000 + Math.random() * 400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    } else {
      const slot = c.slot;
      const feet = P(SLOT_X[slot], BAR_Y - 4);
      const img = this.add.image(feet.x, feet.y, `spr_${sp.sprite}`).setOrigin(0.5, 1).setDepth(43).setFlipX(true);
      const sc = Math.min((106 * PS) / img.height, (150 * PS) / img.width, 1.6);
      img.setScale(sc);
      const name = this.add.text(feet.x, feet.y - 6 * PS, displayName(c.inst), { ...FONT, fontSize: `${17 * PS}px`, color: '#ffffff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 1).setDepth(44);
      const bp = P(SLOT_X[slot] - BAR_W / 2 + 4, BAR_Y + 3);
      const bar = this.add.graphics().setDepth(44);
      const hpText = this.add.text(P(SLOT_X[slot], BAR_Y + 8.5).x, P(SLOT_X[slot], BAR_Y + 8.5).y, '', { ...FONT, fontSize: `${13 * PS}px`, color: '#ffffff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(45);
      const status = this.add.text(feet.x, PANEL_Y + 8, '', { fontSize: '16px' }).setOrigin(0.5, 0).setDepth(45);
      v = {
        c, img, home: { x: feet.x, y: feet.y }, center: () => ({ x: img.x, y: img.y - img.displayHeight / 2 }),
        bar, barBox: { x: bp.x, y: bp.y, w: (BAR_W - 8) * PS, h: 11 * PS }, name, hpText, status, extras: [], shownHp: c.pool.hp, baseScale: sc,
      };
      this.participants.add(c.inst.uid);
    }
    this.drawHp(v);
    this.views.set(c.key, v);
    v.img.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.clickMon(c));
    if (!entering) return Promise.resolve();
    const parts = [v.img, v.name, ...v.extras];
    const dy = c.side === 1 ? -40 : 60;
    parts.forEach((o: any) => { o.alpha = 0; o.y += dy; });
    return this.tw({ targets: parts, y: `-=${dy}`, alpha: 1, duration: 380, ease: 'Back.out' });
  }

  private drawHp(v: View) {
    const pct = Math.max(0, v.shownHp / v.c.pool.max);
    const { x, y, w, h: hh } = v.barBox;
    v.bar.clear();
    // the sheet's bar art is the "full" state: darken the lost part from the right
    v.bar.fillStyle(0x140303, 0.88).fillRect(x + w * pct, y, w * (1 - pct), hh);
    v.hpText?.setText(`${Math.max(0, Math.round(v.shownHp))}/${v.c.pool.max}`);
    v.status.setText(Object.keys(v.c.statuses).map((k) => STATUS_ICON[k] ?? '').join('') + (v.c.poisons.length ? STATUS_ICON.poison : ''));
  }

  private removeView(v: View) {
    [v.img, v.name, v.bar, v.status, v.hpText, ...v.extras].forEach((o) => o?.destroy());
  }

  /** Slot 4 of the panel previews the next reserve monster, like the original's 4-slot panel. */
  private drawNext() {
    this.nextView?.destroy();
    this.nextView = null;
    const nxt = this.b.reserve(0)[0];
    if (!nxt || !this.textures.exists(`spr_${nxt.sp.sprite}`)) return;
    const feet = P(SLOT_X[3], BAR_Y - 4);
    const img = this.add.image(0, 0, `spr_${nxt.sp.sprite}`).setOrigin(0.5, 1).setFlipX(true);
    img.setScale(Math.min((90 * PS) / img.height, (130 * PS) / img.width, 1.4)).setAlpha(0.55);
    const t = this.add.text(0, -6 * PS, `${displayName(nxt.inst)}`, { ...FONT, fontSize: `${15 * PS}px`, color: '#d8e6ff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 1);
    const hp = this.add.text(0, 12.5 * PS, `${nxt.pool.hp}/${nxt.pool.max}`, { ...FONT, fontSize: `${13 * PS}px`, color: '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
    this.nextView = this.add.container(feet.x, feet.y, [img, t, hp]).setDepth(43);
  }

  // ---------------------------------------------------------------- helpers
  private tw(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((res) => this.tweens.add({ ...cfg, duration: ((cfg.duration as number) ?? 300) / S.settings.speed, onComplete: () => res() }));
  }
  private wait(ms: number) { return new Promise<void>((r) => this.time.delayedCall(ms / S.settings.speed, r)); }

  private banner(text: string, color = '#fff') {
    const p = T(480, 200);
    const t = this.add.text(p.x, p.y, text, { ...FONT, fontSize: '34px', color, stroke: '#000', strokeThickness: 7 }).setOrigin(0.5).setDepth(100).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: p.y - 10, duration: 250, yoyo: true, hold: 1000 / S.settings.speed, onComplete: () => t.destroy() });
  }

  /** Original-style floating numbers: bold red "-31" / green heals, black outline. */
  private float(v: View, text: string, color: string, size = 34, dy = 0) {
    const c = v.center();
    const t = this.add.text(c.x + Phaser.Math.Between(-18, 18), c.y + dy, text, { ...FONT, fontSize: `${size}px`, color, stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5).setDepth(120).setScale(0.5);
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.out' });
    this.tweens.add({ targets: t, y: t.y - 50, alpha: 0, delay: 520 / S.settings.speed, duration: 650 / S.settings.speed, onComplete: () => t.destroy() });
  }

  private burst(x: number, y: number, color: number, n = 20, speed = 240) {
    const p = this.add.particles(x, y, 'glow', { speed: { min: speed * 0.3, max: speed }, lifespan: 550, scale: { start: 1.3, end: 0 }, tint: color, blendMode: 'ADD', emitting: false }).setDepth(110);
    p.explode(n);
    this.time.delayedCall(800, () => p.destroy());
  }

  /** The glowing orbs from the original sheet fly from caster to target. */
  private async orbs(from: { x: number; y: number }, to: { x: number; y: number }, tint: number) {
    const os = [0, 1, 2].map((i) => this.add.image(from.x + (i - 1) * 14, from.y + (i % 2) * 10, 'ui_orb').setDepth(115).setBlendMode('ADD').setTint(tint === 0xffffff ? 0xffffff : tint));
    await Promise.all(os.map((o, i) => this.tw({ targets: o, x: to.x + (i - 1) * 16, y: to.y + (i - 1) * 8, duration: 300 + i * 50, ease: 'Sine.in' })));
    os.forEach((o) => o.destroy());
  }

  // ---------------------------------------------------------------- flow
  private async begin() {
    for (const c of this.b.all.filter((x) => x.slot >= 0)) await this.makeView(c, false);
    this.drawNext();
    const enc = this.req.enc;
    this.banner(enc.intro ?? (enc.team.length > 1 ? `${enc.team.length} wild monsters appear!` : `A wild ${displayName(enc.team[0])} appears!`), enc.kind === 'wild' ? '#ffffff' : '#ffb4b4');
    if (enc.kind !== 'wild') this.cameras.main.shake(400, 0.006);
    this.refreshQueue();
    this.ui();
    await this.wait(800);
    this.loop();
  }

  private async loop() {
    while (this.b.over === null) {
      const ev: BattleEvent[] = [];
      const actor = this.b.next(ev);
      await this.play(ev);
      if (!actor || this.b.over !== null) break;
      this.actor = actor;
      this.refreshQueue();
      const v = this.views.get(actor.key);
      if (v) {
        const c = v.center();
        this.activeMark.setPosition(c.x, actor.side === 0 ? PANEL_Y + 10 : c.y - v.img.displayHeight / 2 - 6).setVisible(true);
      }
      let choice: { ability: Ability; target?: string } | null;
      if (actor.side === 0 && !S.settings.auto) {
        choice = await new Promise((res) => { this.choose = res; this.ui(); });
        this.choose = null;
        if (this.b.over !== null) break;
        if (!choice) continue;
      } else {
        this.ui();
        await this.wait(actor.side ? 360 : 220);
        choice = this.b.choose(actor);
      }
      this.activeMark.setVisible(false);
      const evs = this.b.act(actor, choice.ability, choice.target);
      this.busy = true;
      this.ui();
      await this.play(evs);
      this.busy = false;
    }
    this.activeMark.setVisible(false);
    this.finish();
  }

  /** Left column: who acts next and how many time units until they do. */
  private refreshQueue() {
    this.queue.forEach((q) => q.destroy());
    this.queue = [];
    const actors = this.b.all.filter((c) => c.slot >= 0 && c.pool.hp > 0).sort((a, b) => a.time - b.time).slice(0, 6);
    const now = Math.min(...actors.map((a) => a.time));
    actors.forEach((c, i) => {
      const p = T(22, 26 + i * 50);
      const tu = Math.max(0, Math.round(((c.time - now) * c.stats.spd) / this.b.refSpd));
      const frame = this.add.image(0, 0, 'ui_qframe').setOrigin(0, 0).setDisplaySize(52 * K, 38 * K);
      const icon = this.add.image(26 * K, 19 * K, `spr_${c.sp.sprite}`);
      icon.setScale(Math.min((44 * K) / icon.width, (32 * K) / icon.height)).setFlipX(c.side === 0);
      const color = i === 0 ? '#ff2a1f' : c.side === 0 ? '#3cdc4a' : tu < 60 ? '#ffffff' : '#8f8dff';
      const num = this.add.text(76 * K, 19 * K, `${tu}`, { ...FONT, fontSize: `${21 * K}px`, color, stroke: '#000', strokeThickness: 5 }).setOrigin(0.5);
      const bar = this.add.image(0, 38 * K, 'ui_qbar').setOrigin(0, 0).setDisplaySize(104 * K, 15 * K);
      const g = this.add.graphics();
      const pct = c.pool.hp / c.pool.max;
      g.fillStyle(0x140303, 0.85).fillRect(6 * K + 92 * K * pct, 41 * K, 92 * K * (1 - pct), 8 * K);
      this.queue.push(this.add.container(p.x, p.y, [frame, icon, num, bar, g]).setDepth(41));
    });
    this.coinText.setText(String(this.b.reserve(1).length));
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
        const ac = a.center();
        const label = this.add.text(ac.x, a.c.side ? ac.y - a.img.displayHeight / 2 - 20 : PANEL_Y - 18, e.ability,
          { ...FONT, fontSize: '22px', color: '#fff', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(130);
        this.tweens.add({ targets: label, alpha: 0, y: label.y - 18, delay: 650 / S.settings.speed, duration: 380, onComplete: () => label.destroy() });
        const targets = e.targets.map(V).filter(Boolean) as View[];
        const foe = targets.find((t) => t.c.side !== a.c.side);
        if (ab?.kind === 'physical' && foe) {
          sfx('select');
          if (a.c.side === 0) {
            await this.tw({ targets: a.img, y: a.home.y - 70, scale: a.baseScale * 1.25, duration: 170, ease: 'Quad.out' });
            this.tw({ targets: a.img, y: a.home.y, scale: a.baseScale, duration: 240, ease: 'Quad.in' });
          } else {
            await this.tw({ targets: a.img, y: a.home.y + 40, scale: a.baseScale * 1.12, duration: 170, ease: 'Quad.in' });
            this.tw({ targets: a.img, y: a.home.y, scale: a.baseScale, duration: 260, ease: 'Quad.out' });
          }
        } else if (ab?.kind === 'magical' && foe) {
          sfx('magic');
          await Promise.all(targets.filter((t) => t.c.side !== a.c.side).map((t) => this.orbs(ac, t.center(), col)));
        } else {
          sfx(ab?.healPower ? 'heal' : 'buff');
          const ring = this.add.circle(ac.x, ac.y, 26, col, 0).setStrokeStyle(6, col, 0.9).setDepth(105);
          await this.tw({ targets: ring, scale: 3, alpha: 0, duration: 360 });
          ring.destroy();
        }
        break;
      }
      case 'damage': {
        const v = V(e.who);
        if (!v) return;
        const c = v.center();
        if (!e.dot) {
          this.burst(c.x, c.y, EL_COLOR[e.element ?? ''] ?? 0xffffff, e.crit ? 34 : 18, e.crit ? 340 : 240);
          sfx(e.crit ? 'crit' : 'hit');
          v.img.setTintFill(0xffffff);
          this.time.delayedCall(70, () => v.img.clearTint());
          this.tweens.add({ targets: v.img, x: { from: v.home.x - 9, to: v.home.x }, duration: 60, repeat: 2, yoyo: true });
          if (e.crit || e.mult > 1) this.cameras.main.shake(e.crit ? 220 : 120, e.crit ? 0.01 : 0.005);
        } else {
          v.img.setTint(0xb05cff);
          this.time.delayedCall(160, () => v.img.clearTint());
        }
        this.float(v, `-${e.amount}`, e.dot ? '#d79bff' : '#ff2a1f', e.crit ? 42 : 34);
        if (e.crit) this.float(v, 'CRITICAL', '#ffb14a', 20, -40);
        else if (e.mult > 1) this.float(v, 'Super effective', '#ffe34a', 18, -40);
        else if (e.mult < 1) this.float(v, 'Resisted', '#c7d0e8', 16, -40);
        for (const o of this.views.values()) if (o.c.pool === v.c.pool) this.animHp(o);
        await this.wait(e.dot ? 260 : 360);
        break;
      }
      case 'heal': {
        const v = V(e.who);
        if (!v) return;
        sfx('heal');
        const c = v.center();
        const p = this.add.particles(c.x, c.y + 20, 'glow', { speedY: { min: -150, max: -60 }, speedX: { min: -40, max: 40 }, lifespan: 650, scale: { start: 1, end: 0 }, tint: 0x8cff9e, blendMode: 'ADD', emitting: false }).setDepth(110);
        p.explode(18);
        this.time.delayedCall(800, () => p.destroy());
        this.float(v, `+${e.amount}`, '#3cff6a', 32);
        for (const o of this.views.values()) if (o.c.pool === v.c.pool) this.animHp(o);
        await this.wait(280);
        break;
      }
      case 'mod': {
        const v = V(e.who);
        if (!v) return;
        const up = e.amount > 0;
        sfx(up ? 'buff' : 'debuff');
        this.float(v, `${up ? '▲' : '▼'} ${e.stat.toUpperCase()}`, up ? '#7fe3ff' : '#ff9a9a', 20, 12);
        await this.wait(180);
        break;
      }
      case 'status': {
        const v = V(e.who);
        if (!v) return;
        this.drawHp(v);
        if (!e.on) return;
        const labels: Record<string, string> = { immune: 'Immune', cleanse: 'Cleansed', poison: 'Poisoned' };
        this.float(v, labels[e.status] ?? e.status[0].toUpperCase() + e.status.slice(1), e.status === 'immune' ? '#e2e8ff' : '#ffb3ff', 22, 20);
        sfx(e.status === 'immune' || e.status === 'cleanse' ? 'buff' : 'debuff');
        await this.wait(240);
        break;
      }
      case 'skip': {
        const v = V(e.who);
        if (v) this.float(v, e.reason === 'asleep' ? 'Zzz…' : 'Confused', '#d0d8ff', 22);
        await this.wait(320);
        break;
      }
      case 'faint': {
        const v = V(e.who);
        if (!v) return;
        sfx('faint');
        this.views.delete(e.who);
        v.img.setTint(0x555555);
        await this.tw({ targets: [v.img, v.name, ...v.extras], alpha: 0, y: '+=24', duration: 420 });
        this.removeView(v);
        this.refreshQueue();
        break;
      }
      case 'leave': {
        const v = V(e.who);
        if (!v) return;
        this.views.delete(e.who);
        await this.tw({ targets: [v.img, v.name, ...v.extras], alpha: 0, duration: 350 });
        this.removeView(v);
        break;
      }
      case 'enter': {
        const c = this.b.get(e.who);
        const old = [...this.views.values()].find((x) => x.c.side === c.side && x.c.slot === c.slot && x.c !== c);
        if (old) { this.views.delete(old.c.key); this.removeView(old); }
        await new Promise<void>((res) => loadSprites(this, [c.sp.sprite], () => res()));
        if (c.side === 1) markSeen(c.sp.id);
        await this.makeView(c, true);
        this.drawNext();
        this.refreshQueue();
        break;
      }
      case 'text':
        this.banner(e.msg);
        await this.wait(560);
        break;
      case 'capture':
        await this.captureAnim(e.who, e.success, e.chance);
        break;
      default:
        break;
    }
  }

  private animHp(v: View) {
    const target = v.c.pool.hp;
    this.tweens.addCounter({ from: v.shownHp, to: target, duration: 340 / S.settings.speed, onUpdate: (t) => { v.shownHp = t.getValue() ?? target; this.drawHp(v); } });
  }

  private async captureAnim(key: string, ok: boolean, chance: number) {
    const v = this.views.get(key);
    if (!v) return;
    const c = v.center();
    const from = P(80, 80);
    const card = this.add.rectangle(from.x, from.y, 44, 58, 0xf0f4ff).setStrokeStyle(3, this.capturing === 'gold' ? 0xf6c453 : 0xffffff).setDepth(140);
    await this.tw({ targets: card, x: c.x, y: c.y, angle: 720, duration: 450, ease: 'Quad.out' });
    this.burst(c.x, c.y, 0xffffff, 26);
    await this.tw({ targets: v.img, scale: v.baseScale * 0.15, alpha: 0.4, duration: 280 });
    for (let i = 0; i < 3; i++) {
      sfx('spin');
      await this.tw({ targets: card, angle: { from: -18, to: 18 }, duration: 160, yoyo: true });
      if (!ok && i === Math.floor(chance * 3)) break;
    }
    if (ok) {
      sfx('capture');
      this.burst(c.x, c.y, 0xf6c453, 46, 380);
      this.float(v, 'Captured!', '#ffd23f', 34);
      await this.tw({ targets: card, y: card.y - 80, alpha: 0, duration: 450 });
    } else {
      sfx('fail');
      this.float(v, `Broke free! (${Math.round(chance * 100)}%)`, '#ff9a9a', 22);
      await this.tw({ targets: v.img, scale: v.baseScale, alpha: 1, duration: 240, ease: 'Back.out' });
      await this.tw({ targets: card, alpha: 0, duration: 180 });
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
      if (type === 'card') S.items.card--; else if (type === 'silver') S.items.silver--; else S.items.gold--;
      const evs = this.b.tryCapture(c.key, type);
      this.busy = true;
      this.ui();
      this.play(evs).then(() => {
        this.capturing = null;
        this.busy = false;
        this.refreshQueue();
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

  private toggleAuto() {
    S.settings.auto = !S.settings.auto;
    save();
    toast(S.settings.auto ? 'Auto battle on' : 'Auto battle off');
    if (S.settings.auto && this.choose && this.actor) this.choose(this.b.choose(this.actor));
    this.ui();
  }

  /** The ghost box opens the battle menu: capture cards, auto, speed, escape. */
  private battleMenu() {
    if (document.querySelector('.bt-menu')) { clearLayer('battlemenu'); return; }
    const mine = () => !!(this.actor && this.actor.side === 0 && this.choose && !this.busy);
    const card = (t: 'card' | 'silver' | 'gold', n: number, label: string) => h('button', {
      class: 'bt-mi', disabled: !n || !this.req.enc.capturable,
      onClick: () => {
        if (!mine()) return toast('Wait for one of your monsters to act.');
        this.capturing = t; this.pending = null; clearLayer('battlemenu'); this.ui();
      },
    }, `${label} ×${n}`);
    layer('battlemenu', h('div', { class: 'bt-menu' },
      card('card', S.items.card, 'Capture Card'), card('silver', S.items.silver, 'Silver Card'), card('gold', S.items.gold, 'Gold Card'),
      h('button', { class: 'bt-mi', onClick: () => { clearLayer('battlemenu'); this.toggleAuto(); } }, `Auto: ${S.settings.auto ? 'ON' : 'OFF'}`),
      h('button', { class: 'bt-mi', onClick: () => { S.settings.speed = (S.settings.speed % 3) + 1; save(); clearLayer('battlemenu'); this.battleMenu(); } }, `Speed ${S.settings.speed}x`),
      h('button', { class: 'bt-mi red', disabled: !this.req.enc.canFlee, onClick: () => {
        if (!mine()) return toast('Wait for one of your monsters to act.');
        clearLayer('battlemenu');
        const evs = this.b.flee();
        this.play(evs).then(() => this.choose?.(null));
      } }, 'Escape')));
  }

  private ui() {
    const actor = this.actor;
    const mine = !!(actor && actor.side === 0 && this.choose && !this.busy);
    const abilities = mine ? this.b.usable(actor!) : [];
    const prompt = this.capturing ? 'Tap a wild monster to throw the card' : this.pending ? `Choose a target for ${this.pending.name}` : '';
    layer('battle', h('div', {},
      prompt ? h('div', { class: 'bt-prompt2' }, prompt) : null,
      mine ? h('div', { class: 'bt-abil2' },
        h('div', { class: 'who' }, `${displayName(actor!.inst)}`),
        ...abilities.map((a) => h('button', {
          class: `bt-ab2 ${this.pending === a ? 'on' : ''}`,
          onClick: () => {
            if (!this.choose) return;
            this.capturing = null;
            const needsPick = ((a.target === 'foe' || a.target === 'twoFoes') && this.b.foesOf(actor!).length > 1 && !(a.healPower && !a.power)) || (a.target === 'ally' && this.b.alliesOf(actor!).length > 1);
            if (needsPick && this.pending !== a) { this.pending = a; this.ui(); return; }
            this.pending = null;
            this.choose({ ability: a });
          },
        }, h('span', { class: 'n' }, a.name), h('span', { class: 'tu' }, `${a.tu ?? 130}`), h('span', { class: 'd' }, `${a.element ? a.element + ' · ' : ''}${a.text ?? ''}`)))) : null));
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
    music(null);
    sfx(outcome === 0 ? 'victory' : outcome === 1 ? 'defeat' : 'back');
    const title = outcome === 0 ? 'VICTORY' : outcome === 1 ? 'DEFEAT' : 'ESCAPED';
    const color = outcome === 0 ? '#ffd56b' : outcome === 1 ? '#ff7b7b' : '#cfd8ff';
    const tp = T(480, 110);
    const t = this.add.text(tp.x, tp.y, title, { ...FONT, fontSize: '80px', color, stroke: '#2a1600', strokeThickness: 10 }).setOrigin(0.5).setDepth(200).setScale(2).setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 500, ease: 'Back.out' });
    clearLayer('battle');
    clearLayer('battlemenu');
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
  }
}
