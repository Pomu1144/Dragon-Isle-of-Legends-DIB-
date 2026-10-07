#!/usr/bin/env python3
"""Make tileable versions of the battle-kit pieces that the DOM UI draws at many sizes.

usage: tile_fills.py
  panel_blue.png is only 208x91, so stretching its centre over a modal smears the mottled enamel into streaks.
  -> public/assets/ui/orig/bk/panel_blue_tiled.png: the same corners, frame and inner shadow, with the edges and
     the centre rebuilt as seamless tiles from the panel's own patches, so `border-image: ... fill repeat` can
     tile it at its painted scale on any panel size.
  bar_orange.png's enamel channel is cut into a horizontally tileable fill strip for the progress bars, and
  hue-shifted into blue (hero XP) and green (region explored).
  -> public/assets/ui/orig/bk/fill_orange.png, fill_blue.png, fill_green.png
"""
import os
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BK = os.path.join(HERE, "..", "..", "public", "assets", "ui", "orig", "bk")


def mirror_x(a):
    return np.concatenate([a, a[:, ::-1]], axis=1)


def splat(src, th, tw, ph, pw, n, seed=3):
    """Seamless th x tw texture: random (flipped) ph x pw patches of src laid on a torus with feathered edges.
    A patch as tall/wide as the target keeps that axis as is (used for the frame edges, which have a profile)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((th, tw, src.shape[2]), np.float32)
    done = np.zeros((th, tw), bool)
    yy, xx = np.mgrid[0:ph, 0:pw]
    d = np.full((ph, pw), 1e9)
    if ph < th:
        d = np.minimum(d, np.minimum(yy, ph - 1 - yy))
    if pw < tw:
        d = np.minimum(d, np.minimum(xx, pw - 1 - xx))
    m = np.clip((d + .5) / 8, 0, 1)
    m = (m * m * (3 - 2 * m))[..., None]
    for _ in range(n):
        sy, sx = rng.integers(0, src.shape[0] - ph + 1), rng.integers(0, src.shape[1] - pw + 1)
        patch = src[sy:sy + ph, sx:sx + pw]
        if pw < tw and rng.random() < .5:
            patch = patch[:, ::-1]
        if ph < th and rng.random() < .5:
            patch = patch[::-1]
        ys = (np.arange(ph) + (rng.integers(0, th) if ph < th else 0)) % th
        xs = (np.arange(pw) + (rng.integers(0, tw) if pw < tw else 0)) % tw
        ix = np.ix_(ys, xs)
        mm = np.where(done[ix][..., None], m, 1.0)
        out[ix] = out[ix] * (1 - mm) + patch * mm
        done[ix] = True
    return out


# ---- blue panel: frame insets (wood + dark line + soft inner shadow), measured from row/column means
p = cv2.imread(os.path.join(BK, "panel_blue.png"), cv2.IMREAD_UNCHANGED).astype(np.float32)
H, W = p.shape[:2]
T, R, B, L = 17, 22, 16, 18
TW, TH = 240, 160  # tile size of the new centre
mid = p[T:H - B, L:W - R, :3]
mid = mid / np.maximum(cv2.GaussianBlur(mid, (0, 0), 14), 1) * mid.reshape(-1, 3).mean(0)  # even out the light falloff
centre = splat(mid, TH, TW, 40, 40, 600)
# patch feathering softens the grain a little: restore the source's grain contrast around the tile's own mean
low = cv2.GaussianBlur(np.tile(centre, (3, 3, 1)), (0, 0), 6)[TH:2 * TH, TW:2 * TW]
grain = lambda a, lo: (a - lo).std((0, 1))
centre = mid.reshape(-1, 3).mean(0) + (centre - low) * grain(mid, cv2.GaussianBlur(mid, (0, 0), 6)) / grain(centre, low)
centre = np.dstack([centre, np.full((TH, TW), 255, np.float32)])
top, bottom = splat(p[:T, L:W - R], T, TW, T, 40, 40), splat(p[H - B:, L:W - R], B, TW, B, 40, 40)
left, right = splat(p[T:H - B, :L], TH, L, 40, L, 40), splat(p[T:H - B, W - R:], TH, R, 40, R, 40)
out = np.concatenate([
    np.concatenate([p[:T, :L], top, p[:T, W - R:]], axis=1),
    np.concatenate([left, centre, right], axis=1),
    np.concatenate([p[H - B:, :L], bottom, p[H - B:, W - R:]], axis=1),
], axis=0)
cv2.imwrite(os.path.join(BK, "panel_blue_tiled.png"), np.clip(out, 0, 255).astype(np.uint8))
print("panel_blue_tiled", out.shape[1], "x", out.shape[0], "slice", T, R, B, L)

# ---- bar fills: the orange enamel between the casing's rims, from the even stretch before its bright leading edge
o = cv2.imread(os.path.join(BK, "bar_orange.png"), cv2.IMREAD_UNCHANGED)
strip = mirror_x(o[7:40, 24:76, :3])
cv2.imwrite(os.path.join(BK, "fill_orange.png"), strip)
hsv = cv2.cvtColor(strip, cv2.COLOR_BGR2HSV).astype(np.int32)
for name, hue, sat in (("blue", 102, 0.9), ("green", 50, 0.85)):  # OpenCV hue is 0-180
    s = hsv.copy()
    s[..., 0] = (s[..., 0] - 12 + hue) % 180
    s[..., 1] = (s[..., 1] * sat).astype(np.int32)
    cv2.imwrite(os.path.join(BK, f"fill_{name}.png"), cv2.cvtColor(s.astype(np.uint8), cv2.COLOR_HSV2BGR))
print("fills", strip.shape[1], "x", strip.shape[0])
