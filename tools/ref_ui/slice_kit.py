#!/usr/bin/env python3
"""Slice the Monsterpedia UI kit (transparent PNG sheet) into game assets.

usage: slice_kit.py kit.png page.jpg OUT_DIR
  kit.png   - the UI sheet: 5 empty cards, 6 tabs, plank, back button, loose crown/socket/chain/box
  page.jpg  - parchment page extracted from the original screenshot (extract.py)
Writes OUT_DIR/{card_a.png, card_b.png, tab1..6.png, plank.png, back.png, page.jpg, layout.json}.
All coordinates in layout.json are in the kit's 1536x1024 space.
"""
import json, os, sys
import numpy as np
import cv2

KIT, PAGE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
kit = cv2.imread(KIT, cv2.IMREAD_UNCHANGED)
H, W = kit.shape[:2]
n, lab, stats, _ = cv2.connectedComponentsWithStats((kit[..., 3] > 40).astype(np.uint8), 8)
comps = sorted([tuple(int(v) for v in s[:4]) for s in stats[1:] if s[4] > 500], key=lambda c: (c[1] // 60, c[0]))


def piece(c, pad=2):
    x, y, w, h = c
    x0, y0 = max(0, x - pad), max(0, y - pad)
    return kit[y0:y + h + pad, x0:x + w + pad].copy(), (x0, y0)


cards = [c for c in comps if c[2] > 300 and c[3] > 350]
tabs = sorted([c for c in comps if 200 < c[2] < 260 and 100 < c[3] < 140 and c[0] > 1200 and c[1] < 850], key=lambda c: c[1])
plank = max(comps, key=lambda c: c[2] if c[3] < 150 else 0)
back = [c for c in comps if c[0] > 1290 and c[1] > 850][0]
print("cards", cards, "\ntabs", tabs, "\nplank", plank, "back", back)


def erase_silhouette(img, cx, cy, r):
    """Replace the placeholder silhouette inside the round element socket with the socket's
    own parchment tone, so element icons sit on a clean socket."""
    yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]]
    d = np.hypot(xx - cx, yy - cy)
    inner = d < r * 0.86
    ring = (d > r * 0.74) & (d < r * 0.84)
    bgr = img[..., :3].astype(np.float32)
    lum = bgr.mean(-1)
    tone = np.median(bgr[ring & (lum > np.percentile(lum[ring], 40))], 0)
    # soft radial vignette like the socket's rim shading
    shade = 1 - 0.18 * (d / (r * 0.86)) ** 2
    fill = tone[None, None, :] * shade[..., None]
    rng = np.random.default_rng(5)
    fill = fill + rng.normal(0, 3, fill.shape)
    edge = np.clip((r * 0.86 - d) / 3, 0, 1)[..., None]
    bgr = np.where(inner[..., None], bgr * (1 - edge) + fill * edge, bgr)
    img[..., :3] = np.clip(bgr, 0, 255).astype(np.uint8)
    return img


# locate the round element socket in each card (Hough circle in the lower panel)
layout = {"size": [W, H], "cards": [], "tabs": [], "plank": None, "back": None}
variants = {}
for i, c in enumerate(cards):
    img, (ox, oy) = piece(c)
    h = img.shape[0]
    g = cv2.medianBlur(cv2.cvtColor(img[..., :3], cv2.COLOR_BGR2GRAY), 5)
    circles = cv2.HoughCircles(g[h - 172:], cv2.HOUGH_GRADIENT, 1.2, 40, param1=80, param2=25, minRadius=34, maxRadius=50)[0]
    cx, cy, _ = min(circles, key=lambda q: abs(q[0] - img.shape[1] * 0.49))
    cy += h - 172
    r = 42
    key = "a" if c[3] > 420 else "b"
    if key not in variants:
        variants[key] = dict(img=erase_silhouette(img, cx, cy, r), socket=[round(float(cx)), round(float(cy)), r], size=[img.shape[1], img.shape[0]])
        cv2.imwrite(os.path.join(OUT, f"card_{key}.png"), variants[key]["img"])
    layout["cards"].append({"x": ox, "y": oy, "variant": key})
