#!/usr/bin/env python3
"""Data the walkable town scene reads next to its hand-authored layouts (public/assets/town/layouts.json).

usage: prep_walk.py
  walk_<plate>.png  each plate averaged down to one pixel per walk-grid cell (16 world px). The game and the
                    reachability test (tests/town.test.ts) both build the town's walk grid from these exact
                    pixels with WalkGrid.fromPixels, so water is read the same way in both.
  bases.json        the ground line of every building: for each column of a building (every 10 kit units),
                    the lowest opaque pixel, relative to its ground anchor. The town uses it to block the
                    building's footprint on the walk grid and to sort the hero in front of or behind it.
Rerun after adding or replacing town art (e.g. guild.webp).
"""
import json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TOWN = os.path.join(HERE, "..", "..", "public", "assets", "town")
CELL = 16
STEP = 10  # kit units between contour samples

for plate in ("plaza", "harbor", "garden"):
    im = Image.open(os.path.join(TOWN, f"plate_{plate}.jpg")).convert("RGB")
    cols, rows = -(-im.width // CELL), -(-im.height // CELL)
    im.resize((cols, rows), Image.BOX).save(os.path.join(TOWN, f"walk_{plate}.png"), optimize=True)
    print(plate, cols, rows)

kit = json.load(open(os.path.join(TOWN, "kit.json")))
art = json.load(open(os.path.join(TOWN, "art.json")))
pieces = {n: (os.path.join(TOWN, "kit", n + ".webp"), v["w"], v["h"], v["origin"]) for n, v in kit.items() if v["cat"] == "architecture"}
for n in ("guild", "arena", "keep", "gate"):
    p = os.path.join(TOWN, n + ".webp")
    if n in art and os.path.exists(p):
        pieces[n] = (p, art[n]["w"], art[n]["h"], [0.5, 1.0])

bases = {}
for n, (path, w, h, (ox, oy)) in sorted(pieces.items()):
    im = Image.open(path).convert("RGBA")
    a = im.getchannel("A").load()
    kx, ky = im.width / w, im.height / h  # texture px per kit unit
    x0 = -ox * w
    ys = []
    x = x0 + STEP / 2
    while x < x0 + w:
        lo, hi = int((x - STEP / 2 - x0) * kx), max(int((x + STEP / 2 - x0) * kx), int((x - STEP / 2 - x0) * kx) + 1)
        bottom = None
        for px in range(max(0, lo), min(im.width, hi)):
            for py in range(im.height - 1, -1, -1):
                if a[px, py] >= 128:
                    bottom = py if bottom is None else max(bottom, py)
                    break
        ys.append(None if bottom is None else round((bottom + 1) / ky - oy * h, 1))
        x += STEP
    bases[n] = {"x0": round(x0, 1), "dx": STEP, "y": ys}
json.dump(bases, open(os.path.join(TOWN, "bases.json"), "w"), separators=(",", ":"))
print(len(bases), "building ground lines")
