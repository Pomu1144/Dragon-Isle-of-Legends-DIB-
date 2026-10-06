#!/usr/bin/env python3
"""Build the walkable-town art in public/assets/town/ from tools/town/src/.

usage: prep_town_art.py
Sources (Higgsfield, generated in the style of the user's Azurelake kit with its art as reference):
  plate_*.jpg   empty town grounds (plaza with canal, harbour quay, garden green) the town is built on
  guild/arena/keep/gate.webp  the service buildings the kit lacks; hero.webp  the player character
The plates become the town's world at 1:1; buildings and the hero are scaled to the kit's world units
(a townsperson is ~80 px tall) and written at 1.5x for high-DPI screens. Sizes go to art.json.
"""
import json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(HERE, "src"), os.path.join(HERE, "..", "..", "public", "assets", "town")
os.makedirs(OUT, exist_ok=True)
SHARP = 1.5
# world width (px) of each building, height of the hero; the kit's houses are ~355 px wide
WORLD = {"guild": ("w", 560), "arena": ("w", 760), "keep": ("w", 500), "gate": ("w", 380), "hero": ("h", 88)}
art = {}
for name, (axis, size) in WORLD.items():
    p = os.path.join(SRC, name + ".webp")
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert("RGBA")
    im = im.crop(im.getbbox())
    k = size / (im.width if axis == "w" else im.height)
    ww, wh = im.width * k, im.height * k
    out = im.resize((round(ww * SHARP), round(wh * SHARP)), Image.LANCZOS)
    out.save(os.path.join(OUT, name + ".webp"), quality=90, method=6)
    art[name] = {"w": round(ww, 1), "h": round(wh, 1)}
for name in ("plaza", "harbor", "garden"):
    im = Image.open(os.path.join(SRC, f"plate_{name}.jpg")).convert("RGB")
    im.save(os.path.join(OUT, f"plate_{name}.jpg"), quality=82, optimize=True, progressive=True)
    art[f"plate_{name}"] = {"w": im.width, "h": im.height}
json.dump(art, open(os.path.join(OUT, "art.json"), "w"), indent=1)
print(art)
