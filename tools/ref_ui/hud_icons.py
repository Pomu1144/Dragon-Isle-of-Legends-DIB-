#!/usr/bin/env python3
"""HUD / M-menu icons made from the kit's painted pieces.

usage: hud_icons.py   (writes public/assets/ui/btn/coin_{silver,gold}.png and orig/bk/btn_hero.png, cleans orig/town/menu_m.png)
- coins: the bronze-rimmed round_gold / round_ivory medallions (the ivory face re-toned to silver), lit from the top-left
  like metal and minted with an engraved inner ring and a star in relief, downsized to 64px.
- btn_hero: the town map's hero portrait disc set into btn_gear's bronze ring, so the Hero row matches the other medallions.
- menu_m: the cut-out kept near-black scraps outside the frame (top 3 rows, the outer 2 columns, the bottom 2 rows); they are made transparent.
"""
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
UI = os.path.join(HERE, "..", "..", "public", "assets", "ui")
load = lambda *p: np.array(Image.open(os.path.join(UI, *p)).convert("RGBA")).astype(np.float32)
save = lambda a, *p: Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(os.path.join(UI, *p))


def polar(img):
    a = img[..., 3]
    ys, xs = np.where(a > 128)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    yy, xx = np.mgrid[: img.shape[0], : img.shape[1]].astype(np.float32)
    return cx, cy, xx - cx, yy - cy, np.hypot(xx - cx, yy - cy)


def coin(src, face_r, silver, out):
    img = load("btn", src)
    cx, cy, dx, dy, r = polar(img)
    rgb = img[..., :3]
    face = np.clip(face_r + 0.5 - r, 0, 1)[..., None]  # soft-edged face mask, the bronze rim stays as painted
    if silver:  # ivory enamel -> cool silver
        lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
        rgb = rgb * (1 - face) + face * lum[..., None] * np.array([0.93, 0.97, 1.04], np.float32)
    # metal sheen: bright top-left, darker bottom-right
    t = np.clip(((dx + dy) / (2 * face_r) + 1) / 2, 0, 1)[..., None]
    rgb = rgb * (1 - face) + face * rgb * ((1.12 if silver else 1.3) - (0.42 if silver else 0.4) * t)
    # engraved inner ring
    ring = np.clip(1.4 - np.abs(r - face_r * 0.8), 0, 1)[..., None] * face
    up = (-(dx + dy) / np.maximum(r, 1) / 1.42)[..., None]  # +1 on the top-left half
    rgb = rgb * (1 - ring * (0.35 + 0.25 * up)) + ring * np.clip(-up, 0, 1) * 70
    # a five-point star struck in relief (4x supersampled), lit from the top-left
    ss, R = 4, face_r * 0.56
    pts = [(cx + (R if i % 2 == 0 else R * 0.45) * np.sin(i * np.pi / 5), cy + 1 - (R if i % 2 == 0 else R * 0.45) * np.cos(i * np.pi / 5)) for i in range(10)]
    big = Image.new("L", (r.shape[1] * ss, r.shape[0] * ss))
    ImageDraw.Draw(big).polygon([(x * ss, y * ss) for x, y in pts], fill=255)
    m = np.array(big.resize((r.shape[1], r.shape[0]), Image.LANCZOS), np.float32) / 255
    s = 3
    edge = (m - np.roll(np.roll(m, s, 0), s, 1))[..., None]  # >0 on the lit top-left edges, <0 bottom-right
    rgb = rgb * (1 + 0.1 * m[..., None]) + np.clip(edge, 0, 1) * 80 - np.clip(-edge, 0, 1) * rgb * 0.45
    img[..., :3] = rgb
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    im.resize((64, round(im.height * 64 / im.width)), Image.LANCZOS).save(os.path.join(UI, "btn", out))


def hero_medallion():
    gear = load("orig", "bk", "btn_gear.png")
    hero = Image.open(os.path.join(UI, "orig", "town", "hero.png")).convert("RGBA")
    cx, cy, _, _, r = polar(gear)
    face_r, pr, (hx, hy) = 52, 41, (58, 50)  # gear face radius; portrait disc radius and centre in hero.png
    port = hero.crop((hx - pr, hy - pr, hx + pr, hy + pr)).resize((round(2 * face_r),) * 2, Image.LANCZOS)
    canvas = Image.new("RGBA", (gear.shape[1], gear.shape[0]))
    canvas.paste(port, (round(cx - face_r), round(cy - face_r)))
    out = np.array(canvas, np.float32)
    inside = np.clip(face_r + 0.5 - r, 0, 1)
    out[..., 3] = 255 * inside
    ring = np.clip(r - (face_r - 1.5), 0, 1)[..., None] * (gear[..., 3:] / 255)  # btn_gear's rim and dark inner edge
    out[..., :3] = out[..., :3] * (1 - ring) + gear[..., :3] * ring
    out[..., 3] = np.maximum(out[..., 3] * (r < face_r), gear[..., 3] * (r >= face_r - 1.5))
    save(out, "orig", "bk", "btn_hero.png")


def clean_menu_m():
    img = load("orig", "town", "menu_m.png")
    h, w = img.shape[:2]
    lum = img[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    outer = np.zeros((h, w), bool)
    outer[:3], outer[h - 2 :], outer[:, :2], outer[:, w - 2 :] = True, True, True, True
    img[..., 3][outer & (lum < 60)] = 0
    save(img, "orig", "town", "menu_m.png")


coin("round_ivory.png", 48.5, True, "coin_silver.png")
coin("round_gold.png", 45.5, False, "coin_gold.png")
hero_medallion()
clean_menu_m()
