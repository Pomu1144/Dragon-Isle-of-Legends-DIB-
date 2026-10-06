import { sfx } from '../audio';

export const ui = () => document.getElementById('ui')!;

type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), (e) => { if (k === 'onClick') sfx('select'); v(e); });
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return el;
}

export function clearLayer(name: string) { document.querySelectorAll(`[data-layer="${name}"]`).forEach((e) => e.remove()); }
export function layer(name: string, el: HTMLElement) {
  clearLayer(name);
  el.dataset.layer = name;
  ui().append(el);
  return el;
}

export function toast(msg: string) {
  let wrap = document.querySelector('.toast-wrap') as HTMLElement;
  if (!wrap) ui().append((wrap = h('div', { class: 'toast-wrap' })));
  const t = h('div', { class: 'toast' }, msg);
  wrap.append(t);
  setTimeout(() => t.remove(), 2900);
}

let modalStack: HTMLElement[] = [];
export function modal(title: string, body: HTMLElement | ((close: () => void) => HTMLElement), opts: { width?: string; onClose?: () => void; actions?: HTMLElement[] } = {}) {
  const close = () => {
    back.remove();
    modalStack = modalStack.filter((m) => m !== back);
    opts.onClose?.();
  };
  const content = typeof body === 'function' ? body(close) : body;
  const box = h('div', { class: 'modal panel', style: opts.width ? { width: opts.width } : undefined },
    h('header', {}, h('h2', {}, title), h('div', { class: 'grow' }), ...(opts.actions ?? []), h('button', { class: 'btn small', onClick: () => { sfx('back'); close(); } }, '✕')),
    h('div', { class: 'body' }, content));
  const back = h('div', { class: 'modal-back' }, box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  ui().append(back);
  modalStack.push(back);
  return close;
}
export const anyModal = () => modalStack.length > 0;
export function closeAllModals() { modalStack.forEach((m) => m.remove()); modalStack = []; }

export function confirmBox(msg: string, yes: string = 'Yes'): Promise<boolean> {
  return new Promise((res) => {
    let done = false;
    const close = modal('Confirm', (c) => h('div', { class: 'col' }, h('p', {}, msg), h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onClick: () => { done = true; c(); res(false); } }, 'Cancel'),
      h('button', { class: 'btn gold', onClick: () => { done = true; c(); res(true); } }, yes))), { width: '28em', onClose: () => !done && res(false) });
    void close;
  });
}

export function dialogue(lines: { who?: string; text: string }[]): Promise<void> {
  return new Promise((res) => {
    let i = 0;
    const box = h('div', { class: 'dlg panel' });
    const show = () => {
      if (i >= lines.length) { box.remove(); res(); return; }
      const l = lines[i++];
      box.replaceChildren(l.who ? h('div', { class: 'who' }, l.who) : '', h('div', {}, l.text), h('div', { class: 'muted', style: { textAlign: 'right', fontSize: '.8em' } }, '▼ tap'));
    };
    box.addEventListener('click', () => { sfx('select'); show(); });
    layer('dialogue', box);
    show();
  });
}

export const starsHtml = (n: number) => '★'.repeat(Math.floor(n)) + (n % 1 ? '½' : '');

/** replaceChildren that tolerates null/false entries. */
export function fill(el: HTMLElement, ...kids: (Child | Child[])[]) {
  el.replaceChildren(...(kids.flat().filter((k) => k != null && k !== false) as (Node | string)[]));
  return el;
}
