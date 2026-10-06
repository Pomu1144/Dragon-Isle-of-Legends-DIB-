#!/usr/bin/env python3
"""Turn the scraped Dragon Island Blue wiki dump into game-ready JSON.

usage: build_data.py RAW_DIR OUT_DIR
  RAW_DIR contains pages.json + images.json (scrape_wiki.py) and img/ (download_images.py)
"""
import json, os, random, re, shutil, statistics, sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from wikiparse import strip, files, links, tables, section, drop_templates

RAW, OUT = sys.argv[1], sys.argv[2]
pages = json.load(open(os.path.join(RAW, "pages.json")))
imgs = set(os.listdir(os.path.join(RAW, "img")))
ELEMENTS = ["Fire", "Water", "Air", "Earth", "Life", "Death", "Arcane"]
STATS = {"HP": "hp", "Attack": "atk", "Magic": "mag", "Speed": "spd", "Defense": "def", "Defence": "def", "Resist": "res"}


def page(title):
    seen = 0
    while title in pages and seen < 4:
        t = pages[title]["text"]
        m = re.match(r"\s*#REDIRECT\s*\[\[([^\]|#]+)", t, re.I)
        if not m:
            return t
        title, seen = m.group(1).strip(), seen + 1
    return pages.get(title, {}).get("text", "")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


# ---------------------------------------------------------------- monster index
ml = page("Monster List")
ml = ml[ml.find("The Full List"):]
index = []
for tb in tables(ml):
    for r in tb:
        if not r or not re.match(r"^\d{3}", r[0].strip()):
            continue
        num = int(r[0].strip()[:3])
        name = strip(r[2])
        evo = strip(r[3])
        el = next((e for e in ELEMENTS if e in r[4]), None)
        stars = float(re.findall(r"[\d.]+", strip(r[5]) or "0")[0]) if re.findall(r"[\d.]+", strip(r[5])) else None
        index.append(dict(id=num, name=name, evo=evo, element=el, stars=stars, location=strip(r[6]) if len(r) > 6 else "",
                          listimg=(files(r[1]) or [None])[0]))
names = {m["name"].lower(): m for m in index}
names["crab king"] = names.get("crab king")


def find_monster(s):
    return names.get(strip(s).lower().strip())


# -------------------------------------------------------------- per-page parsing
def parse_stats(text):
    for tb in tables(text):
        rows = {}
        header = None
        for r in tb:
            key = strip(r[0])
            if key in ("Level", "Rank"):
                header = [strip(c) for c in r[1:]]
            if key in STATS:
                nums = [int(x) for c in r[1:] for x in re.findall(r"^\d+$", strip(c).replace(",", ""))]
                if nums:
                    rows[STATS[key]] = nums
        if len(rows) >= 5:
            kind = "rank" if header and any("S" in h or "F" in h for h in header) else "level"
            if header and header[0] not in ("1", "") and kind == "level":
                kind = "rank"
            first = {k: v[0] for k, v in rows.items()}
            last = {k: v[-1] for k, v in rows.items()}
            return kind, first, last, header
    return None, None, None, None


TARGETS = [
    (r"all foes and all|all foes, all", "all"),
    (r"all (foe|enem|fiend)|^all$", "allFoes"),
    (r"all (all|friend)", "allAllies"),
    (r"(2|two) foe", "twoFoes"),
    (r"(1|one) (ally|friend)", "ally"),
    (r"self|itself|user|this monster", "self"),
    (r"(1|one)? ?foe|^1$|^2$", "foe"),
]


def parse_target(t):
    t = t.lower().strip()
    if t in ("-", ""):
        return "passive"
    for pat, v in TARGETS:
        if re.search(pat, t):
            return v
    return "foe"


STATUS = [
    ("stun", r"stun"), ("sleep", r"sleep(?! &)|to sleep"), ("paralyze", r"paralyz"), ("confuse", r"confus"),
    ("doom", r"killed after|will die after|killed when the duration|kills the target after"),
    ("taunt", r"more likely to attack this|taunt|attack this monster more"), ("disguise", r"less likely to attack|disguis"),
    ("noguard", r"no guard"), ("berserk", r"berserk|chooses its own target"),
]


