/**
 * Headless CTB ("time unit") battle engine modelled on Dragon Island Blue:
 * up to 3 monsters per side are on the field, the rest wait in reserve; each ability
 * costs Time Units and faster monsters spend fewer real ticks per TU.
 */
import { species, speciesByName, data } from './data';
import { statsOf, makeMonster, displayName } from './monster';
import type { Ability, Element, MonsterInst, Species, Stats, StatusType } from './types';
import { Rng } from './rng';

export const FIELD = 3;
const STRONG: Record<Element, Element[]> = {
  Air: ['Water'], Water: ['Fire'], Fire: ['Earth'], Earth: ['Air'], Life: ['Death'], Death: [], Arcane: ['Arcane'],
};
export function elementMult(att: Element | null | undefined, def: Element): number {
  if (!att) return 1;
  if (STRONG[att].includes(def)) return 1.5;
  if (STRONG[def].includes(att) && att !== def) return 0.7;
  return 1;
}

export interface Pool { hp: number; max: number }
export interface Combatant {
  key: string;
  side: 0 | 1;
  inst: MonsterInst;
  sp: Species;
  base: Stats;
  stats: Stats;
  pool: Pool;
  time: number;
  slot: number; // 0..2 on field, -1 reserve, -2 gone
  statuses: Partial<Record<StatusType, number>>; // until clock
  poisons: { until: number; next: number; dmg: number; element: Element | null; src: string }[];
  immune: boolean;
  reflect: number;
  scout: boolean;
  captureTried: boolean;
  temp: boolean; // clone/summon: never returned to the player's collection
  boss: boolean;
  usedBuffs: Record<string, number>;
}
export type BattleEvent =
  | { t: 'turn'; who: string }
  | { t: 'use'; who: string; ability: string; element?: Element | null; targets: string[] }
  | { t: 'damage'; who: string; src: string; amount: number; crit: boolean; mult: number; element?: Element | null; kind?: string; dot?: boolean }
  | { t: 'heal'; who: string; amount: number }
  | { t: 'status'; who: string; status: StatusType | 'poison' | 'cleanse' | 'immune'; on: boolean }
  | { t: 'mod'; who: string; stat: string; amount: number }
  | { t: 'faint'; who: string }
  | { t: 'enter'; who: string; slot: number }
  | { t: 'leave'; who: string }
  | { t: 'skip'; who: string; reason: string }
  | { t: 'text'; msg: string }
  | { t: 'capture'; who: string; success: boolean; chance: number }
  | { t: 'end'; winner: 0 | 1 | 'fled' };

export interface BattleOpts {
  rng?: Rng;
  capturable?: boolean;
  canFlee?: boolean;
  gem?: Partial<Stats>;
  bossHp?: number; // multiplier for side-1 HP (overlords)
  enemyStatMult?: number;
}

export class Battle {
  rng: Rng;
  clock = 0;
  all: Combatant[] = [];
  kills: [number, number] = [0, 0];
  over: 0 | 1 | 'fled' | null = null;
  captured: MonsterInst[] = [];
  refSpd: number;
  private seq = 0;

  constructor(player: MonsterInst[], enemy: MonsterInst[], public opts: BattleOpts = {}) {
    this.rng = opts.rng ?? new Rng();
    player.forEach((m) => this.add(m, 0, opts.gem));
    enemy.forEach((m) => this.add(m, 1, undefined, opts.enemyStatMult, opts.bossHp));
    const spds = this.all.map((c) => c.base.spd);
    this.refSpd = spds.reduce((a, b) => a + b, 0) / Math.max(1, spds.length);
    for (const side of [0, 1] as const) {
      this.side(side).slice(0, FIELD).forEach((c, i) => (c.slot = i));
    }
    for (const c of this.all) c.time = this.rng.range(0, 100) * this.refSpd / Math.max(1, c.stats.spd);
  }

