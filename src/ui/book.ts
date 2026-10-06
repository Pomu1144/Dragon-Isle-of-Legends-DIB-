/**
 * Monsterpedia / My Monsters book, built from the Dragon Island Blue UI kit
 * (tools/ref_ui/kit.png, sliced by tools/ref_ui/slice_kit.py into public/assets/ui/kit).
 * Everything is placed in the kit's own 1536x1024 pixel space and scaled to fit.
 */
import { data, species, spriteUrl } from '../core/data';
import type { MonsterInst, Species } from '../core/types';
import { S } from '../core/state';
import { displayName } from '../core/monster';
import { h, fill, layer, clearLayer, modal } from './dom';
import { sfx } from '../audio';
import { speciesDetail, monsterActions } from './menus';

const KIT = 'assets/ui/kit/';
const PAGE_W = 1536, PAGE_H = 1024;
type Variant = 'a' | 'b';
// card slots exactly as laid out on the kit sheet (row 1 uses the tall card, row 2 the short one)
const SLOTS: { x: number; y: number; v: Variant }[] = [
  { x: 47, y: 22, v: 'a' }, { x: 446, y: 22, v: 'a' }, { x: 842, y: 21, v: 'a' },
  { x: 47, y: 479, v: 'b' }, { x: 446, y: 479, v: 'b' }, { x: 842, y: 479, v: 'b' },
];
const CARD = { a: { w: 385, h: 443, sx: 187, sy: 378, starDy: -76 }, b: { w: 384, h: 409, sx: 189, sy: 346, starDy: -57 } };
const TABS = [
  { x: 1264, y: 25, w: 234, h: 131, label: 'Quests', go: 'quests' },
  { x: 1264, y: 158, w: 234, h: 124, label: 'Hero', go: 'hero' },
  { x: 1263, y: 282, w: 235, h: 128, label: 'Bag', go: 'bag' },
  { x: 1264, y: 411, w: 234, h: 123, label: 'Settings', go: 'system' },
  { x: 1260, y: 534, w: 239, h: 127, label: 'My Monsters', go: 'mine' },
  { x: 1258, y: 663, w: 241, h: 131, label: 'Monsterpedia', go: 'pedia' },
];
const PLANK = { x: 821, y: 889, w: 473, h: 135, label: { x: 132, y: 40, w: 317, h: 61 } };
const BACK = { x: 1310, y: 893, w: 198, h: 113 };

function px(el: HTMLElement, x: number, y: number, w?: number, hh?: number) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  if (w != null) el.style.width = `${w}px`;
  if (hh != null) el.style.height = `${hh}px`;
  return el;
}

function stars(n: number) {
  const out: HTMLElement[] = [];
  for (let i = 0; i < Math.floor(n); i++) out.push(h('img', { src: 'assets/ui/staricon.png', alt: '' }));
  if (n % 1) out.push(h('img', { src: 'assets/ui/halfstaricon.png', alt: '', class: 'half' }));
  return h('div', { class: `kb-stars ${n > 5 ? 'many' : ''}` }, ...out);
}

/** One card: the kit's empty frame with live content in its slots. */
export function kitCard(sp: Species, crown: number | string, v: Variant, onClick?: () => void) {
  const c = CARD[v];
  const card = h('div', { class: 'kb-card', onClick, title: sp.name, style: { backgroundImage: `url(${KIT}card_${v}.png)` } });
  card.style.width = `${c.w}px`;
  card.style.height = `${c.h}px`;
  const portraitBottom = c.sy - 103;
  card.append(
    px(h('div', { class: 'kb-name' }, sp.name), 26, 23, 334, 32),
    px(h('div', { class: 'kb-sprite' }, h('img', { src: spriteUrl(sp), alt: sp.name, draggable: 'false' })), 34, 68, 318, portraitBottom - 72),
    px(stars(sp.stars), c.sx - 120, c.sy + c.starDy, 240, 26),
    px(h('div', { class: `kb-crown ${String(crown).length > 2 ? 'long' : ''}` }, String(crown)), 46, c.sy - 10, 72, 40),
    px(h('img', { class: 'kb-el', src: `assets/ui/element-${sp.element.toLowerCase()}.png`, alt: sp.element }), c.sx - 33, c.sy - 33, 66, 66),
    px(h('div', { class: 'kb-num' }, String(sp.id)), c.sx + 78, c.sy - 10, 92, 50),
  );
  return card;
}

type Mode = 'pedia' | 'mine';

