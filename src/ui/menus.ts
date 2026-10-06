import { data, species, speciesByName, spriteUrl, town as townData } from '../core/data';
import { RANKS, STAT_KEYS, STAT_LABEL, displayName, power, rankName, statsOf, xpToNext } from '../core/monster';
import type { MonsterInst, Species, StatKey } from '../core/types';
import {
  S, save, partySize, heroLevel, heroXpFor, skillPoints, heroBonus, GEM_SHAPES, gemSlotsUnlocked, destroyForSoul, equipSoul,
  eggPrizes, grantPrize, questDone, exportSave, importSave, findMon, allMonsters, EggPrize, fuse,
} from '../core/state';
import { h, modal, toast, confirmBox, starsHtml, layer, anyModal, fill } from './dom';
import { sfx, setAudio } from '../audio';

export const elChip = (el: string) => h('span', { class: `chip el el-${el}` }, el);

export function monCard(m: MonsterInst, opts: { onClick?: () => void; sel?: boolean; extra?: HTMLElement } = {}) {
  const sp = species(m.species);
  const hp = statsOf(m, heroBonus()).hp;
  return h('div', { class: `mcard ${opts.sel ? 'sel' : ''}`, onClick: opts.onClick },
    h('span', { class: 'lv' }, `Lv ${m.level}`),
    h('span', { class: 'rk' }, rankName(m.rank)),
    h('img', { src: spriteUrl(sp), loading: 'lazy', draggable: 'false' }),
    h('div', { class: 'nm' }, displayName(m)),
    h('div', { class: 'row' }, elChip(sp.element), h('span', { class: 'stars' }, starsHtml(sp.stars))),
    h('div', { class: 'bar', title: 'XP' }, h('i', { style: { width: `${Math.min(100, (m.xp / xpToNext(m)) * 100)}%` } })),
    m.soul ? h('div', { class: 'chip' }, `◆ ${m.soul.element} soul`) : null,
    h('div', { class: 'muted', style: { fontSize: '.75em' } }, `HP ${hp} · PWR ${power(m)}`),
    opts.extra ?? null);
}

export function abilityLine(a: Species['abilities'][number]) {
  const tu = a.tu == null || a.passive ? 'Passive' : `${a.tu} TU`;
  const tgt = { foe: '1 Foe', twoFoes: '2 Foes', allFoes: 'All Foes', self: 'Self', ally: '1 Ally', allAllies: 'All Allies', all: 'Everyone', passive: '—' }[a.target];
  return h('div', { class: 'abil' }, h('div', { class: 'row' }, h('b', {}, a.name), a.element ? elChip(a.element) : null, h('span', { class: 'grow' }),
    h('span', { class: 'muted' }, `${tgt} · ${tu}`)), h('div', { class: 'muted' }, a.text ?? ''));
}

function statRows(st: Record<StatKey, number>) {
  const max = Math.max(...STAT_KEYS.filter((k) => k !== 'hp').map((k) => st[k]), 1);
  return STAT_KEYS.map((k) => h('div', { class: 'stat-row' }, h('span', {}, STAT_LABEL[k]), h('b', {}, String(st[k])),
    h('div', { class: 'bar' }, h('i', { style: { width: `${Math.min(100, (k === 'hp' ? st[k] / 4 / max : st[k] / max) * 100)}%` } }))));
}

