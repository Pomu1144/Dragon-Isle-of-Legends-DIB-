#!/usr/bin/env python3
"""Download every image listed in images.json (from scrape_wiki.py) into an output dir."""
import json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

idx, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
images = json.load(open(idx))

def fetch(item):
    name, meta = item
    dest = os.path.join(out, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    req = urllib.request.Request(meta["url"], headers={"User-Agent": "DIB-remake-scraper/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
            f.write(r.read())
    except Exception as e:
        print("FAIL", name, e)

with ThreadPoolExecutor(8) as ex:
    list(ex.map(fetch, images.items()))
print("done", len(os.listdir(out)))
