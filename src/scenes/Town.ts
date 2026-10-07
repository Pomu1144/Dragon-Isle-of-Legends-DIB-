import Phaser from 'phaser';
import { data, maps, region, regionByName, species, speciesByName, spriteUrl, town as townData } from '../core/data';
import { S, save, buildQuest, questDone, questEvent, heroLevel, rollGem, findMon, allMonsters, fuse, partySize } from '../core/state';
import { arenaEncounter, breederTeam } from '../core/encounters';
import { h, layer, modal, toast, dialogue, confirmBox, stars, fill } from '../ui/dom';
import { hud, openMenu, questGoalText, openEgg, monCard, elChip } from '../ui/menus';
import { music, sfx } from '../audio';
import { toRegion, toTown } from '../nav';
import { fight } from '../flow';
import { Rng } from '../core/rng';
import { displayName } from '../core/monster';
import { loadMap } from './Boot';

export class TownScene extends Phaser.Scene {
  constructor() { super('Town'); }
  private name = '';
  init(d: { name: string }) { this.name = d.name; }

  create() {
    music('town');
    this.cameras.main.fadeIn(400);
    const t = townData(this.name)!;
    const reg = regionByName(t.region)!;
    const spot = maps()[reg.id].spots.find((s) => s.kind === 'town' && s.ref === this.name);
    if (spot) { S.location = { region: reg.id, spot: spot.id }; S.lastTown = { ...S.location }; }
    questEvent('visit', this.name);
    save();
    loadMap(this, reg.id, () => this.drawTown(reg.id, spot ? { x: spot.x, y: spot.y } : { x: 0.5, y: 0.5 }));
    this.render();
    const ready = S.quests.filter(questDone).filter((q) => q.town === this.name);
    if (ready.length) toast(`${ready.length} quest(s) ready to turn in at the Guild!`, 'assets/ui/orig/bk/btn_scroll.png');
  }

  /**
   * The town is shown the way the original does it: the region map zoomed in on the town, with
   * the town's buildings and their round emblems standing on it (layout from the original's
   * 480x360 town screen; art from the original sprite sheet).
   */
  drawTown(regionId: string, at: { x: number; y: number }) {
    const { width, height } = this.scale;
    const bg = this.add.image(0, 0, `map_${regionId}`).setOrigin(0, 0);
    const zoom = Math.max(width / bg.width, height / bg.height) * 2.3;
    bg.setScale(zoom);
    bg.x = Phaser.Math.Clamp(width / 2 - at.x * bg.width * zoom, width - bg.width * zoom, 0);
    bg.y = Phaser.Math.Clamp(height / 2 - at.y * bg.height * zoom, height - bg.height * zoom, 0);
    const K = height / 360, OX = (width - 480 * K) / 2;   // reference 480x360 -> world
    const PIECE = 0.44 * K;                                // sheet art is drawn at 0.44x in the reference
    const t = townData(this.name)!;
    const put = (key: string, x: number, y: number, fn?: () => void, label?: string, depth = 10) => {
      const img = this.add.image(OX + x * K, y * K, `town_${key}`).setScale(PIECE).setDepth(depth + y / 100);
      if (label) this.add.text(img.x, img.y + img.displayHeight * 0.38, label, { fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold', fontSize: `${6.6 * K}px`, color: '#ffffff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(img.depth + 0.01);
      if (fn) {
        img.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 40 });
        img.on('pointerover', () => img.setTint(0xfff2c8)).on('pointerout', () => img.clearTint());
        img.on('pointerdown', () => { sfx('select'); fn(); });
      }
      return img;
    };
    // scenery
    put('trees', 200, 52, undefined, undefined, 2);
    put('bigtree', 92, 262, undefined, undefined, 2);
    put('farm', 332, 258, undefined, undefined, 2);
    put('bushes', 395, 305, undefined, undefined, 2);
    // buildings, positioned as in the original town screen
    put('hero', 213, 100, () => openMenu('hero', () => this.render()));
    put('shop', 140, 152, () => this.shop());
    put('leave', 55, 190, () => toRegion());
    put('warp_house', 255, 203, () => this.warp());
    // the emblem art is cropped flat at the bottom: it sits behind the roof, and a mask rounds off the corners the roof misses
    const em = put('warp_emblem', 252, 166, () => this.warp(), undefined, 9);
    const es = em.scaleX, ex = em.x - em.displayWidth / 2, ey = em.y - em.displayHeight / 2;
    em.setMask(this.make.graphics({}, false).fillStyle(0xffffff).fillRect(ex, ey, 124 * es, 62 * es).fillEllipse(ex + 62 * es, ey + 62 * es, 124 * es, 62 * es).createGeometryMask());
    put('monsterpedia', 180, 242, () => openMenu('pedia', () => this.render()));
    put('monsters', 245, 300, () => openMenu('team', () => this.render()));
    put('house_a', 332, 116, () => this.guild(), 'Guild');
    put('house_b', 332, 205, () => this.lab(), 'Recipe Lab');
    if (t.arena) put('emblem_house', 412, 165, () => this.arena(), 'Arena');
    if (t.tournament) put('signpost', 420, 248, () => this.tournament(), 'Tournament');
  }