export function speciesDetail(sp: Species, m?: MonsterInst, actions?: HTMLElement) {
  const st = m ? statsOf(m, heroBonus()) : sp.base;
  const evo = sp.evolveInto ? `Evolves into ${sp.evolveInto} at Lv ${sp.evolveLevel}` : 'Final form';
  const recipes = data().recipes.filter((r) => r.result === sp.name || r.parts.includes(sp.name));
  return h('div', { class: 'detail' },
    h('div', { class: 'col' },
      h('div', { class: 'portrait' }, h('img', { src: spriteUrl(sp) })),
      h('div', { class: 'row' }, h('span', { class: 'chip' }, `#${String(sp.id).padStart(3, '0')}`), elChip(sp.element), h('span', { class: 'stars' }, starsHtml(sp.stars))),
      sp.types.length ? h('div', { class: 'row' }, ...sp.types.map((t) => h('span', { class: 'chip' }, t))) : null,
      actions ?? null),
    h('div', { class: 'col' },
      h('h3', {}, m ? `${displayName(m)} — Lv ${m.level} · Rank ${rankName(m.rank)}` : sp.name),
      m ? h('div', { class: 'muted' }, `XP ${m.xp} / ${xpToNext(m)}${m.soul ? ` · ${m.soul.element} soul stone +${Math.round(m.soul.power * 100)}%` : ''}`) : h('div', { class: 'muted' }, 'Base stats (Lv 1)'),
      ...statRows(st),
      h('div', { class: 'muted' }, evo),
      sp.lore ? h('p', { class: 'muted', style: { fontStyle: 'italic' } }, sp.lore) : null,
      h('h3', { style: { fontSize: '1em', marginTop: '.4em' } }, 'Abilities'),
      ...sp.abilities.map(abilityLine),
      recipes.length ? h('h3', { style: { fontSize: '1em', marginTop: '.4em' } }, 'Recipes') : null,
      ...recipes.map((r) => h('div', { class: 'abil' }, `${r.parts[0]} + ${r.parts[1]} = `, h('b', {}, r.result))),
      sp.obtain || sp.location ? h('div', { class: 'muted', style: { fontSize: '.85em' } }, `Wiki: ${sp.location || sp.obtain}`) : null));
}

// ------------------------------------------------------------------ HUD
export function hud(onMenu: (k: string) => void, extra: HTMLElement[] = []) {
  const coin = (g = false) => h('span', { class: `coin ${g ? 'g' : ''}` });
  return layer('hud', h('div', { class: 'hud' },
    h('div', { class: 'badge panel' }, h('span', { class: 'hero-lv' }, `Lv ${heroLevel()}`), h('b', {}, S.hero),
      S.license >= 0 ? h('span', { class: 'chip' }, data().licenses[S.license].name) : null),
    h('div', { class: 'badge panel' }, coin(), h('b', {}, S.silver.toLocaleString()), coin(true), h('b', {}, S.gold.toLocaleString()),
      h('span', { class: 'muted', title: 'Capture cards' }, `🂠 ${S.items.card}/${S.items.silver}/${S.items.gold}`)),
    ...extra,
    h('div', { class: 'menu' },
      ...[['team', '🐉 Team'], ['bag', '🎒 Bag'], ['pedia', '📖 Pedia'], ['quests', '📜 Quests'], ['hero', '🛡 Hero'], ['system', '⚙']]
        .map(([k, l]) => h('button', { class: 'btn small', onClick: () => onMenu(k), 'data-menu': k }, l)))));
}

export function openMenu(k: string, refresh: () => void) {
  if (anyModal()) return;
  ({ team: () => teamMenu(refresh), bag: () => bagMenu(refresh), pedia: pediaMenu, quests: questsMenu, hero: () => heroMenu(refresh), system: systemMenu } as Record<string, () => void>)[k]?.();
}

// ------------------------------------------------------------------ Team
export function teamMenu(refresh: () => void, tab: 'party' | 'storage' = 'party') {
  let sel: number | null = null;
  let view = tab;
  const root = h('div', { class: 'col' });
  const render = () => {
    const list = view === 'party' ? S.party : S.storage.slice().sort((a, b) => power(b) - power(a));
    const selM = sel != null ? findMon(sel) : null;
    fill(root, 
      h('div', { class: 'row' },
        h('div', { class: 'tabs' },
          h('button', { class: `tab ${view === 'party' ? 'on' : ''}`, onClick: () => { view = 'party'; render(); } }, `Party ${S.party.length}/${partySize()}`),
          h('button', { class: `tab ${view === 'storage' ? 'on' : ''}`, onClick: () => { view = 'storage'; render(); } }, `Storage ${S.storage.length}`)),
        h('span', { class: 'grow' }),
        h('span', { class: 'muted' }, view === 'party' ? 'Lead monsters fight first. Tap a monster to manage it.' : 'Stored monsters do not fight.')),
      ...(selM ? [monsterActions(selM, () => { render(); refresh(); }, () => { sel = null; render(); })] : []),
      list.length ? h('div', { class: 'grid' }, ...list.map((m) => monCard(m, { sel: m.uid === sel, onClick: () => { sel = m.uid === sel ? null : m.uid; render(); } })))
        : h('p', { class: 'muted' }, 'Nothing here yet.'));
  };
  render();
  modal('Monsters', root, { onClose: refresh });
}

