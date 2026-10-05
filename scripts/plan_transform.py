"""Umformungen einer extrahierten Etage (scripts/extract_plan.py) – ohne PDF, damit sie sich testen lassen:

- rotate_floor: Etage um 90/180/270 Grad (im Uhrzeigersinn, wie im Plan gesehen) drehen, um die Umrandung ihrer
  Außenwände – die linke obere Ecke bleibt der Ursprung. Magicplan legt jede Etage mit eigener Ausrichtung ab.
- translate_floor: Etage verschieben (offset, nach der Drehung).
- unique_room_ids: Raum-IDs über alle Etagen eindeutig machen – kommt eine ID schon in einer früheren Etage vor,
  bekommt sie das Etagenkürzel vorangestellt (og_bad); Türen und Fenster folgen.
- split_rooms: Raum an einer Linie teilen – die Seite links der Linie (in Laufrichtung) wird eine Belag-Zone
  (rooms[].zones) mit eigener Oberfläche, z. B. Naturstein im Essbereich.
"""
import math


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


# --- Einpassen und Korrigieren (0.25.0) ---------------------------------------------------------------------------

def stretch_floor(floor, stretches):
    """Messfehler ausgleichen: alles jenseits der Linie `from` (Achse x oder y) wird so gestreckt, dass `src` auf
    `dst` landet; diesseits bleibt alles, wie es ist. stretches: { axis, from, src, dst } oder eine Liste davon."""
    if isinstance(stretches, dict):
        stretches = [stretches]
    for s in stretches or []:
        ax = 0 if s.get("axis", "y") == "x" else 1
        a, src, dst = float(s["from"]), float(s["src"]), float(s["dst"])
        if abs(src - a) < 1e-9:
            raise ValueError(f"stretch: src ({src}) darf nicht auf from ({a}) liegen")
        k = (dst - a) / (src - a)

        def f(p, ax=ax, a=a, k=k, src=src):
            p = list(p)
            if (p[ax] - a) * (src - a) > 0:
                p[ax] = a + (p[ax] - a) * k
            return round(p[0], 3), round(p[1], 3)

        _map(floor, f)
    return floor


def _area(poly):
    return sum(poly[i - 1][0] * p[1] - p[0] * poly[i - 1][1] for i, p in enumerate(poly)) / 2


def _inside(p, poly):
    x, y = p
    c = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i - 1], poly[i]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def _chord(poly, a, b):
    """Strecke der Geraden a→b innerhalb des Polygons (erster bis letzter Schnittpunkt) oder None"""
    dx, dy = b[0] - a[0], b[1] - a[1]
    ts = []
    for i in range(len(poly)):
        p, q = poly[i - 1], poly[i]
        ex, ey = q[0] - p[0], q[1] - p[1]
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den
        u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den
        if -1e-9 <= u <= 1 + 1e-9:
            ts.append(t)
    if len(ts) < 2:
        return None
    t0, t1 = min(ts), max(ts)
    return [a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]


def _band(p, q, w):
    """Rechteck der Breite w um die Strecke p–q (Wand)"""
    l = math.hypot(q[0] - p[0], q[1] - p[1]) or 1
    nx, ny = -(q[1] - p[1]) / l * w / 2, (q[0] - p[0]) / l * w / 2
    return [[round(p[0] + nx, 3), round(p[1] + ny, 3)], [round(q[0] + nx, 3), round(q[1] + ny, 3)],
            [round(q[0] - nx, 3), round(q[1] - ny, 3)], [round(p[0] - nx, 3), round(p[1] - ny, 3)]]