def parse_effect(name, tu, target, eff):
    e = eff
    el = lambda s: next((x for x in ELEMENTS if x.lower() in s.lower()), None)
    a = {"name": name, "tu": tu, "target": target, "text": eff}
    if re.match(r"\s*removes?\b", e, re.I) and not re.search(r"damage", e, re.I):
        a["cleanse"] = "all" if re.search(r"all effects", e, re.I) else "bad"
        if target == "passive" or tu is None:
            a["passive"] = True
        return a
    m = re.search(r"(\d+)\s*-\s*(\d+)\s*(?:\w+\s+)?(physical|magical)?\s*(?:damage|dmg)", e, re.I)
    if not m:
        m = re.search(r"(\d+)\s*-\s*(\d+)\s*(physical|magical)?", e, re.I) if re.search(r"damage", e, re.I) and not re.search(r"^\s*(poison|deals \w+ damage over)", e, re.I) else None
    if m:
        a["dmg"] = [int(m.group(1)), int(m.group(2))]
        a["kind"] = (m.group(3) or ("magical" if re.search("magic", e, re.I) else "physical")).lower()
        a["element"] = el(e[m.end():m.end() + 25]) or el(e)
    elif re.search(r"(physical|magical) damage", e, re.I) and not re.search(r"over", e, re.I):
        a["kind"] = "magical" if re.search("magic", e, re.I) else "physical"
        a["element"] = el(e)
        a["dmg"] = None  # unknown magnitude: estimated later from TU
        if re.search(r"\(high\)|heavy", e, re.I): a["mag"] = 1.6
        if re.search(r"\(low\)|low ", e, re.I): a["mag"] = 0.7
    m = re.search(r"heals? (?:for )?(\d+)% of (?:the )?damage", e, re.I)
    if m: a["drain"] = int(m.group(1))
    m = re.search(r"(?:heals|\+)\s*(\d+)\s*-\s*(\d+)\s*hp", e, re.I)
    if m: a["heal"] = [int(m.group(1)), int(m.group(2))]
    if re.search(r"sacrific", e, re.I):
        if re.search(r"party that is(?:n't)? (?:not )?(?:in|outside)|monster in your party", e, re.I):
            a["sacrificeBench"] = True
        else:
            m = re.search(r"(\d+)% chance", e, re.I)
            a["selfSacrifice"] = int(m.group(1)) if m else 100
    if re.search(r"random monster", e, re.I): a["summonRandom"] = True
    if re.search(r"copy", e, re.I): a["clone"] = True
    if re.search(r"escape", e, re.I): a["escape"] = True
    if re.search(r"removes? (all effects|effects?:|sleep|poison)", e, re.I):
        a["cleanse"] = "all" if re.search("all effects", e, re.I) else "bad"
    if re.search(r"immun", e, re.I): a["immune"] = True
    if re.search(r"see (the )?(incoming|enem)|party order|enemies coming", e, re.I): a["scout"] = True
    if re.search(r"adds monster's defense|adds this monster's defense", e, re.I): a["defToAtk"] = True
    m = re.search(r"(?:reflect|counters?)\D*(\d+)|(\d+) damage reflected", e, re.I)
    if m: a["reflect"] = int(m.group(1) or m.group(2))
    m = re.search(r"hurts self for (\d+)%", e, re.I)
    if m: a["recoil"] = int(m.group(1))
    m = re.search(r"\+?(\d+(?:\.\d+)?)%[^.,;]*?(?:per|for every) (?:kill|ally killed|friendly casualty)", e, re.I) or re.search(r"(\d+)% per ally killed", e, re.I)
    if m: a["perKill"] = float(m.group(1))
    m = re.search(r"(\d+(?:\.\d+)?)%[^.,;]*?per (\d+)\s*tus?", e, re.I)
    if m: a["perTU"] = [float(m.group(1)), int(m.group(2))]
    m = re.search(r"(\d+)%[^.,;]*?(?:alone|last monster)", e, re.I)
    if m: a["alone"] = int(m.group(1))
    for t in ["Humanoid", "Demonic", "Metal", "Dragon", "Divine", "Water", "Sleep"]:
        m = re.search(r"\+?(\d+)%?\s*(?:damage|effect)?\s*(?:vs\.?|VS)\s*" + t, e, re.I)
        if m: a.setdefault("vs", {})[t.lower()] = int(m.group(1))
    m = re.search(r"(?:speeds? up actions? by|slows? actions? by|slows target)\s*(-?\d+)?%?", e, re.I)
    if m:
        n = int(m.group(1)) if m.group(1) else 30
        a["haste"] = -abs(n) if re.search(r"slow|by -", e, re.I) else n
    m = re.search(r"poison", e, re.I)
    if m or re.search(r"damage over|over the duration|over \d+ tu", e, re.I):
        dm = re.findall(r"(\d+)\s*-\s*(\d+)[^.;]*?(?:damage)?[^.;]*?(?:over|additional)", e, re.I)
        dur = re.search(r"(?:duration:?\s*|for |over )(\d+)", e, re.I)
        a["poison"] = {"dmg": [int(x) for x in dm[-1]] if dm else None, "tu": int(dur.group(1)) if dur else 300,
                       "element": el(e)}
        if dm and "dmg" in a and a["dmg"] == [int(x) for x in dm[-1]] and not re.search(r"physical|magical", e, re.I):
            del a["dmg"]
    for st, pat in STATUS:
        if re.search(pat, e, re.I):
            dur = re.search(r"(\d+)\s*tu", e, re.I) or re.search(r"duration\s*:?\s*(\d+)", e, re.I)
            a["status"] = {"type": st, "tu": int(dur.group(1)) if dur else (400 if st == "doom" else 300)}
            break
    # stat changes: +N Attack / Increases Defense by N / -N Resist / Decreases Attack by N
    mods = {}
    e = re.sub(r"(\d)\s*-\s*(\d)", r"\1~\2", e)
    for sign, amt, stats in re.findall(r"([+-])\s*(\d+)\s+((?:attack|magic|defen[sc]e|resist|speed)(?:\s*(?:,|and)\s*(?:attack|magic|defen[sc]e|resist))*)", e, re.I):
        for s in re.findall(r"attack|magic|defen[sc]e|resist|speed", stats, re.I):
            mods[s.lower()[:3]] = int(amt) * (1 if sign == "+" else -1)
    for verb, stats, amt in re.findall(r"(increases?|inreases?|inrceases?|decreases?|decrease)\s+((?:attack|magic|defen[sc]e|resist)(?:\s*(?:,|and|&)\s*(?:attack|magic|defen[sc]e|resist))*)\s*(?:by)?\s*(\d+)?", e, re.I):
        for s in re.findall(r"attack|magic|defen[sc]e|resist", stats, re.I):
            mods[s.lower()[:3]] = int(amt or 20) * (-1 if verb.lower().startswith("decr") else 1)
    if mods:
        a["mods"] = {{"att": "atk", "mag": "mag", "def": "def", "res": "res", "spe": "spd"}[k]: v for k, v in mods.items()}
    if target == "passive" or tu is None:
        a["passive"] = True
    return a


def parse_abilities(text):
    out = []
    sec = section(text, "Abilities") or section(text, "Skills")
    for tb in tables(sec):
        for r in tb:
            r = [strip(c) for c in r]
            if len(r) < 4 or r[0].lower() in ("name", "") or "form" in r[0].lower():
                continue
            name = r[0].strip("[] ")
            tum = re.search(r"\d+", r[1])
            tu = int(tum.group()) if tum else None
            target = parse_target(r[2])
            out.append(parse_effect(name, tu, target, r[3]))
    return out