function monsterActions(m: MonsterInst, changed: () => void, deselect: () => void) {
  const inParty = S.party.includes(m);
  const idx = S.party.indexOf(m);
  const souls = S.souls;
  const btns = h('div', { class: 'col', style: { width: '100%' } },
    h('div', { class: 'row', style: { flexWrap: 'wrap' } },
      inParty ? h('button', { class: 'btn small', disabled: idx <= 0, onClick: () => { S.party.splice(idx, 1); S.party.splice(idx - 1, 0, m); save(); changed(); } }, '▲ Move up') : null,
      inParty ? h('button', { class: 'btn small', disabled: S.party.length <= 1, onClick: () => { S.party.splice(idx, 1); S.storage.push(m); save(); deselect(); changed(); } }, 'To storage')
        : h('button', { class: 'btn small green', disabled: S.party.length >= partySize(), onClick: () => { S.storage = S.storage.filter((x) => x !== m); S.party.push(m); save(); deselect(); changed(); } }, 'To party'),
      h('button', { class: 'btn small', onClick: () => { const n = prompt('Nickname', displayName(m)); if (n != null) { m.nick = n.trim().slice(0, 16) || undefined; save(); changed(); } } }, 'Rename'),
      h('button', {
        class: 'btn small red', disabled: S.party.length <= 1 && inParty, onClick: async () => {
          if (await confirmBox(`Destroy ${displayName(m)} to extract its soul stone? This is permanent.`, 'Destroy')) {
            const s = destroyForSoul(m.uid);
            if (s) { sfx('magic'); toast(`Obtained a ${s.element} soul stone (+${Math.round(s.power * 100)}%)`); save(); deselect(); changed(); }
          }
        },
      }, '◆ Extract soul')),
    souls.length ? h('div', { class: 'row', style: { flexWrap: 'wrap' } }, h('span', { class: 'muted' }, 'Equip soul stone:'),
      ...souls.slice(0, 12).map((s) => h('button', { class: 'btn small', onClick: () => { equipSoul(m.uid, s.id); sfx('buff'); save(); changed(); } },
        `${s.element} +${Math.round(s.power * 100)}%`))) : null);
  return h('div', { class: 'panel', style: { padding: '.8em', background: 'var(--panel2)' } }, speciesDetail(species(m.species), m, btns));
}

// ------------------------------------------------------------------ Pedia
export function pediaMenu() {
  const root = h('div', { class: 'col' });
  let filter = 'all';
  const render = () => {
    const els = ['all', 'Fire', 'Water', 'Air', 'Earth', 'Life', 'Death', 'Arcane'];
    const list = data().monsters.filter((s) => filter === 'all' || s.element === filter);
    fill(root, 
      h('div', { class: 'row' }, h('div', { class: 'tabs' }, ...els.map((e) => h('button', { class: `tab ${filter === e ? 'on' : ''}`, onClick: () => { filter = e; render(); } }, e))),
        h('span', { class: 'grow' }), h('b', {}, `Caught ${S.caught.length} / ${data().monsters.length}`), h('span', { class: 'muted' }, ` · Seen ${S.seen.length}`)),
      h('div', { class: 'grid' }, ...list.map((s) => {
        const seen = S.seen.includes(s.id), caught = S.caught.includes(s.id);
        return h('div', { class: `mcard ${seen ? '' : 'unknown'}`, onClick: () => seen && modal(s.name, speciesDetail(s), { width: '60em' }) },
          h('span', { class: 'lv' }, `#${String(s.id).padStart(3, '0')}`), caught ? h('span', { class: 'rk' }, '●') : null,
          h('img', { src: spriteUrl(s), loading: 'lazy' }), h('div', { class: 'nm' }, seen ? s.name : '???'),
          seen ? h('div', { class: 'row' }, elChip(s.element), h('span', { class: 'stars' }, starsHtml(s.stars))) : null);
      })));
  };
  render();
  modal('Monsterpedia', root);
}