  private add(m: MonsterInst, side: 0 | 1, gem?: Partial<Stats>, mult = 1, bossHp = 1, temp = false): Combatant {
    const sp = species(m.species);
    const st = statsOf(m, gem);
    if (mult !== 1) for (const k of Object.keys(st) as (keyof Stats)[]) st[k] = Math.round(st[k] * mult);
    st.hp = Math.round(st.hp * bossHp);
    const c: Combatant = {
      key: `${side}:${this.seq++}`, side, inst: m, sp, base: { ...st }, stats: { ...st }, pool: { hp: st.hp, max: st.hp },
      time: 0, slot: -1, statuses: {}, poisons: [], immune: false, reflect: 0, scout: false, captureTried: false,
      temp, boss: bossHp > 1, usedBuffs: {},
    };
    for (const a of sp.abilities) {
      if (a.immune && (a.passive || a.tu == null)) c.immune = true;
      if (a.reflect && (a.passive || a.tu == null || /reflect|counter/i.test(a.text ?? ''))) c.reflect = Math.max(c.reflect, a.reflect);
      if (a.scout) c.scout = true;
    }
    this.all.push(c);
    return c;
  }

  side(s: 0 | 1) { return this.all.filter((c) => c.side === s && c.slot !== -2 && c.pool.hp > 0); }
  field(s: 0 | 1) { return this.all.filter((c) => c.side === s && c.slot >= 0 && c.pool.hp > 0); }
  reserve(s: 0 | 1) { return this.all.filter((c) => c.side === s && c.slot === -1 && c.pool.hp > 0); }
  get(key: string) { return this.all.find((c) => c.key === key)!; }
  usable(c: Combatant) { return c.sp.abilities.filter((a) => !a.passive && a.tu != null); }
  name(c: Combatant) { return displayName(c.inst); }

  /** Advance time to the next actor, resolving poison/doom/expiry along the way. */
  next(ev: BattleEvent[]): Combatant | null {
    for (let guard = 0; guard < 200 && this.over === null; guard++) {
      const actors = this.all.filter((c) => c.slot >= 0 && c.pool.hp > 0);
      if (!actors.length) { this.checkEnd(ev); return null; }
      const actor = actors.reduce((a, b) => (b.time < a.time ? b : a));
      // poison ticks / doom happening before the actor's turn
      const tick = this.all.flatMap((c) => c.slot >= 0 && c.pool.hp > 0 ? c.poisons.map((p) => ({ c, p })) : [])
        .filter(({ p }) => p.next <= actor.time).sort((a, b) => a.p.next - b.p.next)[0];
      const doomed = this.all.find((c) => c.slot >= 0 && c.pool.hp > 0 && c.statuses.doom != null && c.statuses.doom! <= actor.time);
      if (tick && (!doomed || tick.p.next <= doomed.statuses.doom!)) {
        this.clock = tick.p.next;
        tick.p.next += 100;
        this.hurt(tick.c, tick.p.dmg, ev, { src: tick.p.src, element: tick.p.element, dot: true });
        if (tick.p.next > tick.p.until) tick.c.poisons.splice(tick.c.poisons.indexOf(tick.p), 1);
        if (this.checkEnd(ev)) return null;
        continue;
      }
      if (doomed) {
        this.clock = doomed.statuses.doom!;
        delete doomed.statuses.doom;
        ev.push({ t: 'text', msg: `${this.name(doomed)}'s doom arrives!` });
        this.hurt(doomed, doomed.pool.hp, ev, { src: doomed.key, element: 'Death', dot: true });
        if (this.checkEnd(ev)) return null;
        continue;
      }
      this.clock = actor.time;
      for (const k of Object.keys(actor.statuses) as StatusType[]) {
        if (k !== 'doom' && actor.statuses[k]! <= this.clock) {
          delete actor.statuses[k];
          ev.push({ t: 'status', who: actor.key, status: k, on: false });
        }
      }
      if (actor.statuses.sleep != null) {
        ev.push({ t: 'skip', who: actor.key, reason: 'asleep' });
        actor.time += this.delay(actor, 100);
        continue;
      }
      if (actor.statuses.confuse != null && this.rng.chance(0.4)) {
        ev.push({ t: 'skip', who: actor.key, reason: 'confused' });
        actor.time += this.delay(actor, 100);
        continue;
      }
      ev.push({ t: 'turn', who: actor.key });
      return actor;
    }
    return null;
  }