def parse_evolution(text, me):
    sec = section(text, "Evolution")
    return sec


def parse_type(text, name):
    sec = strip(section(text, "Cat[ae]gory") or "")
    return sec.split()[0] if sec else None


monsters = []
for m in index:
    t = page(m["name"])
    kind, first, last, header = parse_stats(t)
    infobox_img = re.search(r"\|\s*image\s*=\s*(?:\[\[)?(?:file|File|Image):([^|\]\n]+)", t)
    abil = parse_abilities(t)
    evo_level = re.search(r"Level (\d+)", m["evo"])
    evo_into = re.search(r"\((.+?)\)", m["evo"])
    obtain = strip(section(t, "How to Obtain") or section(t, "Location") or "")
    body = re.sub(r"\{\|.*?\n\|\}", "", drop_templates(t), flags=re.S)
    body = re.sub(r"\[\[Category:[^\]]*\]\]", "", body)
    body = re.sub(r"^=+[^=\n]*=+\s*$", "\n", body, flags=re.M)
    paras = [strip(x) for x in re.split(r"\n\s*\n", body) if not x.strip().startswith(("*", "#", ":"))]
    bad = re.compile(r"found|obtain|recipe|location|evolve|floor|capture|level \d|all abilities|reflected|following|tile|quest", re.I)
    lore = next((x for x in paras if len(x) > 40 and not bad.search(x) and not x.endswith(":")), "")[:400]
    monsters.append(dict(
        id=m["id"], name=m["name"], element=m["element"] or "Arcane", stars=m["stars"] or 3,
        evolveLevel=int(evo_level.group(1)) if evo_level else None,
        evolveInto=strip(evo_into.group(1)) if evo_into else None,
        location=m["location"], obtain=obtain[:300], lore=lore,
        statKind=kind, statsFirst=first, statsLast=last, abilities=abil,
        category=parse_type(t, m["name"]),
        _imgs=[x for x in [infobox_img.group(1).strip() if infobox_img else None, m["listimg"]] if x],
    ))
byname = {m["name"]: m for m in monsters}
byid = {m["id"]: m for m in monsters}

# evolutions where list says "Level N" without target: next id in sequence
for m in monsters:
    if m["evolveLevel"] and not m["evolveInto"] and m["id"] + 1 in byid:
        m["evolveInto"] = byid[m["id"] + 1]["name"]
    if m["evolveInto"] and m["evolveInto"] not in byname:
        alt = find_monster(m["evolveInto"])
        m["evolveInto"] = alt["name"] if alt else None

# ---------------------------------------------------------------- monster types
types = defaultdict(set)
for tp, title in [("dragon", "Dragon Monsters"), ("humanoid", "Humanoid Monsters"), ("demonic", "Demonic Monsters")]:
    for l in links(page(title)):
        mm = find_monster(l.split("/")[-1].replace("_", " "))
        if mm: types[mm["name"]].add(tp)
    for l in re.findall(r"wiki/([A-Za-z_]+)", page(title)):
        mm = find_monster(l.replace("_", " "))
        if mm: types[mm["name"]].add(tp)
for m in monsters:
    n = m["name"].lower()
    if re.search(r"dragon|wyrm|drake|hydra|hatchling|dragoon|wyvern|nessie|serpent", n): types[m["name"]].add("dragon")
    if re.search(r"iron|steel|metal|armor", n): types[m["name"]].add("metal")
    if re.search(r"angel|cherub|divine|god|holy|sphinx", n): types[m["name"]].add("divine")
    if re.search(r"demon|imp|lich|devil|dementor|abomination|fiend", n): types[m["name"]].add("demonic")
    if (m["category"] or "").lower().startswith("dragon"): types[m["name"]].add("dragon")
    m["types"] = sorted(types[m["name"]])

# ---------------------------------------------------------------- stat normalisation
# Pages give either level-1 stats or rank (F-..S+, roughly lv 75) stats.  We express every monster
# as level-1 base stats so the in-game growth curve (stat * (1 + G*(lv-1))) applies uniformly.
G = 0.075
def total(s): return sum(s.get(k, 0) for k in ("hp", "atk", "mag", "spd", "def", "res"))
lvl1 = [(m["stars"], total(m["statsFirst"])) for m in monsters if m["statKind"] == "level" and m["statsFirst"] and len(m["statsFirst"]) >= 6]
# linear fit total ~ a + b*stars
xs, ys = zip(*lvl1)
mx, my = statistics.mean(xs), statistics.mean(ys)
b = sum((x - mx) * (y - my) for x, y in lvl1) / sum((x - mx) ** 2 for x in xs)
a = my - b * mx
pred = lambda s: max(60, a + b * s)
ratios = [total(m["statsLast"]) / pred(m["stars"]) for m in monsters if m["statKind"] == "rank" and m["statsLast"] and len(m["statsLast"]) >= 6]
rank_factor = statistics.median(ratios) if ratios else 10
SHAPE = {"hp": .27, "atk": .14, "mag": .14, "spd": .17, "def": .14, "res": .14}
for m in monsters:
    ref = None
    if m["statKind"] == "level" and m["statsFirst"] and len(m["statsFirst"]) >= 6:
        base, ref = dict(m["statsFirst"]), dict(m["statsFirst"])
    elif m["statKind"] == "rank" and m["statsLast"] and len(m["statsLast"]) >= 6:
        ref = dict(m["statsLast"])
        base = {k: max(1, round(v / rank_factor)) for k, v in ref.items()}
    else:
        tot = pred(m["stars"])
        base = {k: max(2, round(tot * f)) for k, f in SHAPE.items()}
    # dragon overlord / boss-ish monsters keep relative shape but are clamped to sane totals
    m["base"] = {k: base.get(k, 5) for k in ("hp", "atk", "mag", "spd", "def", "res")}
    floor = pred(m["stars"]) * 0.8  # some wiki stat tables are partial; keep every species viable
    if total(m["base"]) < floor:
        k = floor / max(1, total(m["base"]))
        m["base"] = {s: max(1, round(v * k)) for s, v in m["base"].items()}
    m["_ref"] = ref or m["base"]
    del m["statsFirst"], m["statsLast"], m["statKind"]

