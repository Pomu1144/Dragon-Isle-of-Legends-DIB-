#!/usr/bin/env python3
"""Extract a 1:1 Monsterpedia UI kit from a screenshot of the original game.

usage: extract.py reference.jpg OUT_DIR
Writes OUT_DIR/card.png (the empty card frame) and OUT_DIR/page.jpg (the book page with its
tabs and plank but no cards, page counter or plank label). Everything stays in the reference's
1170x879 pixel space; src/ui/book.ts places live content at the same coordinates.
"""
import itertools, os, sys
import numpy as np
import cv2

REF, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
img = cv2.imread(REF)  # BGR
H, W = img.shape[:2]
CW, CH = 272, 342
NOMINAL = [(58, 36), (356, 36), (653, 36), (58, 425), (356, 425)]


def crop(x, y):
    return img[y:y + CH, x:x + CW].astype(np.float32)


# ---------------------------------------------------------------- align cards on their frames
frame = np.zeros((CH, CW), np.uint8)
frame[:, :14] = frame[:, -14:] = 1
frame[:12, :] = frame[-10:, :] = 1
ref = crop(653, 36)
origins = []
for (x0, y0) in NOMINAL:
    best = min(((np.abs(crop(x0 + dx, y0 + dy) - ref).sum(2) * frame).sum(), x0 + dx, y0 + dy)
               for dy in range(-4, 5) for dx in range(-4, 5))
    origins.append(best[1:])
print("card origins", origins)

# ---------------------------------------------------------------- consensus template
# Shared parts (frame, portrait backdrop, crown, chain, panels) look the same on every card;
# per-monster content almost never matches between two cards at the same pixel. So the template
# value of a pixel is the mean of the closest-agreeing pair of cards, if they agree.
stack = np.stack([crop(x, y) for x, y in origins])
blur = np.stack([cv2.GaussianBlur(c, (0, 0), 1.2) for c in stack])
best_d = np.full((CH, CW), np.inf, np.float32)
card = np.zeros((CH, CW, 3), np.float32)
for i, j in itertools.combinations(range(len(stack)), 2):
    d = np.abs(blur[i] - blur[j]).mean(-1)
    better = d < best_d
    best_d[better] = d[better]
    card[better] = ((stack[i] + stack[j]) / 2)[better]
hole = (best_d > 14).astype(np.uint8) * 255
c8 = card.astype(np.uint8)
teal = (c8[..., 0].astype(int) > c8[..., 2].astype(int) + 18)
portrait = np.zeros((CH, CW), bool)
portrait[66:204, 38:234] = True   # inner area only: the copper corner brackets are not teal
hole[portrait & ~teal] = 255

# per-monster slots that may coincide on two cards (same element, same star count, same digit)
slots = np.zeros((CH, CW), np.uint8)
cv2.rectangle(slots, (24, 22), (248, 47), 255, -1)          # name (keep strip, drop text below)
cv2.rectangle(slots, (88, 229), (198, 262), 255, -1)        # star row
cv2.circle(slots, (142, 293), 32, 255, -1)                  # element icon
cv2.circle(slots, (60, 297), 11, 255, -1)                   # crown digit
cv2.rectangle(slots, (209, 288), (252, 320), 255, -1)       # pedia number
card = card.astype(np.uint8)
lum = card.mean(-1)
name_text = np.zeros_like(slots)
name_text[22:48, 24:249] = ((lum[22:48, 24:249] < 120) * 255).astype(np.uint8)
mask = cv2.dilate(np.maximum(hole, name_text), np.ones((3, 3), np.uint8))
mask[slots > 0] = 255
mask[22:48, 24:249] = cv2.dilate(name_text, np.ones((5, 5), np.uint8))[22:48, 24:249] | hole[22:48, 24:249]


