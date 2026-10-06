"""Shared wikitext helpers for the DIB data builder."""
import re

LINK = re.compile(r"\[\[(?!File:|file:|Image:|Category:)([^\]|]+)(?:\|([^\]]+))?\]\]")
EXT = re.compile(r"\[https?://\S+ ([^\]]+)\]")
FILE = re.compile(r"\[\[(?:File|file|Image):([^\]|]+)[^\]]*\]\]")
TAG = re.compile(r"<[^>]+>")


def strip(s):
    s = FILE.sub("", s)
    s = LINK.sub(lambda m: m.group(2) or m.group(1), s)
    s = EXT.sub(r"\1", s)
    s = TAG.sub("", s)
    s = s.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", s).strip()


def files(s):
    return [f.strip() for f in FILE.findall(s)]


def links(s):
    return [m.group(1).strip() for m in LINK.finditer(s)] + [m.strip() for m in EXT.findall(s)]


def tables(text):
    """Yield each {| ... |} table as a list of rows, each row a list of raw cell strings."""
    for m in re.finditer(r"\{\|(.*?)\n\|\}", text, re.S):
        body = m.group(1)
        rows = []
        for chunk in re.split(r"\n\|-[^\n]*", "\n" + body.split("\n", 1)[1] if "\n" in body else ""):
            cells = []
            for line in chunk.split("\n"):
                line = line.strip()
                if not line or line.startswith("|+"):
                    if cells and line == "":
                        continue
                    continue
                if line[0] in "|!":
                    sep = "||" if line[0] == "|" else "!!"
                    parts = re.split(r"\|\||!!", line[1:])
                    for p in parts:
                        # drop "style=..." attribute prefix
                        if "|" in p and not p.strip().startswith("[[") and "=" in p.split("|", 1)[0]:
                            p = p.split("|", 1)[1]
                        elif p.count("|") and re.match(r'\s*(scope|style|colspan|rowspan|align|class)\b', p):
                            p = p.split("|", 1)[1]
                        cells.append(p.strip())
                elif cells:
                    cells[-1] += "\n" + line
            if cells:
                rows.append(cells)
        yield rows


def section(text, name):
    m = re.search(r"==+\s*" + name + r"[^=\n]*==+(.*?)(?=\n==[^=]|\Z)", text, re.S | re.I)
    return m.group(1) if m else ""


def drop_templates(text):
    """Remove {{...}} templates, honouring nesting."""
    out, depth, i = [], 0, 0
    while i < len(text):
        if text.startswith("{{", i):
            depth += 1; i += 2; continue
        if text.startswith("}}", i) and depth:
            depth -= 1; i += 2; continue
        if not depth:
            out.append(text[i])
        i += 1
    return "".join(out)
