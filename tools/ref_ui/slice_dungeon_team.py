#!/usr/bin/env python3
"""Cut the Higgsfield dungeon + team-screen art (tools/ref_ui/dungeon_team/*.png) into game assets.

usage: slice_dungeon_team.py
  rooms / corridor (painted on black): the black around them becomes transparent, then they are cropped.
    The flagstone floor of each room is measured and written to public/assets/dungeon/layout.json
    (normalised rect) so the game can stand monsters, chests and the hero on the floor.
  hero, props, cards, nav buttons (painted on white): keyed with dewhite.py and split into pieces.
  backgrounds: resized to 1920x1080 JPEGs.
"""
import json, os, subprocess, sys, tempfile
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "dungeon_team")
PUB = os.path.join(HERE, "..", "..", "public", "assets")
DUN, TEAM = os.path.join(PUB, "dungeon"), os.path.join(PUB, "team")
os.makedirs(DUN, exist_ok=True)
os.makedirs(TEAM, exist_ok=True)


def key_black(img):
    """Black connected to the border -> transparent, with a soft edge."""
    dark = (img.max(-1) < 28).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(dark, 4)
    h, w = dark.shape
    bg = np.zeros(n, bool)
    for i in range(1, n):
        x, y, ww, hh, _ = st[i]
        bg[i] = x == 0 or y == 0 or x + ww >= w or y + hh >= h
    mask = (~bg[lab]).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    mask = cv2.GaussianBlur(mask, (5, 5), 0)
    return np.dstack([img, mask])


def crop(rgba, pad=2):
    ys, xs = np.where(rgba[..., 3] > 20)
    return rgba[max(0, ys.min() - pad):ys.max() + pad + 1, max(0, xs.min() - pad):xs.max() + pad + 1]


def floor_rect(rgba):
    """Bounding box of the brown flagstone floor (largest brown component), normalised."""
    b, g, r = [rgba[..., i].astype(int) for i in range(3)]
    # floor is warm brown (r > g > b, r - b >= 14); the rim and back wall are neutral grey (r ~ g ~ b)
    brown = ((r - b >= 14) & (r >= g + 5) & (g >= b) & (r > 35) & (r < 150) & (rgba[..., 3] > 200)).astype(np.uint8)
    brown = cv2.morphologyEx(brown, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(brown, 8)
    i = 1 + int(np.argmax(st[1:, 4]))
    x, y, w, h, _ = st[i]
    H, W = brown.shape
    return [round(float(x) / W, 4), round(float(y) / H, 4), round(float(x + w) / W, 4), round(float(y + h) / H, 4)]


def fit(img, height=None, width=None):
    h, w = img.shape[:2]
    s = (height / h) if height else (width / w)
    return cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)


def keyed_parts(name, count):
    tmp = os.path.join(tempfile.gettempdir(), "dt_" + name)
    subprocess.run([sys.executable, "-I", os.path.join(HERE, "dewhite.py"), os.path.join(SRC, name), tmp], check=True, stdout=subprocess.DEVNULL)
    img = cv2.imread(tmp, cv2.IMREAD_UNCHANGED)
    m = cv2.morphologyEx((img[..., 3] > 40).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    parts = sorted([st[i] for i in range(1, n) if st[i][4] > 3000], key=lambda s: s[0])
    if len(parts) != count:
        sys.exit(f"{name}: expected {count} pieces, found {len(parts)}")
    out = []
    for x, y, w, h, _ in parts:
        piece = img[y:y + h, x:x + w].copy()
        sil = (lab[y:y + h, x:x + w] > 0).astype(np.uint8)
        cnts, _ = cv2.findContours(sil, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        solid = np.zeros_like(sil)
        cv2.drawContours(solid, cnts, -1, 1, -1)
        # enclosed white (the close button's X, highlights) is part of the piece, not background
        piece[..., 3] = np.where(cv2.erode(solid, np.ones((5, 5), np.uint8)) > 0, 255, piece[..., 3])
        out.append(piece)
    return out


layout = {}
# rooms: cell counts across x down (floor grid) are recorded for placement
ROOMS = {"room_a": (2, 2, 420), "room_b": (2, 2, 420), "room_tall": (2, 3, 420), "room_wide": (6, 2, 860)}
# share of the inner area taken by the grey back wall (measured by eye on the sliced art; the
# candle glow and fossil carving defeat a colour test)
WALL_FRAC = {"room_a": 0.33, "room_b": 0.27, "room_tall": 0.25, "room_wide": 0.31}
for name, (cx, cy, width) in ROOMS.items():
    img = cv2.imread(os.path.join(SRC, name + ".png"))
    rgba = crop(key_black(img))
    rgba = fit(rgba, width=width)
    cv2.imwrite(os.path.join(DUN, name + ".png"), rgba)
    inner = floor_rect(rgba)
    H, W = rgba.shape[:2]
    layout[name] = {"w": W, "h": H, "inner": inner, "wallFrac": WALL_FRAC[name], "cells": [cx, cy]}
    print(name, layout[name])
cor = crop(key_black(cv2.imread(os.path.join(SRC, "corridor.png"))))
cor = fit(cor, height=96)
cv2.imwrite(os.path.join(DUN, "corridor.png"), cor)
layout["corridor"] = {"w": cor.shape[1], "h": cor.shape[0]}
print("corridor", layout["corridor"])

(hero,) = keyed_parts("hero.png", 1)
cv2.imwrite(os.path.join(DUN, "hero.png"), fit(crop(hero), height=200))
for nm, p in zip(["portal", "chest", "stairs"], keyed_parts("props.png", 3)):
    cv2.imwrite(os.path.join(DUN, nm + ".png"), fit(crop(p), height=180))
for nm, p in zip(["card_teal", "card_red", "card_empty"], keyed_parts("cards.png", 3)):
    cv2.imwrite(os.path.join(TEAM, nm + ".png"), fit(crop(p), height=320))
for nm, p in zip(["nav_double", "nav_single", "nav_down", "nav_close"], keyed_parts("nav.png", 4)):
    cv2.imwrite(os.path.join(TEAM, nm + ".png"), fit(crop(p), height=140))
for nm in ("bg_barn", "bg_stone"):
    img = cv2.imread(os.path.join(SRC, nm + ".png"))
    cv2.imwrite(os.path.join(TEAM, nm + ".jpg"), cv2.resize(img, (1920, 1080), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 84])
# one flagstone cut from the tall room tiles the corridors, so they match the room floors exactly
tall = cv2.imread(os.path.join(DUN, "room_tall.png"), cv2.IMREAD_UNCHANGED)
L = layout["room_tall"]
ix0, iy0, ix1, iy1 = L["inner"]
fy0 = iy0 + (iy1 - iy0) * L["wallFrac"]
cw, ch = (ix1 - ix0) / 2 * L["w"], (iy1 - fy0) / 3 * L["h"]
x0, y0 = round(ix0 * L["w"] + cw * 0.04), round(fy0 * L["h"] + ch * 1.04)
tile = tall[y0:y0 + round(ch * 0.92), x0:x0 + round(cw * 0.92), :3]
cv2.imwrite(os.path.join(DUN, "floor_tile.png"), cv2.resize(tile, (144, 144), interpolation=cv2.INTER_AREA))
layout["floor_tile"] = {"w": 144, "h": 144}
json.dump(layout, open(os.path.join(DUN, "layout.json"), "w"), indent=1)
print("done")