# the four starter hatchlings are mirror images of each other in the original game
hatch = [m for m in monsters if m["name"].endswith("Hatchling")]
best = max(hatch, key=lambda m: total(m["base"]))
for m in hatch:
    m["base"] = dict(best["base"])

# ---------------------------------------------------------------- ability coefficients
# Convert absolute damage / buff numbers (which were measured at the wiki's reference level)
# into coefficients of the caster's stats so they scale with level.
def dmg_powers(abilities, ref):
    out = []
    for ab in abilities:
        if ab.get("dmg") and "kind" in ab:
            out.append(((ab["dmg"][0] + ab["dmg"][1]) / 2) / max(1, ref["atk"] if ab["kind"] == "physical" else ref["mag"]))
    return out


for m in monsters:
    ref = m.pop("_ref")
    pw = dmg_powers(m["abilities"], ref)
    if pw and statistics.median(pw) < 0.6:
        # ability numbers were recorded at a lower level than the stat table: measure against base stats
        pw2 = dmg_powers(m["abilities"], m["base"])
        if statistics.median(pw2) <= 4:
            ref = m["base"]
    clean = []
    for ab in m["abilities"]:
        if ab.get("dmg") is not None and "kind" in ab:
            stat = ref["atk"] if ab["kind"] == "physical" else ref["mag"]
            ab["power"] = round(((ab["dmg"][0] + ab["dmg"][1]) / 2) / max(1, stat), 3)
        elif "kind" in ab:
            ab["power"] = round((ab.get("tu") or 130) / 100 * ab.pop("mag", 1.0), 3)
        if ab.get("heal"):
            ab["healPower"] = round(((ab["heal"][0] + ab["heal"][1]) / 2) / max(1, ref["mag"]), 3)
        if ab.get("poison"):
            p = ab["poison"]
            p["power"] = round(((p["dmg"][0] + p["dmg"][1]) / 2) / max(1, max(ref["atk"], ref["mag"])), 3) if p.get("dmg") else 0.6
        if ab.get("mods"):
            ab["mods"] = {k: max(-0.6, min(1.0, round(v / max(1, ref.get(k, 10)), 3))) for k, v in ab["mods"].items()}
        if ab.get("reflect"):
            ab["reflect"] = round(ab["reflect"] / max(1, ref["hp"]), 3)
        for k in ("dmg", "heal"):
            ab.pop(k, None)
        if ab.get("poison"):
            ab["poison"].pop("dmg", None)
        ab["power"] = min(max(ab["power"], 0.4), 4.5) if "power" in ab else None
        if ab["power"] is None:
            ab.pop("power")
        clean.append(ab)
    dp = [a["power"] for a in clean if a.get("dmg") is None and "power" in a and "kind" in a]
    if dp and statistics.median(dp) < 0.6:
        k = 1.0 / statistics.median(dp)
        for a in clean:
            if "power" in a: a["power"] = round(min(4.5, a["power"] * k), 3)
    if not any(not x.get("passive") for x in clean):
        el = m["element"]
        clean.insert(0, {"name": "Strike", "tu": 100, "target": "foe", "kind": "physical", "element": el, "power": 1.0, "text": "Basic attack"})
        clean.append({"name": f"{el} Bolt", "tu": 140, "target": "foe", "kind": "magical", "element": el, "power": 1.5, "text": f"Magical damage ({el})"})
    m["abilities"] = clean

# ---------------------------------------------------------------- sprites
def save_sprite(src, dst):
    """Copy a sprite as RGBA PNG, flood-filling a flat background colour to transparent when needed."""
    from PIL import Image, ImageDraw
    im = Image.open(src).convert("RGBA")
    if im.getextrema()[3][0] == 255:  # fully opaque
        w, h = im.size
        for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
            if im.getpixel(corner)[3]:
                ImageDraw.floodfill(im, corner, (0, 0, 0, 0), thresh=40)
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    im.save(dst)


def norm(s): return re.sub(r"[^a-z0-9]", "", s.lower())
imgnorm = defaultdict(list)
for f in imgs:
    imgnorm[norm(os.path.splitext(f)[0])].append(f)
SPR = os.path.join(OUT, "..", "sprites")
os.makedirs(SPR, exist_ok=True)
missing = []
for m in monsters:
    cands = []
    for c in m.pop("_imgs") + [m["name"].replace(" ", "_") + ".png", m["name"] + ".png"]:
        c = c.replace(" ", "_")
        if c in imgs: cands.append(c)
        cands += imgnorm.get(norm(os.path.splitext(c)[0]), [])
    key = norm(m["name"])
    cands += imgnorm.get(key, []) + imgnorm.get(f"{m['id']:03d}{key}", []) + imgnorm.get(key + "hd", [])
    # prefer transparent PNGs
    cands = [c for c in dict.fromkeys(cands)]
    from PIL import Image

    def has_alpha(f):
        try:
            return Image.open(os.path.join(RAW, "img", f)).convert("RGBA").getextrema()[3][0] == 0
        except Exception:
            return False
    cands = [c for c in cands if "icon" not in c.lower() or len(cands) == 1]
    cands.sort(key=lambda f: (not has_alpha(f), not f.lower().endswith(".png"), "-hd" not in f))
    if cands:
        src = cands[0]
        dst = f"{m['id']:03d}.png"
        save_sprite(os.path.join(RAW, "img", src), os.path.join(SPR, dst))
        m["sprite"] = dst
        m["spriteSource"] = src
        icon = next((f for f in imgnorm.get(key + "icon", [])), None)
        if icon:
            shutil.copy(os.path.join(RAW, "img", icon), os.path.join(SPR, f"{m['id']:03d}_icon.png"))
            m["icon"] = f"{m['id']:03d}_icon.png"
    else:
        m["sprite"] = None
        missing.append(m["name"])

