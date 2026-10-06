#!/usr/bin/env python3
"""Dump the Dragon Island Blue Fandom wiki (wikitext + image index) via the MediaWiki API."""
import json, os, sys, time, urllib.parse, urllib.request

API = "https://dragonislandblue.fandom.com/api.php"
OUT = sys.argv[1] if len(sys.argv) > 1 else "raw"

def get(params):
    params = {**params, "format": "json", "formatversion": "2"}
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "DIB-remake-scraper/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            time.sleep(2 ** attempt)
    raise RuntimeError(url)

def walk(params, key):
    cont = {}
    while True:
        d = get({**params, **cont})
        yield from d["query"][key]
        if "continue" not in d:
            return
        cont = d["continue"]

os.makedirs(OUT, exist_ok=True)
titles = [p["title"] for p in walk({"action": "query", "list": "allpages", "aplimit": "500"}, "allpages")]
pages = {}
for i in range(0, len(titles), 50):
    d = get({"action": "query", "prop": "revisions|categories", "rvprop": "content", "rvslots": "main",
             "cllimit": "max", "titles": "|".join(titles[i:i + 50])})
    for p in d["query"]["pages"]:
        if "revisions" in p:
            pages[p["title"]] = {
                "text": p["revisions"][0]["slots"]["main"]["content"],
                "categories": [c["title"].split(":", 1)[1] for c in p.get("categories", [])],
            }
images = {}
for im in walk({"action": "query", "list": "allimages", "ailimit": "500", "aiprop": "url|size|mime"}, "allimages"):
    images[im["name"]] = {"url": im["url"], "w": im.get("width"), "h": im.get("height"), "mime": im.get("mime")}
json.dump(pages, open(os.path.join(OUT, "pages.json"), "w"), indent=1)
json.dump(images, open(os.path.join(OUT, "images.json"), "w"), indent=1)
print(len(pages), "pages,", len(images), "images")