def row_fill(im, fill, grain_src, pad=3):
    """Fill masked pixels row by row: linear blend between the clean pixels on either side of
    each masked run, plus fine grain borrowed from clean pixels of the same row."""
    out = im.astype(np.float32).copy()
    hp = out - cv2.GaussianBlur(out, (0, 0), 2)
    rng = np.random.default_rng(7)
    for y in range(im.shape[0]):
        row = fill[y]
        if not row.any():
            continue
        cleanx = np.nonzero(grain_src[y] & ~row)[0]
        x = 0
        while x < im.shape[1]:
            if not row[x]:
                x += 1
                continue
            x0 = x
            while x < im.shape[1] and row[x]:
                x += 1
            x1 = x
            L = out[y, max(0, x0 - 2 * pad):max(1, x0 - pad)].mean(0) if x0 > pad else out[y, x1 + pad:x1 + 2 * pad].mean(0)
            R = out[y, x1 + pad:x1 + 2 * pad].mean(0) if x1 + 2 * pad < im.shape[1] else L
            t = np.linspace(0, 1, x1 - x0 + 2)[1:-1, None]
            out[y, x0:x1] = L * (1 - t) + R * t
            if len(cleanx):
                out[y, x0:x1] += hp[y, rng.choice(cleanx, x1 - x0)] * 0.8
    return np.clip(out, 0, 255).astype(np.uint8)


