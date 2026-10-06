#!/usr/bin/env python3
"""Stitch the 3x2 Higgsfield world-map panels into one large world and cut it into GPU-safe tiles.

usage: stitch_world.py PANEL_DIR OUT_DIR
PANEL_DIR holds p00.png .. p21.png (column, row). Each panel is painted with open sea on all edges, so
neighbouring panels overlap by OV pixels and are cross-faded there. Before blending, each panel's sea
colour is shifted to the average sea colour so the seams don't show. Writes OUT_DIR/world_<c>.jpg
tiles (each <= 4096 px for WebGL) and OUT_DIR/world_layout.json with the full size and tile list.
"""
import json, os, sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
COLS, ROWS, OV = 3, 2, 320
panels = {(c, r): np.asarray(Image.open(os.path.join(SRC, f"p{c}{r}.png")).convert("RGB"), np.float32) for c in range(COLS) for r in range(ROWS)}
H, W = next(iter(panels.values())).shape[:2]


def sea_mean(a):
    b = 60  # border band, which the prompts keep as open sea
    band = np.concatenate([a[:b].reshape(-1, 3), a[-b:].reshape(-1, 3), a[:, :b].reshape(-1, 3), a[:, -b:].reshape(-1, 3)])
    return np.median(band, axis=0)


means = {k: sea_mean(v) for k, v in panels.items()}
target = np.mean(list(means.values()), axis=0)
for k, v in panels.items():
    # shift the whole panel toward the shared sea colour, strongest near the edges where panels meet
    yy, xx = np.mgrid[0:H, 0:W]
    edge = np.minimum.reduce([xx, W - 1 - xx, yy, H - 1 - yy]).astype(np.float32)
    w = np.clip(1 - edge / (OV * 2.5), 0.35, 1)[..., None]
    panels[k] = np.clip(v + (target - means[k]) * w, 0, 255)

FW, FH = COLS * W - (COLS - 1) * OV, ROWS * H - (ROWS - 1) * OV
acc = np.zeros((FH, FW, 3), np.float32)
wsum = np.zeros((FH, FW, 1), np.float32)
ramp_x = np.ones(W, np.float32)
ramp_y = np.ones(H, np.float32)
for c in range(COLS):
    for r in range(ROWS):
        wx = ramp_x.copy(); wy = ramp_y.copy()
        if c > 0: wx[:OV] = np.linspace(0, 1, OV)
        if c < COLS - 1: wx[-OV:] = np.linspace(1, 0, OV)
        if r > 0: wy[:OV] = np.linspace(0, 1, OV)
        if r < ROWS - 1: wy[-OV:] = np.linspace(1, 0, OV)
        wgt = (wy[:, None] * wx[None, :])[..., None] + 1e-4
        x0, y0 = c * (W - OV), r * (H - OV)
        acc[y0:y0 + H, x0:x0 + W] += panels[(c, r)] * wgt
        wsum[y0:y0 + H, x0:x0 + W] += wgt
world = Image.fromarray((acc / wsum).astype(np.uint8))
os.makedirs(OUT, exist_ok=True)
NT = -(-FW // 4000)
tw = -(-FW // NT)
tiles = []
for i in range(NT):
    x0 = i * tw
    t = world.crop((x0, 0, min(FW, x0 + tw), FH))
    name = f"world_{i}.jpg"
    t.save(os.path.join(OUT, name), quality=84, optimize=True, progressive=True)
    tiles.append({"file": name, "x": x0, "w": t.width})
world.resize((FW // 8, FH // 8), Image.LANCZOS).save(os.path.join(OUT, "world_small.jpg"), quality=86)
json.dump({"width": FW, "height": FH, "panel": [W, H], "overlap": OV, "tiles": tiles}, open(os.path.join(OUT, "world_layout.json"), "w"))
print(FW, FH, tiles)
