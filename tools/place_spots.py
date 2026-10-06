#!/usr/bin/env python3
"""Place walkable map spots on land in each Higgsfield region painting.

usage: place_spots.py ASSET_DIR DATA_DIR
Reads ASSET_DIR/maps/<region>.jpg and DATA_DIR/gamedata.json, writes DATA_DIR/maps.json:
  {region_id: {"spots": [{id,x,y,kind,ref,exit}], "edges": [[a,b],...]}}
Coordinates are normalised 0..1 so the game can scale the art freely.
"""
import colorsys, json, math, os, random, sys
import numpy as np
from PIL import Image

ASSETS, DATA = sys.argv[1], sys.argv[2]
gd = json.load(open(os.path.join(DATA, "gamedata.json")))
GW, GH = 128, 72
N_SPOTS = 60          # walkable points per region (the region map is 3x the screen and scrolls)
LINK = 16             # max extra-road length, in grid cells
# hidden discoveries per region (revealed by exploring; see src/scenes/Region.ts)
DISCOVERIES = [("treasure", 7), ("rare", 3), ("breeder", 3), ("lookout", 2)]


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
    margin_x, margin_y = 4, 4
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
            if d(i, j) < LINK:
                edges.add(tuple(sorted((i, j))))
    spots = [{"id": i, "x": round(p[0] / GW, 4), "y": round(p[1] / GH, 4), "kind": "field"} for i, p in enumerate(pts)]
    # exits toward neighbouring regions
    for dx, dy, key in [(-1, 0, "W"), (1, 0, "E"), (0, -1, "N"), (0, 1, "S")]:
        nb = next((r for r in gd["regions"] if r["x"] == region["x"] + dx and r["y"] == region["y"] + dy
                   and r.get("realm") == region.get("realm")), None)
        if not nb or nb.get("sea") or region.get("sea"):
            continue  # sea regions are reached by boat, not by road
        score = {"W": lambda s: s["x"], "E": lambda s: -s["x"], "N": lambda s: s["y"], "S": lambda s: -s["y"]}[key]
        free = [s for s in spots if s["kind"] == "field"]
        s = min(free, key=score)
        s["kind"], s["exit"], s["ref"] = "exit", key, nb["id"]
    # docks: the free spot closest to open water becomes the pier for each sea route
    for a, b in SEA_ROUTES:
        if region["id"] not in (a, b):
            continue
        other = b if region["id"] == a else a
        water = [(x, y) for y in range(GH) for x in range(GW) if not mask[y][x]]
        free = [s for s in spots if s["kind"] == "field"]
        if water and free:
            def coast(sp):
                px, py = sp["x"] * GW, sp["y"] * GH
                return min((px - x) ** 2 + (py - y) ** 2 for x, y in water[::3])
            d = min(free, key=coast)
            d["kind"], d["ref"] = "dock", other
    # special locations claim the most central remaining spots, in order
    cx = lambda s: (s["x"] - 0.5) ** 2 + (s["y"] - 0.5) ** 2
    specials = [("town", t) for t in region["towns"]] + [("dungeon", d_) for d_ in region["dungeons"]] + \
               [("overlord", o) for o in region["overlords"]]
    free = sorted([s for s in spots if s["kind"] == "field"], key=cx)
    rng.shuffle(free[2:])
    for (kind, ref), s in zip(specials, free[::2] + free[1::2]):
        s["kind"], s["ref"] = kind, ref
    # hidden discoveries on ordinary spots, spread out and away from the region's start points
    taken = [s for s in spots if s["kind"] != "field"]
    for kind, count in DISCOVERIES:
        for _ in range(count):
            free = [s for s in spots if s["kind"] == "field"]
            if len(free) < 6:
                break
            far = max(free, key=lambda s: min(((s["x"] - t["x"]) * 16) ** 2 + ((s["y"] - t["y"]) * 9) ** 2 for t in taken) * rng.uniform(0.6, 1.0))
            far["kind"] = kind
            taken.append(far)
    # a Dragon Overlord waits at the far end of its region, not on the doorstep of the town you start in:
    # it trades places with the ordinary spot farthest from the region's towns (or from its centre)
    homes = [s for s in spots if s["kind"] == "town"] or [{"x": 0.5, "y": 0.5}]
    far_from_home = lambda s: min(((s["x"] - t["x"]) * 16) ** 2 + ((s["y"] - t["y"]) * 9) ** 2 for t in homes)
    for lord in [s for s in spots if s["kind"] == "overlord"]:
        field = [s for s in spots if s["kind"] == "field"]
        if field:
            far = max(field, key=far_from_home)
            if far_from_home(far) > far_from_home(lord):
                far["kind"], far["ref"], lord["kind"] = "overlord", lord["ref"], "field"
                del lord["ref"]
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
SEA_ROUTES = gd.get("seaRoutes", [])  # dock <-> dock boat connections
out = {}
for r in gd["regions"]:
    rng = random.Random(r["id"])
    out[r["id"]] = place(r, land_mask(os.path.join(ASSETS, "maps", r["id"] + ".jpg")), rng)
