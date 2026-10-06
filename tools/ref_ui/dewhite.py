#!/usr/bin/env python3
"""Key out the white background of a UI sheet -> RGBA, and print/draw its components.

usage: dewhite.py sheet.png out.png [index.png]
White connected to the border is background; enclosed white pockets above a size are too
(the inside of rings, gaps between candles). Edges get a soft alpha from their whiteness so
anti-aliased outlines don't keep a white fringe.
"""
import sys
import numpy as np
import cv2

src, dst = sys.argv[1], sys.argv[2]
img = cv2.imread(src)
H, W = img.shape[:2]
f = img.astype(np.int16)
white = (f.min(-1) > 232) & ((f.max(-1) - f.min(-1)) < 14)
n, lab, st, _ = cv2.connectedComponentsWithStats(white.astype(np.uint8), 4)
bg = np.zeros(n, bool)
for i in range(1, n):
    x, y, w, h, ar = st[i]
    bg[i] = x == 0 or y == 0 or x + w >= W or y + h >= H or ar > 350
bgm = bg[lab]
# soft edge: pixels next to background fade by how white they are
near = cv2.dilate(bgm.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
wh = np.clip((f.min(-1) - 170) / (250 - 170), 0, 1)
alpha = np.where(bgm, 0, np.where(near & ~bgm, (1 - wh) * 255, 255)).astype(np.float32)
alpha = np.clip(alpha, 0, 255).astype(np.uint8)
# un-premultiply the white fringe so it doesn't glow
a = alpha.astype(np.float32)[..., None] / 255
rgb = np.where(a > 0.02, (f - 255 * (1 - a)) / np.maximum(a, 0.02), f)
rgb = np.clip(rgb, 0, 255).astype(np.uint8)
cv2.imwrite(dst, np.dstack([rgb, alpha]))
if len(sys.argv) > 3:
    m = (alpha > 60).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    vis = np.full((H, W, 3), (120, 80, 160), np.uint8)
    vis = (rgb * a + vis * (1 - a)).astype(np.uint8)
    k = 0
    for i in range(1, n):
        x, y, w, h, ar = st[i]
        if ar < 120:
            continue
        cv2.rectangle(vis, (x, y), (x + w, y + h), (0, 255, 255), 1)
        cv2.putText(vis, str(k), (x + 2, y + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
        print(k, (int(x), int(y), int(w), int(h), int(ar)))
        k += 1
    cv2.imwrite(sys.argv[3], vis)