  delay(c: Combatant, tu: number) { return (tu * this.refSpd) / Math.max(1, c.stats.spd); }

  /** Upcoming turn order preview for the timeline UI. */
  forecast(n = 8): Combatant[] {
    const sim = this.all.filter((c) => c.slot >= 0 && c.pool.hp > 0).map((c) => ({ c, t: c.time }));
    const out: Combatant[] = [];
    for (let i = 0; i < n && sim.length; i++) {
      sim.sort((a, b) => a.t - b.t);
      out.push(sim[0].c);
      sim[0].t += this.delay(sim[0].c, 130);
    }
    return out;
  }

  foesOf(c: Combatant) { return this.field(c.side === 0 ? 1 : 0); }
  alliesOf(c: Combatant) { return this.field(c.side); }

  targetsFor(c: Combatant, a: Ability, chosen?: string): Combatant[] {
    const foes = this.foesOf(c);
    const allies = this.alliesOf(c);
    const pickFoe = (exclude: Combatant[] = []) => {
      const pool = foes.filter((f) => !exclude.includes(f));
      if (!pool.length) return null;
      if (c.statuses.berserk == null && c.statuses.confuse == null) {
        const pref = chosen ? pool.find((f) => f.key === chosen) : null;
        if (pref) return pref;
      }
      return this.rng.weighted(pool, (f) => (f.statuses.taunt != null ? 5 : 1) * (f.statuses.disguise != null ? 0.2 : 1));
    };
    switch (a.target) {
      case 'self': return [c];
      case 'ally': {
        const pref = chosen ? allies.find((x) => x.key === chosen) : null;
        return [pref ?? allies.reduce((x, y) => (y.pool.hp / y.pool.max < x.pool.hp / x.pool.max ? y : x))];
      }
      case 'allAllies': return allies;
      case 'allFoes': return foes;
      case 'all': return [...foes, ...allies.filter((x) => x !== c)];
      case 'twoFoes': {
        const a1 = pickFoe();
        const a2 = a1 ? pickFoe([a1]) : null;
        return [a1, a2].filter(Boolean) as Combatant[];
      }
      default: {
        // healing/buff abilities mislabelled as 'foe' go to allies
        if (!a.power && (a.healPower || (a.mods && Object.values(a.mods).every((v) => v! > 0)))) return [c];
        const f = pickFoe();
        return f ? [f] : [];
      }
    }
  }