  render() {
    const t = townData(this.name)!;
    const refresh = () => this.render();
    hud((k) => openMenu(k, refresh));
    const ready = S.quests.filter((q) => q.town === this.name && questDone(q)).length;
    layer('scene', h('div', {},
      h('div', { class: 'town-name' }, this.name, ready ? h('span', { class: 'chip gold', style: { marginLeft: '.5em' } }, h('img', { class: 'chip-ic', src: 'assets/ui/orig/bk/btn_scroll.png', alt: '' }), `${ready} ready at the Guild`) : null),
      h('div', { class: 'town-sub' }, t.region)));
  }

  // ---------------------------------------------------------------- Guild
  guild() {
    const t = townData(this.name)!;
    const root = h('div', { class: 'col' });
    const render = () => {
      const mine = S.quests.filter((q) => q.town === this.name);
      const offers = t.quests.map((_, i) => i).filter((i) => !S.questsDone.includes(`${this.name}#${i}`) && !S.quests.some((q) => q.id === `${this.name}#${i}`));
      fill(root, 
        h('div', { class: 'row' }, h('b', {}, `Active quests ${S.quests.length}/3`), h('span', { class: 'grow' }), h('span', { class: 'muted' }, `Completed: ${S.questCount}`)),
        ...mine.map((q) => h('div', { class: 'abil col' },
          h('div', { class: 'row' }, h('b', {}, q.title), h('span', { class: 'chip' }, q.type), h('span', { class: 'grow' }),
            questDone(q) ? h('button', { class: 'btn small gold', onClick: () => { this.turnIn(q.id); render(); } }, 'Turn in') :
              h('button', { class: 'btn small', onClick: () => { S.quests = S.quests.filter((x) => x !== q); save(); render(); } }, 'Drop')),
          h('div', { class: 'muted' }, q.text), h('div', {}, questGoalText(q)))),
        h('h3', {}, 'Requests'),
        ...offers.slice(0, 6).map((i) => {
          const q = buildQuest(this.name, i);
          return h('div', { class: 'abil col' },
            h('div', { class: 'row' }, h('b', {}, q.title), h('span', { class: 'chip' }, q.type), h('span', { class: 'grow' }),
              h('span', { class: 'muted' }, `Reward: ${q.reward.silver} silver${q.reward.gold ? ` + ${q.reward.gold} gold` : ''}${q.reward.egg ? ' + Egg' : ''}`),
              h('button', { class: 'btn small green', disabled: S.quests.length >= 3, onClick: () => { S.quests.push(q); save(); sfx('select'); render(); } }, 'Accept')),
            h('div', { class: 'muted' }, q.text), h('div', {}, questGoalText(q)));
        }),
        offers.length ? null : h('p', { class: 'muted' }, 'The Guild here has no more requests. Try other towns!'));
    };
    render();
    modal(`${this.name} Guild`, root, { width: '56em', onClose: () => this.render() });
  }

