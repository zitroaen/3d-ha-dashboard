"""Grundriss-Import aus einem Magicplan-PDF-Report (deutschsprachiger Export): liest Wände, Räume, Fenster
und Türen als Vektordaten und schreibt house.json. Danach ist house.json die Quelle der Wahrheit und wird von
Hand (oder im Panel) gepflegt – das Skript nur erneut laufen lassen, wenn man von vorn anfangen will, denn es
überschreibt die Datei.

    python scripts/extract_plan.py <report.pdf> --out <datenordner>/house.json [--config plan.json] [--debug]

Etagen- und Raumseiten werden automatisch erkannt: Eine Etagenseite hat eine Überschrift "▼<Etage>" mit
"RÄUME:" darunter, die folgenden Raumseiten "▼<Raum>" mit der Etage darunter. Maßstab ("1:95") und
Deckenhöhen ("DECKENHÖHE: 2.50 m") kommen aus dem Seitentext.

Optionale Konfiguration (JSON), alles optional:
    {
      "name": "Mein Haus",
      "north_deg": 0,                                   # Norden im Plan, Grad im Uhrzeigersinn von oben
      "floors": { "Erdgeschoss": { "id": "eg", "elevation": 0, "offset": [0, 0] } },
      "room_ids": { "Badezimmer": "bad" },              # Magicplan-Name -> Raum-ID (sonst aus dem Namen)
      "floor_material": { "bad": "fliesen" },           # Raum-ID -> Bodenbelag (sonst nach Raumname geraten)
      "front_door_rooms": ["diele"]                     # Außentüren dieser Räume massiv (sonst verglast)
    }
Mehrere Etagen: Jede Etage bekommt ihren eigenen Ursprung (linke obere Ecke ihrer Außenwände); die Lage der
Etagen zueinander ("offset": [dx, dy] je Etage) und die Höhe ("elevation") bitte in der Konfiguration setzen.

Benötigt: pip install pymupdf
"""
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

FLOOR_IDS = {"erdgeschoss": "eg", "obergeschoss": "og", "1. stock": "og", "1. obergeschoss": "og",
             "2. stock": "og2", "dachgeschoss": "dg", "untergeschoss": "ug", "1. untergeschoss": "ug",
             "kellergeschoss": "ug", "keller": "ug"}
TILED = re.compile(r"bad|wc|toilette|dusche|küche|kueche|waschküche|diele|flur|eingang|windfang|heizung", re.I)
FRONT = re.compile(r"diele|flur|eingang|windfang", re.I)


def slug(name):
    t = name.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")


def scale_of(text):
    """Meter pro PDF-Punkt aus der Maßstabsangabe "1:95" (letzte im Seitentext)."""
    found = re.findall(r"^1:(\d+)$", text, re.M)
    return 25.4 / 72 / 1000 * int(found[-1]) if found else None


def detect_floors(doc):
    """[{name, plan_page, room_pages, scale, ceilings: {raumname: [höhen]}}] in Reihenfolge des PDFs."""
    floors, cur = [], None
    for i, page in enumerate(doc):
        lines = [l.strip() for l in page.get_text().split("\n")]
        heads = [(k, l[1:].strip()) for k, l in enumerate(lines) if l.startswith("▼")]
        if heads and len(lines) > heads[0][0] + 1 and "RÄUME:" in lines[heads[0][0] + 1]:
            cur = {"name": heads[0][1], "plan_page": i, "room_pages": [], "scale": scale_of(page.get_text()), "ceilings": {}}
            floors.append(cur)
            continue
        if cur and heads:
            cur["room_pages"].append(i)
            for k, name in heads:
                for l in lines[k + 1:k + 5]:
                    m = re.search(r"DECKENHÖHE:\s*([\d.]+)", l)
                    if m:
                        cur["ceilings"].setdefault(name, []).append(float(m.group(1)))
    return floors


