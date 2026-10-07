/**
 * Monsters / team selector, rebuilt after the original's screen (tools/ref_ui/orig_screens/team_selector.png,
 * Luckythree.jpg, Image123.jpg): the party and the storage are two cover-flow rows of painted cards in the barn
 * (or the stone cellar inside a dungeon); monsters are dragged up/down between them. Everything is placed in a
 * fixed 1280x720 sheet that is scaled to the stage, like the book.
 */
import './team.css';
import { species, spriteUrl } from '../core/data';
import { S, save, partySize, equipSoul, destroyForSoul, questEvent, markCaught, recordLevel } from '../core/state';
import { canEvolve, evolve, displayName } from '../core/monster';
import type { MonsterInst } from '../core/types';
import { h, fill, layer, clearLayer, modal, toast, confirmBox, promptBox, anyModal } from './dom';
import { speciesDetail } from './menus';
import { sfx } from '../audio';
import { sceneActive } from '../nav';

const A = 'assets/team/';
const W = 1280, H = 720, C = 182;
const ROW_Y: Record<Row, number> = { party: 262, storage: 534 };
// side cards: distance of the first one from the centre, spacing of the rest, and their 3D turn
const FIRST = 168, STEP = 74, TURN = 62, PERSP = 900, SIDE_SCALE = 1.04, SIDE = 4;
const MODES = ['Change Party', 'Insert Soul Stone', 'Convert to Soul Stone', 'Evolve', 'Rename', 'Monster Info'] as const;
const HINT: Record<Mode, string> = {
  'Change Party': 'Drag monsters up/down to change your party.',
  'Insert Soul Stone': 'Choose a soul stone, then tap the centre monster.',
  'Convert to Soul Stone': 'Tap the centre monster to convert it to a soul stone.',
  Evolve: 'Tap the centre monster to evolve it.',
  Rename: 'Tap the centre monster to rename it.',
  'Monster Info': 'Tap the centre monster to see its details.',
};
const TUT_KEY = 'dragon-isle-tut-team';
type Mode = typeof MODES[number];
type Row = 'party' | 'storage';
type Item = { key: string; m?: MonsterInst };

let desc = true; // storage order 99→1, kept while the game runs

const elUrl = (el: string) => `assets/ui/element-${el.toLowerCase()}.png`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const stars = (n: number) => `${Math.floor(n)}${n % 1 ? '½' : ''}`;
function tutSeen() { try { return !!localStorage.getItem(TUT_KEY); } catch { return true; } }
function tutDone() { try { localStorage.setItem(TUT_KEY, '1'); } catch { /* storage blocked */ } }

/** The card's painted layers: highlight plate, frame, sprite, soul stone and element badges. */
function cardFace(r: Row, it: Item) {
  const sp = it.m && species(it.m.species);
  return [
    h('div', { class: 'tm-hl' }),
    h('img', { class: 'tm-frame', src: A + (it.m ? (r === 'party' ? 'card_teal.png' : 'card_red.png') : r === 'party' ? 'card_empty.png' : 'card_red.png'), alt: '', draggable: 'false' }),
    // the storage drop slot is the red card under the ghost arrows of the empty card, turned to point down
    !it.m && r === 'storage' ? h('img', { class: 'tm-frame tm-arrows', src: A + 'card_empty.png', alt: '', draggable: 'false' }) : null,
    sp ? h('img', { class: 'tm-spr', src: spriteUrl(sp), alt: sp.name, draggable: 'false' }) : null,
    it.m?.soul ? h('img', { class: 'tm-soul', src: elUrl(it.m.soul.element), alt: '', draggable: 'false' }) : null,
    sp ? h('img', { class: 'tm-el', src: elUrl(sp.element), alt: sp.element, draggable: 'false' }) : null,
  ];
}

function place(d: number) {
  const s = Math.sign(d), n = Math.abs(d);
  const x = n ? s * (FIRST + (n - 1) * STEP) : 0;
  return `translateX(${x}px) perspective(${PERSP}px) rotateY(${-s * TURN}deg) scale(${n ? SIDE_SCALE : 1})`;
}

