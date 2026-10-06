import Phaser from 'phaser';
import { coverBg, vignette } from './fx';
import { data, maps } from '../core/data';
import { S, save } from '../core/state';
import type { Region } from '../core/types';
import { hud, openMenu } from '../ui/menus';
import { h, layer, toast } from '../ui/dom';
import { music, sfx } from '../audio';
import { go, toRegion } from '../nav';

type Realm = 'isle' | 'frontier';
const REALMS: Record<Realm, { name: string; bg: string; bounds: string; blurb: string }> = {
  isle: { name: 'Dragon Isle', bg: 'world', bounds: '_world',
    blurb: 'Tap your current region to return, a neighbouring region to travel there, or any visited region to fast travel. Western lands are gentle; the east holds the fiercest monsters.' },
  frontier: { name: 'The Frontier', bg: 'world_frontier', bounds: '_world_frontier',
    blurb: 'A wild continent across the sea: frozen coasts and glaciers in the north-west, ash wastes and the Infernal Rift in the north-east, giant forests, graveyards and the Hellmouth in the south.' },
};
const realmOf = (r: Region): Realm => r.realm ?? 'isle';

export class WorldScene extends Phaser.Scene {
  constructor() { super('World'); }
  private realm: Realm = 'isle';

  init(d: { realm?: Realm }) {
    const cur = data().regions.find((r) => r.id === S.location.region)!;
    this.realm = d?.realm ?? realmOf(cur);
  }

  /** The other end of each boat route leaving this region, if it lies in another realm or out at sea. */
  private crossings(r: Region) {
    return (data().seaRoutes ?? []).filter((p) => p.includes(r.id)).map((p) => data().regions.find((x) => x.id === (p[0] === r.id ? p[1] : p[0]))!)
      .filter((o) => o && (o.sea || realmOf(o) !== realmOf(r)));
  }