# ---------------------------------------------------------------- original UI icons (stars, elements, menu icons)
UI = os.path.join(OUT, "..", "ui")
os.makedirs(UI, exist_ok=True)
for f in ["StarIcon.png", "HalfStarIcon.png", "MonsterpediaIcon.png"] + [f"Element_{e}.png" for e in ELEMENTS]:
    if f in imgs:
        shutil.copy(os.path.join(RAW, "img", f), os.path.join(UI, f.lower().replace("_", "-")))

# ---------------------------------------------------------------- custom (non-wiki) monsters
CUSTOM = os.path.join(os.path.dirname(__file__), "custom")
if os.path.exists(os.path.join(CUSTOM, "monsters.json")):
    for c in json.load(open(os.path.join(CUSTOM, "monsters.json")))["monsters"]:
        dst = f"{c['id']:03d}.png"
        shutil.copy(os.path.join(CUSTOM, "sprites", c["sprite"]), os.path.join(SPR, dst))
        parent = byname[c["evolvesFrom"]] if c.get("evolvesFrom") in byname else None
        m = {"id": c["id"], "name": c["name"], "element": c["element"], "stars": c["stars"], "evolveLevel": None, "evolveInto": None,
             "location": f"Evolves from {c['evolvesFrom']} at level {c['evolveLevel']}." if parent else "", "obtain": "", "lore": c.get("lore", ""),
             "abilities": c["abilities"], "category": None, "types": c.get("types", []), "base": c["base"], "sprite": dst,
             "spriteSource": "custom/" + c["sprite"], "custom": True}
        monsters = [x for x in monsters if x["id"] != c["id"]] + [m]
        byname[m["name"]] = m
        byid[m["id"]] = m
        names[m["name"].lower()] = m
        if parent:
            parent["evolveLevel"], parent["evolveInto"] = c["evolveLevel"], c["name"]

# HD sprites: tools/upscale_sprites.py writes NNN.webp next to NNN.png; the game uses those when present
# (delete a .webp and re-run the upscaler after replacing its .png)
for m in monsters:
    if m.get("sprite"):
        hd = os.path.splitext(m["sprite"])[0] + ".webp"
        if os.path.exists(os.path.join(SPR, hd)):
            m["sprite"] = hd

# ---------------------------------------------------------------- regions / towns / dungeons
REGIONS = [  # 4x4 grid exactly as on the in-game world map, with progression tier 0..15
    ("Forest of Mangal", 0, 0, 3), ("Norwoods", 1, 0, 6), ("North Earlsome", 2, 0, 10), ("Swinedene", 3, 0, 15),
    ("Ringfeld", 0, 1, 2), ("Safaris", 1, 1, 5), ("South Earlsome", 2, 1, 8), ("Endergate", 3, 1, 12),
    ("Northern Alvalon", 0, 2, 1), ("Greater Wesing", 1, 2, 4), ("Wesburn", 2, 2, 9), ("Saintspring", 3, 2, 13),
    ("Southern Alvalon", 0, 3, 0), ("Western Gracia", 1, 3, 7), ("Eastern Gracia", 2, 3, 11), ("Applefield", 3, 3, 14),
    # the Underworld is not on the island grid: it lies across the sea east of Saintspring and is
    # reached by boat from the Saintspring dock (or through the Unknown Relic, as in the original)
    ("Underworld", 4, 2, 16),
]
SEA_REGIONS = {"Underworld"}
TERRAIN = {"Forest of Mangal": "forest", "Norwoods": "mountain", "North Earlsome": "snow", "Swinedene": "beach",
           "Ringfeld": "meadow", "Safaris": "meadow", "South Earlsome": "mountain", "Endergate": "river",
           "Northern Alvalon": "beach", "Greater Wesing": "meadow", "Wesburn": "mountain", "Saintspring": "river",
           "Southern Alvalon": "meadow", "Western Gracia": "forest", "Eastern Gracia": "volcano", "Applefield": "meadow",
           "Underworld": "underworld"}


def monsters_in(text):
    found = []
    for l in links(text) + re.findall(r"link=([^\]|]+)", text) + re.findall(r"wiki/([A-Za-z_]+)", text):
        mm = find_monster(l.split("/")[-1].replace("_", " "))
        if mm and mm["name"] not in found:
            found.append(mm["name"])
    for line in text.split("\n"):
        mm = find_monster(re.sub(r"^\W*\d+\W*", "", strip(line)))
        if mm and mm["name"] not in found:
            found.append(mm["name"])
    return found


towns, dungeons = {}, {}
town_titles = [k for k, v in pages.items() if "Towns" in v["categories"]]
dungeon_titles = [k for k, v in pages.items() if "Dungeons" in v["categories"]] + ["The Abyss"]
region_names = [r[0] for r in REGIONS]


def locate(text):
    for r in region_names:
        if r in strip(text):
            return r
    if "Wesburn" in text: return "Wesburn"
    return None


TOWN_REGION_FALLBACK = {"Dundean": "Endergate", "Lorensia": "Western Gracia", "Ilios": "Underworld", "Wesing": "Greater Wesing",
                        "Longdale": "South Earlsome", "Olympia": "Applefield", "Corova": "Southern Alvalon", "Westguard": "Northern Alvalon"}