export function openTeam(refresh: () => void) {
  let mode: Mode = 'Change Party';
  let active: Row = 'party';
  let soulSel: number | null = null;
  const focus: Record<Row, number> = { party: 0, storage: 0 };
  const cards: Record<Row, Map<string, HTMLElement>> = { party: new Map(), storage: new Map() };

  const items = (r: Row): Item[] => r === 'party'
    ? [...S.party.map((m) => ({ key: `m${m.uid}`, m })), ...Array.from({ length: Math.max(0, partySize() - S.party.length) }, (_, i) => ({ key: `e${i}` }))]
    : [{ key: 'drop' }, ...S.storage.slice().sort((a, b) => (desc ? b.level - a.level : a.level - b.level) || a.uid - b.uid).map((m) => ({ key: `m${m.uid}`, m }))];
  const focusOn = (r: Row, m: MonsterInst) => { focus[r] = Math.max(0, items(r).findIndex((i) => i.m === m)); active = r; };
  const focused = (r: Row) => items(r)[focus[r]]?.m;

  const rows = { party: h('div', { class: 'tm-row', style: { top: `${ROW_Y.party}px` } }), storage: h('div', { class: 'tm-row', style: { top: `${ROW_Y.storage}px` } }) };
  const labs = { party: h('div', { class: 'tm-lab', style: { top: `${ROW_Y.party - C / 2 - 70}px` } }), storage: h('div', { class: 'tm-lab', style: { top: `${ROW_Y.storage - C / 2 - 54}px` } }) };
  const title = h('div', { class: 'tm-title', 'data-testid': 'team-title', onClick: () => toggleMenu() });
  const menu = h('div', { class: 'm-menu tm-menu' }, ...MODES.map((md) => h('button', { class: 'bt-mi', 'data-mode': md, onClick: () => setMode(md) }, md)));
  const souls = h('div', { class: 'tm-souls' });
  const order = h('div', { class: 'tm-order' });
  const nav = (cls: string, img: string, label: string, fn: () => void) =>
    h('button', { class: `tm-nav ${cls}`, 'aria-label': label, title: label, onClick: fn }, h('img', { src: A + img, alt: '', draggable: 'false' }));

  const sheet = h('div', { class: 'tm-sheet' },
    rows.party, rows.storage, labs.party, labs.storage,
    h('div', { class: 'tm-party' }, 'Party'), souls,
    title,
    nav('tm-first', 'nav_double.png', 'First', () => step(-Infinity)),
    nav('tm-prev', 'nav_single.png', 'Previous', () => step(-1)),
    nav('tm-down', 'nav_down.png', 'Actions', () => toggleMenu()),
    nav('tm-next flip', 'nav_single.png', 'Next', () => step(1)),
    nav('tm-last flip', 'nav_double.png', 'Last', () => step(Infinity)),
    nav('tm-close', 'nav_close.png', 'Close', () => close()),
    h('button', { class: 'tm-sort', 'data-testid': 'team-sort', onClick: () => sort() },
      h('span', { class: 'tm-wood', style: { backgroundImage: 'url(assets/ui/kit/plank.png)' } }), h('span', {}, 'Sort')),
    order,
    h('div', { class: 'tm-foot' }, 'Drag Monsters Up/Down To Change Party'),
    menu);
  const stone = sceneActive('Dungeon');
  const root = h('div', { class: `tm-root ${stone ? 'stone' : 'barn'}` }, h('div', { class: 'tm-bg', style: { backgroundImage: `url(${A}${stone ? 'bg_stone' : 'bg_barn'}.jpg)` } }), sheet);

  function layoutRow(r: Row) {
    const list = items(r);
    focus[r] = clamp(focus[r], 0, list.length - 1);
    const f = focus[r], map = cards[r], keep = new Set<string>();
    list.forEach((it, i) => {
      const d = i - f;
      if (Math.abs(d) > SIDE) return;
      keep.add(it.key);
      let el = map.get(it.key);
      const sig = it.m ? `${it.m.species}|${it.m.soul?.element ?? ''}` : it.key;
      if (!el) {
        el = h('div', { class: 'tm-card' });
        el.dataset.row = r;
        el.style.transform = place(d); // placed before it is added, so new cards appear in place instead of sliding in
        map.set(it.key, el);
        rows[r].append(el);
      }
      if (el.dataset.sig !== sig) { el.dataset.sig = sig; fill(el, ...cardFace(r, it)); }
      el.dataset.idx = String(i);
      el.style.transform = place(d);
      el.style.zIndex = String(50 - Math.abs(d));
      el.classList.toggle('focus', d === 0);
      el.classList.toggle('hl', d === 0 && r === active);
    });
    for (const [k, el] of map) if (!keep.has(k)) { el.remove(); map.delete(k); }
  }

  function label(r: Row) {
    const m = focused(r);
    if (!m) return [];
    const sp = species(m.species);
    const evo = sp.evolveInto && sp.evolveLevel ? `${Math.min(100, Math.floor((100 * m.level) / sp.evolveLevel))}% Evolved` : 'Fully evolved';
    return [h('div', { class: 'tm-lv' }, h('img', { src: 'assets/ui/staricon.png', alt: '' }), h('small', {}, stars(sp.stars)), `Lv:${m.level}`), h('div', { class: 'tm-evo' }, evo)];
  }

  function render() {
    title.textContent = mode;
    menu.querySelectorAll<HTMLElement>('.bt-mi').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    layoutRow('party');
    layoutRow('storage');
    fill(labs.party, ...label('party'));
    fill(labs.storage, ...label('storage'));
    if (soulSel != null && !S.souls.some((s) => s.id === soulSel)) soulSel = null;
    fill(souls, ...(mode === 'Insert Soul Stone' ? S.souls.map((s) => h('button', {
      class: `tm-stone ${s.id === soulSel ? 'sel' : ''}`, title: `${s.element} soul stone +${Math.round(s.power * 100)}%`,
      onClick: () => { soulSel = s.id === soulSel ? null : s.id; render(); },
    }, h('img', { src: elUrl(s.element), alt: s.element, draggable: 'false' }))) : []));
    fill(order, ...(desc ? ['99', h('b', {}, '➔'), '1'] : ['1', h('b', {}, '➔'), '99']));
  }

  const step = (d: number) => {
    const n = clamp(focus[active] + d, 0, items(active).length - 1);
    if (n !== focus[active]) { focus[active] = n; render(); }
  };
  const sort = () => {
    const cur = focused('storage');
    desc = !desc;
    if (cur) focus.storage = items('storage').findIndex((i) => i.m === cur);
    render();
  };
  const toggleMenu = (open = !menu.classList.contains('open')) => menu.classList.toggle('open', open);
  function setMode(md: Mode) {
    mode = md;
    soulSel = null;
    toggleMenu(false);
    toast(md === 'Insert Soul Stone' && !S.souls.length ? 'You have no soul stones. Convert a monster to make one.' : HINT[md]);
    render();
  }

  /** Tapping the centre monster applies the current action to it. */
  async function act(m: MonsterInst) {
    const name = displayName(m);
    switch (mode) {
      case 'Change Party': return;
      case 'Insert Soul Stone': {
        const s = S.souls.find((x) => x.id === soulSel);
        if (!s) return toast(S.souls.length ? 'Choose a soul stone first.' : 'You have no soul stones.');
        equipSoul(m.uid, s.id);
        soulSel = null;
        sfx('buff');
        toast(`${s.element} soul stone inserted into ${name} (+${Math.round(s.power * 100)}%)`);
        break;
      }
      case 'Convert to Soul Stone': {
        if (S.party.length <= 1 && S.party.includes(m)) return toast('Your party needs at least one monster.');
        if (!(await confirmBox(`Destroy ${name} to extract its soul stone? This is permanent.`, 'Destroy'))) return;
        const s = destroyForSoul(m.uid);
        if (!s) return;
        sfx('magic');
        toast(`Obtained a ${s.element} soul stone (+${Math.round(s.power * 100)}%)`);
        break;
      }
      case 'Evolve': {
        const sp = species(m.species);
        if (!canEvolve(m)) return toast(sp.evolveInto ? `${name} evolves into ${sp.evolveInto} at Lv ${sp.evolveLevel}.` : `${name} is fully evolved.`);
        const into = evolve(m)!;
        markCaught(m.species);
        recordLevel(m);
        questEvent('evolve');
        sfx('evolve');
        toast(`${name} evolved into ${into.name}!`);
        break;
      }
      case 'Rename': {
        const n = await promptBox('Rename', 'Nickname', name, 16);
        if (n == null) return;
        m.nick = n.trim().slice(0, 16) || undefined;
        break;
      }
      case 'Monster Info': modal(name, speciesDetail(species(m.species), m), { width: '60em' }); return;
    }
    save();
    render();
  }

  function tap(r: Row, idx: number) {
    sfx('select');
    const again = r === active && idx === focus[r];
    active = r;
    focus[r] = idx;
    render();
    const m = items(r)[idx]?.m;
    if (again && m) void act(m);
  }

  // ---- pointer: tap to focus, swipe sideways to scroll a row, drag up/down to move a monster between rows
  type Press = { row: Row; idx: number; it: Item; x: number; y: number; id: number; kind?: 'drag' | 'swipe'; base: number; ghost?: HTMLElement; src?: HTMLElement };
  let press: Press | null = null;
  const k = () => sheet.getBoundingClientRect().width / W;
  const toSheet = (e: MouseEvent) => { const b = sheet.getBoundingClientRect(); return { x: (e.clientX - b.left) / k(), y: (e.clientY - b.top) / k() }; };
  const rowAt = (y: number): Row => (y < (ROW_Y.party + ROW_Y.storage) / 2 ? 'party' : 'storage');

  sheet.addEventListener('pointerdown', (e) => {
    if (menu.classList.contains('open') && !(e.target as HTMLElement).closest('.tm-menu, .tm-title, .tm-down')) toggleMenu(false);
    const card = (e.target as HTMLElement).closest<HTMLElement>('.tm-card');
    if (!card || e.button > 0 || press) return;
    const r = card.dataset.row as Row, idx = Number(card.dataset.idx);
    press = { row: r, idx, it: items(r)[idx], x: e.clientX, y: e.clientY, id: e.pointerId, base: focus[r], src: card };
    sheet.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  sheet.addEventListener('pointermove', (e) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    const dx = (e.clientX - p.x) / k(), dy = (e.clientY - p.y) / k();
    if (!p.kind) {
      if (Math.hypot(dx, dy) < 10) return;
      p.kind = p.it.m && Math.abs(dy) > Math.abs(dx) ? 'drag' : 'swipe';
      if (p.kind === 'drag') {
        p.ghost = h('div', { class: 'tm-card tm-drag' }, ...cardFace(p.row, p.it));
        p.src!.classList.add('lift');
        sheet.append(p.ghost);
      }
    }
    if (p.kind === 'drag') {
      const at = toSheet(e);
      Object.assign(p.ghost!.style, { left: `${at.x - C / 2}px`, top: `${at.y - C / 2}px` });
      rows.party.classList.toggle('drop', rowAt(at.y) === 'party' && p.row === 'storage');
      rows.storage.classList.toggle('drop', rowAt(at.y) === 'storage' && p.row === 'party');
    } else {
      const n = clamp(p.base - Math.round(dx / STEP), 0, items(p.row).length - 1);
      if (n !== focus[p.row] || active !== p.row) { focus[p.row] = n; active = p.row; render(); }
    }
  });
  const release = (e: PointerEvent, cancel = false) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    p.ghost?.remove();
    p.src?.classList.remove('lift');
    rows.party.classList.remove('drop');
    rows.storage.classList.remove('drop');
    if (cancel) return;
    if (!p.kind) tap(p.row, p.idx);
    else if (p.kind === 'drag') drop(p.row, p.it.m!, rowAt(toSheet(e).y), e);
  };
  sheet.addEventListener('pointerup', (e) => release(e));
  sheet.addEventListener('pointercancel', (e) => release(e, true));
  let wheelAt = 0;
  sheet.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (performance.now() - wheelAt < 110) return;
    wheelAt = performance.now();
    active = rowAt(toSheet(e).y);
    step(Math.sign(e.deltaY || e.deltaX));
  }, { passive: false });

  /** The card of a row under (or nearest to) the pointer. */
  function targetIn(r: Row, e: MouseEvent): Item | undefined {
    let best: HTMLElement | undefined, bestScore = Infinity;
    for (const el of cards[r].values()) {
      const b = el.getBoundingClientRect();
      const inside = e.clientX >= b.left && e.clientX <= b.right;
      // inside a card beats nearness; among overlapping cards the one drawn on top wins
      const score = inside ? -Number(el.style.zIndex) : Math.abs(e.clientX - (b.left + b.right) / 2);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best ? items(r)[Number(best.dataset.idx)] : undefined;
  }

  function drop(from: Row, m: MonsterInst, to: Row, e: PointerEvent) {
    if (from === 'party' && to === 'storage') {
      if (S.party.length <= 1) { sfx('fail'); toast('Your party needs at least one monster.'); return render(); }
      S.party.splice(S.party.indexOf(m), 1);
      S.storage.push(m);
    } else if (from === 'storage' && to === 'party') {
      if (S.party.length < partySize()) {
        S.storage.splice(S.storage.indexOf(m), 1);
        S.party.push(m);
      } else {
        const out = targetIn('party', e)?.m ?? focused('party') ?? S.party[S.party.length - 1];
        S.party[S.party.indexOf(out)] = m;
        S.storage.splice(S.storage.indexOf(m), 1, out);
        toast(`${displayName(m)} joined the party in place of ${displayName(out)}`);
      }
    } else if (from === 'party' && to === 'party') {
      const other = targetIn('party', e)?.m;
      if (!other || other === m) return render();
      const a = S.party.indexOf(m), b = S.party.indexOf(other);
      [S.party[a], S.party[b]] = [other, m];
    } else return render();
    save();
    sfx('select');
    focusOn(to, m);
    render();
  }

  function close() {
    sfx('back');
    cleanup();
    clearLayer('team');
    refresh();
  }
  function cleanup() { window.removeEventListener('resize', fit); window.removeEventListener('keydown', onKey); }
  function onKey(e: KeyboardEvent) {
    if (!root.isConnected) return cleanup();
    if (anyModal()) return;
    if (e.key === 'Escape') { if (menu.classList.contains('open')) toggleMenu(false); else close(); }
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { active = e.key === 'ArrowUp' ? 'party' : 'storage'; render(); }
  }
  function fit() {
    if (!root.isConnected) return cleanup();
    const b = root.getBoundingClientRect();
    const s = Math.min(b.width / W, b.height / H);
    sheet.style.transform = `translate(${(b.width - W * s) / 2}px, ${(b.height - H * s) / 2}px) scale(${s})`;
  }

  if (!tutSeen()) {
    const tut = h('div', { class: 'tm-tut-back' },
      h('div', { class: 'tm-tut' }, h('div', { class: 'tm-tut-t' }, 'Tutorial: Changing Your Party'),
        h('div', { class: 'tm-tut-x' }, 'Drag a monster down to store it, or drag one up to add it to your party.')),
      h('div', { class: 'tm-ok' }, h('button', { class: 'btn gold', 'data-testid': 'team-tut-ok', onClick: () => { tutDone(); tut.remove(); } }, 'Ok')));
    sheet.append(tut);
  }
  // Phaser also handles presses that reach the window outside its canvas; keep them from hitting the scene underneath
  for (const t of ['mousedown', 'touchstart']) root.addEventListener(t, (e) => e.stopPropagation());
  window.addEventListener('resize', fit);
  window.addEventListener('keydown', onKey);
  render();
  layer('team', root);
  fit();
}
