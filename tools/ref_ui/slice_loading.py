#!/usr/bin/env python3
"""Build the loading-screen art (public/assets/loading/).

usage: slice_loading.py
  plaque.webp: the cracked terracotta title plaque (tools/ref_ui/loading/plaque.jpg, painted on white),
    keyed with dewhite.py and fitted to PLAQUE_W px.
  bg.jpg: the Dragon Isle panel of the stitched world map, cropped close around the island like the
    original game's loading screen and sized to 1920x1080.
The monsters standing around the plaque are the game's own (upscaled) sprites, referenced from index.html.
"""
import os, subprocess, sys, tempfile
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
OUT = os.path.join(ROOT, "public", "assets", "loading")
PLAQUE_W = 960
os.makedirs(OUT, exist_ok=True)

tmp = os.path.join(tempfile.gettempdir(), "keyed_plaque.png")
subprocess.run([sys.executable, "-I", os.path.join(HERE, "dewhite.py"), os.path.join(HERE, "loading", "plaque.jpg"), tmp], check=True, stdout=subprocess.DEVNULL)
img = cv2.imread(tmp, cv2.IMREAD_UNCHANGED)
ys, xs = np.nonzero(img[..., 3] > 20)
img = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
h, w = img.shape[:2]
img = cv2.resize(img, (PLAQUE_W, round(h * PLAQUE_W / w)), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(OUT, "plaque.webp"), img, [cv2.IMWRITE_WEBP_QUALITY, 92])
print("plaque", img.shape[1], "x", img.shape[0])

# the Dragon Isle is the south-west panel (column 0, row 1) of the 3x2 world; see tools/stitch_world.py
world = cv2.imread(os.path.join(ROOT, "public", "assets", "maps", "world_0.jpg"))
PW, PH, OV = 2736, 1536, 320
x0, y0 = 0, PH - OV
panel = world[y0:y0 + PH, x0:x0 + PW]
# 16:9 window over the island's heart (mountains, forests, farmland) so land fills the screen
cx, cy, cw = 1330, 760, 1900
ch = round(cw * 9 / 16)
crop = panel[cy - ch // 2:cy - ch // 2 + ch, cx - cw // 2:cx - cw // 2 + cw]
cv2.imwrite(os.path.join(OUT, "bg.jpg"), cv2.resize(crop, (1920, 1080), interpolation=cv2.INTER_CUBIC), [cv2.IMWRITE_JPEG_QUALITY, 76, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
print("bg 1920 x 1080")