# only ever repaint the inner areas; the frame, corner ornaments, crown and chain stay original
region = np.zeros((CH, CW), bool)
region[24:47, 26:246] = True       # name strip interior
region[62:208, 26:246] = True      # portrait interior (inside the copper corner brackets)
region[230:262, 86:200] = True     # star row
el_c = np.zeros((CH, CW), np.uint8); cv2.circle(el_c, (142, 293), 31, 255, -1)
region |= el_c > 0
fillm = cv2.dilate(((mask > 0) & region).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
fillm &= region
fillm |= (el_c > 0)
filled = row_fill(card, fillm, region)
# soften the row-wise interpolation vertically so no horizontal streaks remain, keep grain
smooth = cv2.GaussianBlur(filled.astype(np.float32), (0, 0), sigmaX=1.2, sigmaY=5)
grainy = filled.astype(np.float32) - cv2.GaussianBlur(filled.astype(np.float32), (0, 0), 1.5)
soft = cv2.GaussianBlur(fillm.astype(np.float32), (0, 0), 1.5)[..., None]
card = np.clip(filled * (1 - soft) + (smooth + grainy * 0.6) * soft, 0, 255).astype(np.uint8)
rest = ((mask > 0) & ~region).astype(np.uint8) * 255
card = cv2.inpaint(card, rest, 3, cv2.INPAINT_TELEA)


def row_color_fill(im, shape_mask, pick):
    """Fill `shape_mask` with, per row, the median colour of pixels that `pick` accepts across
    all five cards in that row of the shape's bounding box, plus fine grain."""
    out = im.astype(np.float32).copy()
    ys, xs = np.nonzero(shape_mask)
    x0, x1 = xs.min(), xs.max() + 1
    rng = np.random.default_rng(3)
    for y in np.unique(ys):
        px = stack[:, y, x0:x1].reshape(-1, 3)
        good = px[pick(px)]
        if len(good) < 4:
            continue
        col = np.median(good, 0)
        sel = xs[ys == y]
        out[y, sel] = col + rng.normal(0, 3.5, (len(sel), 1))
    return np.clip(out, 0, 255).astype(np.uint8)


lum_of = lambda px: px.mean(1)
green = lambda px: (px[:, 1] > px[:, 2] - 5) & (px[:, 1] > px[:, 0]) & (lum_of(px) > 150)
blue = lambda px: (px[:, 0] > px[:, 2] + 15) & (lum_of(px) > 150)
el = np.zeros((CH, CW), np.uint8); cv2.circle(el, (142, 293), 33, 255, -1)
st = np.zeros((CH, CW), np.uint8); cv2.rectangle(st, (88, 228), (198, 262), 255, -1)
nb = np.zeros((CH, CW), np.uint8); cv2.rectangle(nb, (210, 289), (251, 319), 255, -1)
card = row_color_fill(card, nb > 0, blue)
# crown gem: take it from the Wolf card, whose "1" covers the least, and patch only the digit
wolf = stack[4].astype(np.uint8)
gem = np.zeros((CH, CW), np.uint8); cv2.circle(gem, (60, 297), 14, 255, -1)
card[gem > 0] = wolf[gem > 0]
digit = ((wolf.mean(-1) < 70) & (gem > 0)).astype(np.uint8) * 255
card = cv2.inpaint(card, cv2.dilate(digit, np.ones((3, 3), np.uint8)), 3, cv2.INPAINT_TELEA)
# transparent outside the card's chamfered frame: per row, keep only the span between the
# outermost dark frame pixels (frame is consistent across all cards, so use their median)
med = np.median(stack, 0).mean(-1)
left = np.full(CH, CW, float); right = np.full(CH, -1.0)
for y in range(CH):
    dark = np.nonzero(med[y] < 95)[0]
    if len(dark):
        left[y], right[y] = dark[0], dark[-1]
# the outline is straight except at the chamfers: smooth out single-row dropouts
from scipy.ndimage import median_filter  # noqa: E402
left = median_filter(left, 9, mode="nearest"); right = median_filter(right, 9, mode="nearest")
alpha = np.zeros((CH, CW), np.uint8)
for y in range(CH):
    if right[y] >= 0:
        alpha[y, max(0, int(left[y]) - 1):min(CW, int(right[y]) + 2)] = 255
alpha = cv2.GaussianBlur(alpha, (3, 3), 0.8)
cv2.imwrite(os.path.join(OUT, "card.png"), np.dstack([card, alpha]))
print("inpainted card px", int((mask > 0).sum()))

# ---------------------------------------------------------------- page background
page = img.copy()
holes = np.zeros((H, W), np.uint8)
for x, y in origins:
    cv2.rectangle(holes, (x - 12, y - 12), (x + CW + 14, y + CH + 34), 255, -1)
cv2.rectangle(holes, (1005, 640), (1165, 745), 255, -1)    # "Pg 1/1 / Found 2%"
cv2.circle(holes, (102, 768), 60, 255, -1)                 # screenshot lens overlay
cv2.circle(holes, (108, 792), 52, 255, -1)
# membrane (Laplace) fill at quarter resolution: matches the surrounding parchment exactly at
# every hole edge and varies smoothly inside
q = 4
KERNEL = np.array([[0, .25, 0], [.25, 0, .25], [0, .25, 0]], np.float32)
sm = cv2.resize(page, (W // q, H // q), interpolation=cv2.INTER_AREA).astype(np.float32)
hm = cv2.resize(holes, (W // q, H // q), interpolation=cv2.INTER_NEAREST) > 0
solve = hm.copy()
solve[: 30 // q, :] = True          # grass above the page must not tint the parchment
solve[:, : 50 // q] = True          # nor the leather cover on the left
solve[860 // q:, :] = True
solve[:, 1000 // q:] = solve[:, 1000 // q:] & hm[:, 1000 // q:]
sm[solve] = sm[~solve].mean(0)
for _ in range(5000):
    avg = cv2.filter2D(sm, -1, KERNEL, borderType=cv2.BORDER_REPLICATE)  # no wrap-around at the edges
    sm[solve] = avg[solve]
fit = cv2.resize(cv2.GaussianBlur(sm, (0, 0), 1), (W, H), interpolation=cv2.INTER_CUBIC)
tex = img[445:745, 665:915].astype(np.float32)                 # empty 6th slot = clean parchment
grain = tex - cv2.GaussianBlur(tex, (0, 0), 5)
grain = np.tile(grain, (H // grain.shape[0] + 1, W // grain.shape[1] + 1, 1))[:H, :W]
filled = np.clip(fit + grain, 0, 255).astype(np.uint8)
soft = cv2.GaussianBlur(holes, (0, 0), 6).astype(np.float32)[..., None] / 255
page = (page * (1 - soft) + filled * soft).astype(np.uint8)
# plank label
label = np.zeros((H, W), np.uint8)
lab = img[798:848, 905:1080]
label[798:848, 905:1080] = cv2.dilate(((lab.max(2) < 140) * 255).astype(np.uint8), np.ones((7, 7), np.uint8))
page = cv2.inpaint(page, label, 7, cv2.INPAINT_TELEA)
cv2.imwrite(os.path.join(OUT, "page.jpg"), page, [cv2.IMWRITE_JPEG_QUALITY, 92])
print("wrote", OUT)
