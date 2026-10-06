/**
 * Monster book in the style of the original Dragon Island Blue Monsterpedia:
 * parchment page, 3x2 framed monster cards, element tabs on the right,
 * "Pg x/y · Found n%" and a wooden "My Monsters" plank to switch views.
 */
import { data, species, spriteUrl } from '../core/data';
import type { MonsterInst, Species } from '../core/types';
import { S } from '../core/state';
import { displayName } from '../core/monster';
import { h, fill, layer, clearLayer, modal } from './dom';
import { sfx } from '../audio';
import { speciesDetail, monsterActions } from './menus';

const ELEMENTS = ['Water', 'Earth', 'Air', 'Fire', 'Life', 'Death', 'Arcane'] as const;
const PER_PAGE = 6;

const CROWN = (n: number | string) => h('div', { class: 'dib-crown', html: `
<svg viewBox="0 0 64 52" aria-hidden="true">
  <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2a6"/><stop offset=".45" stop-color="#f2be3a"/><stop offset="1" stop-color="#a8650c"/></linearGradient></defs>
  <path d="M4 44 L2 16 L16 28 L24 8 L32 22 L40 8 L48 28 L62 16 L60 44 Z" fill="url(#cg)" stroke="#6b3d05" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="24" cy="8" r="3.4" fill="#d33a2c" stroke="#6b1d12"/><circle cx="40" cy="8" r="3.4" fill="#d33a2c" stroke="#6b1d12"/>
  <circle cx="2.5" cy="16" r="2.6" fill="#f7d469" stroke="#6b3d05"/><circle cx="61.5" cy="16" r="2.6" fill="#f7d469" stroke="#6b3d05"/>
  <rect x="4" y="42" width="56" height="7" rx="2" fill="url(#cg)" stroke="#6b3d05" stroke-width="2"/>
  <circle cx="32" cy="31" r="12.5" fill="#2e9a6a" stroke="#0f4a30" stroke-width="2.5"/>
  <circle cx="32" cy="31" r="10" fill="none" stroke="#7fe0b0" stroke-width="1.2" opacity=".7"/>
</svg>` }, h('b', { class: String(n).length > 2 ? 'long' : '' }, String(n)));

const CHAIN = () => h('span', { class: 'dib-chain', html: `
<svg viewBox="0 0 40 40" aria-hidden="true">
  <g fill="none" stroke-linecap="round">
    <rect x="4" y="15" width="18" height="10" rx="5" transform="rotate(-45 13 20)" stroke="#1d4f86" stroke-width="5.5"/>
    <rect x="18" y="15" width="18" height="10" rx="5" transform="rotate(-45 27 20)" stroke="#1d4f86" stroke-width="5.5"/>
    <rect x="4" y="15" width="18" height="10" rx="5" transform="rotate(-45 13 20)" stroke="#5aa6e6" stroke-width="3"/>
    <rect x="18" y="15" width="18" height="10" rx="5" transform="rotate(-45 27 20)" stroke="#5aa6e6" stroke-width="3"/>
  </g>
</svg>` });

function stars(n: number) {
  const out: HTMLElement[] = [];
  for (let i = 0; i < Math.floor(n); i++) out.push(h('img', { src: 'assets/ui/staricon.png', alt: '' }));
  if (n % 1) out.push(h('img', { src: 'assets/ui/halfstaricon.png', alt: '', class: 'half' }));
  return h('div', { class: `dib-stars ${n > 5 ? 'many' : ''}` }, ...out);
}

/** One framed card exactly like the original: title banner, portrait, stars, crown/element/chain row. */
export function dibCard(sp: Species, crown: number | string, onClick?: () => void, opts: { selected?: boolean; tag?: string } = {}) {
  return h('div', { class: `dib-card ${opts.selected ? 'sel' : ''}`, onClick, title: sp.name },
    h('div', { class: 'dib-title' }, h('span', {}, sp.name)),
    h('div', { class: 'dib-portrait' }, h('i', { class: 'c tl' }), h('i', { class: 'c tr' }), h('i', { class: 'c bl' }), h('i', { class: 'c br' }),
      h('img', { src: spriteUrl(sp), loading: 'lazy', draggable: 'false' }),
      opts.tag ? h('span', { class: 'dib-tag' }, opts.tag) : null),
    h('div', { class: 'dib-info' }, h('i', { class: 'c tl' }), h('i', { class: 'c tr' }), h('i', { class: 'c bl' }), h('i', { class: 'c br' }),
      stars(sp.stars),
      h('div', { class: 'dib-row' },
        CROWN(crown),
        h('img', { class: 'dib-el', src: `assets/ui/element-${sp.element.toLowerCase()}.png`, alt: sp.element, title: sp.element }),
        h('div', { class: 'dib-num' }, CHAIN(), h('b', {}, String(sp.id))))));
}