for t in sorted(set(town_titles)):
    text = page(t)
    quests = []
    for tb in tables(text):
        for r in tb:
            if len(r) >= 3 and strip(r[0]) not in ("Title", ""):
                quests.append({"title": strip(r[0]), "type": strip(r[1]), "text": strip(r[2]).strip('"')})
    if not quests:  # free-form quest list (e.g. Longdale)
        for title, desc in re.findall(r"\n([A-Z][\w' -]{2,30})\n+\"([^\"]+)\"", text):
            quests.append({"title": title.strip(), "type": "Battle", "text": desc})
    region = TOWN_REGION_FALLBACK.get(t) or locate(section(text, "Location") or text)
    towns[t] = {"name": t, "region": region, "quests": quests, "about": strip(text.split("==")[0])[:300],
                "arena": "License Test" in text, "tournament": t in ("Westguard", "Ilios")}

DUNGEON_REGION_FALLBACK = {"Lighthouse": "Ringfeld", "Holy Cave": "Saintspring", "Ruins": "Underworld", "Giant Mangal": "Forest of Mangal",
                           "North Cave": "Norwoods", "Pirate's Cave": "Swinedene", "Igneous Passage": "Eastern Gracia",
                           "No Man's Castle": "Southern Alvalon", "Cave of Endergate": "Endergate", "Cave of Earlsome": "North Earlsome",
                           "Sanctuary": "Applefield", "The Abyss": "Wesburn", "Unknown Relic": "Swinedene"}
DUNGEON_BG = {"Lighthouse": "lighthouse", "Holy Cave": "sanctuary", "Ruins": "ruins", "Giant Mangal": "forest", "North Cave": "cave",
              "Pirate's Cave": "piratecave", "Igneous Passage": "magma", "No Man's Castle": "castle", "Cave of Endergate": "cave",
              "Cave of Earlsome": "cave", "Sanctuary": "sanctuary", "The Abyss": "abyss", "Unknown Relic": "ruins"}
for d in dungeon_titles:
    text = page(d)
    floors = 0
    specials = {}
    for tb in tables(section(text, "Floors") or ""):
        for r in tb:
            n = re.match(r"\d+", strip(r[0]))
            if n:
                floors = max(floors, int(n.group()))
                s = strip(" ".join(r[1:]))
                if s: specials[int(n.group())] = s
    fm = re.findall(r"(\d+)(?:st|nd|rd|th) (?:floor|FL)", text, re.I)
    floors = max([floors] + [int(x) for x in fm] + [5])
    mons = monsters_in(section(text, "Monsters"))
    spirit = monsters_in(section(text, "Spirit"))
    challenge = monsters_in(section(text, "Capture Challenge"))
    dungeons[d] = {"name": d, "region": DUNGEON_REGION_FALLBACK.get(d) or locate(section(text, "Location") or text),
                   "floors": 999 if d == "The Abyss" else min(floors, 20), "specials": specials, "monsters": mons,
                   "spirit": spirit[:1], "captureChallenge": challenge, "about": strip(text.split("==")[0] or section(text, "About"))[:300],
                   "bg": DUNGEON_BG.get(d, "cave")}

overlords = {}
for o in [k for k, v in pages.items() if "Dragon Overlords" in v["categories"]]:
    text = page(o)
    ident = re.search(r"identity of '*\w+'* is an? \[\[([^\]]+)\]\]", text) or re.search(r"image = File:([A-Za-z_]+)", text)
    form = None
    if ident:
        form = find_monster(ident.group(1).replace("_", " ").replace(".png", ""))
        if not form:
            form = find_monster(re.sub(r"([a-z])([A-Z])", r"\1 \2", ident.group(1)))
    nums = re.search(r"(\d+) HP (\d+) Attack (\d+) Magic (\d+) Speed (\d+) Defense (\d+)", strip(text))
    region = locate(section(text, "Location") or text)
    overlords[o] = {"name": o, "form": form["name"] if form else None, "region": region,
                    "about": strip(section(text, "Info"))[:300],
                    "stats": dict(zip(["hp", "atk", "mag", "spd", "def", "res"], map(int, nums.groups()))) if nums else None}

for name, *_ in REGIONS:
    for l in links(section(page(name), "Dragon Overlord")):
        if l in overlords and not overlords[l]["region"]:
            overlords[l]["region"] = name
OVERLORD_FALLBACK = {"Apophis": "Eastern Gracia", "Arkanis": "Norwoods", "Garuga": "Western Gracia", "Ladon": "Swinedene"}
for o, r in OVERLORD_FALLBACK.items():
    if o in overlords and not overlords[o]["region"]:
        overlords[o]["region"] = r
OVERLORD_FORM = {"Arashi": "Red Dragonling", "Arkanis": "Gold Wyrm", "Ormr": "Bone Dragon", "Nagendra": "Orochi", "Quetzalcoatl": "Quetzlecoatl",
                 "Xiuhcoatl": "Red Wyrm"}
for o, f in OVERLORD_FORM.items():
    if o in overlords and not overlords[o]["form"]:
        mm = find_monster(f) or find_monster("White Wyrm")
        overlords[o]["form"] = mm["name"]
# in the original game Arashi, the first Overlord, fights with a Red Dragonling (not the Drake the wiki lists)
if "Arashi" in overlords:
    overlords["Arashi"]["form"] = "Red Dragonling"

regions = []
for name, x, y, tier in REGIONS:
    text = page(name)
    pool = monsters_in(section(text, "Monsters"))
    rtowns = [t for t, v in towns.items() if v["region"] == name]
    rdung = [d for d, v in dungeons.items() if v["region"] == name]
    rover = [o for o, v in overlords.items() if v["region"] == name]
    lo = 2 + round(tier ** 1.45 * 1.9)
    regions.append({"name": name, "id": slug(name), "x": x, "y": y, "tier": tier, "levels": [lo, lo + 3 + tier], "sea": name in SEA_REGIONS,
                    "terrain": TERRAIN[name], "monsters": pool, "towns": rtowns, "dungeons": rdung, "overlords": rover,
                    "about": strip(text.split("==")[0])[:300]})

