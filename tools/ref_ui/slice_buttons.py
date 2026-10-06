#!/usr/bin/env python3
"""Cut the Higgsfield button sheets (tools/ref_ui/buttons/*.png) into the UI's button skins.

usage: slice_buttons.py   (writes public/assets/ui/btn/*.png and prints the 9-slice insets)
Each sheet has its pieces on plain white. dewhite.py keys the white out, then every connected piece is
cropped, ordered top-to-bottom / left-to-right, named, and scaled to a fixed height so the CSS
border-image slice values (in source pixels) are the same for every skin of a family.
"""
import os, subprocess, sys, tempfile
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "public", "assets", "ui", "btn")
SHEETS = {  # sheet -> (names in reading order, output height in px)
    "rect.png": (["blue", "gold", "green", "red"], 120),
    "round.png": (["round_blue", "round_gold", "round_red", "round_slate"], 128),
    "strips.png": (["strip_parch", "strip_slate", "strip_teal"], 72),
    "round2.png": (["round_green", "round_purple", "round_ivory", "round_orange"], 128),
    "rooms.png": (["room_dark", "room_lit", "room_gold", "room_locked"], 160),
}
os.makedirs(OUT, exist_ok=True)
for sheet, (names, height) in SHEETS.items():
    src = os.path.join(HERE, "buttons", sheet)
    tmp = os.path.join(tempfile.gettempdir(), "keyed_" + sheet)
    subprocess.run([sys.executable, "-I", os.path.join(HERE, "dewhite.py"), src, tmp], check=True, stdout=subprocess.DEVNULL)
    img = cv2.imread(tmp, cv2.IMREAD_UNCHANGED)
    alpha = img[..., 3]
    # enclosed white is never part of these pieces: fill any holes so the face is fully opaque
    m = (alpha > 40).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    parts = [st[i] for i in range(1, n) if st[i][4] > 5000]
    rows = sorted(parts, key=lambda s: (round(s[1] / 200), s[0]))
    if len(rows) != len(names):
        sys.exit(f"{sheet}: expected {len(names)} pieces, found {len(rows)}")
    for name, (x, y, w, h, _) in zip(names, rows):
        piece = img[y:y + h, x:x + w].copy()
        # solid interior: everything inside the outer silhouette is opaque
        sil = (lab[y:y + h, x:x + w] > 0).astype(np.uint8)
        cnts, _ = cv2.findContours(sil, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        solid = np.zeros_like(sil)
        cv2.drawContours(solid, cnts, -1, 1, -1)
        inner = cv2.erode(solid, np.ones((7, 7), np.uint8))
        piece[..., 3] = np.where(inner > 0, 255, piece[..., 3])
        # the key leaves a pale anti-aliased rim on the outer edge: pull the silhouette in by 3px and
        # feather it so the bronze frame ends on its own dark outline
        rim = cv2.erode(solid, np.ones((3, 3), np.uint8), iterations=3).astype(np.float32)
        rim = cv2.GaussianBlur(rim, (5, 5), 0)
        piece[..., 3] = (piece[..., 3].astype(np.float32) * rim).astype(np.uint8)
        scale = height / h
        piece = cv2.resize(piece, (max(1, round(w * scale)), height), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(OUT, name + ".png"), piece)
        print(f"{name}: {piece.shape[1]}x{piece.shape[0]}")
