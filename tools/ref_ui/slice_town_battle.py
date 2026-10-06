#!/usr/bin/env python3
"""Cut the town + battle UI pieces out of the de-checkered sprite sheet.

usage: slice_town_battle.py sheet_rgba.png OUT_DIR
(sheet_rgba.png comes from dechecker.py run on tools/ref_ui/town_battle_sheet.jpg)
"""
import json, os, sys
import numpy as np
import cv2

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
sheet = cv2.imread(SRC, cv2.IMREAD_UNCHANGED)

RECTS = {  # x0, y0, x1, y1 in sheet pixels
    "town/menu_m": (16, 14, 127, 122),
    "town/leave": (141, 37, 243, 130),
    "town/shop": (248, 0, 373, 166),
    "town/hero": (381, 0, 501, 146),
    "town/warp_emblem": (506, 0, 636, 96),
    "town/emblem_house": (506, 0, 636, 142),
    "town/house_a": (636, 0, 834, 142),
    "town/warp_house": (479, 146, 647, 272),
    "town/house_b": (650, 138, 817, 270),
    "town/monsterpedia": (150, 132, 345, 284),
    "town/monsters": (337, 138, 488, 296),
    "town/signpost": (845, 2, 976, 106),
    "town/trees": (963, 0, 1140, 182),
    "town/bigtree": (815, 105, 993, 235),
    "town/bushes": (813, 221, 972, 283),
    "town/farm": (970, 179, 1150, 287),
    "battle/hpbar": (190, 337, 396, 373),
    "battle/coin": (881, 290, 950, 362),
    "battle/qframe": (22, 282, 98, 338),
    "battle/qbar": (22, 333, 159, 354),
    "battle/orb": (933, 380, 966, 413),
    "battle/water_orb": (1041, 286, 1152, 394),
    "battle/ghost": (1010, 390, 1150, 522),
    "battle/panel": (176, 516, 1149, 681),
}


def crop(name):
    x0, y0, x1, y1 = RECTS[name]
    return sheet[y0:y1, x0:x1].copy()


def isolate(img):
    """Drop fragments of neighbouring pieces: alpha components that touch the crop border and
    are much smaller than the main piece."""
    a = (img[..., 3] > 30).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(a, 8)
    if n <= 2:
        return img
    h, w = a.shape
    big = st[1:, 4].max()
    keep = np.zeros(n, bool)
    for i in range(1, n):
        x, y, cw, ch, ar = st[i]
        border = x == 0 or y == 0 or x + cw >= w or y + ch >= h
        keep[i] = ar == big or (not border and ar > big * 0.01) or (border and ar > big * 0.35)
    soft = cv2.dilate(keep[lab].astype(np.uint8), np.ones((3, 3), np.uint8))
    img[..., 3] = (img[..., 3] * soft).astype(np.uint8)
    return img


def trim(img):
    a = img[..., 3]
    ys, xs = np.nonzero(a > 8)
    return img[ys.min():ys.max() + 1, xs.min():xs.max() + 1] if len(ys) else img


meta = {}
for name in RECTS:
    img = crop(name)
    if name == "battle/panel":
        continue
    if name == "battle/coin":
        # erase the baked "0" so the game can print any count
        c = img[..., :3].copy()
        h, w = c.shape[:2]
        m = np.zeros((h, w), np.uint8)
        cv2.ellipse(m, (w // 2, h // 2), (int(w * .26), int(h * .32)), 0, 0, 360, 255, -1)
        digit = ((c.max(-1) > 170) & (m > 0)).astype(np.uint8) * 255
        img[..., :3] = cv2.inpaint(c, cv2.dilate(digit, np.ones((5, 5), np.uint8)), 5, cv2.INPAINT_TELEA)
    if name == "battle/qframe":
        # keep only the gold frame: clear the tiger portrait inside
        h, w = img.shape[:2]
        inner = np.zeros((h, w), bool)
        inner[7:h - 7, 7:w - 7] = True
        img[inner, 3] = 0
    img = trim(isolate(img))
    path = os.path.join(OUT, name + ".png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cv2.imwrite(path, img)
    meta[name] = [int(img.shape[1]), int(img.shape[0])]

# bottom battle panel: keep the frames, rebuild the middle panel's interior without the four
# empty-slot silhouettes. Interior = per-row blend of the clean left/right edges + mottled noise
# that imitates the panel's paper texture (no tiling, so no repeating shapes).
panel = crop("battle/panel")
ph, pw = panel.shape[:2]
x0, x1 = 182, 793
rng = np.random.default_rng(11)


def rebuild(img, y0, y1):
    f = img[..., :3].astype(np.float32)
    cl = f[y0:y1, x0:x0 + 5].mean(1)
    cr = f[y0:y1, x1 - 5:x1].mean(1)
    t = np.linspace(0, 1, x1 - x0)[None, :, None]
    base = cv2.GaussianBlur(cl[:, None, :] * (1 - t) + cr[:, None, :] * t, (0, 0), 3)
    h_, w_ = y1 - y0, x1 - x0
    mottle = cv2.GaussianBlur(rng.normal(0, 1, (h_, w_)).astype(np.float32), (0, 0), 6) * 22
    fine = rng.normal(0, 3.2, (h_, w_)).astype(np.float32)
    f[y0:y1, x0:x1] = np.clip(base + (mottle + fine)[..., None] * np.array([0.8, 0.9, 1.0]), 0, 255)
    img[..., :3] = f.astype(np.uint8)
    return img


panel = rebuild(panel, 14, 135)
cv2.imwrite(os.path.join(OUT, "battle/panel.png"), panel)
meta["battle/panel"] = [pw, ph]
# variant for the player's turn (ability cards): no party HP bars at all
cards = rebuild(crop("battle/panel"), 14, 157)
cv2.imwrite(os.path.join(OUT, "battle/panel_cards.png"), cards)
json.dump(meta, open(os.path.join(OUT, "pieces.json"), "w"), indent=1)
print(json.dumps(meta))
