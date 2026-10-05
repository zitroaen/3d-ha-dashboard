"""Umformungen einer extrahierten Etage (scripts/extract_plan.py) – ohne PDF, damit sie sich testen lassen:

- rotate_floor: Etage um 90/180/270 Grad (im Uhrzeigersinn, wie im Plan gesehen) drehen, um die Umrandung ihrer
  Außenwände – die linke obere Ecke bleibt der Ursprung. Magicplan legt jede Etage mit eigener Ausrichtung ab.
- translate_floor: Etage verschieben (offset, nach der Drehung).
- unique_room_ids: Raum-IDs über alle Etagen eindeutig machen – kommt eine ID schon in einer früheren Etage vor,
  bekommt sie das Etagenkürzel vorangestellt (og_bad); Türen und Fenster folgen.
- split_rooms: Raum an einer Linie teilen – die Seite links der Linie (in Laufrichtung) wird eine Belag-Zone
  (rooms[].zones) mit eigener Oberfläche, z. B. Naturstein im Essbereich.
"""


def _points(floor):
    """Alle Punkte der Etage als (Liste, Index)-Referenzen zum Umschreiben"""
    for w in floor["walls"]:
        for i in range(len(w)):
            yield w, i
    for r in floor["rooms"]:
        for i in range(len(r["polygon"])):
            yield r["polygon"], i
        for z in r.get("zones", []):
            for i in range(len(z["polygon"])):
                yield z["polygon"], i


def _map(floor, f):
    for lst, i in list(_points(floor)):
        lst[i] = list(f(lst[i]))
    for w in floor["windows"]:
        x0, y0, x1, y1 = w["rect"]
        a, b = f((x0, y0)), f((x1, y1))
        w["rect"] = [round(min(a[0], b[0]), 3), round(min(a[1], b[1]), 3), round(max(a[0], b[0]), 3), round(max(a[1], b[1]), 3)]
    for d in floor["doors"]:
        d["hinge"], d["end"] = list(f(d["hinge"])), list(f(d["end"]))


def rotate_floor(floor, deg):
    """Etage im Uhrzeigersinn drehen (Plan: x nach rechts, y nach unten); Ursprung bleibt links oben."""
    deg = int(deg or 0) % 360
    if deg == 0:
        return floor
    if deg not in (90, 180, 270):
        raise ValueError(f"rotate: nur 90, 180 oder 270 (nicht {deg})")
    xs = [p[0] for w in floor["walls"] for p in w]
    ys = [p[1] for w in floor["walls"] for p in w]
    x0, y0, w, h = min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)

    def f(p):
        x, y = p[0] - x0, p[1] - y0
        if deg == 90:
            x, y = h - y, x
        elif deg == 180:
            x, y = w - x, h - y
        else:
            x, y = y, w - x
        return round(x + x0, 3), round(y + y0, 3)

    _map(floor, f)
    return floor


def translate_floor(floor, offset):
    dx, dy = offset or (0, 0)
    if dx or dy:
        _map(floor, lambda p: (round(p[0] + dx, 3), round(p[1] + dy, 3)))
    return floor


def unique_room_ids(floors):
    """IDs, die schon in einer früheren Etage vorkommen, bekommen das Etagenkürzel vorangestellt."""
    used = set()
    for f in floors:
        rename = {}
        for r in f["rooms"]:
            rid = r["id"]
            if rid in used:
                new = f"{f['id']}_{rid}"
                k = 2
                while new in used:
                    new = f"{f['id']}_{rid}_{k}"
                    k += 1
                rename[rid] = new
                r["id"] = new
            used.add(r["id"])
        if not rename:
            continue
        for d in f["doors"]:
            d["rooms"] = [rename.get(x, x) for x in d.get("rooms", [])]
        for w in f["windows"]:
            if w.get("room") in rename:
                w["room"] = rename[w["room"]]
        print(f"  Etage {f['id']}: Raum-IDs eindeutig gemacht: " + ", ".join(f"{a} -> {b}" for a, b in rename.items()))
    return floors


def _clip_left(poly, a, b):
    """Teil des Polygons links der gerichteten Linie a→b, wie im Plan gesehen (y nach unten; Sutherland–Hodgman)"""
    def side(p):
        return (b[1] - a[1]) * (p[0] - a[0]) - (b[0] - a[0]) * (p[1] - a[1])

    out = []
    for i, p in enumerate(poly):
        q = poly[(i + 1) % len(poly)]
        sp, sq = side(p), side(q)
        if sp >= 0:
            out.append([round(p[0], 3), round(p[1], 3)])
        if (sp > 0 > sq) or (sp < 0 < sq):
            t = sp / (sp - sq)
            out.append([round(p[0] + (q[0] - p[0]) * t, 3), round(p[1] + (q[1] - p[1]) * t, 3)])
    return out if len(out) >= 3 else None


def split_rooms(floor, splits):
    """splits: [{ room, line: [[x, y], [x, y]], surface }] – Seite links der Linie wird eine Belag-Zone"""
    for s in splits or []:
        room = next((r for r in floor["rooms"] if r["id"] == s["room"]), None)
        if not room:
            raise ValueError(f"split: Raum {s['room']} gibt es in Etage {floor['id']} nicht")
        a, b = s["line"]
        part = _clip_left(room["polygon"], a, b)
        if not part:
            raise ValueError(f"split: Linie {s['line']} teilt Raum {s['room']} nicht (links der Linie liegt nichts)")
        room.setdefault("zones", []).append({"polygon": part, "surface": s.get("surface", "flagstone")})
    return floor
