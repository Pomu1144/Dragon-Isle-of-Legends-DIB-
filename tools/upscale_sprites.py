#!/usr/bin/env python3
"""Upscale the monster sprites with Real-ESRGAN (x4plus anime 6B), keeping their transparency.

usage: upscale_sprites.py MODEL.pth SRC_DIR DST_DIR [names...]
Needs torch, numpy, opencv (run it from a virtualenv; see README). The wiki sprites are small (median
117 px), so each is upscaled 4x by the network, fitted to at most MAX_SIDE px and written as NNN.webp
next to the original (tools/build_data.py prefers the .webp when one exists). Transparent
pixels are first filled with the nearest opaque colour so edges don't pick up a dark halo, and the
alpha channel is upscaled by the same network so outlines stay crisp.
"""
import os, sys
import cv2
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

MAX_SIDE = 512
WEBP_QUALITY = 90


class RDB(nn.Module):
    def __init__(self, nf=64, gc=32):
        super().__init__()
        self.conv1 = nn.Conv2d(nf, gc, 3, 1, 1)
        self.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1)
        self.conv3 = nn.Conv2d(nf + 2 * gc, gc, 3, 1, 1)
        self.conv4 = nn.Conv2d(nf + 3 * gc, gc, 3, 1, 1)
        self.conv5 = nn.Conv2d(nf + 4 * gc, nf, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(0.2, True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        return self.conv5(torch.cat((x, x1, x2, x3, x4), 1)) * 0.2 + x


class RRDB(nn.Module):
    def __init__(self, nf=64, gc=32):
        super().__init__()
        self.rdb1, self.rdb2, self.rdb3 = RDB(nf, gc), RDB(nf, gc), RDB(nf, gc)

    def forward(self, x):
        return self.rdb3(self.rdb2(self.rdb1(x))) * 0.2 + x


class RRDBNet(nn.Module):
    """Real-ESRGAN generator (same layer names as the released weights)."""
    def __init__(self, nb=6, nf=64, gc=32):
        super().__init__()
        self.conv_first = nn.Conv2d(3, nf, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(nf, gc) for _ in range(nb)])
        self.conv_body = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_hr = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_last = nn.Conv2d(nf, 3, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(0.2, True)

    def forward(self, x):
        feat = self.conv_first(x)
        feat = feat + self.conv_body(self.body(feat))
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode='nearest')))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode='nearest')))
        return self.conv_last(self.lrelu(self.conv_hr(feat)))


def run(net, bgr):
    t = torch.from_numpy(bgr[..., ::-1].astype(np.float32) / 255).permute(2, 0, 1)[None]
    pad = 8  # reflect-pad so borders don't darken
    t = F.pad(t, (pad, pad, pad, pad), mode='reflect')
    with torch.no_grad():
        out = net(t).clamp(0, 1)[0, :, pad * 4:-pad * 4, pad * 4:-pad * 4]
    return (out.permute(1, 2, 0).numpy()[..., ::-1] * 255).round().astype(np.uint8)


def bleed(bgr, alpha):
    """Fill transparent pixels with the nearest opaque colour (prevents dark halos)."""
    known = (alpha > 8).astype(np.uint8)
    if known.all() or not known.any():
        return bgr
    _, idx = cv2.distanceTransformWithLabels(1 - known, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(known)
    lut = np.zeros((idx.max() + 1, 3), np.uint8)
    lut[idx[ys, xs]] = bgr[ys, xs]
    return lut[idx]


def upscale(net, img):
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGRA)
    if img.shape[2] == 3:
        img = np.dstack([img, np.full(img.shape[:2], 255, np.uint8)])
    bgr, alpha = img[..., :3], img[..., 3]
    filled = bleed(bgr, alpha)
    rgb_up = run(net, filled)
    a_up = run(net, cv2.cvtColor(alpha, cv2.COLOR_GRAY2BGR))[..., 1]
    # the anime model flattens soft shading toward white: keep its crisp detail (high frequencies) but
    # take the broad colour and shading (low frequencies) from a plain resize of the original
    h, w = rgb_up.shape[:2]
    base = cv2.resize(filled, (w, h), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    sigma = 3.0
    hi = rgb_up.astype(np.float32) - cv2.GaussianBlur(rgb_up.astype(np.float32), (0, 0), sigma)
    rgb_up = np.clip(cv2.GaussianBlur(base, (0, 0), sigma) + hi, 0, 255).astype(np.uint8)
    out = np.dstack([rgb_up, a_up])
    h, w = out.shape[:2]
    target = min(MAX_SIDE, max(img.shape[:2]) * 4)
    s = target / max(h, w)
    if s < 1:
        out = cv2.resize(out, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    return out


if __name__ == '__main__':
    model, src, dst = sys.argv[1:4]
    # the small *_icon.png thumbnails stay as they are
    names = sys.argv[4:] or sorted(f for f in os.listdir(src) if f.lower().endswith('.png') and not f.endswith('_icon.png'))
    torch.set_num_threads(os.cpu_count() or 4)
    net = RRDBNet()
    sd = torch.load(model, map_location='cpu')
    net.load_state_dict(sd.get('params_ema', sd.get('params', sd)), strict=True)
    net.eval()
    os.makedirs(dst, exist_ok=True)
    for i, n in enumerate(names):
        img = cv2.imread(os.path.join(src, n), cv2.IMREAD_UNCHANGED)
        if img is None:
            print('skip', n)
            continue
        out = os.path.join(dst, os.path.splitext(n)[0] + '.webp')
        if os.path.exists(out):
            continue  # already done (lets an interrupted run resume); delete the .webp to redo it
        big = img if max(img.shape[:2]) >= MAX_SIDE else upscale(net, img)
        cv2.imwrite(out, big, [cv2.IMWRITE_WEBP_QUALITY, WEBP_QUALITY])
        print(f'{i + 1}/{len(names)} {n} {img.shape[1]}x{img.shape[0]}', flush=True)