for k, v in variants.items():
    layout[f"card_{k}"] = {"size": v["size"], "socket": v["socket"]}
for i, c in enumerate(tabs):
    img, (ox, oy) = piece(c)
    cv2.imwrite(os.path.join(OUT, f"tab{i + 1}.png"), img)
    layout["tabs"].append({"x": ox, "y": oy, "w": img.shape[1], "h": img.shape[0]})
img, (ox, oy) = piece(plank)
# remove the baked "My Monsters" label so the game can write either label
lbl = np.zeros(img.shape[:2], np.uint8)
x0, x1 = int(img.shape[1] * 0.28), int(img.shape[1] * 0.95)
y0, y1 = int(img.shape[0] * 0.3), int(img.shape[0] * 0.75)
region = img[y0:y1, x0:x1, :3]
dark = (region.max(-1) < 90).astype(np.uint8) * 255
lbl[y0:y1, x0:x1] = cv2.dilate(dark, np.ones((5, 5), np.uint8))
img[..., :3] = cv2.inpaint(img[..., :3], lbl, 6, cv2.INPAINT_TELEA)
cv2.imwrite(os.path.join(OUT, "plank.png"), img)
layout["plank"] = {"x": ox, "y": oy, "w": img.shape[1], "h": img.shape[0], "label": [x0, y0, x1, y1]}
img, (ox, oy) = piece(back)
cv2.imwrite(os.path.join(OUT, "back.png"), img)
layout["back"] = {"x": ox, "y": oy, "w": img.shape[1], "h": img.shape[0]}

# parchment page at the kit's aspect, without the old low-res tabs/plank baked into it
page = cv2.imread(PAGE)
ph, pw = page.shape[:2]
hole = np.zeros((ph, pw), np.uint8)
cv2.rectangle(hole, (950, 20), (pw, 868), 255, -1)      # old tabs (incl. a 7th behind the plank)
cv2.rectangle(hole, (815, 770), (pw, 868), 255, -1)     # old plank
q = 4
KERNEL = np.array([[0, .25, 0], [.25, 0, .25], [0, .25, 0]], np.float32)
sm = cv2.resize(page, (pw // q, ph // q), interpolation=cv2.INTER_AREA).astype(np.float32)
hm = cv2.resize(hole, (pw // q, ph // q), interpolation=cv2.INTER_NEAREST) > 0
solve = hm.copy()
solve[: 26 // q, :] = True
solve[866 // q:, :] = True
solve[:, 1150 // q:] = True       # the right edge is all tab art: don't let it tint the parchment
sm[solve] = sm[~solve].mean(0)
for _ in range(4000):
    avg = cv2.filter2D(sm, -1, KERNEL, borderType=cv2.BORDER_REPLICATE)  # no wrap-around at the edges
    sm[solve] = avg[solve]
fit = cv2.resize(sm, (pw, ph), interpolation=cv2.INTER_CUBIC)
tex = page[445:745, 665:915].astype(np.float32)
grain = tex - cv2.GaussianBlur(tex, (0, 0), 5)
grain = np.tile(grain, (ph // grain.shape[0] + 1, pw // grain.shape[1] + 1, 1))[:ph, :pw]
soft = cv2.GaussianBlur(hole, (0, 0), 5).astype(np.float32)[..., None] / 255
# keep the grass band at the top/bottom edge
soft[:24] = 0
soft[868:] = 0
page = (page * (1 - soft) + np.clip(fit + grain, 0, 255) * soft).astype(np.uint8)
cv2.imwrite(os.path.join(OUT, "page.jpg"), cv2.resize(page, (W, H), interpolation=cv2.INTER_CUBIC), [cv2.IMWRITE_JPEG_QUALITY, 90])
json.dump(layout, open(os.path.join(OUT, "layout.json"), "w"), indent=1)
print(json.dumps(layout))
