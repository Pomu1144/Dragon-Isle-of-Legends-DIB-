# Dragon Isle of Legends

A from-scratch browser rebuild of the 2012 mobile monster-taming RPG **Dragon Island Blue**, in TypeScript with Phaser 3 and Vite.
Game data and monster art come from a scrape of the [Dragon Island Blue Fandom wiki](https://dragonislandblue.fandom.com); the screens are rebuilt after the original game's UI kits and screenshots (`tools/ref_ui/`).

![stack](https://img.shields.io/badge/Phaser-3.90-blue) ![ts](https://img.shields.io/badge/TypeScript-strict-3178c6) ![vite](https://img.shields.io/badge/Vite-8-646cff)

## Run, build, test

```bash
npm install
npm run dev         # http://localhost:5173
npm run typecheck   # tsc --noEmit
npm test            # vitest: battle engine, balance, dungeon save points, town layouts, walk grid
npm run build       # typecheck + static build in dist/ (relative asset paths, deployable anywhere)
node tools/ui_shots.mjs OUT_DIR   # with the dev server running: screenshots every screen (Playwright)
```

**GitHub Pages.** `.github/workflows/pages.yml` tests, builds and deploys `dist/` on every push to `main` (CI on other branches and PRs runs typecheck, tests and build). For the deploy to work, the repository's **Settings → Pages → Source** must be set to **"GitHub Actions"**.

## The game

| | |
| --- | --- |
| **Loading screen** | Rebuilt like the original's: the Dragon Isle cropped from the painted world map, the cracked title plaque and HD monsters around it, as plain HTML in `index.html` so it shows before any script loads |
| **Monsters** | All 224 wiki monsters (sprites, element, stars, stats, abilities, evolution chains) plus 3 original evolutions: Moonreaver, Seraph and Empyrean (`tools/custom/`). Sprites are upscaled to HD (see below) |
| **Battles** | The original's time-unit combat, up to 3 monsters per side with reserves. Every wiki ability is modelled (7-element wheel, buffs/debuffs, stun, sleep, poison, doom, taunt, reflect, clones, summons…). Turn queue, auto-battle, 1–3× speed. Capture with Card, Silver Card or Gold Card |
| **World map** | One painted world (six panels stitched by `tools/stitch_world.py`) you can drag and zoom, with a minimap; each of the 27 regions is a pin on its own stretch of land. Travel overland to neighbouring regions, by boat from docks, or fast-travel to visited ones |
| **Regions** | Free-roam painted maps: tap the ground or use arrow keys / WASD to walk (the walk grid is read from the painting). Fog of war lifts as you explore. Wild monsters attack at random as you cross open country (more often in forest, less on roads), never close to a town, and they grow from the region's lowest level at the town edge to its highest far out in the wilds. Each region hides treasure chests, monster lairs, breeder camps and lookout towers; Dragon Overlords wait far from town |
| **Towns** | 28 walkable towns (the 8 originals and 20 Frontier villages) in the style of the user's **Azurelake** kit: one of three painted grounds (canal plaza, harbour quay, garden green) with the kit's buildings, trees, lamps and townsfolk placed by a planner seeded by the town's name (`src/core/townplan.ts`, hand-authored slots in `public/assets/town/layouts.json`). Walk in to use the Guild Hall (wiki quests), Market, Recipe Lab, Warp Shrine, Monster Keep, Hero's House, the Scholar (Monsterpedia), and the Grand Arena and tournament board where the original had them |
| **Dungeons** | 18 dungeons (13 originals, 5 in the Frontier) as the original's stone chambers on black, with battles, chests, stairs and, in some, a spirit guardian on the last floor. Save points let you resume deep runs: floors 6, 11, 16… in ordinary dungeons, every 10th floor in **the Abyss**, which also shows "Next bonus at floor: N". In the Abyss nothing can be captured, battles pay 50% bonus experience and Fafnir guards every 10th floor from 50 |
| **Team screen** | The original's team selector: party and storage as two cover-flow rows of painted cards in the barn (a stone cellar inside dungeons). Drag monsters up/down to change the party; insert or make soul stones, evolve, rename, view info |
| **Progression** | Hero level from raising species, skill points, gem slots, 6 breeder licenses (more party slots), 23 fusion recipes, Eggs and Golden Eggs with the stop-the-wheel minigame, 12 Dragon Overlords, and the Sanctuary finale against Cornelius, Xin, Raiden, Enya, Beatrice and Caius |
| **The Frontier** | An expansion continent across the sea (`tools/custom/expansion.json`): 10 regions (Lv 28–138), 20 villages and 5 dungeons |
| **Audio / saves** | Procedural WebAudio music and effects (no audio files). Autosave to localStorage plus a copy-paste save code; Continue resumes inside the town you were in |

### Balance

The opening is tuned with a headless "sensible player" simulation (`tests/sim.ts`), locked in by `tests/balance.test.ts`:

- Experience: `xpYield` has a flat 40 + 8 per level part, so a Lv 5 starter gains about 5 levels in 15–25 wild battles near Corova; at Lv 50+ the level term dominates.
- Overlord HP and stat multipliers ramp up over the first tiers (`overlordMults`): Arashi, the first, is beatable about a third to half of the time by a Lv 10–12 starter with a catch or two, and never by an untrained one.
- A fresh starter usually beats the wild packs in Southern Alvalon, but not trivially.

## Painted UI

Every control uses painted art; there are no plain CSS gradients, flat pills or browser dialogs. Buttons (blue neutral, gold primary, green go, red danger), round bronze medallions, bronze-framed parchment/slate/teal strips, the blue enamel panel and the stone dungeon rooms come from the original UI kits (`tools/ref_ui/kit.png`, `battle_kit.png`, `town_battle_sheet.jpg`) and from art painted with Higgsfield using the kits as the style reference. The "Painted UI skin" section of `src/style.css` applies them as `border-image` 9-slices. Selected tabs light up turquoise (`tab_on.png`) so gold stays reserved for primary buttons.

The art tools in `tools/ref_ui/` (each script's docstring has its usage):

| Script | Makes |
| --- | --- |
| `slice_kit.py`, `extract.py` | the Monsterpedia book (cards, tabs, plank, parchment page) from `kit.png` and `reference.jpg` |
| `dechecker.py`, `slice_town_battle.py` | town/battle pieces from the sprite sheet whose checkerboard was baked in |
| `dewhite.py`, `slice_battle_kit.py` | the battle kit (panels, cards, bars, effects) |
| `slice_buttons.py` | the painted button set in `public/assets/ui/btn/` |
| `tile_fills.py` | tileable versions of small kit panels |
| `hud_icons.py` | minted silver/gold coins and the hero medallion |
| `tab_skin.py` | the lit selected-tab skin |
| `zoom_icons.py` | the world map's plus/minus glyphs, lifted from the original hero-stats screen |
| `slice_loading.py` | the loading-screen plaque and backdrop |
| `slice_dungeon_team.py`, `slice_lv_tab.py` | dungeon rooms, corridors, props, the team screen and the "Lv" tab |
| `discoveries.py` | region markers (chest, tent, tower, lair) |

Town art lives in `tools/town/`: `prep_kit.py` turns the Azurelake kit into runtime WebPs plus `kit.json`, `prep_town_art.py` builds the painted grounds and the extra buildings, and `prep_walk.py` writes the walk masks and building ground lines that the game and `tests/town.test.ts` share.

## Data and HD sprites

```bash
python3 tools/scrape_wiki.py .cache/wiki                                   # wiki pages + image URLs (MediaWiki API)
python3 tools/download_images.py .cache/wiki/images.json .cache/wiki/img   # monster sprites
npm run data                                                               # -> public/assets/data/{gamedata,maps}.json + sprites
```

- `tools/build_data.py` parses the wiki tables into `gamedata.json`, normalises stats onto one level curve, and turns ability numbers into coefficients of the caster's stats. It merges `tools/custom/` (original monsters, the Frontier) and prefers an HD `NNN.webp` sprite next to each `NNN.png`.
- `tools/upscale_sprites.py MODEL.pth SRC_DIR DST_DIR` upscales the small wiki sprites 4× with Real-ESRGAN (x4plus anime 6B, keeping transparency) to WebPs of at most 512 px. It needs torch, numpy and opencv, so run it from a virtualenv.
- `tools/place_spots.py` finds land in each region painting and places spots and roads; `tools/stitch_world.py` builds the world map tiles.
- `tools/cutout_black.py IN OUT` cuts custom monster art out of a black background.

## Project layout

```
src/core/      battle engine, monsters, encounters, save state, town planner, walk grid (pure TS, unit-tested)
src/scenes/    Phaser scenes: Boot, Title, World, Region, Town, Dungeon, Battle
src/ui/        DOM UI: HUD, menus, Monsterpedia book, team screen, dialogs, loading screen
tests/         vitest suites and the balance simulation
tools/         data, map and art pipelines (Python), screenshot harness
public/assets/ data/ (generated), sprites/, maps/, bg/, town/, dungeon/, team/, loading/, ui/
```

## Credits and legal

This is a **non-commercial fan project**. Dragon Island Blue and its monster designs belong to their original creators.
Monster sprites, names, stats and quest text come from the Dragon Island Blue Fandom wiki (text under [CC BY-SA 3.0](https://www.fandom.com/licensing); sprites are the original game's art). UI kit pieces come from the original game. The town kit is the user's Azurelake art; maps, backgrounds, title and extra UI art were generated with Higgsfield for this project. All code is original.