  turnIn(id: string) {
    const q = S.quests.find((x) => x.id === id)!;
    S.quests = S.quests.filter((x) => x !== q);
    S.questsDone.push(id);
    S.questCount++;
    S.silver += q.reward.silver;
    if (q.reward.gold) S.gold += q.reward.gold;
    if (q.reward.egg) S.items.egg++;
    sfx('coin');
    toast(`Quest complete! +${q.reward.silver} silver${q.reward.gold ? `, +${q.reward.gold} gold` : ''}${q.reward.egg ? ', +1 Egg' : ''}`);
    save();
  }

  // ---------------------------------------------------------------- Shop
  shop() {
    const root = h('div', { class: 'col' });
    const buy = (cost: number, cur: 'silver' | 'gold', fn: () => void) => {
      if (S[cur] < cost) return toast(`Not enough ${cur}.`);
      S[cur] -= cost;
      fn();
      sfx('coin');
      save();
      render();
    };
    const gemShape = (n: string) => (['Oval', 'Square', 'Tear', 'Star'].find((s) => n.includes(s)) ?? 'Oval') as 'Oval';
    const render = () => {
      const items = data().shop.map((it) => {
        let act: () => void = () => {};
        if (/^card$/i.test(it.item)) act = () => (S.items.card += 1);
        else if (/silver card/i.test(it.item)) act = () => (S.items.silver += 1);
        else if (/gold card/i.test(it.item)) act = () => (S.items.gold += 1);
        else if (/gem/i.test(it.item)) act = () => { const g = rollGem(gemShape(it.item), /imbued/i.test(it.item)); S.gems.push(g); toast(`Got a ${g.shape} gem!`); };
        else if (/golden egg/i.test(it.item)) act = () => (S.items.golden += 1);
        else if (/egg/i.test(it.item)) act = () => (S.items.egg += 1);
        else return null;
        // non-breaking hyphens: names wrap only at spaces
        return h('tr', {}, h('td', {}, h('b', {}, it.item.replace(/-/g, '\u2011'))), h('td', { class: 'muted' }, it.desc),
          h('td', { style: { whiteSpace: 'nowrap' } }, `${it.price.toLocaleString()} ${it.currency}`),
          h('td', {}, h('button', { class: 'btn small gold', disabled: S[it.currency] < it.price, onClick: () => buy(it.price, it.currency, act) }, 'Buy')),
          /card$/i.test(it.item) ? h('td', {}, h('button', { class: 'btn small gold', disabled: S[it.currency] < it.price * 10, onClick: () => buy(it.price * 10, it.currency, () => { for (let i = 0; i < 10; i++) act(); }) }, '×10')) : h('td', {}));
      }).filter(Boolean) as HTMLElement[];
      const eggRow = (n: string, price: number, fn: () => void) => h('tr', {}, h('td', {}, h('b', {}, n)), h('td', { class: 'muted' }, n === 'Egg' ? 'Spin the wheel for monsters and items.' : 'Rare monsters you have not caught yet, including hatchlings.'),
        h('td', { style: { whiteSpace: 'nowrap' } }, `${price} gold`), h('td', {}, h('button', { class: 'btn small gold', disabled: S.gold < price, onClick: () => buy(price, 'gold', fn) }, 'Buy')), h('td', {}));
      fill(root, 
        h('div', { class: 'row' }, h('span', { class: 'coin' }), h('b', {}, S.silver.toLocaleString()), h('span', { class: 'coin g' }), h('b', {}, S.gold.toLocaleString()),
          h('span', { class: 'grow' }), h('span', { class: 'muted' }, `Cards: ${S.items.card} · Silver ${S.items.silver} · Gold ${S.items.gold} · Eggs ${S.items.egg}/${S.items.golden}`)),
        h('table', { class: 'list', style: '--cols: minmax(7em, 1.3fr) 3fr auto auto 3.6em' }, ...items,
          data().shop.some((x) => /egg/i.test(x.item)) ? null : eggRow('Egg', 30, () => (S.items.egg += 1)),
          data().shop.some((x) => /golden egg/i.test(x.item)) ? null : eggRow('Golden Egg', 100, () => (S.items.golden += 1)),
          h('tr', {}, h('td', {}, h('b', {}, 'Exchange')), h('td', { class: 'muted' }, 'Trade 1,000 silver for 5 gold.'), h('td', { style: { whiteSpace: 'nowrap' } }, '1,000 silver'),
            h('td', {}, h('button', { class: 'btn small gold', disabled: S.silver < 1000, onClick: () => buy(1000, 'silver', () => (S.gold += 5)) }, 'Trade')), h('td', {}))),
        h('div', { class: 'row' }, S.items.egg ? h('button', { class: 'btn gold', onClick: () => openEgg('egg', render) }, `Open Egg (${S.items.egg})`) : null,
          S.items.golden ? h('button', { class: 'btn gold', onClick: () => openEgg('golden', render) }, `Open Golden Egg (${S.items.golden})`) : null));
    };
    render();
    modal(`${this.name} Shop`, root, { width: '58em', onClose: () => this.render() });
  }