// ------------------------------------------------------------------ Bag & eggs
export function bagMenu(refresh: () => void) {
  const root = h('div', { class: 'col' });
  const render = () => {
    fill(root, 
      h('table', { class: 'list' },
        h('tr', {}, h('td', {}, 'Capture Card'), h('td', {}, String(S.items.card)), h('td', { class: 'muted' }, 'Basic capture chance')),
        h('tr', {}, h('td', {}, 'Silver Card'), h('td', {}, String(S.items.silver)), h('td', { class: 'muted' }, 'Much higher capture chance')),
        h('tr', {}, h('td', {}, 'Gold Card'), h('td', {}, String(S.items.gold)), h('td', { class: 'muted' }, 'Guaranteed capture')),
        h('tr', {}, h('td', {}, 'Egg'), h('td', {}, String(S.items.egg)), h('td', {}, h('button', { class: 'btn small gold', disabled: !S.items.egg, onClick: () => openEgg('egg', () => { render(); refresh(); }) }, 'Open'))),
        h('tr', {}, h('td', {}, 'Golden Egg'), h('td', {}, String(S.items.golden)), h('td', {}, h('button', { class: 'btn small gold', disabled: !S.items.golden, onClick: () => openEgg('golden', () => { render(); refresh(); }) }, 'Open')))),
      h('h3', {}, `Soul stones (${S.souls.length})`),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, ...S.souls.map((s) => h('span', { class: `chip el el-${s.element}` }, `◆ ${s.element} +${Math.round(s.power * 100)}%`)),
        S.souls.length ? null : h('span', { class: 'muted' }, 'Extract souls from monsters in the Team menu.')),
      h('h3', {}, `Gems (${S.gems.length})`),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, ...S.gems.map(gemChip), S.gems.length ? null : h('span', { class: 'muted' }, 'Buy gems in town shops; equip them on the Hero screen.')));
  };
  render();
  modal('Bag', root, { width: '46em' });
}

export const gemChip = (g: S['gems'][number]) => h('span', { class: 'chip' }, `${{ Oval: '⬭', Square: '◼', Tear: '💧', Star: '★' }[g.shape]} ${g.shape} ` +
  Object.entries(g.stats).map(([k, v]) => `${STAT_LABEL[k as StatKey]} +${Math.round((v ?? 0) * 100)}%`).join(', '));
type S = typeof S;

export function openEgg(type: 'egg' | 'golden', done: () => void) {
  if ((type === 'egg' ? S.items.egg : S.items.golden) <= 0) return;
  if (type === 'egg') S.items.egg--; else S.items.golden--;
  save();
  const prizes = eggPrizes(type);
  const n = prizes.length;
  const label = (p: EggPrize) => p.kind === 'monster' ? h('img', { src: spriteUrl(species(p.species)) })
    : h('span', {}, { silver: `${p.kind === 'silver' ? (p as any).amount : ''}🪙`, gold: `${(p as any).amount}G`, card: '🂠×5', silverCard: '🂠S', goldCard: '🂠G', gem: '💎' }[p.kind as 'gem']);
  const colors = ['#2a3f7a', '#3b2a6a', '#1f5a5a', '#6a3a2a'];
  const wheel = h('div', { class: 'wheel', style: { background: `conic-gradient(${prizes.map((_, i) => `${colors[i % 4]} ${(i / n) * 360}deg ${((i + 1) / n) * 360}deg`).join(',')})` } },
    ...prizes.map((p, i) => { const s = h('div', { class: 'seg', style: { transform: `rotate(${(i + 0.5) * (360 / n) - 90}deg)` } }, label(p)); return s; }));
  let angle = 0, speed = 22, stopping = false, raf = 0, finished = false, prevT = performance.now();
  const result = h('div', { style: { minHeight: '2em', fontWeight: '800', textAlign: 'center' } }, 'Tap STOP!');
  const stopBtn = h('button', { class: 'btn gold', onClick: () => { stopping = true; stopBtn.setAttribute('disabled', ''); } }, 'STOP');
  let last = 0;
  const spin = (now = performance.now()) => {
    const dt = Math.min(4, (now - prevT) / 16.67);
    prevT = now;
    angle = (angle + speed * dt) % 360;
    wheel.style.transform = `rotate(${angle}deg)`;
    if (Math.floor(angle / (360 / n)) !== last) { last = Math.floor(angle / (360 / n)); sfx('spin'); }
    if (stopping) speed *= Math.pow(0.965, dt);
    if (speed < 0.15) {
      finished = true;
      const pointerAngle = (360 - angle + 360) % 360;
      const idx = Math.floor(((pointerAngle + 90 + 360) % 360) / (360 / n)) % n;
      const msg = grantPrize(prizes[idx]);
      sfx(prizes[idx].kind === 'monster' ? 'levelup' : 'coin');
      result.textContent = `🎉 ${msg}`;
      save();
      done();
      return;
    }
    raf = requestAnimationFrame(spin);
  };
  raf = requestAnimationFrame(spin);
  modal(type === 'golden' ? 'Golden Egg' : 'Egg', h('div', { class: 'wheel-wrap' }, h('div', { class: 'pointer', style: { transform: 'rotate(180deg) translateY(1.4em)' } }), h('div', { class: 'pointer' }), wheel, stopBtn, result),
    { width: '30em', onClose: () => { cancelAnimationFrame(raf); if (!finished) { const msg = grantPrize(prizes[0]); toast(msg); save(); done(); } } });
}

