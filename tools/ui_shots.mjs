// Screenshot every UI screen for visual review: node tools/ui_shots.mjs OUT_DIR [baseUrl]
// Needs the dev server (npm run dev) — it drives the game through the DEV-only window.__* hooks.
import { chromium } from '@playwright/test';
import fs from 'fs';
const OUT = process.argv[2] ?? 'shots';
const BASE = process.argv[3] ?? 'http://127.0.0.1:5173/';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-webgl'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (name) => { await p.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); };
const ev = (fn, arg) => p.evaluate(fn, arg);
const closeModals = () => ev(() => window.__dom.closeAllModals());

await p.goto(BASE); await wait(3000);
await shot('01_title');
await p.click('text=New Game'); await wait(600);
await shot('02_new_game');
await p.click('text=Begin Adventure'); await wait(800);
await shot('03_dialogue');
for (let i = 0; i < 6; i++) { await p.click('.dlg').catch(() => {}); await wait(200); }
await wait(1500);
// give the save some content so menus are populated
await ev(() => { const S = window.__state.S; S.items.egg = 2; S.items.golden = 1; S.silver = 4200; S.gold = 55; });
await shot('04_town');
await p.click('.m-btn').catch(() => {}); await wait(400);
await shot('05_m_menu');
await p.click('.m-btn').catch(() => {}); await wait(200);
const town = (m) => ev((m) => window.__game.scene.getScene('Town')[m](), m);
for (const [m, n] of [['guild', '06_guild'], ['shop', '07_shop'], ['lab', '08_lab'], ['warp', '09_warp'], ['arena', '10_arena']]) {
  await town(m).catch(() => {}); await wait(600); await shot(n); await closeModals(); await wait(200);
}
const menu = (k) => ev((k) => { const M = window.__menus; ({ team: () => M.teamMenu(() => {}), bag: () => M.bagMenu(() => {}), quests: () => M.questsMenu(), hero: () => M.heroMenu(() => {}), system: () => M.systemMenu(), pedia: () => M.pediaMenu() })[k](); }, k);
for (const k of ['team', 'bag', 'quests', 'hero', 'system', 'pedia']) { await menu(k).catch((e) => errors.push(String(e))); await wait(600); await shot(`11_menu_${k}`); await closeModals(); await wait(200); }
await menu('team'); await wait(500); await p.click('.mcard').catch(() => {}); await wait(500); await shot('12_monster_selected'); await closeModals();
await ev(() => { void window.__dom.promptBox('Rename', 'Nickname', 'Fire Hatchling', 16); }); await wait(500); await shot('13b_prompt'); await closeModals();
await ev(() => { void window.__dom.confirmBox('Battle the Dragon Overlord Arashi? (a Drake of immense power)', 'Fight!'); }); await wait(500); await shot('13_confirm'); await closeModals();
await ev(() => { window.__dom.toast('🧰 You opened a treasure chest: 3 Capture Cards!'); window.__dom.toast('Quest target defeated!'); }); await wait(500); await shot('14_toast');
await ev(() => { window.__menus.openEgg('egg', () => {}); }); await wait(900); await shot('15_egg'); await closeModals(); await wait(300);
await ev(() => { window.__nav.toRegion(); }); await wait(4000); await shot('16_region');
await ev(() => { window.__nav.toWorld(); }); await wait(4500); await shot('17_world');
await ev(() => { window.__flow.fight(window.__enc.wildEncounter('southern_alvalon', 3)); }); await wait(5000); await shot('18_battle');
await ev(() => { const sc = window.__game.scene.getScene('Battle'); sc.battleMenu?.(); }); await wait(600); await shot('19_battle_menu');
await ev(() => { window.__nav.toDungeon("No Man's Castle", 1); }); await wait(3500); await shot('20_dungeon');
console.log('ERRORS', JSON.stringify(errors));
await b.close();
