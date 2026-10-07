#!/usr/bin/env python3
"""The selected-tab skin: the painted blue button, lit up.

usage: tab_skin.py   (reads public/assets/ui/btn/blue.png, writes public/assets/ui/btn/tab_on.png)
Gold enamel is kept for primary (confirm) buttons, so a selected tab needs its own look. This keeps the blue
button's bronze frame and rivets exactly as painted and only re-tones the enamel: a brighter turquoise, lit from
inside with a soft glow towards the centre and a sheen along the top, like a gem with a lamp behind it.
"""
import colorsys
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
BTN = os.path.join(HERE, "..", "..", "public", "assets", "ui", "btn")

img = np.asarray(Image.open(os.path.join(BTN, "blue.png")).convert("RGBA"), np.float32)
rgb = img[..., :3] / 255
mx, mn = rgb.max(2), rgb.min(2)
hsv = np.vectorize(colorsys.rgb_to_hsv, otypes=[np.float32] * 3)(rgb[..., 0], rgb[..., 1], rgb[..., 2])
h, s, v = hsv
# enamel = blue-ish hue with some saturation; the bronze frame is orange and stays untouched
enamel = np.clip((s - 0.18) / 0.1, 0, 1) * (np.abs(h - 0.54) < 0.12)
H, W = enamel.shape
yy, xx = np.mgrid[:H, :W].astype(np.float32)
# inner light: strongest in the middle of the enamel, plus a sheen along its top third
glow = np.exp(-(((xx - W / 2) / (W * 0.38)) ** 2 + ((yy - H * 0.52) / (H * 0.42)) ** 2))
sheen = np.exp(-(((yy - H * 0.3) / (H * 0.1)) ** 2)) * 0.35
h2 = np.full_like(h, 0.49)  # turquoise
s2 = np.clip(s * 0.85, 0, 1)
v2 = np.clip(v * 1.12 + 0.18 * glow + sheen * v, 0, 1)
lit = np.stack(np.vectorize(colorsys.hsv_to_rgb, otypes=[np.float32] * 3)(h2, s2, v2), -1)
out = rgb * (1 - enamel[..., None]) + lit * enamel[..., None]
img[..., :3] = out * 255
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(os.path.join(BTN, "tab_on.png"))
print("wrote tab_on.png")