  // ---------------------------------------------------------------- Lab
  lab() {
    const root = h('div', { class: 'col' });
    const render = () => {
      const owned = allMonsters();
      fill(root, h('p', { class: 'muted' }, 'Fuse two monsters (each Lv 15+) following a recipe to create a stronger species. Both ingredients are consumed. Recipes come straight from the Dragon Island Blue wiki.'),
        ...data().recipes.map((r) => {
          const a = owned.filter((m) => species(m.species).name === r.parts[0] && m.level >= 15).sort((x, y) => y.level - x.level);
          const b = owned.filter((m) => species(m.species).name === r.parts[1] && m.level >= 15).sort((x, y) => y.level - x.level);
          const pa = a[0], pb = b.find((m) => m !== pa);
          const res = speciesByName(r.result)!;
          const known = (n: string) => S.seen.includes(speciesByName(n)!.id);
          const img = (n: string) => h('img', { src: spriteUrl(speciesByName(n)!), style: { height: '3em', filter: known(n) ? '' : 'brightness(0) opacity(.4)' } });
          return h('div', { class: 'abil row' }, img(r.parts[0]), h('b', {}, '+'), img(r.parts[1]), h('b', {}, '='), img(r.result),
            h('div', { class: 'col grow', style: { gap: '0' } }, h('b', {}, `${r.parts[0]} + ${r.parts[1]} → ${r.result}`), h('span', { class: 'row' }, elChip(res.element), stars(res.stars))),
            h('button', { class: 'btn small gold', disabled: !(pa && pb), onClick: async () => {
              if (!(await confirmBox(`Fuse ${displayName(pa)} (Lv ${pa.level}) and ${displayName(pb!)} (Lv ${pb!.level}) into ${r.result}?`, 'Fuse'))) return;
              if (S.party.length <= 2 && S.party.includes(pa) && S.party.includes(pb!) && allMonsters().length <= 2) return toast('You need at least one other monster.');
              const m = fuse(pa.uid, pb!.uid, r.result);
              if (m) { sfx('evolve'); toast(`${r.result} was born!`); save(); render(); }
            } }, pa && pb ? 'Fuse' : 'Need both'));
        }));
    };
    render();
    modal('Recipe Lab', root, { width: '52em', onClose: () => this.render() });
  }