  act(c: Combatant, a: Ability, chosen?: string): BattleEvent[] {
    const ev: BattleEvent[] = [];
    const tu = a.tu ?? 130;
    c.time += this.delay(c, tu);
    if (a.escape) {
      if (c.side === 0) {
        if (this.opts.canFlee === false) { ev.push({ t: 'text', msg: "Can't escape this battle!" }); return ev; }
        ev.push({ t: 'use', who: c.key, ability: a.name, targets: [] });
        this.over = 'fled';
        ev.push({ t: 'end', winner: 'fled' });
        return ev;
      }
      if (!c.boss && this.rng.chance(0.5)) {
        ev.push({ t: 'use', who: c.key, ability: a.name, targets: [] });
        ev.push({ t: 'text', msg: `${this.name(c)} ran away!` });
        this.remove(c, ev);
        this.checkEnd(ev);
        return ev;
      }
    }
    let targets = this.targetsFor(c, a, chosen);
    ev.push({ t: 'use', who: c.key, ability: a.name, element: a.element ?? c.sp.element, targets: targets.map((t) => t.key) });

    if (a.summonRandom) {
      this.summon(c, ev);
      if (a.selfSacrifice && this.rng.chance(a.selfSacrifice / 100)) this.hurt(c, c.pool.hp, ev, { src: c.key });
      this.checkEnd(ev);
      return ev;
    }
    if (a.clone) {
      const who = a.target === 'self' || targets[0]?.side === c.side ? (targets[0] ?? c) : c;
      this.cloneOf(who, ev);
      return ev;
    }

    let sacBonus = 0;
    if (a.sacrificeBench) {
      const bench = this.reserve(c.side);
      if (bench.length) {
        const v = bench.reduce((x, y) => (y.inst.level < x.inst.level ? y : x));
        sacBonus = v.inst.level / 100;
        ev.push({ t: 'text', msg: `${this.name(c)} draws power from ${this.name(v)}!` });
        v.pool.hp = 0;
        v.slot = -2;
        ev.push({ t: 'faint', who: v.key });
      }
    }

    for (const t of targets) {
      if (t.pool.hp <= 0) continue;
      if (a.power && a.kind) {
        const dmg = this.damage(c, t, a, sacBonus);
        this.hurt(t, dmg.amount, ev, { src: c.key, element: a.element, crit: dmg.crit, mult: dmg.mult, kind: a.kind });
        if (a.drain) this.healC(c, Math.round((dmg.amount * a.drain) / 100), ev);
        if (a.recoil) this.hurt(c, Math.round((dmg.amount * a.recoil) / 100), ev, { src: c.key });
        if (t.reflect && t.pool.hp > 0 && c.pool.hp > 0) this.hurt(c, Math.round(t.reflect * t.pool.max), ev, { src: t.key });
        if (t.pool.hp > 0 && t.statuses.sleep != null) {
          delete t.statuses.sleep;
          ev.push({ t: 'status', who: t.key, status: 'sleep', on: false });
        }
      }
      if (t.pool.hp <= 0) continue;
      if (a.healPower) this.healC(t, Math.round(a.healPower * c.stats.mag * this.rng.range(0.9, 1.1)), ev);
      if (a.cleanse) {
        const ally = t.side === c.side;
        for (const k of Object.keys(t.statuses) as StatusType[]) if (k !== 'taunt' || !ally) delete t.statuses[k];
        t.poisons = [];
        if (!ally || a.cleanse === 'all') t.stats = { ...t.base, hp: t.stats.hp };
        ev.push({ t: 'status', who: t.key, status: 'cleanse', on: true });
      }
      if (a.mods) this.applyMods(c, t, a, ev);
      if (a.haste) {
        const up = a.haste > 0 && t.side === c.side;
        const down = a.haste < 0 && t.side !== c.side || (a.haste < 0 && t === c && a.target !== 'self');
        if (up || down) {
          const delta = Math.round(t.base.spd * (a.haste / 100));
          t.stats.spd = Math.max(Math.round(t.base.spd * 0.3), Math.min(t.base.spd * 3, t.stats.spd + delta));
          ev.push({ t: 'mod', who: t.key, stat: 'spd', amount: delta });
        }
      }
      if (a.status) this.applyStatus(c, t, a.status.type, a.status.tu, ev);
      if (a.poison) {
        if (t.immune && t.side !== c.side) { ev.push({ t: 'status', who: t.key, status: 'immune', on: true }); continue; }
        const stat = Math.max(c.stats.atk, c.stats.mag);
        const dmg = Math.max(1, Math.round(a.poison.power * stat * 0.45 * elementMult(a.poison.element, t.sp.element)));
        t.poisons.push({ until: this.clock + a.poison.tu, next: this.clock + 100, dmg, element: a.poison.element ?? null, src: c.key });
        ev.push({ t: 'status', who: t.key, status: 'poison', on: true });
      }
    }
    if (a.selfSacrifice && !a.summonRandom && c.pool.hp > 0 && this.rng.chance(a.selfSacrifice / 100)) {
      ev.push({ t: 'text', msg: `${this.name(c)} gives everything!` });
      this.hurt(c, c.pool.hp, ev, { src: c.key });
    }
    this.checkEnd(ev);
    return ev;
  }