def split_rooms_ext(floor, splits):
    """split mit `into` (die Seite links der Linie wird ein eigener Raum { id, name }) und/oder `wall` (Raumteiler-Wand
    dieser Stärke entlang der Linie, so weit sie im Raum liegt). Ohne `into`: Belag-Zone wie split_rooms."""
    for s in splits or []:
        room = next((r for r in floor["rooms"] if r["id"] == s["room"]), None)
        if not room:
            raise ValueError(f"split: Raum {s['room']} gibt es in Etage {floor['id']} nicht")
        a, b = s["line"]
        poly = room["polygon"]
        if s.get("wall"):
            ch = _chord(poly, a, b)
            if ch:
                floor["walls"].append(_band(ch[0], ch[1], float(s["wall"])))
        if s.get("into"):
            left, right = _clip_left(poly, a, b), _clip_left(poly, b, a)
            if not left or not right:
                raise ValueError(f"split: Linie {s['line']} teilt Raum {s['room']} nicht")
            into = s["into"] if isinstance(s["into"], dict) else {"id": s["into"]}
            new = {k: v for k, v in room.items() if k not in ("polygon", "zones")}
            new.update(id=into["id"], name=into.get("name", room.get("name")), polygon=left)
            if s.get("surface"):
                new["floor"] = s["surface"]
            for k in ("ha_area",):
                if into.get(k):
                    new[k] = into[k]
            room["polygon"] = right
            floor["rooms"].append(new)
            # Fenster auf der neuen Seite gehören zum neuen Raum
            for w in floor["windows"]:
                x0, y0, x1, y1 = w["rect"]
                if w.get("room") == room["id"] and _inside_or_near(((x0 + x1) / 2, (y0 + y1) / 2), left):
                    w["room"] = new["id"]
            for d in floor["doors"]:
                mid = ((d["hinge"][0] + d["end"][0]) / 2, (d["hinge"][1] + d["end"][1]) / 2)
                if room["id"] in d.get("rooms", []) and _inside_or_near(mid, left):
                    d["rooms"] = [new["id"] if x == room["id"] else x for x in d["rooms"]]
        elif not s.get("wall") or s.get("surface"):
            split_rooms(floor, [s])
    return floor


def _inside_or_near(p, poly, tol=0.35):
    if _inside(p, poly):
        return True
    # Fenster/Türen liegen in der Wand, knapp außerhalb des Raums: Abstand zum Rand
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i - 1], poly[i]
        dx, dy = x2 - x1, y2 - y1
        L = dx * dx + dy * dy or 1
        t = max(0, min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / L))
        if math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy) <= tol:
            return True
    return False


def _douglas(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy) or 1
    k, dmax = 0, -1
    for i in range(1, len(pts) - 1):
        d = abs(dy * (pts[i][0] - a[0]) - dx * (pts[i][1] - a[1])) / L
        if d > dmax:
            k, dmax = i, d
    if dmax <= eps:
        return [a, b]
    return _douglas(pts[:k + 1], eps)[:-1] + _douglas(pts[k:], eps)


def _trace(mask, nx, ny, x0, y0, res):
    """Umriss der größten zusammenhängenden Fläche einer Rastermaske (Kanten zwischen innen und außen)"""
    edges = {}
    inside = lambda i, j: 0 <= i < nx and 0 <= j < ny and mask[j * nx + i]
    for j in range(ny):
        for i in range(nx):
            if not mask[j * nx + i]:
                continue
            # gerichtete Kanten, innen links (Plan: y nach unten -> gegen den Uhrzeigersinn im Plan-Sinn)
            if not inside(i, j - 1):
                edges[(i + 1, j)] = (i, j)
            if not inside(i, j + 1):
                edges[(i, j + 1)] = (i + 1, j + 1)
            if not inside(i - 1, j):
                edges[(i, j)] = (i, j + 1)
            if not inside(i + 1, j):
                edges[(i + 1, j + 1)] = (i + 1, j)
    loops = []
    while edges:
        start, nxt = edges.popitem()
        loop = [start]
        cur = nxt
        while cur != start and cur in edges:
            loop.append(cur)
            cur = edges.pop(cur)
        loops.append(loop)
    best = max(loops, key=lambda l: abs(_area(l)))
    pts = [[round(x0 + i * res, 3), round(y0 + j * res, 3)] for i, j in best]
    # Ecken: nur Richtungswechsel behalten, dann glätten (Treppen an schrägen Kanten)
    corners = [p for k, p in enumerate(pts)
               if (pts[k - 1][0] - p[0]) * (pts[(k + 1) % len(pts)][1] - p[1]) != (pts[k - 1][1] - p[1]) * (pts[(k + 1) % len(pts)][0] - p[0])]
    # geschlossener Ring: am entferntesten Punkt teilen, beide Hälften vereinfachen
    a = corners[0]
    k = max(range(len(corners)), key=lambda i: math.hypot(corners[i][0] - a[0], corners[i][1] - a[1]))
    eps = res * 1.2
    return _douglas(corners[:k + 1], eps)[:-1] + _douglas(corners[k:] + [a], eps)[:-1]


def _closing(mask, nx, ny, r):
    """Morphologisches Schließen mit einem Quadrat (Kantenlänge 2r+1): schließt Lücken bis 2r Zellen (Wände)"""
    def window(m, test):
        # getrennt nach Zeilen und Spalten: test(Ausschnitt) für jede Zelle
        tmp = [0] * (nx * ny)
        for j in range(ny):
            row = m[j * nx:(j + 1) * nx]
            for i in range(nx):
                tmp[j * nx + i] = test(row[max(0, i - r):i + r + 1])
        out = [0] * (nx * ny)
        for i in range(nx):
            col = tmp[i::nx]
            for j in range(ny):
                out[j * nx + i] = test(col[max(0, j - r):j + r + 1])
        return out

    dilated = window(mask, lambda w: 1 if 1 in w else 0)
    return window(dilated, lambda w: 0 if 0 in w else 1)


