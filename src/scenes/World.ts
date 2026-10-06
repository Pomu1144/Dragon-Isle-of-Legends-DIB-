import Phaser from 'phaser';
import { coverBg, vignette } from './fx';
import { data, maps } from '../core/data';
import { S, save } from '../core/state';
import { hud, openMenu } from '../ui/menus';
import { h, layer, toast } from '../ui/dom';
import { music, sfx } from '../audio';
import { go, toRegion } from '../nav';

export class WorldScene extends Phaser.Scene {
  constructor() { super('World'); }
  create() {
    music('world');
    const { width, height } = this.scale;
    coverBg(this, 'world', false);
    vignette(this, 0.4);
    this.cameras.main.fadeIn(400);
    const cw = width / 4, ch = (height - 40) / 4;
    const cur = data().regions.find((r) => r.id === S.location.region)!;
    for (const r of data().regions) {
      const x = r.x * cw, y = 40 + r.y * ch;
      const visited = S.visited.includes(r.id);
      const adjacent = Math.abs(r.x - cur.x) + Math.abs(r.y - cur.y) === 1;
      const here = r.id === cur.id;
      const rect = this.add.rectangle(x + cw / 2, y + ch / 2, cw - 6, ch - 6, here ? 0xf6c453 : 0x0b1020, here ? 0.18 : visited ? 0.05 : 0.38)
        .setStrokeStyle(2, here ? 0xf6c453 : 0xffffff, here ? 0.9 : 0.25).setInteractive({ useHandCursor: true });
      const t = this.add.text(x + cw / 2, y + ch / 2 - 12, r.name, { fontFamily: 'Cinzel, serif', fontSize: '24px', color: here ? '#ffe9a8' : '#ffffff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5);
      this.add.text(x + cw / 2, y + ch / 2 + 18, `Lv ${r.levels[0]}–${r.levels[1]}${r.towns.length ? ' · ' + r.towns.join(', ') : ''}`, { fontFamily: 'Nunito', fontSize: '15px', color: '#dfe6ff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
      const done = r.overlords.filter((o) => S.overlords.includes(o)).length;
      if (r.overlords.length) this.add.text(x + cw - 12, y + 10, done ? '🐲✔' : '🐲', { fontSize: '20px' }).setOrigin(1, 0);
      rect.on('pointerover', () => { rect.setFillStyle(0xf6c453, 0.22); t.setScale(1.06); });
      rect.on('pointerout', () => { rect.setFillStyle(here ? 0xf6c453 : 0x0b1020, here ? 0.18 : visited ? 0.05 : 0.38); t.setScale(1); });
      rect.on('pointerdown', () => {
        if (here) return toRegion();
        if (!visited && !adjacent) return toast('Travel overland through neighbouring regions to reach this area.');
        if (adjacent || visited) {
          // fast travel: arrive at the exit facing where we came from, or the town
          const m = maps()[r.id];
          const town = m.spots.find((s) => s.kind === 'town');
          const entry = m.spots.find((s) => s.kind === 'exit' && s.ref === cur.id) ?? town ?? m.spots[0];
          if (!visited && r.levels[0] > Math.max(...S.party.map((p) => p.level)) + 12) toast(`Careful — monsters in ${r.name} are around Lv ${r.levels[0]}!`);
          S.location = { region: r.id, spot: (visited && town ? town : entry).id };
          if (!S.visited.includes(r.id)) S.visited.push(r.id);
          save();
          sfx('step');
          toRegion();
        }
      });
    }
    const refresh = () => hud((k) => openMenu(k, refresh), [h('button', { class: 'btn small gold', onClick: () => toRegion() }, '⬅ Back to region')]);
    refresh();
    layer('scene', h('div', { class: 'region-info panel', style: { width: '22em' } }, h('b', {}, 'World Map'),
      h('div', { class: 'muted' }, 'Tap your current region to return, a neighbouring region to travel there, or any visited region to fast travel. Western lands are gentle; the east holds the fiercest monsters.')));
    void go;
  }
}