  /** Sea regions (reached by boat) are drawn as islands off the coast of the realm they belong to. */
  seaIsles(ox: number, oy: number, cw: number, ch: number, cur: Region) {
    const { width } = this.scale;
    for (const r of data().regions.filter((x) => x.sea && realmOf(x) === this.realm)) {
      const from = data().regions.find((x) => !x.sea && realmOf(x) === this.realm && Math.abs(x.x - r.x) + Math.abs(x.y - r.y) === 1)!;
      const tx = Math.min(width - 70, ox + 4 * cw + 50), ty = oy + from.y * ch + ch * 0.5 - 40;
      const visited = S.visited.includes(r.id);
      const here = cur.id === r.id;
      const isle = this.add.circle(tx, ty, 46, here ? 0xf6c453 : 0x2a1f3d, here ? 0.35 : 0.55).setStrokeStyle(3, here ? 0xf6c453 : 0xffffff, 0.8).setInteractive({ useHandCursor: true });
      this.add.image(tx, ty - 6, 'town_dock').setScale(0.16);
      this.add.text(tx, ty + 28, r.name, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold', fontSize: '16px', color: '#fff', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5);
      this.add.text(tx, ty + 46, `Lv ${r.levels[0]}–${r.levels[1]} · by boat`, { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', color: '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
      isle.on('pointerdown', () => {
        if (here) return toRegion();
        if (!visited) return toast(`Sail to ${r.name} from the dock in ${from.name}.`);
        this.arriveAt(r, maps()[r.id].spots.find((s) => s.kind === 'dock') ?? maps()[r.id].spots[0]);
      });
    }
  }

  private arriveAt(r: Region, spot: { id: number }) {
    S.location = { region: r.id, spot: spot.id };
    if (!S.visited.includes(r.id)) S.visited.push(r.id);
    save();
    sfx('step');
    toRegion();
  }

  create() {
    music('world');
    const { width, height } = this.scale;
    const realm = REALMS[this.realm];
    coverBg(this, realm.bg, false);
    vignette(this, 0.4);
    this.cameras.main.fadeIn(400);
    // regions sit on the land itself (bounds measured from the map by tools/place_spots.py)
    const wb = (maps() as any)[realm.bounds] ?? { x0: 0, x1: 1, y0: 0.06, y1: 1 };
    const land = data().regions.filter((r) => !r.sea && realmOf(r) === this.realm);
    const cols = Math.max(...land.map((r) => r.x)) + 1, rows = Math.max(...land.map((r) => r.y)) + 1;
    const ox = wb.x0 * width, oy = wb.y0 * height;
    const cw = ((wb.x1 - wb.x0) * width) / cols, ch = ((wb.y1 - wb.y0) * height) / rows;
    const cur = data().regions.find((r) => r.id === S.location.region)!;
    this.seaIsles(ox, oy, cw, ch, cur);
    for (const r of land) {
      const x = ox + r.x * cw, y = oy + r.y * ch;
      const visited = S.visited.includes(r.id);
      const adjacent = realmOf(cur) === this.realm && !cur.sea && Math.abs(r.x - cur.x) + Math.abs(r.y - cur.y) === 1;
      const here = r.id === cur.id;
      const rect = this.add.rectangle(x + cw / 2, y + ch / 2, cw - 4, ch - 4, here ? 0xf6c453 : 0x0b1020, here ? 0.22 : visited ? 0.01 : 0.3)
        .setStrokeStyle(2, here ? 0xf6c453 : 0xffffff, here ? 0.9 : 0.25).setInteractive({ useHandCursor: true });
      const big = cols > 4 ? 17 : 19;
      const t = this.add.text(x + cw / 2, y + ch / 2 - 12, r.name, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold', fontSize: `${big}px`, color: here ? '#ffe9a8' : '#ffffff', stroke: '#000', strokeThickness: 5, align: 'center', wordWrap: { width: cw - 16 } }).setOrigin(0.5);
      const towns = r.towns.length ? `\n${r.towns.join(', ')}` : '';
      this.add.text(x + cw / 2, y + ch / 2 + 16, `Lv ${r.levels[0]}–${r.levels[1]}${towns}`, { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '13px', color: '#ffffff', stroke: '#000', strokeThickness: 4, align: 'center', wordWrap: { width: cw - 16 } }).setOrigin(0.5, 0);
      const done = r.overlords.filter((o) => S.overlords.includes(o)).length;
      if (r.overlords.length) this.add.text(x + cw - 12, y + 10, done ? '🐲✔' : '🐲', { fontSize: '20px' }).setOrigin(1, 0);
      const ports = this.crossings(r).filter((o) => !o.sea);
      if (ports.length) this.add.text(x + 12, y + 10, `⛵ ${ports.map((o) => o.name).join(', ')}`, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold', fontSize: '12px', color: '#bfe9ff', stroke: '#000', strokeThickness: 4 });
      rect.on('pointerover', () => { rect.setFillStyle(0xf6c453, 0.22); t.setScale(1.06); });
      rect.on('pointerout', () => { rect.setFillStyle(here ? 0xf6c453 : 0x0b1020, here ? 0.22 : visited ? 0.01 : 0.3); t.setScale(1); });
      rect.on('pointerdown', () => {
        if (here) return toRegion();
        if (!visited && !adjacent) {
          const port = this.realm === 'frontier' ? 'Sail to the Frontier from a dock on the Dragon Isle, then travel overland.' : 'Travel overland through neighbouring regions to reach this area.';
          return toast(port);
        }
        // fast travel: arrive at the exit facing where we came from, or the town
        const m = maps()[r.id];
        const town = m.spots.find((s) => s.kind === 'town');
        const entry = m.spots.find((s) => s.kind === 'exit' && s.ref === cur.id) ?? town ?? m.spots[0];
        if (!visited && r.levels[0] > Math.max(...S.party.map((p) => p.level)) + 12) toast(`Careful — monsters in ${r.name} are around Lv ${r.levels[0]}!`);
        this.arriveAt(r, visited && town ? town : entry);
      });
    }
    const frontierOpen = data().regions.some((r) => realmOf(r) === 'frontier' && S.visited.includes(r.id));
    const tab = (k: Realm) => h('button', {
      class: `btn small ${this.realm === k ? 'gold' : ''}`,
      onClick: () => {
        if (k === this.realm) return;
        if (k === 'frontier' && !frontierOpen) return toast('The Frontier lies across the sea. Board a boat at the dock in Forest of Mangal or Endergate.');
        go('World', { realm: k });
      },
    }, `${k === 'frontier' && !frontierOpen ? '🔒 ' : ''}${REALMS[k].name}`);
    const refresh = () => hud((k) => openMenu(k, refresh), [h('button', { class: 'btn small gold', onClick: () => toRegion() }, '⬅ Back to region')]);
    refresh();
    layer('scene', h('div', {},
      h('div', { class: 'realm-tabs' }, tab('isle'), tab('frontier')),
      h('div', { class: 'region-info panel', style: { width: '22em' } }, h('b', {}, realm.name), h('div', { class: 'muted' }, realm.blurb))));
  }
}