export function openBook(mode: Mode, refresh: () => void = () => {}, nav: (k: string) => void = () => {}) {
  let page = 0;
  const cards = h('div', {});
  const pg = h('div', { class: 'kb-pg', title: 'Next page' });
  const plankLabel = h('div', { class: 'kb-plank-label' });
  const tabs: HTMLElement[] = [];
  const close = () => { sfx('back'); clearLayer('book'); window.removeEventListener('resize', fit); window.removeEventListener('keydown', onKey); refresh(); };

  const entries = (): { sp: Species; crown: number; m?: MonsterInst }[] =>
    mode === 'pedia'
      ? data().monsters.filter((s) => S.caught.includes(s.id)).sort((a, b) => a.id - b.id).map((s) => ({ sp: s, crown: S.bestLevel[s.id] ?? 1 }))
      : [...S.party, ...S.storage].map((m) => ({ sp: species(m.species), crown: m.level, m }));
  const pages = () => Math.max(1, Math.ceil(entries().length / SLOTS.length));
  const turn = (d: number) => { const n = Math.min(pages() - 1, Math.max(0, page + d)); if (n !== page) { page = n; sfx('select'); render(); } };

  const render = () => {
    const list = entries();
    page = Math.min(page, pages() - 1);
    fill(cards, ...list.slice(page * SLOTS.length, (page + 1) * SLOTS.length).map((e, i) => {
      const slot = SLOTS[i];
      const c = kitCard(e.sp, e.crown, slot.v, () => {
        if (e.m) {
          const m = e.m;
          modal(displayName(m), (cl) => monsterActions(m, () => { cl(); render(); refresh(); }, () => { cl(); render(); }), { width: '60em' });
        } else modal(e.sp.name, speciesDetail(e.sp), { width: '60em' });
      });
      return px(c, slot.x, slot.y);
    }));
    const found = Math.floor((S.caught.length / data().monsters.length) * 100);
    fill(pg, h('div', {}, `Pg ${page + 1}/${pages()}`), h('div', {}, mode === 'pedia' ? `Found ${found}%` : `Owned ${list.length}`));
    plankLabel.textContent = mode === 'pedia' ? 'My Monsters' : 'Monsterpedia';
    tabs.forEach((t, i) => t.classList.toggle('on', TABS[i].go === mode));
  };

  TABS.forEach((t, i) => {
    const el = px(h('button', { class: 'kb-tab', title: t.label, onClick: () => {
      if (t.go === 'mine' || t.go === 'pedia') { sfx('select'); mode = t.go; page = 0; render(); return; }
      close();
      nav(t.go);
    } }, h('img', { src: `${KIT}tab${i + 1}.png`, alt: t.label, draggable: 'false' })), t.x, t.y, t.w, t.h);
    tabs.push(el);
  });
  const plank = px(h('button', { class: 'kb-plank', 'data-testid': 'book-switch', onClick: () => { sfx('select'); mode = mode === 'pedia' ? 'mine' : 'pedia'; page = 0; render(); } },
    h('img', { src: `${KIT}plank.png`, alt: '', draggable: 'false' }), px(plankLabel, PLANK.label.x, PLANK.label.y, PLANK.label.w, PLANK.label.h)), PLANK.x, PLANK.y, PLANK.w, PLANK.h);
  const back = px(h('button', { class: 'kb-back', title: 'Back', 'data-testid': 'book-back', onClick: close }, h('img', { src: `${KIT}back.png`, alt: 'Back', draggable: 'false' })), BACK.x, BACK.y, BACK.w, BACK.h);
  pg.addEventListener('click', () => turn(page >= pages() - 1 ? -page : 1));

  const sheet = h('div', { class: 'kb-page', style: { backgroundImage: `url(${KIT}page.jpg)` } }, cards, ...tabs, pg, plank, back);
  const root = h('div', { class: 'kb-root' }, h('div', { class: 'kb-backdrop', style: { backgroundImage: `url(${KIT}page.jpg)` } }), sheet);

  function fit() {
    const box = document.getElementById('ui')!.getBoundingClientRect();
    sheet.style.transform = `translate(-50%, -50%) scale(${Math.min(box.width / PAGE_W, box.height / PAGE_H)})`;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') turn(1);
    if (e.key === 'ArrowLeft') turn(-1);
  }
  root.addEventListener('wheel', (e) => turn(e.deltaY > 0 ? 1 : -1));
  let sx = 0;
  root.addEventListener('pointerdown', (e) => (sx = e.clientX));
  root.addEventListener('pointerup', (e) => { if (Math.abs(e.clientX - sx) > 60) turn(e.clientX < sx ? 1 : -1); });
  window.addEventListener('resize', fit);
  window.addEventListener('keydown', onKey);
  render();
  layer('book', root);
  fit();
}