def subpaths(drawing):
    """Zerlegt einen PDF-Pfad in Polylinien (Liste von (x, y))."""
    subs, cur = [], []
    for it in drawing["items"]:
        if it[0] == "re":
            if cur:
                subs.append(cur)
                cur = []
            r = it[1]
            subs.append([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
            continue
        a, b = (it[1], it[2]) if it[0] == "l" else (it[1], it[4])
        if cur and abs(cur[-1][0] - a.x) < 0.01 and abs(cur[-1][1] - a.y) < 0.01:
            cur.append((b.x, b.y))
        else:
            if cur:
                subs.append(cur)
            cur = [(a.x, a.y), (b.x, b.y)]
    if cur:
        subs.append(cur)
    # geschlossene Polygone: doppelten Endpunkt entfernen
    out = []
    for s in subs:
        if len(s) > 2 and math.dist(s[0], s[-1]) < 0.01:
            s = s[:-1]
        out.append(s)
    return out


def fill_is(d, rgb, tol=0.01):
    f = d.get("fill")
    return d["type"] == "f" and f is not None and all(abs(a - b) < tol for a, b in zip(f, rgb))


FLOOR_RGB = (0.0, 0.0, 0.098)   # halbtransparente Etagenfläche
ROOM_RGB = (0.94, 0.94, 0.94)   # Raumfläche (Detailseiten)


def within(r, outer, tol=1.0):
    """Rechteck r liegt in outer (mit Toleranz in PDF-Punkten; Kanten können exakt aufeinanderliegen)."""
    return r.x0 >= outer.x0 - tol and r.y0 >= outer.y0 - tol and r.x1 <= outer.x1 + tol and r.y1 <= outer.y1 + tol


def point_in_poly(p, poly):
    x, y = p
    inside = False
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def simplify(poly, eps=0.005):
    """Entfernt doppelte und kollineare Punkte (Meter)."""
    pts = []
    for p in poly:
        if not pts or math.dist(p, pts[-1]) > eps:
            pts.append(p)
    if len(pts) > 1 and math.dist(pts[0], pts[-1]) <= eps:
        pts.pop()
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if abs(cross) < eps * 0.05:
                pts.pop(i)
                changed = True
                break
    return pts


def signed_area(poly):
    return sum(poly[i - 1][0] * p[1] - p[0] * poly[i - 1][1] for i, p in enumerate(poly)) / 2


def extract_floor(doc, fid, cfg, conf):
    M_PER_PT = cfg["scale"] or 25.4 / 72 / 1000 * 95
    room_ids = conf.get("room_ids", {})
    floor_material = conf.get("floor_material", {})
    front_rooms = set(conf.get("front_door_rooms", []))
    plan = doc[cfg["plan_page"]].get_drawings()
    floor_main = next(d for d in plan if fill_is(d, FLOOR_RGB))
    walls_draw = next(d for d in plan if fill_is(d, (0, 0, 0)) and len(d["items"]) > 50)
    fm = subpaths(floor_main)[0]

    # --- Räume: auf jeder Detailseite ist der Raum in der Mini-Übersicht hervorgehoben.
    #     Die Mini-Übersicht ist eine verkleinerte Kopie des Etagenplans -> Ähnlichkeitstransformation.
    rooms_pt = []
    for pg in cfg["room_pages"]:
        page = doc[pg]
        dr = page.get_drawings()
        names = [l[1:].strip() for l in page.get_text().split("\n") if l.startswith("▼")]
        thumbs = [d for d in dr if fill_is(d, FLOOR_RGB)]
        for name, th in zip(names, sorted(thumbs, key=lambda d: d["rect"].y0)):
            ft = subpaths(th)[0]
            s = (max(p[0] for p in fm) - min(p[0] for p in fm)) / (max(p[0] for p in ft) - min(p[0] for p in ft))
            ox = min(p[0] for p in fm) - s * min(p[0] for p in ft)
            oy = min(p[1] for p in fm) - s * min(p[1] for p in ft)
            hl = [d for d in dr if fill_is(d, ROOM_RGB) and within(d["rect"], th["rect"])]
            assert len(hl) == 1, (name, len(hl))
            poly = max(subpaths(hl[0]), key=len)
            rooms_pt.append((name, [(ox + s * x, oy + s * y) for x, y in poly]))

    walls_pt = [s for s in subpaths(walls_draw) if len(s) >= 3]

    # Ursprung: linke obere Ecke der Außenwände im Plan (+ optionaler Versatz der Etage)
    x0 = min(p[0] for w in walls_pt for p in w)
    y0 = min(p[1] for w in walls_pt for p in w)
    dx, dy = cfg.get("offset", [0, 0])

    def m(p):
        return (round((p[0] - x0) * M_PER_PT + dx, 3), round((p[1] - y0) * M_PER_PT + dy, 3))

    walls = [simplify([m(p) for p in w]) for w in walls_pt]

    def in_wall(p):
        return any(point_in_poly(p, w) for w in walls)

    def wall_extent(p, n, reach=0.8, step=0.005):
        """Ausdehnung der Wand durch Punkt p entlang Richtung n: (tmin, tmax) relativ zu p, oder None."""
        ts = [k * step for k in range(-int(reach / step), int(reach / step) + 1)]
        inside = [t for t in ts if in_wall((p[0] + n[0] * t, p[1] + n[1] * t))]
        if not inside:
            return None
        # zusammenhängender Abschnitt, der p am nächsten liegt
        runs, cur = [], [inside[0]]
        for t in inside[1:]:
            if t - cur[-1] > step * 1.5:
                runs.append(cur)
                cur = [t]
            else:
                cur.append(t)
        runs.append(cur)
        run = min(runs, key=lambda r: 0 if r[0] <= 0 <= r[-1] else min(abs(r[0]), abs(r[-1])))
        return run[0] - step / 2, run[-1] + step / 2

    def opening_jamb(a, b):
        """Wanddicke einer Öffnung von a nach b: Wand direkt hinter beiden Enden abtasten (Laibungen)."""
        ln = math.dist(a, b)
        u = ((b[0] - a[0]) / ln, (b[1] - a[1]) / ln)
        n = (-u[1], u[0])
        ext = []
        # direkt hinter den Enden; liegt dort ein Nachbarfenster, weiter entlang der Wand suchen
        for k in [0.04] + [0.25 * i for i in range(1, 15)]:
            ext = [e for e in (wall_extent((a[0] - u[0] * k, a[1] - u[1] * k), n, reach=0.45),
                               wall_extent((b[0] + u[0] * k, b[1] + u[1] * k), n, reach=0.45)) if e]
            if ext:
                break
        if not ext:
            return None
        return min(e[0] for e in ext), max(e[1] for e in ext)

    # --- Fenster: weiße Rechtecke (4 Kurven) in Wandlücken
    windows = []
    for d in plan:
        if fill_is(d, (1, 1, 1)) and d["type"] == "f" and len(d["items"]) == 4 and all(i[0] == "c" for i in d["items"]):
            r = d["rect"]
            a, b = m((r.x0, r.y0)), m((r.x1, r.y1))
            w, h = b[0] - a[0], b[1] - a[1]
            if max(w, h) < 0.3 or min(w, h) > 0.3:
                continue
            # Magicplan zeichnet das Fenstersymbol schmaler als die Wand -> Laibungstiefe der Wand übernehmen
            if w > h:
                cy = (a[1] + b[1]) / 2
                j = opening_jamb((a[0], cy), (b[0], cy))
                if j:
                    a, b = (a[0], round(cy + j[0], 3)), (b[0], round(cy + j[1], 3))
            else:
                cx = (a[0] + b[0]) / 2
                j = opening_jamb((cx, a[1]), (cx, b[1]))
                if j:  # n zeigt bei Öffnung nach unten in Richtung -x
                    a, b = (round(cx - j[1], 3), a[1]), (round(cx - j[0], 3), b[1])
            windows.append({"rect": [a[0], a[1], b[0], b[1]], "sill": 0.9, "top": 2.1})

    # --- Türen: Viertelkreise (Strichstärke 0.3, zwei Kurvensegmente, quadratische Bounding-Box)
    doors = []
    for d in plan:
        if d["type"] != "s" or abs((d.get("width") or 0) - 0.3) > 0.01:
            continue
        if [i[0] for i in d["items"]] != ["c", "c"]:
            continue
        col = d.get("color") or (1, 1, 1)
        if max(col) > 0.05:
            continue
        r = d["rect"]
        if abs(r.width - r.height) > 1:
            continue
        # Pfad = Bogen (geschlossene Türspitze -> offene Türspitze) + Türblatt (offene Spitze -> Scharnier)
        arc, leaf = d["items"]
        best = m((arc[1].x, arc[1].y))    # geschlossene Spitze, liegt in der Wandflucht
        swing = m((arc[4].x, arc[4].y))   # offene Spitze
        hinge = m((leaf[4].x, leaf[4].y))
        rad = math.dist(hinge, best)
        ux, uy = (best[0] - hinge[0]) / rad, (best[1] - hinge[1]) / rad
        nx, ny = -uy, ux
        sx, sy = swing[0] - hinge[0], swing[1] - hinge[1]
        side = 1 if sx * nx + sy * ny > 0 else -1  # Aufschlagrichtung (+n oder -n)
        # Laibung: Wandausdehnung senkrecht zur Türflucht, als Abstand von der Linie Scharnier->Ende
        jamb = opening_jamb(hinge, best) or (-0.1 * side, 0)
        doors.append({
            "hinge": [round(hinge[0], 3), round(hinge[1], 3)], "end": [round(best[0], 3), round(best[1], 3)],
            "swing": side, "jamb": [round(jamb[0], 3), round(jamb[1], 3)], "height": 2.0,
        })

    # Deckenhöhe der Etage = häufigste Raumhöhe; abweichende Räume bekommen ihre eigene
    all_h = [h for hs in cfg["ceilings"].values() for h in hs]
    floor_ceiling = Counter(all_h).most_common(1)[0][0] if all_h else 2.5
    cfg["ceiling"] = floor_ceiling
    rooms = []
    seen = {}
    ceil_seen = Counter()
    for name, poly in rooms_pt:
        rid = room_ids.get(name) or slug(name)
        seen[rid] = seen.get(rid, 0) + 1
        if seen[rid] > 1:
            rid = f"{rid}_{seen[rid]}"
        pm = simplify([m(p) for p in poly])
        if signed_area(pm) < 0:
            pm.reverse()
        hs = cfg["ceilings"].get(name, [])
        h = hs[ceil_seen[name]] if ceil_seen[name] < len(hs) else floor_ceiling
        ceil_seen[name] += 1
        material = floor_material.get(rid) or ("fliesen" if TILED.search(name) else "parkett")
        rooms.append({"id": rid, "name": name, "polygon": [list(p) for p in pm],
                      "floor": material, "ceiling": None if abs(h - floor_ceiling) < 0.005 else h})

    def room_at(p):
        return next((r["id"] for r in rooms if point_in_poly(p, r["polygon"])), None)

    # Türen: Innen- oder Außentür? (Raum auf beiden Seiten der Türmitte prüfen)
    for d in doors:
        (hx, hy), (ex, ey) = d["hinge"], d["end"]
        mx, my = (hx + ex) / 2, (hy + ey) / 2
        ln = math.dist(d["hinge"], d["end"])
        nx, ny = -(ey - hy) / ln, (ex - hx) / ln
        sides = [room_at((mx + nx * k, my + ny * k)) for k in (0.4, -0.4)]
        d["rooms"] = sides
        d["type"] = "exterior" if None in sides else "interior"
        if d["type"] == "exterior":
            inner = next((r for r in rooms if r["id"] in sides), None)
            solid = inner and (inner["id"] in front_rooms or (not front_rooms and FRONT.search(inner["name"])))
            d["leaf"] = "solid" if solid else "glass"

    # Fenster, die in einer Türöffnung liegen, gehören zur (verglasten) Tür
    def overlaps_door(w):
        x0, y0, x1, y1 = w["rect"]
        for d in doors:
            (hx, hy), (ex, ey) = d["hinge"], d["end"]
            if min(hx, ex) < x1 - 0.05 and max(hx, ex) > x0 + 0.05 and min(hy, ey) < y1 + 0.05 and max(hy, ey) > y0 - 0.05:
                return True
        return False

    windows = [w for w in windows if not overlaps_door(w)]
    for w in windows:
        x0, y0, x1, y1 = w["rect"]
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        horiz = (x1 - x0) > (y1 - y0)
        w["room"] = room_at((cx, cy + 0.4)) or room_at((cx, cy - 0.4)) if horiz else \
            room_at((cx + 0.4, cy)) or room_at((cx - 0.4, cy))

    return {
        "id": fid, "name": cfg["name"], "level": cfg["level"], "elevation": cfg.get("elevation", 0.0),
        "ceiling": cfg["ceiling"], "rooms": rooms,
        "walls": [[list(p) for p in w] for w in walls],
        "windows": windows, "doors": doors,
    }


def debug_svg(floor, path):
    s = 60
    xs = [p[0] for w in floor["walls"] for p in w]
    ys = [p[1] for w in floor["walls"] for p in w]
    W, H = (max(xs) + 1) * s, (max(ys) + 1) * s
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -30 {W + 60} {H + 60}" '
           f'width="{W + 60}" height="{H + 60}" style="background:#fff;font:11px sans-serif">']
    pal = ["#e9c46a", "#a8dadc", "#f4a261", "#cdb4db", "#b5e48c", "#ffafcc", "#90e0ef", "#ddd", "#f6bd60", "#84a59d"]
    for i, r in enumerate(floor["rooms"]):
        pts = " ".join(f"{x * s},{y * s}" for x, y in r["polygon"])
        out.append(f'<polygon points="{pts}" fill="{pal[i % len(pal)]}" fill-opacity="0.7" stroke="#555" stroke-width="0.5"/>')
        cx = sum(p[0] for p in r["polygon"]) / len(r["polygon"]) * s
        cy = sum(p[1] for p in r["polygon"]) / len(r["polygon"]) * s
        out.append(f'<text x="{cx}" y="{cy}" text-anchor="middle">{r["id"]}</text>')
    for w in floor["walls"]:
        pts = " ".join(f"{x * s},{y * s}" for x, y in w)
        out.append(f'<polygon points="{pts}" fill="#111" fill-opacity="0.85"/>')
    for w in floor["windows"]:
        x0, y0, x1, y1 = w["rect"]
        out.append(f'<rect x="{x0 * s}" y="{y0 * s}" width="{(x1 - x0) * s}" height="{(y1 - y0) * s}" fill="#09f"/>')
    for d in floor["doors"]:
        (hx, hy), (ex, ey) = d["hinge"], d["end"]
        out.append(f'<line x1="{hx * s}" y1="{hy * s}" x2="{ex * s}" y2="{ey * s}" stroke="#e00" stroke-width="4"/>')
        out.append(f'<circle cx="{hx * s}" cy="{hy * s}" r="4" fill="#e00"/>')
    out.append("</svg>")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(out), encoding="utf-8")


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        print(__doc__)
        sys.exit(1)
    opt = lambda name, default=None: args[args.index(name) + 1] if name in args else default
    pdf = Path(args[0])
    out = Path(opt("--out", "house.json"))
    conf = json.loads(Path(opt("--config")).read_text(encoding="utf-8")) if opt("--config") else {}
    floor_conf = conf.get("floors", {})

    doc = pymupdf.open(pdf)
    detected = detect_floors(doc)
    if not detected:
        sys.exit("Keine Etagenseite gefunden (Überschrift '▼<Etage>' mit 'RÄUME:' darunter) – ist das ein Magicplan-Report?")
    floors = []
    for level, cfg in enumerate(detected):
        fc = floor_conf.get(cfg["name"], {})
        fid = fc.get("id") or FLOOR_IDS.get(cfg["name"].lower()) or slug(cfg["name"])
        cfg.update(level=level, elevation=fc.get("elevation", 0.0), offset=fc.get("offset", [0, 0]))
        floors.append(extract_floor(doc, fid, cfg, conf))
        floors[-1]["ceiling"] = cfg["ceiling"]
    house = {
        "name": conf.get("name", pdf.stem),
        "units": "m",
        "coordinates": "x nach rechts, y nach unten wie im Magicplan-Plan (three.js: x -> x, y -> z). "
                       "Ursprung: linke obere Ecke der Außenwände je Etage (+ offset).",
        "source": pdf.name,
        "north_deg": conf.get("north_deg", 0),
        "floors": floors,
    }
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from house_fixes import fix_house  # Fensterbänder zusammenfassen, Wandstreifen entfernen
    fix_house(house)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(house, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"-> {out}")
    for f in floors:
        print(f["id"], f["name"], len(f["rooms"]), "Räume", len(f["walls"]), "Wände", len(f["windows"]), "Fenster", len(f["doors"]), "Türen")
        for r in f["rooms"]:
            xs = [p[0] for p in r["polygon"]]
            ys = [p[1] for p in r["polygon"]]
            print(f'  {r["id"]:14s} bbox {max(xs) - min(xs):.2f} x {max(ys) - min(ys):.2f}  Fläche {abs(signed_area(r["polygon"])):.2f} m²'
                  + (f'  Decke {r["ceiling"]}' if r["ceiling"] else ""))
        if "--debug" in args:
            debug_svg(f, out.parent / f"plan_debug_{f['id']}.svg")


if __name__ == "__main__":
    main()
