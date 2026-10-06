import Phaser from 'phaser';
import { coverBg, ambient, vignette } from './fx';
import { h, layer, modal, dialogue, toast } from '../ui/dom';
import { hasSave, load, newGame, S, STARTERS } from '../core/state';
import { speciesByName, spriteUrl } from '../core/data';
import { music, sfx, setAudio, unlockAudio } from '../audio';
import { toRegion, toTown } from '../nav';
import { elChip } from '../ui/menus';

export class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }
  create() {
    coverBg(this, 'title');
    ambient(this, 0xffd28a, 40);
    vignette(this, 0.6);
    this.cameras.main.fadeIn(900);
    const start = () => { unlockAudio(); music('title'); };
    const cont = hasSave();
    layer('title', h('div', { class: 'title-screen' },
      h('div', { class: 'logo' }, h('h1', {}, 'Dragon Isle of Legends'), h('div', { class: 'sub' }, 'A DRAGON ISLAND BLUE REBUILD')),
      h('div', { class: 'row' },
        cont ? h('button', { class: 'btn gold', style: { fontSize: '1.3em', padding: '.6em 2em' }, onClick: () => { start(); if (load()) { setAudio(S.settings.music, S.settings.sfx); toRegion(); } } }, 'Continue') : null,
        h('button', { class: `btn ${cont ? '' : 'gold'}`, style: { fontSize: '1.3em', padding: '.6em 2em' }, onClick: () => { start(); this.newGameDialog(); } }, 'New Game')),
      h('div', { class: 'muted', style: { textShadow: '0 1px 4px #000' } }, '224 monsters · 16 regions · 13 dungeons · 12 Dragon Overlords')));
  }

  newGameDialog() {
    let pick = STARTERS[0];
    let name = 'Rowan';
    const grid = h('div', { class: 'starter-grid' });
    const render = () => grid.replaceChildren(...STARTERS.map((n) => {
      const sp = speciesByName(n)!;
      return h('div', { class: `starter panel ${pick === n ? 'sel' : ''}`, onClick: () => { pick = n; render(); } },
        h('img', { src: spriteUrl(sp) }), h('div', { style: { fontWeight: '800' } }, n), elChip(sp.element));
    }));
    render();
    modal('A New Legend', (close) => h('div', { class: 'col' },
      h('p', {}, 'Every breeder on Dragon Island begins with a dragon hatchling. Choose your partner — its element shapes your early battles.'),
      grid,
      h('div', { class: 'row' }, h('span', {}, 'Your name'), h('input', { class: 'text', value: name, maxlength: '14', onInput: (e: Event) => (name = (e.target as HTMLInputElement).value) }),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn gold', onClick: async () => {
          if (!name.trim()) return toast('Enter a name');
          close();
          newGame(name.trim(), pick);
          sfx('levelup');
          await dialogue([
            { who: 'Old Sage', text: `Welcome to Dragon Island, ${S.hero}. Monsters roam every corner of this land, and breeders like you tame them.` },
            { who: 'Old Sage', text: `Your ${pick} has chosen you. Raise it well — at level 6 it will become a Dragonling, and one day a mighty Wyrm.` },
            { who: 'Old Sage', text: 'Twelve Dragon Overlords rule the regions of this island. Grow strong, earn your Guild license, and challenge them.' },
            { who: 'Old Sage', text: 'Begin at the Guild in Corova. Weaken wild monsters and throw Capture Cards to recruit them. Good luck!' },
          ]);
          toRegion();
          toTown('Corova');
        } }, 'Begin Adventure'))), { width: '48em' });
  }
}
