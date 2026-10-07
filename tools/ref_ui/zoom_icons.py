#!/usr/bin/env python3
"""Painted plus / minus icons for the world map's zoom medallions.

usage: zoom_icons.py   (writes public/assets/ui/btn/icon_plus.png and icon_minus.png)
The glyph shapes are lifted from the original game's hero-stats screen (orig_screens/Herolvl31image.jpg), where
every stat has a green "+" and a red "-" button with a chunky white glyph. The white glyph is keyed out of each
button, cleaned up and re-shaded like the kit's silver play / fast-forward icons (orig/bk/play.png): a cool silver
face lit from the top-left, a bevel, and the kit's dark bronze outline, so it sits on the round bronze medallions.
"""
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "orig_screens", "Herolvl31image.jpg")
OUT = os.path.join(HERE, "..", "..", "public", "assets", "ui", "btn")
# button centres and radius in the 2048x1536 screenshot
BUTTONS = {"icon_plus": (215, 510), "icon_minus": (455, 510)}
R, SCALE, SIZE = 62, 4, 96


def glyph(cx, cy):
    im = Image.open(SRC).convert("RGB").crop((cx - R, cy - R, cx + R, cy + R))
    im = im.resize((im.width * SCALE, im.height * SCALE), Image.LANCZOS)
    a = np.asarray(im, np.float32)
    lum, sat = a.mean(2), a.max(2) - a.min(2)
    m = np.clip((lum - 170) / 50, 0, 1) * np.clip((90 - sat) / 40, 0, 1)  # white, unsaturated -> glyph
    yy, xx = np.mgrid[: m.shape[0], : m.shape[1]]
    m *= np.hypot(xx - m.shape[1] / 2, yy - m.shape[0] / 2) < R * SCALE * 0.8  # only inside the button
    # keep the glyph only (the button's gloss highlight is white too): the largest blob
    lab, n = ndimage.label(m > 0.5)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(m), lab, range(1, n + 1))
        m *= ndimage.binary_dilation(lab == 1 + int(np.argmax(sizes)), iterations=SCALE)
    # smooth the JPEG edges into a clean silhouette
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(SCALE * 1.2)), np.float32) / 255
    return np.clip((m - 0.5) * 6 + 0.5, 0, 1)


def shade(m):
    h, w = m.shape
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    # outline: the glyph grown by a few px, in the kit's dark bronze
    grow = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(4 * SCALE + 1)).filter(ImageFilter.GaussianBlur(SCALE * 0.6)), np.float32) / 255
    rgba = np.zeros((h, w, 4), np.float32)
    rgba[..., :3] = np.array([52, 38, 30], np.float32)
    rgba[..., 3] = grow * 255
    # silver face: bright top-left, cooler bottom-right, with a bevel from the blurred mask's slope
    t = np.clip((xx + yy) / (w + h), 0, 1)
    base = (236 - 70 * t)[..., None] * np.array([1.0, 1.01, 1.05], np.float32)
    soft = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(SCALE * 2.5)), np.float32) / 255
    gy, gx = np.gradient(soft)
    light = -(gx + gy) * SCALE * 9  # >0 on edges facing the top-left light
    face = np.clip(base + light[..., None] * 60, 0, 255)
    rgba[..., :3] = rgba[..., :3] * (1 - m[..., None]) + face * m[..., None]
    img = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8))
    bb = img.getbbox()
    img = img.crop(bb)
    s = SIZE / max(img.size)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    out = Image.new("RGBA", (SIZE, SIZE))
    out.alpha_composite(img, ((SIZE - img.width) // 2, (SIZE - img.height) // 2))
    return out


if __name__ == "__main__":
    for name, (cx, cy) in BUTTONS.items():
        shade(glyph(cx, cy)).save(os.path.join(OUT, name + ".png"))
        print("wrote", name)
