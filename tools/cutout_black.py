#!/usr/bin/env python3
"""Cut a creature out of a flat black background -> trimmed transparent PNG.

usage: cutout_black.py IN OUT [max_size]
Background = pixels connected to the border that are near-black; edge pixels get a soft
alpha ramp so glows and feathers blend instead of leaving a dark halo.
"""
import sys
from collections import deque
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
max_size = int(sys.argv[3]) if len(sys.argv) > 3 else 520
im = Image.open(src).convert("RGB")
w, h = im.size
px = im.load()
HARD, SOFT = 14, 46  # max-channel thresholds: <=HARD is background, HARD..SOFT fades in

# label near-black connected regions; background = touches the border or is a large enclosed pocket
bg = bytearray(w * h)
seen = bytearray(w * h)
POCKET = 900  # px; enclosed black areas bigger than this (between wings, inside halos) are background too
for sy in range(h):
    for sx in range(w):
        i0 = sy * w + sx
        if seen[i0] or max(px[sx, sy]) > HARD:
            continue
        comp, border = [], False
        q = deque([(sx, sy)])
        seen[i0] = 1
        while q:
            x, y = q.popleft()
            comp.append(y * w + x)
            if x in (0, w - 1) or y in (0, h - 1):
                border = True
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if not seen[j] and max(px[nx, ny]) <= HARD:
                        seen[j] = 1
                        q.append((nx, ny))
        if border or len(comp) >= POCKET:
            for j in comp:
                bg[j] = 1

alpha = Image.new("L", (w, h), 255)
a = alpha.load()
near = Image.frombytes("L", (w, h), bytes(255 if v else 0 for v in bg)).filter(ImageFilter.MaxFilter(5)).load()
for y in range(h):
    for x in range(w):
        if bg[y * w + x]:
            a[x, y] = 0
        elif near[x, y]:
            m = max(px[x, y])
            if m < SOFT:
                a[x, y] = int(255 * (m - HARD) / (SOFT - HARD))
out = im.convert("RGBA")
out.putalpha(alpha)
out = out.crop(out.getbbox())
out.thumbnail((max_size, max_size), Image.LANCZOS)
out.save(dst)
print(dst, out.size)