  damage(c: Combatant, t: Combatant, a: Ability, sacBonus = 0) {
    const phys = a.kind === 'physical';
    let A = phys ? c.stats.atk : c.stats.mag;
    if (a.defToAtk) A += c.stats.def;
    let D = phys ? t.stats.def : t.stats.res;
    if (t.statuses.noguard != null) D *= 0.5;
    let dmg = (a.power ?? 1) * A * 1.55 * (A / (A + D));
    const mult = elementMult(a.element ?? c.sp.element, t.sp.element);
    dmg *= mult;
    for (const [k, pct] of Object.entries(a.vs ?? {})) {
      const hit = t.sp.types.includes(k) || t.sp.element.toLowerCase() === k || (k === 'sleep' && t.statuses.sleep != null);
      if (hit) dmg *= 1 + pct / 100;
    }
    if (a.perKill) dmg *= 1 + (a.perKill / 100) * this.kills[c.side];
    if (a.perTU) dmg *= 1 + (a.perTU[0] / 100) * Math.floor(this.clock / a.perTU[1]);
    if (a.alone && this.alliesOf(c).length === 1) dmg *= 1 + a.alone / 100;
    dmg *= 1 + sacBonus;
    const crit = this.rng.chance(0.06);
    if (crit) dmg *= 1.5;
    dmg *= this.rng.range(0.9, 1.1);
    return { amount: Math.max(1, Math.round(dmg)), crit, mult };
  }

  private applyMods(c: Combatant, t: Combatant, a: Ability, ev: BattleEvent[]) {
    for (const [k, v] of Object.entries(a.mods!) as [keyof Stats, number][]) {
      const friendly = t.side === c.side;
      if ((v > 0 && !friendly) || (v < 0 && friendly && a.target !== 'all')) continue;
      if (v < 0 && t.immune && !friendly) continue;
      const stack = `${a.name}:${k}`;
      t.usedBuffs[stack] = (t.usedBuffs[stack] ?? 0) + 1;
      const delta = Math.round(c.base[k] * v * 0.6 * (t.base[k] / Math.max(1, c.base[k])));
      const before = t.stats[k];
      t.stats[k] = Math.round(Math.max(t.base[k] * 0.3, Math.min(t.base[k] * 2.5, t.stats[k] + delta)));
      if (t.stats[k] !== before) ev.push({ t: 'mod', who: t.key, stat: k, amount: t.stats[k] - before });
    }
  }

  applyStatus(c: Combatant, t: Combatant, s: StatusType, tu: number, ev: BattleEvent[]) {
    const self = ['taunt', 'disguise', 'berserk'].includes(s);
    const target = self && t.side !== c.side ? c : t;
    if (!self && target.immune) { ev.push({ t: 'status', who: target.key, status: 'immune', on: true }); return; }
    if (s === 'doom' && target.boss) { ev.push({ t: 'status', who: target.key, status: 'immune', on: true }); return; }
    const dur = Math.max(60, tu);
    target.statuses[s] = this.clock + dur;
    if (s === 'stun' || s === 'paralyze') target.time = Math.max(target.time, this.clock) + this.delay(target, dur) * 0.6;
    ev.push({ t: 'status', who: target.key, status: s, on: true });
  }

  healC(t: Combatant, amount: number, ev: BattleEvent[]) {
    const before = t.pool.hp;
    t.pool.hp = Math.min(t.pool.max, t.pool.hp + Math.max(0, amount));
    if (t.pool.hp > before) ev.push({ t: 'heal', who: t.key, amount: t.pool.hp - before });
  }

  hurt(t: Combatant, amount: number, ev: BattleEvent[], o: { src: string; element?: Element | null; crit?: boolean; mult?: number; kind?: string; dot?: boolean }) {
    if (t.pool.hp <= 0) return;
    t.pool.hp = Math.max(0, t.pool.hp - amount);
    ev.push({ t: 'damage', who: t.key, src: o.src, amount, crit: !!o.crit, mult: o.mult ?? 1, element: o.element, kind: o.kind, dot: o.dot });
    if (t.pool.hp <= 0) {
      // clones share an HP pool: everyone on it falls together
      for (const x of this.all.filter((x) => x.pool === t.pool && x.slot !== -2)) {
        ev.push({ t: 'faint', who: x.key });
        if (!x.temp || x === t) this.kills[x.side === 0 ? 1 : 0]++;
        this.vacate(x, ev);
      }
    }
  }

