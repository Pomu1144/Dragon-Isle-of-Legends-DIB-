#!/usr/bin/env python3
"""Turn the Azurelake / Lower Azureland Ward kit (the user's Drive art, transparent PNGs at 1-2K) into
runtime WebPs plus public/assets/town/kit.json.

usage: prep_kit.py INVENTORY.json RAW_DIR
INVENTORY.json lists every piece with its Drive file id, category and the kit's runtime calibration
(scale = world px per source px, origin = ground-contact anchor, footprint = collision box in world px).
Each piece is trimmed to its visible pixels and stored at 1.5x its in-game size, so it stays sharp on
high-DPI screens; kit.json carries the anchor (re-measured after trimming) and the world size.
"""
import json, os, sys
from PIL import Image

INV, RAW = sys.argv[1:3]
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "assets", "town", "kit")
os.makedirs(OUT, exist_ok=True)
SHARP = 1.5
DEFAULT_SCALE = {"architecture": 0.3, "terrain": 0.32, "props": 0.12, "vegetation": 0.22, "npcs": 0.11, "effects": 0.2}
kit = {}
for x in json.load(open(INV)):
    im = Image.open(os.path.join(RAW, x["fid"] + ".png")).convert("RGBA")
    W, H = im.size
    scale = x.get("scale") or DEFAULT_SCALE.get(x["cat"], 0.2)
    ox, oy = x.get("origin") or [0.5, 0.95]
    bb = im.getbbox() or (0, 0, W, H)
    im = im.crop(bb)
    # anchor in the trimmed image, normalised
    ax, ay = (ox * W - bb[0]) / im.width, (oy * H - bb[1]) / im.height
    world_w, world_h = im.width * scale, im.height * scale
    px = max(8, round(max(world_w, world_h) * SHARP))
    k = px / max(im.width, im.height)
    if k < 1:
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    key = x["id"].split(".", 2)[-1].replace(".", "_")
    im.save(os.path.join(OUT, key + ".webp"), quality=88, method=6)
    kit[key] = {"cat": x["cat"], "w": round(world_w, 1), "h": round(world_h, 1), "origin": [round(ax, 4), round(ay, 4)],
                "footprint": x.get("footprint"), "desc": (x.get("desc") or "")[:160]}
json.dump(kit, open(os.path.join(OUT, "..", "kit.json"), "w"), indent=1)
print(len(kit), "pieces")