// ------------------------------------------------------------------ Quests
export function questsMenu() {
  const body = h('div', { class: 'col' },
    S.quests.length ? null : h('p', { class: 'muted' }, 'No active quests. Visit a town Guild to accept up to 3 quests.'),
    ...S.quests.map((q) => h('div', { class: 'abil' },
      h('div', { class: 'row' }, h('b', {}, q.title), h('span', { class: 'chip' }, q.type), h('span', { class: 'chip' }, `from ${q.town}`), h('span', { class: 'grow' }),
        questDone(q) ? h('span', { class: 'chip', style: { background: 'var(--good)', color: '#032' } }, 'Complete! Return to the guild') : h('span', { class: 'muted' }, questGoalText(q))),
      h('div', { class: 'muted' }, q.text))),
    h('div', { class: 'muted' }, `Quests completed: ${S.questCount} · Dragon Overlords defeated: ${S.overlords.length}/${data().overlords.length}`));
  modal('Quest Log', body, { width: '50em' });
}

export function questGoalText(q: S['quests'][number]): string {
  const g = q.goal;
  const where = g.region ? data().regions.find((r) => r.id === g.region)?.name : '';
  switch (g.kind) {
    case 'capture': return `Capture ${g.species ?? 'any monster'}${where ? ` (${where})` : ''} — ${q.progress}/${g.count ?? 1}`;
    case 'battle': return `Defeat ${g.npc} at the ⚔ marker in ${where}`;
    case 'defeat': return `Defeat monsters — ${q.progress}/${g.count}`;
    case 'soulstone': return `Extract a soul stone — ${q.progress}/${g.count}`;
    case 'fuse': return `Fuse a recipe monster — ${q.progress}/${g.count}`;
    case 'evolve': return `Evolve a monster — ${q.progress}/${g.count}`;
    case 'visit': return `Travel to ${g.town}`;
  }
}

