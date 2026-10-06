#!/usr/bin/env python3
"""Cut the Higgsfield discovery markers (chest, tent, tower, lair) off their white backgrounds.

usage: discoveries.py   (reads tools/ref_ui/disc/*.png, writes public/assets/ui/orig/disc/*.png)
"""
import os, subprocess, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "public", "assets", "ui", "orig", "disc")
os.makedirs(OUT, exist_ok=True)
for name in ("chest", "tent", "tower", "lair"):
    dst = os.path.join(OUT, name + ".png")
    subprocess.run([sys.executable, "-I", os.path.join(HERE, "dewhite.py"), os.path.join(HERE, "disc", name + ".png"), dst], check=True,
                   stdout=subprocess.DEVNULL)
    im = Image.open(dst)
    im = im.crop(im.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox())
    im.thumbnail((256, 256), Image.LANCZOS)
    im.save(dst, optimize=True)
    print(name, im.size)