# ---- the stitched world map (tools/stitch_world.py): pin every region onto its panel's land
WORLD_PANELS = {
    (0, 0): ["frostfang_coast", "glacier_expanse", "rimeheart_peaks"],
    (1, 0): ["ashen_wastes", "infernal_rift"],
    (2, 0): ["hellmouth"],
    (0, 1): [r["id"] for r in gd["regions"] if r.get("realm", "isle") == "isle" and not r.get("sea")],
    (1, 1): ["underworld"],
    (2, 1): ["elderwood", "titanroot_forest", "gravemoor", "hollow_necropolis"],
}
lay_path = os.path.join(ASSETS, "maps", "world_layout.json")
if os.path.exists(lay_path):
    lay = json.load(open(lay_path))
    FW, FH = lay["width"], lay["height"]
    PW, PH = lay["panel"]
    OV = lay["overlap"]
    small = Image.open(os.path.join(ASSETS, "maps", "world_small.jpg")).convert("RGB")
    SW, SH = small.size
    px = small.load()

    def is_land(x, y):
        r_, g_, b_ = px[x, y]
        h_, s_, v_ = colorsys.rgb_to_hsv(r_ / 255, g_ / 255, b_ / 255)
        return not (0.40 < h_ < 0.62 and s_ > 0.12 and b_ >= r_)
    byid = {r["id"]: r for r in gd["regions"]}
    pos = {}
    for (c, rr), ids in WORLD_PANELS.items():
        ids = [i for i in ids if i in byid]
        x0, y0 = c * (PW - OV) * SW / FW, rr * (PH - OV) * SH / FH
        x1, y1 = x0 + PW * SW / FW, y0 + PH * SH / FH
        land = [(x, y) for y in range(int(y0) + 4, int(y1) - 4) for x in range(int(x0) + 4, int(x1) - 4) if is_land(x, y)]
        lx0, lx1 = np.percentile([p[0] for p in land], [8, 92]); ly0, ly1 = np.percentile([p[1] for p in land], [8, 92])
        gx = [byid[i]["x"] for i in ids]; gy = [byid[i]["y"] for i in ids]
        taken = []
        for i in ids:
            fx = 0.5 if max(gx) == min(gx) else (byid[i]["x"] - min(gx)) / (max(gx) - min(gx))
            fy = 0.5 if max(gy) == min(gy) else (byid[i]["y"] - min(gy)) / (max(gy) - min(gy))
            tx, ty = lx0 + (lx1 - lx0) * fx, ly0 + (ly1 - ly0) * fy
            spread = min(lx1 - lx0, ly1 - ly0) / (len(ids) ** 0.5 + 1) * 0.6
            best = min(land, key=lambda p: (p[0] - tx) ** 2 + (p[1] - ty) ** 2 + (1e9 if any((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < spread ** 2 for q in taken) else 0))
            taken.append(best)
            pos[i] = [round(best[0] / SW, 4), round(best[1] / SH, 4)]
    out["_worldmap"] = {"size": [FW, FH], "pos": pos}
    print("worldmap", len(pos), "regions placed")
json.dump(out, open(os.path.join(DATA, "maps.json"), "w"), separators=(",", ":"))
print({k: [s["kind"][0] for s in v["spots"]] for k, v in out.items() if not k.startswith("_")})