# monsters whose list location names a region join that pool
for m in monsters:
    for r in regions:
        if r["name"] in m["location"] and m["name"] not in r["monsters"]:
            r["monsters"].append(m["name"])
# every wild-catchable monster should live somewhere: spread unplaced low-evolution monsters by stars
placed = {n for r in regions for n in r["monsters"]} | {n for d in dungeons.values() for n in d["monsters"]}
evolved_from = {m["evolveInto"] for m in monsters if m["evolveInto"]}
by_tier = sorted(regions, key=lambda r: r["tier"])
for m in monsters:
    if m["name"] in placed or m["name"] in evolved_from or re.search(r"hatchling", m["name"], re.I):
        continue
    if re.search(r"spirit|totem", m["obtain"] + m["location"], re.I) and m["stars"] >= 3:
        continue
    t = min(15, max(0, round((m["stars"] - 1.5) * 1.9)))
    by_tier[t]["monsters"].append(m["name"])
# make sure each region has a healthy pool (fill from neighbouring tiers)
for r in by_tier:
    i = 1
    while len(r["monsters"]) < 6 and i < 16:
        for other in by_tier:
            if abs(other["tier"] - r["tier"]) == i:
                for n in other["monsters"]:
                    if n not in r["monsters"] and len(r["monsters"]) < 6:
                        r["monsters"].append(n)
        i += 1
# the starter region gets the gentle classics
sa = next(r for r in regions if r["name"] == "Southern Alvalon")
for n in ["Goblin", "Slime", "Wolf", "Giant Ant", "Bitewing", "Fairy", "Penguin", "Water Hatchling"]:
    if n in byname and n not in sa["monsters"]:
        sa["monsters"].insert(0, n)

# ---------------------------------------------------------------- the Frontier (expansion continent)
# Hand-written regions, villages and dungeons (tools/custom/expansion.json) on their own 5x2 grid across the
# sea. Wild pools come from the wiki monster list, filtered by the region's elements and its tier's star band.
EXP = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "custom", "expansion.json")))
for r in regions:
    r["realm"] = "isle"


