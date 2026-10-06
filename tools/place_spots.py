#!/usr/bin/env python3
"""Place walkable map spots on land in each Higgsfield region painting.

usage: place_spots.py ASSET_DIR DATA_DIR
Reads ASSET_DIR/maps/<region>.jpg and DATA_DIR/gamedata.json, writes DATA_DIR/maps.json:
  {region_id: {"spots": [{id,x,y,kind,ref,exit}], "edges": [[a,b],...]}}
Coordinates are normalised 0..1 so the game can scale the art freely.
"""
import colorsys, json, math, os, random, sys
from PIL import Image

ASSETS, DATA = sys.argv[1], sys.argv[2]
gd = json.load(open(os.path.join(DATA, "gamedata.json")))
GW, GH = 96, 54
N_SPOTS = 15


def land_mask(path):
    im = Image.open(path).convert("RGB").resize((GW, GH), Image.BOX)
    mask = [[False] * GW for _ in range(GH)]
    for y in range(GH):
        for x in range(GW):
            r, g, b = im.getpixel((x, y))
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            water = 0.43 < h < 0.64 and s > 0.18 and b > r + 10
            mask[y][x] = not water
    return mask


def place(region, mask, rng):
    margin_x, margin_y = 5, 5
    land = [(x, y) for y in range(margin_y, GH - margin_y) for x in range(margin_x, GW - margin_x) if mask[y][x]
            and sum(mask[yy][xx] for yy in range(y - 2, y + 3) for xx in range(x - 2, x + 3)) >= 22]
    if len(land) < N_SPOTS:
        land = [(x, y) for y in range(margin_y, GH - margin_y) for x in range(margin_x, GW - margin_x)]
    pts = [rng.choice(land)]
    while len(pts) < N_SPOTS:  # farthest-point sampling (with jitter) => evenly spread spots
        cand = rng.sample(land, min(400, len(land)))
        best = max(cand, key=lambda p: min((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 for q in pts) * rng.uniform(0.85, 1.0))
        pts.append(best)
    pts.sort(key=lambda p: (p[0], p[1]))
    d = lambda a, b: math.dist(pts[a], pts[b])
    # minimum spanning tree + short extra links
    n = len(pts)
    inside, edges = {0}, set()
    while len(inside) < n:
        a, b = min(((i, j) for i in inside for j in range(n) if j not in inside), key=lambda e: d(*e))
        inside.add(b)
        edges.add(tuple(sorted((a, b))))
    for i in range(n):
        for j in sorted(range(n), key=lambda j: d(i, j))[1:3]:
            if d(i, j) < 22:
                edges.add(tuple(sorted((i, j))))
    spots = [{"id": i, "x": round(p[0] / GW, 4), "y": round(p[1] / GH, 4), "kind": "field"} for i, p in enumerate(pts)]
    # exits toward neighbouring regions
    for dx, dy, key in [(-1, 0, "W"), (1, 0, "E"), (0, -1, "N"), (0, 1, "S")]:
        nb = next((r for r in gd["regions"] if r["x"] == region["x"] + dx and r["y"] == region["y"] + dy), None)
        if not nb:
            continue
        score = {"W": lambda s: s["x"], "E": lambda s: -s["x"], "N": lambda s: s["y"], "S": lambda s: -s["y"]}[key]
        free = [s for s in spots if s["kind"] == "field"]
        s = min(free, key=score)
        s["kind"], s["exit"], s["ref"] = "exit", key, nb["id"]
    # special locations claim the most central remaining spots, in order
    cx = lambda s: (s["x"] - 0.5) ** 2 + (s["y"] - 0.5) ** 2
    specials = [("town", t) for t in region["towns"]] + [("dungeon", d_) for d_ in region["dungeons"]] + \
               [("overlord", o) for o in region["overlords"]]
    free = sorted([s for s in spots if s["kind"] == "field"], key=cx)
    rng.shuffle(free[2:])
    for (kind, ref), s in zip(specials, free[::2] + free[1::2]):
        s["kind"], s["ref"] = kind, ref
    # snap landmarks onto the painted buildings they belong to
    for ref, (ax, ay) in ANCHORS.get(region["id"], {}).items():
        holder = next((s for s in spots if s.get("ref") == ref), None)
        if not holder:
            continue
        target = min((s for s in spots if s["kind"] != "exit"), key=lambda s: (s["x"] - ax) ** 2 + (s["y"] - ay) ** 2)
        if target is not holder:
            for k in ("kind", "ref"):
                target[k], holder[k] = holder.get(k), target.get(k)
            if holder["ref"] is None:
                del holder["ref"]
        target["x"], target["y"] = ax, ay
    return {"spots": spots, "edges": sorted(edges)}


# The maps are pure terrain (towns are drawn on top as building sprites), so no landmark anchors.
ANCHORS: dict = {}
out = {}
for r in gd["regions"]:
    rng = random.Random(r["id"])
    out[r["id"]] = place(r, land_mask(os.path.join(ASSETS, "maps", r["id"] + ".jpg")), rng)
# bounding box of the island on the world map, so the 4x4 region grid can sit on the land
wm = land_mask(os.path.join(ASSETS, "maps", "world.jpg"))
cols = [x for x in range(GW) if sum(wm[y][x] for y in range(GH)) > GH * 0.25]
rows = [y for y in range(GH) if sum(wm[y][x] for x in range(GW)) > GW * 0.2]
out["_world"] = {"x0": round(min(cols) / GW, 3), "x1": round((max(cols) + 1) / GW, 3), "y0": round(min(rows) / GH, 3), "y1": round((max(rows) + 1) / GH, 3)}
print("world island", out["_world"])
json.dump(out, open(os.path.join(DATA, "maps.json"), "w"), separators=(",", ":"))
print({k: [s["kind"][0] for s in v["spots"]] for k, v in out.items() if not k.startswith("_")})