def merge_rooms(floor, merges, res=0.05, gap=0.4):
    """Zwei (oder mehr) Räume zusammenlegen, z. B. Zimmer mit Durchgang ohne Tür: Umriss = Vereinigung samt der Wand
    dazwischen (Lücken bis `gap` Meter), Wände dazwischen entfallen, Türen zwischen ihnen ebenso.
    merges: [{ rooms: [a, b, …], id?, name? }] oder [[a, b], …]"""
    for m in merges or []:
        if isinstance(m, (list, tuple)):
            m = {"rooms": list(m)}
        ids = m["rooms"]
        rooms = [next((r for r in floor["rooms"] if r["id"] == i), None) for i in ids]
        if not all(rooms) or len(rooms) < 2:
            raise ValueError(f"merge: Räume {ids} gibt es in Etage {floor['id']} nicht (alle)")
        pts = [p for r in rooms for p in r["polygon"]]
        x0, y0 = min(p[0] for p in pts) - gap, min(p[1] for p in pts) - gap
        nx = int((max(p[0] for p in pts) + gap - x0) / res) + 1
        ny = int((max(p[1] for p in pts) + gap - y0) / res) + 1
        cell = lambda i, j: (x0 + (i + 0.5) * res, y0 + (j + 0.5) * res)
        union = [1 if any(_inside(cell(i, j), r["polygon"]) for r in rooms) else 0 for j in range(ny) for i in range(nx)]
        closed = _closing(union, nx, ny, max(1, int(math.ceil(gap / 2 / res))))
        bridge = [c and not u for c, u in zip(closed, union)]
        poly = _trace(closed, nx, ny, x0, y0, res)
        if _area(poly) < 0:
            poly.reverse()
        # Wände im Zwischenraum entfernen bzw. kürzen
        in_bridge = lambda p: (lambda i, j: 0 <= i < nx and 0 <= j < ny and bridge[j * nx + i])(int((p[0] - x0) / res), int((p[1] - y0) / res))
        walls = []
        for w in floor["walls"]:
            walls.extend(_cut_wall(w, in_bridge, res))
        floor["walls"] = walls
        keep, rest = rooms[0], set(ids[1:])
        keep["polygon"] = poly
        keep["id"] = m.get("id", keep["id"])
        if m.get("name"):
            keep["name"] = m["name"]
        floor["rooms"] = [r for r in floor["rooms"] if r is keep or r["id"] not in rest]
        all_ids = set(ids) | {keep["id"]}
        floor["doors"] = [d for d in floor["doors"] if not (len(set(d.get("rooms", [])) & all_ids) >= 2)]
        for d in floor["doors"]:
            d["rooms"] = [keep["id"] if x in all_ids else x for x in d.get("rooms", [])]
        for w in floor["windows"]:
            if w.get("room") in all_ids:
                w["room"] = keep["id"]
        print(f"  Etage {floor['id']}: Räume {', '.join(ids)} -> {keep['id']}")
    return floor


def _cut_wall(w, in_bridge, res):
    """Wand ohne den Teil im Zwischenraum: achsparallele Rechtecke werden gekürzt, andere Wände entfallen, wenn sie
    überwiegend darin liegen"""
    xs, ys = [p[0] for p in w], [p[1] for p in w]
    bx0, bx1, by0, by1 = min(xs), max(xs), min(ys), max(ys)
    rect = len(w) == 4 and all(p[0] in (bx0, bx1) and p[1] in (by0, by1) for p in w)
    along_x = (bx1 - bx0) >= (by1 - by0)
    n = max(2, int(((bx1 - bx0) if along_x else (by1 - by0)) / res))
    mid = ((by0 + by1) / 2) if along_x else ((bx0 + bx1) / 2)
    hit = []
    for k in range(n):
        t = (k + 0.5) / n
        p = (bx0 + (bx1 - bx0) * t, mid) if along_x else (mid, by0 + (by1 - by0) * t)
        hit.append(in_bridge(p) and (rect or _inside(p, w)))
    if not any(hit):
        return [w]
    if not rect:
        return [] if sum(hit) / n > 0.6 else [w]
    # zusammenhängende Stücke außerhalb des Zwischenraums behalten
    out, k = [], 0
    while k < n:
        if hit[k]:
            k += 1
            continue
        s = k
        while k < n and not hit[k]:
            k += 1
        a, b = s / n, k / n
        if along_x:
            ax, bx = round(bx0 + (bx1 - bx0) * a, 3), round(bx0 + (bx1 - bx0) * b, 3)
            if bx - ax > 0.02:
                out.append([[ax, by0], [bx, by0], [bx, by1], [ax, by1]])
        else:
            ay, by = round(by0 + (by1 - by0) * a, 3), round(by0 + (by1 - by0) * b, 3)
            if by - ay > 0.02:
                out.append([[bx0, ay], [bx1, ay], [bx1, by], [bx0, by]])
    return out