  private vacate(c: Combatant, ev: BattleEvent[]) {
    const slot = c.slot;
    c.slot = c.temp ? -2 : c.pool.hp > 0 ? -1 : -2;
    if (slot >= 0) {
      const sub = this.reserve(c.side).find((x) => x !== c);
      if (sub) {
        sub.slot = slot;
        sub.time = this.clock + this.delay(sub, this.rng.range(20, 60));
        ev.push({ t: 'enter', who: sub.key, slot });
      }
    }
  }

  private remove(c: Combatant, ev: BattleEvent[]) {
    ev.push({ t: 'leave', who: c.key });
    c.pool.hp = c.temp ? 0 : c.pool.hp;
    const slot = c.slot;
    c.slot = -2;
    if (slot >= 0) {
      const sub = this.reserve(c.side)[0];
      if (sub) {
        sub.slot = slot;
        sub.time = this.clock + this.delay(sub, 40);
        ev.push({ t: 'enter', who: sub.key, slot });
      }
    }
  }

  private freeSlot(side: 0 | 1) {
    const used = new Set(this.field(side).map((x) => x.slot));
    for (let i = 0; i < FIELD; i++) if (!used.has(i)) return i;
    return -1;
  }

  private cloneOf(c: Combatant, ev: BattleEvent[]) {
    const slot = this.freeSlot(c.side);
    if (slot < 0) { ev.push({ t: 'text', msg: 'But there was no room for a copy!' }); return; }
    const cl = this.add({ ...c.inst, uid: -c.inst.uid }, c.side, undefined, 1, 1, true);
    cl.base = { ...c.base };
    cl.stats = { ...c.stats };
    cl.pool = c.pool;
    cl.slot = slot;
    cl.time = this.clock + this.delay(cl, 50);
    ev.push({ t: 'text', msg: `${this.name(c)} splits in two!` });
    ev.push({ t: 'enter', who: cl.key, slot });
  }

  private summon(c: Combatant, ev: BattleEvent[]) {
    const pool = data().monsters.filter((s) => Math.abs(s.stars - c.sp.stars) <= 1.5 && s.id !== c.sp.id);
    const sp = this.rng.pick(pool);
    const slot = c.slot >= 0 && this.freeSlot(c.side) < 0 ? -1 : this.freeSlot(c.side);
    const m = makeMonster(sp, c.inst.level, this.rng, c.inst.rank);
    const s = this.add(m, c.side, c.side === 0 ? this.opts.gem : undefined, 1, 1, true);
    if (slot >= 0) {
      s.slot = slot;
      s.time = this.clock + this.delay(s, 50);
      ev.push({ t: 'text', msg: `${this.name(c)} summons ${sp.name}!` });
      ev.push({ t: 'enter', who: s.key, slot });
    } else {
      ev.push({ t: 'text', msg: `${sp.name} waits in reserve.` });
    }
  }

  captureChance(t: Combatant, card: 'card' | 'silver' | 'gold') {
    if (card === 'gold') return 1;
    const base = card === 'silver' ? 0.62 : 0.32;
    const hp = t.pool.hp / t.pool.max;
    const starPenalty = 1.5 / (1 + t.sp.stars * 0.17);
    const status = t.statuses.sleep != null || t.statuses.paralyze != null || t.statuses.stun != null ? 1.25 : 1;
    return Math.max(0.02, Math.min(0.97, base * (1.15 - hp) * starPenalty * status));
  }

  tryCapture(key: string, card: 'card' | 'silver' | 'gold'): BattleEvent[] {
    const ev: BattleEvent[] = [];
    const t = this.get(key);
    if (!t || t.side !== 1 || t.captureTried || t.temp || this.opts.capturable === false || t.pool.hp <= 0) return ev;
    t.captureTried = true;
    const chance = this.captureChance(t, card);
    const ok = this.rng.chance(chance);
    ev.push({ t: 'capture', who: key, success: ok, chance });
    if (ok) {
      this.captured.push(t.inst);
      this.remove(t, ev);
      t.pool.hp = 0;
      this.checkEnd(ev);
    }
    return ev;
  }

