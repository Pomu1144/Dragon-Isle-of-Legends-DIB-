#!/usr/bin/env python3
"""Cut the dark wooden "Lv" tab (bottom-left of the original dungeon screen) out of orig_screens/Abyss.jpg.

usage: slice_lv_tab.py
  The black around the tab becomes transparent and the baked-in "Lv 35" is painted out row by row with the
  tab's own colour (the tab is shaded top to bottom and nearly flat across), so the game can write any level on it.
  -> public/assets/dungeon/lv_tab.png
"""
import os
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
src = cv2.imread(os.path.join(HERE, "orig_screens", "Abyss.jpg"))
tab = src[1424:1502, 0:148].copy()
lum = tab.max(-1).astype(np.int32)

# silhouette: everything brighter than the black backdrop, holes (the text's dark outline) filled
body = (lum > 22).astype(np.uint8)
cnts, _ = cv2.findContours(body, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
solid = np.zeros_like(body)
cv2.drawContours(solid, [max(cnts, key=cv2.contourArea)], -1, 1, -1)
alpha = cv2.GaussianBlur(solid.astype(np.float32), (3, 3), 0)

# the white letters and their dark halo cover the left two thirds: every row there is repainted with the colour
# of the same row in the clean strip to their right, with a little of that strip's grain so it isn't flat
H, W = lum.shape
CLEAN = 100
out = tab.astype(np.float32)
rng = np.random.default_rng(7)
for y in range(H):
    inside = np.where(solid[y] > 0)[0]
    if not len(inside):
        continue
    strip = tab[y, CLEAN:max(CLEAN + 4, inside.max() - 6)].astype(np.float32)
    col = np.median(strip, axis=0)
    grain = strip - col
    n = CLEAN + 4
    patch = col + grain[rng.integers(0, len(grain), n)] * 0.6
    w = np.clip((np.arange(n) - (CLEAN - 4)) / 8.0, 0, 1)[:, None]  # cross-fade into the original strip
    out[y, :n] = patch * (1 - w) + out[y, :n] * w
out = cv2.GaussianBlur(out, (3, 3), 0) * 0.5 + out * 0.5
rgba = np.dstack([np.clip(out, 0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
ys, xs = np.where(alpha > 0.05)
rgba = rgba[ys.min():ys.max() + 1, :xs.max() + 2]
dst = os.path.join(HERE, "..", "..", "public", "assets", "dungeon", "lv_tab.png")
cv2.imwrite(dst, rgba)
print("lv_tab", rgba.shape[1], "x", rgba.shape[0])