def clip_floor(floor, clip):
    """Etage auf ein konvexes Polygon beschneiden (z. B. ragt eine obere Etage über den Umriss darunter hinaus) und an
    den Schnittkanten mit Wänden schließen. clip: { polygon, wall: Stärke (0.2) } oder nur das Polygon"""
    if not clip:
        return floor
    if isinstance(clip, list):
        clip = {"polygon": clip}
    poly = [list(p) for p in clip["polygon"]]
    t = float(clip.get("wall", 0.2))
    if _area(poly) > 0:
        poly.reverse()  # so liegt das Innere auf der Seite, die _clip_left behält
    n = len(poly)
    turns = {math.copysign(1, cr) for i in range(n)
             for a, b, c in [(poly[i - 1], poly[i], poly[(i + 1) % n])]
             for cr in [(b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])] if abs(cr) > 1e-9}
    if len(turns) > 1:
        raise ValueError("clip: das Polygon muss konvex sein (L-Formen in zwei Schritten bzw. mit split)")

    def clip_poly(p):
        out = p
        for i in range(n):
            if not out:
                return None
            out = _clip_left(out, poly[i], poly[(i + 1) % n])
        return out if out and abs(_area(out)) > 1e-4 else None

    rooms = []
    for r in floor["rooms"]:
        p = clip_poly(r["polygon"])
        if p:
            r["polygon"] = p
            if r.get("zones"):
                r["zones"] = [dict(z, polygon=zp) for z in r["zones"] for zp in [clip_poly(z["polygon"])] if zp]
            rooms.append(r)
    dropped = {r["id"] for r in floor["rooms"]} - {r["id"] for r in rooms}
    floor["rooms"] = rooms
    floor["walls"] = [p for p in (clip_poly(w) for w in floor["walls"]) if p]
    inside = lambda p: all(_side(poly[i], poly[(i + 1) % n], p) >= -1e-6 for i in range(n))
    floor["windows"] = [w for w in floor["windows"] if inside(((w["rect"][0] + w["rect"][2]) / 2, (w["rect"][1] + w["rect"][3]) / 2))]
    floor["doors"] = [d for d in floor["doors"] if inside(d["hinge"]) and inside(d["end"])]
    for d in floor["doors"]:
        d["rooms"] = [x for x in d.get("rooms", []) if x not in dropped]
    # Schnittkanten schließen: wo ein Raum an einer Kante des Polygons endet, eine Wand nach innen
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
        spans = []
        for r in rooms:
            p = r["polygon"]
            for k in range(len(p)):
                u, v = p[k - 1], p[k]
                if abs(_side(a, b, u)) / L < 1e-3 and abs(_side(a, b, v)) / L < 1e-3:
                    tu = ((u[0] - a[0]) * (b[0] - a[0]) + (u[1] - a[1]) * (b[1] - a[1])) / L
                    tv = ((v[0] - a[0]) * (b[0] - a[0]) + (v[1] - a[1]) * (b[1] - a[1])) / L
                    spans.append((min(tu, tv), max(tu, tv)))
        spans.sort()
        merged = []
        for s in spans:
            if merged and s[0] <= merged[-1][1] + 0.3:  # kleine Lücken (Wände dazwischen) mit schließen
                merged[-1] = (merged[-1][0], max(merged[-1][1], s[1]))
            else:
                merged.append(s)
        ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        # nach innen: links von a→b im Plan-Sinn von _clip_left
        ix, iy = uy, -ux
        if _side(a, b, (a[0] + ix, a[1] + iy)) < 0:
            ix, iy = -ix, -iy
        for s0, s1 in merged:
            p = [a[0] + ux * s0 + ix * t / 2, a[1] + uy * s0 + iy * t / 2]
            q = [a[0] + ux * s1 + ix * t / 2, a[1] + uy * s1 + iy * t / 2]
            floor["walls"].append(_band(p, q, t))
    return floor


def _side(a, b, p):
    """> 0: p liegt auf der Seite, die _clip_left behält"""
    return (b[1] - a[1]) * (p[0] - a[0]) - (b[0] - a[0]) * (p[1] - a[1])
