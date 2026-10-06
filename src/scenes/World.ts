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

  /** Sea regions (reached by boat) are drawn off the coast with a dotted route to their dock. */
  seaRoutes(ox: number, oy: number, cw: number, ch: number, cur: { id: string }) {
    const { width } = this.scale;
    for (const r of data().regions.filter((x) => x.sea)) {
      const from = data().regions.find((x) => !x.sea && Math.abs(x.x - r.x) + Math.abs(x.y - r.y) === 1)!;
      const fx = ox + from.x * cw + cw * 0.85, fy = oy + from.y * ch + ch * 0.5;
      const tx = Math.min(width - 70, ox + 4 * cw + 50), ty = fy - 40;
      const g = this.add.graphics();
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = fx + (tx - fx) * t, y = fy + (ty - fy) * t - Math.sin(t * Math.PI) * 30;
        g.fillStyle(0xffffff, 0.9).fillCircle(x, y, 3);
      }
      const visited = S.visited.includes(r.id);
      const here = cur.id === r.id;
      const isle = this.add.circle(tx, ty, 46, here ? 0xf6c453 : 0x2a1f3d, here ? 0.35 : 0.55).setStrokeStyle(3, here ? 0xf6c453 : 0xffffff, 0.8).setInteractive({ useHandCursor: true });
      this.add.image(tx, ty - 6, 'town_dock').setScale(0.16);
      this.add.text(tx, ty + 28, r.name, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold', fontSize: '16px', color: '#fff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5);
      this.add.text(tx, ty + 46, `Lv ${r.levels[0]}–${r.levels[1]} · by boat`, { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', color: '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
      isle.on('pointerdown', () => {
        if (here) return toRegion();
        if (!visited) return toast(`Sail to ${r.name} from the dock in ${from.name}.`);
        const pier = maps()[r.id].spots.find((s) => s.kind === 'dock') ?? maps()[r.id].spots[0];
        S.location = { region: r.id, spot: pier.id };
        save();
        sfx('step');
        toRegion();
      });
    }
  }
  create() {
    music('world');
    const { width, height } = this.scale;
    coverBg(this, 'world', false);
    vignette(this, 0.4);
    this.cameras.main.fadeIn(400);
    // regions sit on the island itself (bounds measured from the map by tools/place_spots.py)
    const wb = (maps() as any)._world ?? { x0: 0, x1: 1, y0: 0.06, y1: 1 };
    const ox = wb.x0 * width, oy = wb.y0 * height;
    const cw = ((wb.x1 - wb.x0) * width) / 4, ch = ((wb.y1 - wb.y0) * height) / 4;
    const cur = data().regions.find((r) => r.id === S.location.region)!;
    this.seaRoutes(ox, oy, cw, ch, cur);
    for (const r of data().regions) {
      if (r.sea) continue;
      const x = ox + r.x * cw, y = oy + r.y * ch;
      const visited = S.visited.includes(r.id);
      const adjacent = Math.abs(r.x - cur.x) + Math.abs(r.y - cur.y) === 1;
      const here = r.id === cur.id;
      const rect = this.add.rectangle(x + cw / 2, y + ch / 2, cw - 4, ch - 4, here ? 0xf6c453 : 0x0b1020, here ? 0.22 : visited ? 0.01 : 0.3)
        .setStrokeStyle(2, here ? 0xf6c453 : 0xffffff, here ? 0.9 : 0.25).setInteractive({ useHandCursor: true });
      const t = this.add.text(x + cw / 2, y + ch / 2 - 10, r.name, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold', fontSize: '19px', color: here ? '#ffe9a8' : '#ffffff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5);
      this.add.text(x + cw / 2, y + ch / 2 + 14, `Lv ${r.levels[0]}–${r.levels[1]}${r.towns.length ? ' · ' + r.towns.join(', ') : ''}`, { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '13px', color: '#ffffff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
      const done = r.overlords.filter((o) => S.overlords.includes(o)).length;
      if (r.overlords.length) this.add.text(x + cw - 12, y + 10, done ? '🐲✔' : '🐲', { fontSize: '20px' }).setOrigin(1, 0);
      rect.on('pointerover', () => { rect.setFillStyle(0xf6c453, 0.22); t.setScale(1.06); });
      rect.on('pointerout', () => { rect.setFillStyle(here ? 0xf6c453 : 0x0b1020, here ? 0.22 : visited ? 0.01 : 0.3); t.setScale(1); });
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
