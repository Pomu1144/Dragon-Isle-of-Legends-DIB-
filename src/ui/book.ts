/**
 * 1:1 rebuild of the original Dragon Island Blue Monsterpedia screen.
 *
 * The page (with its tabs and plank) and the empty card frame are extracted from a screenshot of
 * the original game by tools/ref_ui/extract.py. Everything is laid out in that screenshot's own
 * 1170x879 pixel space and scaled to fit, so names, sprites, stars, crown digits, element icons
 * and numbers land on exactly the same pixels as in the original.
 */
import { data, species, spriteUrl } from '../core/data';
import type { MonsterInst, Species } from '../core/types';
import { S } from '../core/state';
import { displayName } from '../core/monster';
import { h, fill, layer, clearLayer, modal } from './dom';
import { sfx } from '../audio';
import { speciesDetail, monsterActions } from './menus';

const PAGE_W = 1170, PAGE_H = 879;
const SLOTS: [number, number][] = [[58, 36], [355, 36], [653, 36], [58, 425], [356, 425], [653, 425]];
// tab hit areas on the page, top to bottom (the 6th, Monsterpedia, is drawn selected)
const TABS: [number, number, number][] = [[1000, 30, 120], [1000, 125, 212], [1000, 215, 302], [1000, 305, 392], [1000, 395, 482], [966, 485, 580]];

function stars(n: number) {
  const out: HTMLElement[] = [];
  for (let i = 0; i < Math.floor(n); i++) out.push(h('img', { src: 'assets/ui/staricon.png', alt: '' }));
  if (n % 1) out.push(h('img', { src: 'assets/ui/halfstaricon.png', alt: '', class: 'half' }));
  return h('div', { class: `dibx-stars ${n > 5 ? 'many' : ''}` }, ...out);
}

/** One card: the extracted frame plus live content at the original pixel positions. */
export function dibCard(sp: Species, crown: number | string, onClick?: () => void) {
  return h('div', { class: 'dibx-card', onClick, title: sp.name, style: { backgroundImage: 'url(assets/ui/dib/card.png)' } },
    h('div', { class: 'dibx-name' }, sp.name),
    h('div', { class: 'dibx-sprite' }, h('img', { src: spriteUrl(sp), draggable: 'false', alt: sp.name })),
    stars(sp.stars),
    h('div', { class: `dibx-crown ${String(crown).length > 2 ? 'long' : ''}` }, String(crown)),
    h('img', { class: 'dibx-el', src: `assets/ui/element-${sp.element.toLowerCase()}.png`, alt: sp.element }),
    h('div', { class: 'dibx-num' }, String(sp.id)));
}

type Mode = 'pedia' | 'mine';

export function openBook(mode: Mode, refresh: () => void = () => {}, nav: (k: string) => void = () => {}) {
  let page = 0;
  const cards = h('div', {});
  const pg = h('div', { class: 'dibx-pg' });
  const plank = h('button', { class: 'dibx-plank', 'data-testid': 'book-switch' });
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
      const c = dibCard(e.sp, e.crown, () => {
        if (e.m) {
          const m = e.m;
          modal(displayName(m), (cl) => monsterActions(m, () => { cl(); render(); refresh(); }, () => { cl(); render(); }), { width: '60em' });
        } else modal(e.sp.name, speciesDetail(e.sp), { width: '60em' });
      });
      c.style.left = `${SLOTS[i][0]}px`;
      c.style.top = `${SLOTS[i][1]}px`;
      return c;
    }));
    const found = Math.floor((S.caught.length / data().monsters.length) * 100);
    fill(pg, `Pg ${page + 1}/${pages()}`, h('br'), mode === 'pedia' ? `Found ${found}%` : `Owned ${list.length}`);
    plank.textContent = mode === 'pedia' ? 'My Monsters' : 'Monsterpedia';
  };
  plank.addEventListener('click', () => { sfx('select'); mode = mode === 'pedia' ? 'mine' : 'pedia'; page = 0; render(); });
  pg.addEventListener('click', () => turn(page >= pages() - 1 ? -page : 1));

  const tabs = TABS.map(([x, y0, y1], i) => h('button', {
    class: 'dibx-tab', title: ['Quests', 'Hero', 'Bag', 'System', 'My Monsters', 'Monsterpedia'][i],
    style: { left: `${x}px`, top: `${y0}px`, width: `${PAGE_W - x}px`, height: `${y1 - y0}px` },
    onClick: () => {
      if (i === 4) { mode = 'mine'; page = 0; render(); return; }
      if (i === 5) { mode = 'pedia'; page = 0; render(); return; }
      close();
      nav(['quests', 'hero', 'bag', 'system'][i]);
    },
  }));

  const sheet = h('div', { class: 'dibx-page', style: { backgroundImage: 'url(assets/ui/dib/page.jpg)' } }, cards, ...tabs, pg, plank);
  const root = h('div', { class: 'dibx-root', style: { backgroundImage: 'url(assets/ui/dib/page.jpg)' } },
    h('div', { class: 'dibx-backdrop', style: { backgroundImage: 'url(assets/ui/dib/page.jpg)' } }),
    sheet,
    h('button', { class: 'dibx-back btn small', onClick: close }, '✕ Close'));

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
