/**
 * Battle screen laid out like the original Dragon Island Blue (960x640 reference space):
 * enemies stand in the scene with coloured names and HP bars across the top, the turn queue
 * (time units until each monster acts) runs down the left, and the player's monsters sit in the
 * bottom panel between the ghost box and the hero portrait. On the player's turn the ghost box shows
 * the acting monster and the middle panel turns into its ability cards (TU + info), as in
 * tools/ref_ui/battle_reference2.png. Art: public/assets/ui/orig (slice_town_battle.py) and
 * public/assets/ui/orig/bk (slice_battle_kit.py).
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

const FX_BY_ELEMENT: Record<string, string> = { Air: 'bk_fx_tornado', Water: 'bk_fx_ring', Fire: 'bk_fx_red', Earth: 'bk_fx_green', Death: 'bk_fx_web', Life: 'bk_fx_sparkle', Arcane: 'bk_fx_sparkle' };
const DUNGEON_BGS = new Set(['cave', 'castle', 'ruins', 'sanctuary', 'piratecave', 'magma', 'abyss', 'lighthouse']);
const CARD_Y = 470, CARD_H = 80;

/** Card art like the original: quick physical hit, heavy/support move, magic, or a locked slot. */
function cardArt(a: Ability) {
  if (a.kind === 'magical') return 'bk_card_flame';
  if (a.kind === 'physical' && (a.tu ?? 130) < 150) return 'bk_card_tail';
  return 'bk_card_outrage';
}

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
  fill?: Phaser.GameObjects.Image;
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
  private actorBox: Phaser.GameObjects.Container | null = null;
  private cards: Phaser.GameObjects.Container | null = null;
  private targets: Phaser.GameObjects.Image[] = [];
  private minicards: Phaser.GameObjects.Image[] = [];
  private cardType: 'card' | 'silver' | 'gold' = 'card';
  private paused = false;
  private panelImg!: Phaser.GameObjects.Image;

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
    this.actorBox = null;
    this.cards = null;
    this.targets = [];
    this.minicards = [];
    this.paused = false;
  }

  create() {
    const enc = this.req.enc;
    const boss = enc.kind === 'overlord' || enc.kind === 'boss' || enc.kind === 'arena';
    music(boss ? 'boss' : 'battle');
    const bg = coverBg(this, `bg_${enc.bg}`, false);
    bg.setScale(bg.scale * 1.12);
    this.tweens.add({ targets: bg, scale: bg.scale / 1.12, duration: 900, ease: 'Cubic.out' });
    // bottom panel from the original sheet: ghost box | party slots | hero portrait
    this.panelImg = this.add.image(OX, PANEL_Y, 'ui_panel').setOrigin(0, 0).setScale(PS).setDepth(40);
    const heroHit = this.add.zone(P(800, 0).x, P(800, 0).y, 173 * PS, PANEL.h * PS).setOrigin(0, 0).setDepth(45).setInteractive({ useHandCursor: true });
    heroHit.on('pointerdown', () => this.toggleAuto());
    if (DUNGEON_BGS.has(enc.bg)) this.candles();
    // round buttons in the scene, bottom right (flee / monsters = auto / scroll = cards & speed)
    ([['bk_btn_flee', 735, () => this.flee()], ['bk_btn_monsters', 822, () => this.toggleAuto()], ['bk_btn_scroll', 915, () => this.battleMenu()]] as const)
      .forEach(([key, x, fn]) => {
        const p = T(x, 408);
        const b = this.add.image(p.x, p.y, key).setDisplaySize(62 * K, 62 * K).setDepth(39).setInteractive({ useHandCursor: true });
        b.on('pointerover', () => b.setTint(0xfff0c0)).on('pointerout', () => b.clearTint()).on('pointerdown', () => { sfx('select'); fn(); });
      });
    const c = T(928, 32);
    this.add.image(c.x, c.y, 'bk_coin').setDisplaySize(50 * K, 52 * K).setDepth(40);
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
      const top = T(ENEMY_X[col], 27);
      const name = this.add.text(top.x, top.y, displayName(c.inst), { ...FONT, fontSize: `${23 * K}px`, color: NAME_COLOR[sp.element] ?? '#fff', stroke: '#1a1030', strokeThickness: 6 }).setOrigin(0.5).setDepth(41);
      const barPos = T(ENEMY_X[col], 58);
      const bw = 150 * K, bh = 22 * K;
      const frame = this.add.image(barPos.x, barPos.y, 'bk_bar_empty').setDisplaySize(bw, bh).setDepth(41);
      const fillImg = this.add.image(barPos.x - bw / 2, barPos.y, 'bk_bar_red').setOrigin(0, 0.5).setDisplaySize(bw, bh).setDepth(42);
      const bar = this.add.graphics().setDepth(42);
      const status = this.add.text(barPos.x, barPos.y + 18 * K, '', { fontSize: '18px' }).setOrigin(0.5, 0).setDepth(42);
      const lv = this.add.text(barPos.x + bw / 2 + 4, barPos.y, `${c.inst.level}`, { ...FONT, fontSize: '14px', color: '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0, 0.5).setDepth(42);
      // mini capture card beside the name: tap it to throw a card at this monster
      const mp = T(ENEMY_X[col] - 118, 62);
      const mini = this.add.image(mp.x, mp.y, 'bk_minicard').setDisplaySize(62 * K, 74 * K).setDepth(41);
      if (this.req.enc.capturable && !c.temp) {
        mini.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.throwCard(c));
        mini.on('pointerover', () => mini.setTint(0xfff0c0)).on('pointerout', () => mini.clearTint());
      } else mini.setAlpha(0.35);
      v = {
        c, img, home: { x: feet.x, y: feet.y }, center: () => ({ x: img.x, y: img.y - img.displayHeight / 2 }),
        bar, barBox: { x: barPos.x - bw / 2, y: barPos.y - bh / 2, w: bw, h: bh }, name, status, extras: [shadow, frame, fillImg, lv, mini], shownHp: c.pool.hp, baseScale: sc,
        fill: fillImg,
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
    if (v.fill) {
      // original bars: red above half health, orange below; the empty bar shows through
      v.fill.setTexture(pct > 0.5 ? 'bk_bar_red' : 'bk_bar_orange').setDisplaySize(w, hh);
      v.fill.setCrop(0, 0, v.fill.width * pct, v.fill.height);
      v.status.setText(Object.keys(v.c.statuses).map((k) => STATUS_ICON[k] ?? '').join('') + (v.c.poisons.length ? STATUS_ICON.poison : ''));
      return;
    }
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
    this.nextView = this.add.container(feet.x, feet.y, [img, t, hp]).setDepth(43).setVisible(!this.cards);
  }

  // ---------------------------------------------------------------- helpers
  private tw(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((res) => this.tweens.add({ ...cfg, duration: ((cfg.duration as number) ?? 300) / S.settings.speed, onComplete: () => res() }));
  }
  private async wait(ms: number) {
    await new Promise<void>((r) => this.time.delayedCall(ms / S.settings.speed, r));
    while (this.paused) await new Promise<void>((r) => this.time.delayedCall(120, r));
  }

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
        this.showTurn(actor);
        choice = await new Promise((res) => { this.choose = res; this.ui(); });
        this.choose = null;
        this.hideTurn();
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
      const p = T(22, 6 + i * 67);
      const tu = Math.max(0, Math.round(((c.time - now) * c.stats.spd) / this.b.refSpd));
      const frame = this.add.image(0, 0, 'ui_qframe').setOrigin(0, 0).setDisplaySize(52 * K, 38 * K);
      const icon = this.add.image(26 * K, 19 * K, `spr_${c.sp.sprite}`);
      icon.setScale(Math.min((44 * K) / icon.width, (32 * K) / icon.height)).setFlipX(c.side === 0);
      const color = i === 0 ? '#ff2a1f' : c.side === 0 ? '#3cdc4a' : tu < 60 ? '#ffffff' : '#8f8dff';
      const num = this.add.text(76 * K, 19 * K, `${tu}`, { ...FONT, fontSize: `${21 * K}px`, color, stroke: '#000', strokeThickness: 5 }).setOrigin(0.5);
      const pct = c.pool.hp / c.pool.max;
      const bar = this.add.image(0, 46 * K, pct > 0.5 ? 'bk_qbar_red' : 'bk_qbar_orange').setOrigin(0, 0).setDisplaySize(100 * K, 14 * K);
      const g = this.add.graphics();
      g.fillStyle(0x1b1b1b, 0.95).fillRect(4 * K + 92 * K * pct, 49 * K, 92 * K * (1 - pct), 8 * K);
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
          const fxKey = FX_BY_ELEMENT[e.element ?? ''];
          if (fxKey && e.kind === 'magical') {
            const fx = this.add.image(c.x, c.y, fxKey).setDepth(112).setScale(0.3).setAlpha(0.95);
            this.tweens.add({ targets: fx, scale: 1.25, angle: 200, alpha: 0, duration: 650 / S.settings.speed, ease: 'Cubic.out', onComplete: () => fx.destroy() });
          }
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
        if (up) {
          const c2 = v.center();
          const ring = this.add.image(c2.x, c2.y + v.img.displayHeight * 0.35, 'bk_fx_silver').setDepth(111).setScale(0.6).setAlpha(0.9);
          this.tweens.add({ targets: ring, y: c2.y - v.img.displayHeight * 0.3, alpha: 0, duration: 600 / S.settings.speed, onComplete: () => ring.destroy() });
        }
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
        if (this.cards && c.side === 0) this.setPartyVisible(false);
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
    // the thrown card is the kit's capture card, tinted for silver/gold cards
    const card = this.add.image(from.x, from.y, 'bk_minicard').setDisplaySize(50, 60).setDepth(140);
    if (this.capturing === 'gold') card.setTint(0xffe08a); else if (this.capturing === 'silver') card.setTint(0xdfe8f5);
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
    this.clearTargets();
    this.choose({ ability: a, target: c.key });
  }

  /** Mini capture card next to an enemy's name. */
  private throwCard(c: Combatant) {
    if (!this.choose || this.busy || !this.actor || this.actor.side !== 0) return toast('Throw cards on one of your monsters\' turns.');
    if (c.pool.hp <= 0 || c.slot < 0) return;
    this.capturing = this.cardType;
    this.clickMon(c);
  }

  private flee() {
    if (!this.choose || this.busy || !this.actor || this.actor.side !== 0) return toast('Wait for one of your monsters to act.');
    if (!this.req.enc.canFlee) return toast("You can't run from this fight!");
    const evs = this.b.flee();
    this.play(evs).then(() => this.choose?.(null));
  }

  private toggleAuto() {
    S.settings.auto = !S.settings.auto;
    save();
    toast(S.settings.auto ? 'Auto battle on' : 'Auto battle off');
    if (S.settings.auto && this.choose && this.actor) this.choose(this.b.choose(this.actor));
    this.ui();
  }

  // ---------------------------------------------------------------- player's turn: actor box + ability cards
  private setPartyVisible(on: boolean) {
    this.panelImg?.setTexture(on ? 'ui_panel' : 'ui_panel_cards');
    for (const v of this.views.values()) if (v.c.side === 0) [v.img, v.name, v.bar, v.hpText, v.status].forEach((o) => o?.setVisible(on));
    this.nextView?.setVisible(on);
  }

  private showTurn(actor: Combatant) {
    this.hideTurn();
    this.setPartyVisible(false);
    const v = this.views.get(actor.key);
    // acting monster in the left box (original: portrait, name, HP bar)
    const bx = T(3, 449), bw = 175 * K, bh = 188 * K;
    const box = this.add.image(0, 0, 'bk_actor_box').setOrigin(0, 0).setDisplaySize(bw, bh);
    const sp = this.add.image(bw / 2, bh * 0.66, `spr_${actor.sp.sprite}`).setOrigin(0.5, 1).setFlipX(true);
    sp.setScale(Math.min((bw * 0.82) / sp.width, (bh * 0.6) / sp.height, 1.8));
    const name = this.add.text(bw / 2, bh * 0.73, displayName(actor.inst), { ...FONT, fontSize: `${17 * K}px`, color: '#fff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5);
    const pct = actor.pool.hp / actor.pool.max;
    const barX = bw * 0.085, barW = bw * 0.84, barY = bh * 0.825, barH = bh * 0.11;
    const lost = this.add.graphics().fillStyle(0x1b1b1b, 0.95).fillRect(barX + barW * pct, barY, barW * (1 - pct), barH);
    const hp = this.add.text(bw / 2, barY + barH / 2, `${actor.pool.hp}/${actor.pool.max}`, { ...FONT, fontSize: `${14 * K}px`, color: '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
    this.actorBox = this.add.container(bx.x, bx.y, [box, sp, name, lost, hp]).setDepth(47);
    void v;
    // ability cards across the middle panel; empty slots show the locked "???" card
    const abilities = this.b.usable(actor);
    const n = Math.max(4, abilities.length);
    const step = Math.min(150, 600 / n), cw = Math.min(116, step - 10), ch = (cw / 116) * CARD_H;
    const parts: Phaser.GameObjects.GameObject[] = [];
    for (let i = 0; i < n; i++) {
      const a = abilities[i];
      const cx = T(255 + i * step - (n > 4 ? 20 : 0), 0).x;
      const cy = T(0, CARD_Y).y;
      const card = this.add.image(cx, cy, a ? cardArt(a) : 'bk_card_locked').setOrigin(0.5, 0).setDisplaySize(cw * K, ch * K);
      parts.push(card);
      if (!a) continue;
      const nm = this.add.text(cx, cy + ch * K + 13 * K, a.name, { ...FONT, fontSize: `${(a.name.length > 11 ? 15 : 18) * K}px`, color: '#fff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5);
      const tu = this.add.text(cx - 14 * K, T(0, 612).y, `TU:${a.tu ?? 130}`, { ...FONT, fontSize: `${15 * K}px`, color: '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
      const info = this.add.image(cx + 40 * K, T(0, 612).y, 'bk_info').setDisplaySize(22 * K, 22 * K).setInteractive({ useHandCursor: true });
      info.on('pointerdown', () => { sfx('select'); this.abilityInfo(a); });
      card.setInteractive({ useHandCursor: true });
      card.on('pointerover', () => card.setTint(0xfff3c4)).on('pointerout', () => { if (this.pending !== a) card.clearTint(); });
      card.on('pointerdown', () => this.pickAbility(actor, a, card));
      parts.push(nm, tu, info);
    }
    this.cards = this.add.container(0, 0, parts).setDepth(47);
  }

  private hideTurn() {
    this.actorBox?.destroy();
    this.actorBox = null;
    this.cards?.destroy();
    this.cards = null;
    this.clearTargets();
    clearLayer('abinfo');
    this.setPartyVisible(true);
  }

  private clearTargets() {
    this.targets.forEach((t) => t.destroy());
    this.targets = [];
  }

  private pickAbility(actor: Combatant, a: Ability, card: Phaser.GameObjects.Image) {
    if (!this.choose || this.busy) return;
    sfx('select');
    this.capturing = null;
    const needsPick = ((a.target === 'foe' || a.target === 'twoFoes') && this.b.foesOf(actor).length > 1 && !(a.healPower && !a.power)) || (a.target === 'ally' && this.b.alliesOf(actor).length > 1);
    if (needsPick) {
      if (this.pending === a) { this.pending = null; card.clearTint(); this.clearTargets(); return; }
      this.cards?.list.forEach((o) => (o as Phaser.GameObjects.Image).clearTint?.());
      card.setTint(0xfff3c4);
      this.pending = a;
      this.clearTargets();
      const pool = a.target === 'ally' ? this.b.alliesOf(actor) : this.b.foesOf(actor);
      for (const t of pool) {
        const v = this.views.get(t.key);
        if (!v) continue;
        const c = t.side === 0 ? { x: v.home.x, y: PANEL_Y + 40 } : v.center();
        const m = this.add.image(c.x, c.y, 'bk_fx_target').setDepth(118).setScale(0.55 * K).setInteractive({ useHandCursor: true });
        m.on('pointerdown', () => this.clickMon(t));
        this.tweens.add({ targets: m, scale: 0.7 * K, angle: 45, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        this.targets.push(m);
      }
      this.ui();
      return;
    }
    this.pending = null;
    this.choose({ ability: a });
  }

  private abilityInfo(a: Ability) {
    const tgt = { foe: '1 Foe', twoFoes: '2 Foes', allFoes: 'All Foes', self: 'Self', ally: '1 Ally', allAllies: 'All Allies', all: 'Everyone', passive: '—' }[a.target];
    const box = h('div', { class: 'parch-pop', onClick: () => clearLayer('abinfo') },
      h('div', { class: 'pp-title' }, a.name),
      h('div', {}, `${tgt} · TU ${a.tu ?? 130}${a.element ? ` · ${a.element}` : ''}`),
      h('div', { class: 'pp-text' }, a.text ?? ''));
    layer('abinfo', box);
  }

  /** Scroll button: capture card type + battle speed, in the original blue panel. */
  private battleMenu() {
    if (document.querySelector('.bt-menu')) { clearLayer('battlemenu'); return; }
    const pick = (t: 'card' | 'silver' | 'gold', n: number, label: string) => h('button', {
      class: `bt-mi ${this.cardType === t ? 'on' : ''}`, disabled: !n,
      onClick: () => { this.cardType = t; clearLayer('battlemenu'); toast(`${label} selected — tap the small card beside a monster's name to throw it.`); },
    }, `${label} ×${n}`);
    const speedBtn = (img: string, sp: number | 'pause', label: string) => h('button', {
      class: `bt-speed ${(sp === 'pause' ? this.paused : !this.paused && S.settings.speed === sp) ? 'on' : ''}`, title: label,
      onClick: () => {
        if (sp === 'pause') this.paused = !this.paused;
        else { this.paused = false; S.settings.speed = sp; save(); }
        clearLayer('battlemenu');
        this.battleMenu();
      },
    }, h('img', { src: `assets/ui/orig/bk/${img}.png`, alt: label }));
    layer('battlemenu', h('div', { class: 'bt-menu' },
      h('div', { class: 'bt-mh' }, 'Capture card'),
      pick('card', S.items.card, 'Card'), pick('silver', S.items.silver, 'Silver Card'), pick('gold', S.items.gold, 'Gold Card'),
      h('div', { class: 'bt-mh' }, 'Speed'),
      h('div', { class: 'row' }, speedBtn('pause', 'pause', 'Pause'), speedBtn('play', 1, '1x'), speedBtn('ff', 2, '2x'), speedBtn('fff', 3, '3x')),
      h('button', { class: 'bt-mi', onClick: () => { clearLayer('battlemenu'); this.toggleAuto(); } }, `Auto: ${S.settings.auto ? 'ON' : 'OFF'}`)));
  }

  private ui() {
    const prompt = this.capturing ? 'Tap a wild monster to throw the card' : this.pending ? `Choose a target for ${this.pending.name}` : this.paused ? 'Paused' : '';
    layer('battle', h('div', {}, prompt ? h('div', { class: 'bt-prompt2' }, prompt) : null));
  }

  private candles() {
    const spots: [string, number, number, number][] = [['bk_candle_double', 22, 300, 0.42], ['bk_candle_tall', 175, 250, 0.38], ['bk_candle_double', 938, 280, 0.42], ['bk_candle_small', 790, 230, 0.4]];
    for (const [key, x, y, sc] of spots) {
      const p = T(x, y);
      const c = this.add.image(p.x, p.y, key).setOrigin(0.5, 1).setScale(sc * K).setDepth(8);
      const glow = this.add.image(p.x, p.y - c.displayHeight * 0.9, 'glow').setTint(0xffb347).setBlendMode('ADD').setScale(3.2).setAlpha(0.55).setDepth(8);
      this.tweens.add({ targets: glow, alpha: 0.3, scale: 2.7, duration: 260 + Math.random() * 200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
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
    this.hideTurn();
    clearLayer('battle');
    clearLayer('battlemenu');
    this.time.delayedCall(700, () => {
      const rows = reports.map((r) => {
        const m = S.party.find((x) => x.uid === r.uid) ?? null;
        return h('div', { class: 'abil row' }, m ? h('img', { src: spriteUrl(species(m.species)), style: { height: '2.6em' } }) : null,
          h('b', {}, r.name), h('span', {}, r.to > r.from ? `Lv ${r.from} → ${r.to}` : ''),
          r.evolved ? h('span', { class: 'chip gold' }, `✨ Evolved into ${r.evolved}!`) : null,
          r.hero ? h('span', { class: 'chip' }, `Hero +${r.hero} Lv`) : null);
      });
      if (reports.some((r) => r.evolved)) sfx('evolve'); else if (reports.length) sfx('levelup');
      layer('battle', h('div', { class: 'modal-back' }, h('div', { class: 'modal panel', style: { width: 'min(92%, 40em)' } },
        h('header', {}, h('h2', {}, title)),
        h('div', { class: 'body col' },
          outcome === 0 ? h('div', { class: 'row' }, h('span', { class: 'coin' }), h('b', {}, `+${silver} silver`), gold ? h('span', { class: 'coin g' }) : null, gold ? h('b', {}, `+${gold} gold`) : null,
            egg ? h('span', { class: 'chip gold' }, egg === 'golden' ? '🥚 Golden Egg!' : '🥚 Egg!') : null) : null,
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