  // ---------------------------------------------------------------- Warp
  warp() {
    const towns = data().towns.filter((t) => S.visited.includes(regionByName(t.region)!.id) && t.name !== this.name);
    modal('Warp Gate', (close) => h('div', { class: 'col' }, h('p', { class: 'muted' }, 'Instantly travel to any town in a region you have visited. 20 silver per warp.'),
      ...towns.map((t) => h('button', { class: 'btn', onClick: () => {
        if (S.silver < 20) return toast('Not enough silver');
        S.silver -= 20;
        const reg = regionByName(t.region)!;
        const s = maps()[reg.id].spots.find((x) => x.kind === 'town' && x.ref === t.name)!;
        S.location = { region: reg.id, spot: s.id };
        save();
        close();
        sfx('magic');
        toTown(t.name);
      } }, `${t.name} — ${t.region}`)),
      towns.length ? null : h('p', {}, 'Explore more regions to unlock warp destinations.')), { width: '30em' });
  }

  // ---------------------------------------------------------------- Arena
  arena() {
    const next = S.license + 1;
    const lic = data().licenses[next];
    const body = h('div', { class: 'col' },
      h('p', {}, 'The Guild arena tests breeders for their licenses. Each license raises your party size and unlocks gem slots.'),
      lic ? h('div', { class: 'abil col' }, h('b', {}, `Next: ${lic.name} License`), h('div', { class: 'muted' }, lic.text),
        h('div', {}, `Requires Hero Lv ${lic.heroLevel} (you: ${heroLevel()}) and ${lic.quests} completed quests (you: ${S.questCount}).`),
        h('button', { class: 'btn gold', disabled: heroLevel() < lic.heroLevel || S.questCount < lic.quests, onClick: async () => {
          await dialogue([{ who: next % 2 ? 'Arena Master May' : 'Arena Master Herald', text: `So you seek the ${lic.name} license? Show me your bond with your monsters!` }]);
          fight(arenaEncounter(next), (r) => {
            if (r.outcome === 0) { S.license = next; save(); toast(`${lic.name} License earned! Party size is now ${partySize()}.`); }
            toTown(this.name);
          });
        } }, 'Take the test')) : h('p', {}, 'You hold the highest license — Grandmaster!'));
    modal('Arena', body, { width: '40em' });
  }

  // ---------------------------------------------------------------- Tournament
  tournament() {
    const CLASSES = ['J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
    const S2 = S as typeof S & { tourney?: number };
    const cls = S2.tourney ?? 0;
    const sorted = data().regions.slice().sort((a, b) => a.tier - b.tier);
    const body = h('div', { class: 'col' },
      h('p', {}, 'Battle through the tournament classes. Every win awards an egg; the final classes award Golden Eggs.'),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, ...CLASSES.map((c, i) => h('span', { class: `chip ${i < cls ? 'good' : i === cls ? 'gold' : ''}` }, `${c} class`))),
      cls < CLASSES.length ? h('button', { class: 'btn gold', onClick: () => {
        const reg = sorted[Math.min(15, Math.round(cls * 1.45))];
        const team = breederTeam(reg.id, new Rng(cls * 977), 3 + Math.floor(cls / 2), 4);
        fight({ kind: 'arena', name: `${CLASSES[cls]}-class champion`, team, bg: 'arena', capturable: false, canFlee: false,
          reward: { silver: 300 * (cls + 1), egg: cls >= 8 ? 'golden' : 'egg' }, intro: `Tournament — ${CLASSES[cls]} class` }, (r) => {
          if (r.outcome === 0) { S2.tourney = cls + 1; save(); toast(`${CLASSES[cls]} class cleared!`); }
          toTown(this.name);
        });
      } }, `Fight the ${CLASSES[cls]} class`) : h('p', {}, 'Tournament champion!'));
    modal('Tournament', body, { width: '40em' });
    void region; void findMon; void monCard;
  }
}
