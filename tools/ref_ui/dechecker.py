#!/usr/bin/env python3
"""Recover transparency from a sprite sheet whose transparency checkerboard was flattened into
the image (black / (30,30,30) squares). Fits the checker grid, marks pixels matching it as
background, keeps solid objects (holes filled), and writes an RGBA PNG plus a component index.

usage: dechecker.py sheet.jpg out.png [index.png]
"""
import sys
import numpy as np
import cv2

src, dst = sys.argv[1], sys.argv[2]
img = cv2.imread(src)
H, W = img.shape[:2]
g = img.astype(np.int16)
neutral = (np.abs(g[..., 0] - g[..., 1]) < 6) & (np.abs(g[..., 1] - g[..., 2]) < 6)
lum = g.mean(-1)
is0 = neutral & (lum < 4)
is30 = neutral & (np.abs(lum - 30) < 4)

# fit square size and phase by maximising agreement on clearly-checker pixels
yy, xx = np.mgrid[0:H, 0:W]
best = None
for size in range(48, 61):
    for ox in range(0, size, 3):
        for oy in range(0, size, 3):
            par = (((xx + ox) // size + (yy + oy) // size) % 2).astype(bool)
            score = (is30 & par).sum() + (is0 & ~par).sum()
            if best is None or score > best[0]:
                best = (score, size, ox, oy)
    if size % 10 == 0:
        pass
_, size, ox, oy = best
# refine phase at 1px
for dx in (-2, -1, 0, 1, 2):
    for dy in (-2, -1, 0, 1, 2):
        par = (((xx + ox + dx) // size + (yy + oy + dy) // size) % 2).astype(bool)
        score = (is30 & par).sum() + (is0 & ~par).sum()
        if score > best[0]:
            best = (score, size, ox + dx, oy + dy)
_, size, ox, oy = best
print("checker size", size, "phase", ox, oy)
par = (((xx + ox) // size + (yy + oy) // size) % 2).astype(bool)
expect = np.where(par, 30, 0)
bg = neutral & (np.abs(lum - expect) < 7)

fg = (~bg).astype(np.uint8)
fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
# fill holes: small background islands enclosed by an object (dark interior details that
# happen to match the checker colour)
nb, blab, bst, _ = cv2.connectedComponentsWithStats((1 - fg).astype(np.uint8), 4)
holes = np.zeros(nb, bool)
for i in range(1, nb):
    x, y, w, h, ar = bst[i]
    touches = x == 0 or y == 0 or x + w >= W or y + h >= H
    holes[i] = not touches and ar < 2500
fg = (fg.astype(bool) | holes[blab]).astype(np.uint8)
fg[:, :2] = 0; fg[:2, :] = 0
# black outlines sitting on black checker squares: grow 2px into near-black pixels
grow = cv2.dilate(fg, np.ones((5, 5), np.uint8)) & (lum < 40).astype(np.uint8) & (~par).astype(np.uint8)
fg = fg | grow
# drop specks
n, lab, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
keep = np.zeros(n, bool)
keep[1:] = stats[1:, 4] >= 60
fg = keep[lab].astype(np.uint8)
alpha = cv2.GaussianBlur(fg.astype(np.float32) * 255, (3, 3), 0.7).astype(np.uint8)
alpha[fg == 0] = np.minimum(alpha[fg == 0], 0)
cv2.imwrite(dst, np.dstack([img, alpha]))

if len(sys.argv) > 3:
    n, lab, stats, _ = cv2.connectedComponentsWithStats((alpha > 100).astype(np.uint8), 8)
    vis = np.dstack([img, alpha]).astype(np.float32)
    canvas = np.full((H, W, 3), (120, 80, 160), np.float32)
    a = vis[..., 3:] / 255
    canvas = (vis[..., :3] * a + canvas * (1 - a)).astype(np.uint8)
    comps = []
    for i in range(1, n):
        x, y, w, h, ar = stats[i]
        if ar < 150:
            continue
        comps.append((int(x), int(y), int(w), int(h), int(ar)))
        cv2.rectangle(canvas, (x, y), (x + w, y + h), (0, 255, 255), 1)
        cv2.putText(canvas, str(len(comps) - 1), (x + 2, y + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
    cv2.imwrite(sys.argv[3], canvas)
    for i, c in enumerate(comps):
        print(i, c)