// ------------------------------------------------------------------ Hero
export function heroMenu(refresh: () => void) {
  const root = h('div', { class: 'col' });
  const render = () => {
    const lv = heroLevel();
    const bonus = heroBonus();
    const unlocked = gemSlotsUnlocked();
    fill(root, 
      h('div', { class: 'row' }, h('h3', {}, `${S.hero} — Hero Lv ${lv}`), h('span', { class: 'grow' }),
        h('span', { class: 'muted' }, `Hero XP ${S.heroXp} / ${heroXpFor(lv + 1)} — earned by raising each species to new levels`)),
      h('div', { class: 'bar' }, h('i', { style: { width: `${Math.min(100, ((S.heroXp - heroXpFor(lv)) / Math.max(1, heroXpFor(lv + 1) - heroXpFor(lv))) * 100)}%` } })),
      h('div', { class: 'row' }, h('b', {}, `Skill points: ${skillPoints()}`), h('span', { class: 'muted' }, 'Each point adds +1% to that stat for every monster.')),
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(3, 1fr)' } }, ...STAT_KEYS.map((k) => h('div', { class: 'abil row' },
        h('b', {}, STAT_LABEL[k]), h('span', { class: 'grow' }), h('span', {}, `+${Math.round((bonus[k] ?? 0) * 100)}%`),
        h('button', { class: 'btn small', disabled: skillPoints() <= 0, onClick: () => { S.skill[k] = (S.skill[k] ?? 0) + 1; sfx('buff'); save(); render(); refresh(); } }, '+')))),
      h('h3', {}, 'Gem slots'),
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(4, 1fr)' } }, ...GEM_SHAPES.map((shape, i) => {
        const g = S.gems.find((x) => x.id === S.equippedGems[i]);
        const options = S.gems.filter((x) => x.shape === shape);
        return h('div', { class: 'abil col' }, h('b', {}, `${shape} slot`),
          unlocked[i] ? (g ? gemChip(g) : h('span', { class: 'muted' }, 'Empty')) : h('span', { class: 'muted' }, `Requires ${['Apprentice', 'Veteran', '', 'Elite', 'Master'][[0, 1, 3, 4][i]]} license`),
          unlocked[i] && options.length ? h('select', { class: 'text', onChange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; S.equippedGems[i] = v ? Number(v) : null; save(); render(); refresh(); } },
            h('option', { value: '' }, '— none —'), ...options.map((o) => { const op = h('option', { value: String(o.id) }, Object.entries(o.stats).map(([k, v]) => `${STAT_LABEL[k as StatKey]} +${Math.round((v ?? 0) * 100)}%`).join(', ')); if (o.id === S.equippedGems[i]) op.setAttribute('selected', ''); return op; })) : null);
      })),
      h('h3', {}, 'Breeder license'),
      h('table', { class: 'list' }, ...data().licenses.map((l, i) => h('tr', {}, h('td', {}, i <= S.license ? '✅' : '🔒'), h('td', {}, h('b', {}, l.name)),
        h('td', { class: 'muted' }, `Hero Lv ${l.heroLevel} · ${l.quests} quests`), h('td', { class: 'muted' }, `+${l.slots} party slot${l.slots > 1 ? 's' : ''}`)))),
      h('div', { class: 'muted' }, `Party size: ${partySize()} · Battles won: ${S.stats.wins} · Captures: ${S.stats.captures}`));
  };
  render();
  modal('Hero', root, { width: '52em' });
}

// ------------------------------------------------------------------ System
export function systemMenu() {
  modal('System', (close) => h('div', { class: 'col' },
    h('div', { class: 'row' }, h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: S.settings.music, onChange: (e: Event) => { S.settings.music = (e.target as HTMLInputElement).checked; setAudio(S.settings.music, S.settings.sfx); save(); } }), 'Music'),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: S.settings.sfx, onChange: (e: Event) => { S.settings.sfx = (e.target as HTMLInputElement).checked; setAudio(S.settings.music, S.settings.sfx); save(); } }), 'Sound effects')),
    h('div', { class: 'row' }, h('span', {}, 'Battle speed'), ...[1, 2, 3].map((s) => h('button', { class: `btn small ${S.settings.speed === s ? 'gold' : ''}`, onClick: () => { S.settings.speed = s; save(); close(); systemMenu(); } }, `${s}x`))),
    h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => { save(); toast('Game saved'); } }, '💾 Save now'),
      h('button', { class: 'btn', onClick: () => { navigator.clipboard?.writeText(exportSave()); toast('Save code copied to clipboard'); } }, 'Export save code'),
      h('button', { class: 'btn', onClick: () => { const c = prompt('Paste save code'); if (c) { try { importSave(c); location.reload(); } catch { toast('Invalid save code'); } } } }, 'Import save')),
    h('p', { class: 'muted', style: { fontSize: '.85em' } }, 'Dragon Isle of Legends is a non-commercial fan rebuild of Dragon Island Blue. Monster art and data from the Dragon Island Blue Fandom wiki (CC BY-SA); original monster designs belong to their creators. Maps & backgrounds generated with Higgsfield.'),
    h('button', { class: 'btn red', onClick: async () => { if (await confirmBox('Delete your save and start over?', 'Delete')) { localStorage.removeItem('dragon-isle-save-v1'); location.reload(); } } }, 'Delete save')), { width: '40em' });
}

export { RANKS, speciesByName, townData };
