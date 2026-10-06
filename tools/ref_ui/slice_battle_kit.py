#!/usr/bin/env python3
"""Slice the battle UI kit (white-background sheet, keyed by dewhite.py) into named assets.

usage: slice_battle_kit.py kit_rgba.png OUT_DIR
"""
import json, os, sys
import numpy as np
import cv2

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
k = cv2.imread(SRC, cv2.IMREAD_UNCHANGED)

R = {  # x, y, w, h in sheet pixels (from dewhite.py's component index)
    "bar_red": (48, 731, 216, 44), "bar_orange": (281, 729, 215, 46), "bar_empty": (511, 729, 214, 46),
    "qbar_red": (42, 503, 167, 23), "qbar_orange": (41, 602, 169, 23),
    "coin": (1114, 54, 74, 74), "minicard": (1209, 25, 125, 149),
    "actor_box": (235, 233, 253, 261), "hero_frame": (1268, 233, 234, 261),
    "card_tail": (491, 256, 185, 128), "card_outrage": (683, 256, 186, 128), "card_flame": (876, 256, 186, 128), "card_locked": (1069, 256, 191, 130),
    "info": (49, 888, 62, 61),
    "btn_flee": (236, 542, 125, 127), "btn_monsters": (366, 541, 127, 128), "btn_scroll": (494, 541, 127, 128),
    "btn_book": (626, 541, 126, 128), "btn_bag": (762, 541, 127, 127), "btn_gear": (896, 541, 126, 127),
    "fx_tornado": (1063, 545, 129, 132), "fx_ring": (1205, 563, 113, 93), "fx_sparkle": (1328, 561, 71, 70), "fx_silver": (1408, 566, 99, 51),
    "fx_web": (877, 848, 134, 138), "fx_red": (1035, 852, 129, 134), "fx_green": (1185, 857, 125, 133), "fx_target": (1327, 850, 137, 141),
    "candle_small": (1243, 695, 46, 148), "candle_tall": (1320, 659, 47, 195), "candle_double": (1381, 659, 111, 195),
    "panel_blue": (741, 727, 208, 91), "panel_parch": (968, 727, 233, 91),
    "pause": (134, 873, 87, 88), "play": (257, 883, 63, 72), "ff": (356, 883, 100, 70), "fff": (490, 883, 103, 69),
    "crystal": (637, 894, 31, 59), "arrow": (692, 875, 55, 94), "close": (767, 891, 72, 74),
}
PAD = 3
meta = {}
for name, (x, y, w, h) in R.items():
    img = k[max(0, y - PAD):y + h + PAD, max(0, x - PAD):x + w + PAD].copy()
    if name == "coin":
        # keep only the coin disc (drop the end of the "Blood Priest" label) and erase the baked "0"
        hh, ww = img.shape[:2]
        disc = np.zeros((hh, ww), np.uint8)
        cv2.circle(disc, (ww // 2 + 1, hh // 2), min(hh, ww) // 2 - 1, 255, -1)
        inner = np.zeros((hh, ww), np.uint8)
        cv2.ellipse(inner, (ww // 2 + 1, hh // 2), (int(ww * .22), int(hh * .32)), 0, 0, 360, 255, -1)
        c = img[..., :3].copy()
        # the white digit was keyed out as background: repaint it from the surrounding metal
        digit = (((img[..., 3] < 230) | (c.min(-1) > 150)) & (inner > 0)).astype(np.uint8) * 255
        img[..., 3] = disc
        img[..., :3] = cv2.inpaint(c, cv2.dilate(digit, np.ones((5, 5), np.uint8)), 6, cv2.INPAINT_TELEA)
    if name == "actor_box":
        # the box ships with an HP bar at the bottom; keep it, the game draws the fill
        pass
    ys, xs = np.nonzero(img[..., 3] > 8)
    img = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    cv2.imwrite(os.path.join(OUT, name + ".png"), img)
    meta[name] = [int(img.shape[1]), int(img.shape[0])]
json.dump(meta, open(os.path.join(OUT, "pieces.json"), "w"), indent=1)
print(json.dumps(meta))
