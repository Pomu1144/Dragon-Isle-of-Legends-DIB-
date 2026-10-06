# Dragon Isle of Legends

A from-scratch browser rebuild of the 2012 mobile monster-taming RPG **Dragon Island Blue**.
The game data and monster art come from a scrape of the [Dragon Island Blue Fandom wiki](https://dragonislandblue.fandom.com).
All maps, battle backdrops, the town scene and the title art were painted with **Higgsfield** (FLUX.2).

![stack](https://img.shields.io/badge/Phaser-3.90-blue) ![ts](https://img.shields.io/badge/TypeScript-strict-3178c6) ![vite](https://img.shields.io/badge/Vite-8-646cff)

## Play

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (deployable anywhere, e.g. GitHub Pages)
npm test           # headless battle-engine + balance tests (vitest)
```

## What's in the game

| System | Details |
| --- | --- |
| **Monsters** | All **224** wiki monsters: sprites, element, stars, base stats, abilities and evolution chains (Hatchling → Dragonling → Dragon → Wyrm…). Plus 3 original evolutions: **Moonreaver** (Dark Panther, Lv 75), and **Seraph** (Archangel, Lv 70) → **Empyrean** (Lv 100) |
| **Battles** | Time-unit (CTB) combat as in the original. Up to 3 monsters per side are on the field with reserves behind them. Every wiki ability is modelled: physical/magical damage, the 7-element wheel, buffs/debuffs, stun, sleep, paralyze, confuse, doom, poison, taunt, disguise, no-guard, immunity, life-drain, recoil, reflect, per-kill and per-TU scaling, clones with shared HP, sacrifices, random summons and escape. Includes a turn-order timeline, auto-battle and 1–3× speed |
| **Capturing** | Card, Silver Card and Gold Card. Lower HP and status effects raise the odds. One attempt per monster, as in the original |
| **World** | 16 regions on the original 4×4 island layout, each a Higgsfield-painted map. About 240 walkable spots are placed on land automatically from each painting's land mask, with roads between neighbouring regions |
| **Towns** | 8 towns (Corova, Westguard, Wesing, Longdale, Lorensia, Dundean, Ilios, Olympia). Each has a Guild with the town's real wiki quests, a Shop with wiki prices, a Recipe Lab, a Warp Gate, and an Arena (license tests) or Tournament where the original had one |
| **Dungeons** | 13 dungeons (No Man's Castle, Lighthouse, Pirate's Cave, Sanctuary, the endless Abyss…). Procedural floors with battles, treasure, stairs, waypoints, spirit guardians and Fafnir in the Abyss |
| **Dragon Overlords** | 12 boss fights (Arashi, Apalala, Ladon…), each using the monster form the wiki names |
| **Progression** | Hero level grows by raising each species to new levels, as on the wiki. Skill points, gem slots (Oval/Square/Tear/Star), 6 breeder licenses that add party slots, soul stones from destroyed monsters, 23 fusion recipes, Eggs and Golden Eggs with a stop-the-wheel minigame |
| **Story** | Start in Corova with one of 4 hatchlings. The finale is the Sanctuary *Final Battle* against Cornelius, Xin, Raiden, Enya, Beatrice and Caius with their wiki teams |
| **Audio** | Procedural WebAudio music (title/world/town/battle/boss/dungeon) and sound effects, with no audio files |
| **Saves** | Autosave to localStorage, plus a copy-paste save code for export and import |

## Rebuilding the data from the wiki

```bash
python3 tools/scrape_wiki.py .cache/wiki                                   # 490 pages + 707 image URLs via the MediaWiki API
python3 tools/download_images.py .cache/wiki/images.json .cache/wiki/img   # monster sprites
npm run data                                                               # -> public/assets/data/{gamedata,maps}.json + sprites
```

`tools/build_data.py` parses the wiki tables (Monster List, stat tables, ability tables, recipes, towns, dungeons, overlords, shop, licenses, eggs, soul stones). It also normalises two kinds of stats into one level curve: pages that list level-1 stats and pages that list S+ rank stats. Ability damage and buff numbers become coefficients of the caster's stats, so every move scales with level. `tools/place_spots.py` finds land in each Higgsfield region painting and places the walkable spots and roads on it.

## Adding your own monsters

Original monsters live in `tools/custom/monsters.json`, with their art in `tools/custom/sprites/`. `npm run data` merges them into the roster and links them to their pre-evolution with `evolvesFrom` and `evolveLevel`. To cut art out of a flat black background:

```bash
python3 tools/cutout_black.py my_art.jpg tools/custom/sprites/my_monster.png
```

## Monsterpedia UI kit

The Monsterpedia and My Monsters book is built from the Dragon Island Blue UI kit, `tools/ref_ui/kit.png`. That sheet holds the empty cards, the six tabs, the "My Monsters" plank and the back button, on a transparent background.

- **`tools/ref_ui/slice_kit.py`** cuts the sheet into `public/assets/ui/kit/`. It erases the placeholder silhouette in the element socket and the plank's baked-in label, and writes `layout.json` with every position.
- **The parchment page** comes from a screenshot of the original game. `tools/ref_ui/extract.py` removes the cards, counter and labels from `reference.jpg`; that step needs `pip install opencv-python-headless scipy`.
- **`src/ui/book.ts`** lays everything out in the kit's 1536×1024 space. It writes the names, sprites, stars, the level on the crown, the element icon in the socket and the number in the number box.

```bash
python3 tools/ref_ui/extract.py tools/ref_ui/reference.jpg public/assets/ui/dib
python3 tools/ref_ui/slice_kit.py tools/ref_ui/kit.png public/assets/ui/dib/page.jpg public/assets/ui/kit
```

## Town and battle screens from the original sprite sheet

The town and battle screens follow the original game's layout, using art from `tools/ref_ui/town_battle_sheet.jpg`. In that sheet the transparency checkerboard was flattened into the image, so it takes two steps to cut the pieces out:

```bash
python3 tools/ref_ui/dechecker.py tools/ref_ui/town_battle_sheet.jpg .cache/sheet_rgba.png   # fits the checker grid -> alpha
python3 tools/ref_ui/slice_town_battle.py .cache/sheet_rgba.png public/assets/ui/orig        # town buildings, HUD, battle panel
```

- **Town:** the region map is zoomed in on the town. The original buildings and emblems stand on it at the positions from the reference screen, `town_reference.jpg`: Shop, Hero, Warp Gate, Monsterpedia and Monsters, plus Leave Town, Guild, Recipe Lab, Arena and Tournament. The "M" button opens the menu.
- **Battle:** this matches `battle_reference.jpg`:
  - Enemies stand in the scene, with their names coloured by element and HP bars across the top. A coin shows how many enemies are still in reserve.
  - The left column is the turn queue, giving the time units until each monster acts.
  - The bottom panel has the ghost box (capture cards, auto, speed and escape), your monsters with "HP/max" bars, and the hero portrait (tap it to toggle auto).
  - Magic attacks fire the original glowing orbs.

## Project layout

```
src/core/      battle engine, monster model, encounters, save/state (pure TS, unit-tested)
src/scenes/    Phaser scenes: Boot, Title, World, Region, Battle, Town, Dungeon
src/ui/        DOM UI: HUD, menus, Monsterpedia, egg wheel, dialogs
tools/         wiki scraper + data builder + map spot placer (Python)
public/assets/ maps/ & bg/ (Higgsfield), sprites/ (wiki), data/ (generated)
```

## Credits & legal

This is a **non-commercial fan project**. Dragon Island Blue and its monster designs belong to their original creators.
Monster sprites, names, stats and quest text come from the Dragon Island Blue Fandom wiki. Fandom text is licensed [CC BY-SA 3.0](https://www.fandom.com/licensing); the sprite images are the original game's art, used here for this fan project.
Maps, backgrounds and title art were generated with Higgsfield for this project. All code is original.