  flee(): BattleEvent[] {
    if (this.opts.canFlee === false) return [{ t: 'text', msg: "You can't run from this fight!" }];
    const p = this.field(0).reduce((a, c) => a + c.stats.spd, 0);
    const e = this.field(1).reduce((a, c) => a + c.stats.spd, 0);
    if (this.rng.chance(Math.min(0.95, 0.45 + (p - e) / Math.max(1, p + e)))) {
      this.over = 'fled';
      return [{ t: 'end', winner: 'fled' }];
    }
    // failed escape costs the whole team a little time
    for (const c of this.field(0)) c.time += this.delay(c, 60);
    return [{ t: 'text', msg: "Couldn't get away!" }];
  }

  checkEnd(ev: BattleEvent[]) {
    if (this.over !== null) return true;
    const p = this.side(0).length, e = this.side(1).length;
    if (!e) this.over = 0;
    else if (!p) this.over = 1;
    if (this.over !== null) ev.push({ t: 'end', winner: this.over });
    return this.over !== null;
  }

  /** Simple tactical AI used by enemies and by the player's Auto mode. */
  choose(c: Combatant): { ability: Ability; target?: string } {
    const abilities = this.usable(c);
    if (!abilities.length) return { ability: { name: 'Struggle', tu: 100, target: 'foe', kind: 'physical', power: 0.8 } };
    const foes = this.foesOf(c);
    const allies = this.alliesOf(c);
    const hurtAlly = allies.find((a) => a.pool.hp / a.pool.max < 0.45);
    const score = (a: Ability) => {
      let s = 0.2;
      if (a.escape) return c.side === 1 && c.pool.hp / c.pool.max < 0.25 ? 0.3 : 0;
      if (a.selfSacrifice && c.pool.hp / c.pool.max > 0.3) return 0.02;
      if (a.power && a.kind) {
        const best = Math.max(...foes.map((f) => elementMult(a.element ?? c.sp.element, f.sp.element)), 0.5);
        const n = a.target === 'allFoes' || a.target === 'all' ? Math.min(foes.length, 3) * 0.75 : a.target === 'twoFoes' ? 1.6 : 1;
        s += (a.power * best * n * 130) / (a.tu ?? 130);
      }
      if (a.healPower) s += hurtAlly ? 2.5 : 0.05;
      if (a.mods) {
        const used = Object.keys(a.mods).reduce((m, k) => Math.max(m, c.usedBuffs[`${a.name}:${k}`] ?? 0), 0);
        s += used >= 2 ? 0.05 : 0.6 / (1 + used);
      }
      if (a.status) {
        const already = foes.every((f) => f.statuses[a.status!.type] != null || f.immune);
        s += already ? 0.05 : a.status.type === 'doom' ? 1.1 : 0.8;
        if (['taunt', 'disguise'].includes(a.status.type)) s = c.statuses[a.status.type] != null ? 0.05 : 0.5;
      }
      if (a.poison) s += foes.some((f) => !f.poisons.length) ? 0.7 : 0.1;
      if (a.haste) s += 0.35;
      if (a.cleanse) s += allies.some((x) => Object.keys(x.statuses).length || x.poisons.length) ? 1 : 0.02;
      if (a.clone || a.summonRandom) s += this.freeSlot(c.side) >= 0 ? 0.6 : 0.02;
      return Math.max(0.01, s);
    };
    const ability = this.rng.weighted(abilities, (a) => score(a) ** 2.2);
    let target: string | undefined;
    if (ability.target === 'foe' || ability.target === 'twoFoes') {
      const pick = foes.slice().sort((a, b) => {
        const ea = elementMult(ability.element ?? c.sp.element, a.sp.element), eb = elementMult(ability.element ?? c.sp.element, b.sp.element);
        return eb - ea || a.pool.hp - b.pool.hp;
      })[0];
      target = this.rng.chance(0.7) ? pick?.key : this.rng.pick(foes)?.key;
    } else if (ability.target === 'ally') target = (hurtAlly ?? c).key;
    return { ability, target };
  }
}

export const findSpecies = (n: string) => speciesByName(n);