type Mode = 'pedia' | 'mine';

export function openBook(mode: Mode, refresh: () => void = () => {}) {
  let page = 0;
  let filter: string = 'all';
  const grid = h('div', { class: 'dib-grid' });
  const side = h('div', { class: 'dib-side' });
  const footer = h('div', { class: 'dib-foot' });
  const close = () => { clearLayer('book'); refresh(); };

  const entries = (): { sp: Species; crown: number | string; m?: MonsterInst }[] => {
    if (mode === 'pedia') {
      return data().monsters.filter((s) => S.caught.includes(s.id)).sort((a, b) => a.id - b.id)
        .filter((s) => filter === 'all' || s.element === filter)
        .map((s) => ({ sp: s, crown: S.bestLevel[s.id] ?? 1 }));
    }
    return [...S.party, ...S.storage].filter((m) => filter === 'all' || species(m.species).element === filter)
      .map((m) => ({ sp: species(m.species), crown: m.level, m }));
  };

  const render = () => {
    const list = entries();
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    page = Math.min(page, pages - 1);
    const slice = list.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
    fill(grid, ...slice.map((e) => dibCard(e.sp, e.crown, () => {
      if (e.m) {
        const m = e.m;
        modal(displayName(m), (c) => monsterActions(m, () => { c(); render(); refresh(); }, () => { c(); render(); }), { width: '60em' });
      } else modal(e.sp.name, speciesDetail(e.sp), { width: '60em' });
    }, { tag: e.m && S.party.includes(e.m) ? `Party ${S.party.indexOf(e.m) + 1}` : undefined })),
    ...Array.from({ length: PER_PAGE - slice.length }, () => h('div', { class: 'dib-empty' })));
    fill(side, ...[['all', 'assets/ui/monsterpediaicon.png'], ...ELEMENTS.map((e) => [e, `assets/ui/element-${e.toLowerCase()}.png`])]
      .map(([k, icon]) => h('button', { class: `dib-tab ${filter === k ? 'on' : ''}`, title: k === 'all' ? 'All' : k, onClick: () => { filter = k; page = 0; render(); } },
        h('span', { class: 'disc' }, h('img', { src: icon, alt: k })))));
    const found = Math.floor((S.caught.length / data().monsters.length) * 100);
    fill(footer,
      h('div', { class: 'dib-pg' },
        h('button', { class: 'dib-arrow', disabled: page <= 0, onClick: () => { page--; render(); } }, '◀'),
        h('div', {}, `Pg ${page + 1}/${pages}`, h('br'), mode === 'pedia' ? `Found ${found}%` : `Owned ${list.length}`),
        h('button', { class: 'dib-arrow', disabled: page >= pages - 1, onClick: () => { page++; render(); } }, '▶')),
      h('button', { class: 'dib-plank', 'data-testid': 'book-switch', onClick: () => { mode = mode === 'pedia' ? 'mine' : 'pedia'; page = 0; render(); } },
        mode === 'pedia' ? 'My Monsters' : 'Monsterpedia'));
  };

  render();
  const book = h('div', { class: 'dib-book', style: { backgroundImage: 'url(assets/bg/book.jpg)' } },
    h('div', { class: 'dib-pagearea' },
      h('button', { class: 'dib-close', title: 'Close', onClick: () => { sfx('back'); close(); } }, '✕'),
      grid),
    side, footer);
  book.addEventListener('wheel', (e) => {
    const n = Math.ceil(entries().length / PER_PAGE);
    if (e.deltaY > 0 && page < n - 1) { page++; render(); } else if (e.deltaY < 0 && page > 0) { page--; render(); }
  });
  let sx = 0;
  book.addEventListener('pointerdown', (e) => (sx = e.clientX));
  book.addEventListener('pointerup', (e) => {
    const n = Math.ceil(entries().length / PER_PAGE);
    if (e.clientX - sx < -60 && page < n - 1) { page++; render(); } else if (e.clientX - sx > 60 && page > 0) { page--; render(); }
  });
  layer('book', book);
}