def themed_pool(elements, tier, size):
    c = 2 + tier * 0.28
    def ok(m, lo, hi):
        return m["element"] in elements and lo <= m["stars"] <= hi and not re.search("hatchling", m["name"], re.I)
    pool = [m for m in monsters if ok(m, c - 1, c + 1.5)]
    pool += [m for m in monsters if ok(m, c + 1.5, c + 3) and m not in pool][: max(2, size // 6)]
    if len(pool) < size // 2:
        pool += [m for m in monsters if c - 1.5 <= m["stars"] <= c + 1.5 and m not in pool and not re.search("hatchling", m["name"], re.I)]
    rng = random.Random(tier * 977 + len(elements))
    rng.shuffle(pool)
    return [m["name"] for m in sorted(pool[:size], key=lambda m: m["stars"])]


QUEST_TEMPLATES = [
    ("Trouble on the Road", "Battle", "A rogue breeder named {npc} has been ambushing travellers in {region}. Beat them and send them packing!"),
    ("Specimen Wanted", "Capture", "The Guild's scholars need a live {mon} from {region}. Capture one and bring it in."),
    ("Prove Your Strength", "Train", "The wilds of {region} are no place for the weak. Defeat 12 monsters to show you can handle them."),
    ("Urgent Message", "Deliver", "Please carry this sealed letter to the Guild in {town}. It must not be opened on the way."),
    ("Bounty: {npc2}", "Battle", "{npc2} is a breeder who has been stealing eggs from {region}. Defeat them and the bounty is yours."),
]
NPCS = ["Vorga", "Hask", "Ingrid", "Morrow", "Sella", "Grimsby", "Ulric", "Thessaly", "Corvin", "Nyx", "Bram", "Isolde", "Fenwick",
        "Drusk", "Ysolde", "Kael", "Merrin", "Oswin", "Rhoswen", "Talia"]
for er in EXP["regions"]:
    name = er["name"]
    lo = 2 + round(er["tier"] ** 1.45 * 1.9)
    regions.append({"name": name, "id": slug(name), "x": er["x"], "y": er["y"], "tier": er["tier"], "levels": [lo, lo + 3 + er["tier"]],
                    "sea": False, "realm": "frontier", "terrain": er["terrain"], "monsters": themed_pool(er["elements"], er["tier"], 20),
                    "towns": [t["name"] for t in EXP["towns"] if t["region"] == name],
                    "dungeons": [d["name"] for d in EXP["dungeons"] if d["region"] == name], "overlords": [], "about": er["about"]})
etowns = [t["name"] for t in EXP["towns"]]
for i, t in enumerate(EXP["towns"]):
    reg = next(r for r in regions if r["name"] == t["region"])
    rnd = random.Random(t["name"])
    quests = []
    for title, typ, text in QUEST_TEMPLATES:
        fill = {"npc": NPCS[(i * 3) % len(NPCS)], "npc2": NPCS[(i * 3 + 7) % len(NPCS)], "region": reg["name"],
                "mon": rnd.choice(reg["monsters"][: max(3, len(reg["monsters"]) * 2 // 3)]),
                "town": etowns[(i + 1 + rnd.randrange(len(etowns) - 1)) % len(etowns)]}
        quests.append({"title": title.format(**fill), "type": typ, "text": text.format(**fill)})
    towns[t["name"]] = {"name": t["name"], "region": t["region"], "quests": quests, "about": t["about"],
                        "arena": bool(t.get("arena")), "tournament": bool(t.get("tournament"))}
for d in EXP["dungeons"]:
    reg = next(r for r in regions if r["name"] == d["region"])
    dungeons[d["name"]] = {"name": d["name"], "region": d["region"], "floors": d["floors"], "specials": {},
                           "monsters": themed_pool(d["elements"], reg["tier"] + 2, 16), "spirit": [], "captureChallenge": [],
                           "about": d["about"], "bg": d["bg"]}
SEA_ROUTES = [[slug(a), slug(b)] for a, b in EXP["sea_routes"]]

# ---------------------------------------------------------------- recipes
recipes = []
seen_results = set()
order = ["Recipes"] + [k for k in pages if k != "Recipes"]
for title in order:
    text = pages[title]["text"]
    for tb in tables(text):
        if len(tb) < 2: continue
        head = [strip(c) for c in tb[0]]
        ops = [strip(c) for c in tb[1]]
        cells = [c for c in head if c]
        if "=" in ops and "+" in ops and len(cells) == 3:
            mm = [find_monster(c) for c in cells]
            if not all(mm): continue
            if ops.index("=") < ops.index("+"):
                res, a_, b_ = mm
            else:
                a_, b_, res = mm
            # wiki pages sometimes list fusions backwards; the fused result is never weaker than its parts
            trio = [res, a_, b_]
            strongest = max(trio, key=lambda x: x["stars"])
            if res["stars"] < strongest["stars"]:
                res = strongest
                a_, b_ = [x for x in trio if x is not strongest][:2]
            if title != "Recipes" and res["name"] in seen_results:
                continue
            key = (res["name"], tuple(sorted([a_["name"], b_["name"]])))
            if key not in {(r["result"], tuple(sorted(r["parts"]))) for r in recipes}:
                recipes.append({"result": res["name"], "parts": [a_["name"], b_["name"]]})
        if title == "Recipes":
            seen_results.update(r["result"] for r in recipes)

# ---------------------------------------------------------------- economy / progression
shop = []
for tb in tables(page("Shop")):
    for r in tb:
        r = [strip(c) for c in r]
        if len(r) >= 2 and re.search(r"\d+ (Silver|Gold)", r[1]):
            n, cur = re.search(r"([\d,]+) (Silver|Gold)", r[1]).groups()
            shop.append({"item": r[0], "price": int(n.replace(",", "")), "currency": cur.lower(), "desc": r[2] if len(r) > 2 else ""})
licenses = []
for tb in tables(page("License Test")):
    for r in tb:
        r = [strip(c) for c in r]
        if len(r) >= 3 and r[0] and r[0] != "Level":
            q = re.search(r"(\d+)\s*quests", r[2]); h = re.search(r"hero level\s*'*(\d+)", r[2], re.I)
            slots = re.search(r"by (\d+)", r[1])
            licenses.append({"name": r[0], "slots": int(slots.group(1)) if slots else 1, "quests": int(q.group(1)) if q else 0,
                             "heroLevel": int(h.group(1)) if h else 1, "text": r[1]})
egg = page("Egg")
egg_pool = [find_monster(x)["name"] for x in re.findall(r"\[\[([^\]|]+)\]\]", section(egg, "Egg Content")) if find_monster(x)]
golden_pool = [m["name"] for m in monsters if m["stars"] >= 4 and m["name"] not in evolved_from][:40] + \
              [m["name"] for m in monsters if re.search("hatchling", m["name"], re.I)]
spirits = [k for k, v in pages.items() if "Spirit" in v["categories"]]
soul = {}
for line in page("Soul Stones").split("\n"):
    mm = re.match(r"(\w+) Soul Stone\s*=\s*(.+)", line.strip())
    if mm:
        soul[mm.group(1)] = [STATS.get(s.strip().lstrip("+"), s.strip().lstrip("+").lower()) for s in mm.group(2).split(",")]

quests_detail = {}
for k, v in pages.items():
    if k.endswith("(Quest)"):
        text = v["text"]
        quests_detail[k.replace(" (Quest)", "")] = {
            "obtained": strip(section(text, "Location Obtained")), "text": strip(section(text, "Description")).strip('"'),
            "how": strip(section(text, "How to Complete"))[:500], "reward": strip(section(text, "Reward")),
            "town": next((c.replace(" Quests", "") for c in v["categories"] if c.endswith("Quests")), None)}

characters = {k: strip(page(k).split("==")[0])[:300] for k, v in pages.items() if "Characters" in v["categories"]}

os.makedirs(OUT, exist_ok=True)
monsters.sort(key=lambda m: m["id"])
data = {"monsters": monsters, "regions": regions, "towns": list(towns.values()), "dungeons": list(dungeons.values()),
        "overlords": list(overlords.values()), "recipes": recipes, "shop": shop, "licenses": licenses,
        "eggs": {"egg": egg_pool, "golden": sorted(set(golden_pool))}, "spirits": spirits, "soulStones": soul,
        "quests": quests_detail, "characters": characters, "growth": G,
        "seaRoutes": [["saintspring", "underworld"]] + SEA_ROUTES}
json.dump(data, open(os.path.join(OUT, "gamedata.json"), "w"), indent=0, ensure_ascii=False)
print(f"monsters={len(monsters)} sprites_missing={len(missing)} {missing}")
print(f"regions={len(regions)} towns={len(towns)} dungeons={len(dungeons)} overlords={len(overlords)} recipes={len(recipes)}")
print("shop", len(shop), "licenses", len(licenses), "egg", len(egg_pool), "spirits", len(spirits), "soul", soul, "rank_factor", round(rank_factor, 2))
for r in regions: print(r["name"], r["levels"], len(r["monsters"]), r["towns"], r["dungeons"], r["overlords"])
