"""Tests der Etagen-Umformungen des Magicplan-Imports (scripts/plan_transform.py), ohne PDF.
    python3 tests/plan_transform_test.py       (läuft in npm run test:unit)
"""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from plan_transform import rotate_floor, translate_floor, unique_room_ids, split_rooms, stretch_floor, split_rooms_ext, merge_rooms, clip_floor, _area  # noqa: E402

failed = 0


def check(name, cond, info=""):
    global failed
    print(("✔ " if cond else "✖ ") + name + ("" if cond else f"  {info}"))
    failed += 0 if cond else 1


def floor(fid, rid="bad"):
    # 4 × 2 m: Außenwand-Umrandung (0,0)–(4,2), ein Raum, Fenster oben, Tür unten
    return {
        "id": fid,
        "walls": [[[0, 0], [4, 0], [4, 0.2], [0, 0.2]], [[0, 1.8], [4, 1.8], [4, 2], [0, 2]]],
        "rooms": [{"id": rid, "name": "Bad", "polygon": [[0.2, 0.2], [3.8, 0.2], [3.8, 1.8], [0.2, 1.8]]}],
        "windows": [{"rect": [1, 0, 2, 0.2], "room": rid}],
        "doors": [{"hinge": [3, 1.9], "end": [3.8, 1.9], "rooms": [rid, None]}],
    }


f = rotate_floor(floor("eg"), 90)
check("Drehen 90°: Umrandung 4 × 2 wird 2 × 4, Ursprung bleibt links oben",
      max(p[0] for w in f["walls"] for p in w) == 2 and max(p[1] for w in f["walls"] for p in w) == 4
      and min(p[0] for w in f["walls"] for p in w) == 0, f["walls"])
check("Drehen 90° im Uhrzeigersinn: oben liegendes Fenster liegt danach rechts", f["windows"][0]["rect"] == [1.8, 1, 2, 2], f["windows"][0])
check("Drehen 90°: Tür und Raum gedreht", f["doors"][0]["hinge"] == [0.1, 3] and [1.8, 0.2] in f["rooms"][0]["polygon"],
      (f["doors"][0], f["rooms"][0]["polygon"]))
g = rotate_floor(rotate_floor(copy.deepcopy(f), 180), 90)
check("Drehen 90 + 180 + 90 = einmal herum", g["walls"] == floor("eg")["walls"], g["walls"])
t = translate_floor(floor("eg"), [10, 5])
check("Versatz nach der Drehung", t["doors"][0]["end"] == [13.8, 6.9] and t["windows"][0]["rect"] == [11, 5, 12, 5.2])
fl = unique_room_ids([floor("eg"), floor("og")])
check("Raum-IDs eindeutig: Etagenkürzel bei Doppelung, Türen und Fenster folgen",
      fl[0]["rooms"][0]["id"] == "bad" and fl[1]["rooms"][0]["id"] == "og_bad"
      and fl[1]["doors"][0]["rooms"][0] == "og_bad" and fl[1]["windows"][0]["room"] == "og_bad")
s = split_rooms(floor("eg"), [{"room": "bad", "line": [[2, 2], [2, 0]], "surface": "flagstone"}])
z = s["rooms"][0]["zones"][0]
check("Teilen: links der Linie (im Plan nach oben gezogen) wird eine Belag-Zone",
      z["surface"] == "flagstone" and max(p[0] for p in z["polygon"]) == 2 and min(p[0] for p in z["polygon"]) == 0.2, z)

st = stretch_floor(floor("eg"), {"axis": "x", "from": 2, "src": 4, "dst": 4.4})
check("Strecken ab x = 2: rechte Wand 4 -> 4,4, links davon unverändert",
      max(p[0] for w in st["walls"] for p in w) == 4.4 and st["windows"][0]["rect"] == [1, 0, 2, 0.2] and st["doors"][0]["hinge"] == [3.2, 1.9],
      (st["walls"], st["doors"]))

sp = split_rooms_ext(floor("eg"), [{"room": "bad", "line": [[2, 2], [2, 0]], "into": {"id": "wc", "name": "WC"}, "wall": 0.1}])
wc = next(r for r in sp["rooms"] if r["id"] == "wc")
bad = next(r for r in sp["rooms"] if r["id"] == "bad")
check("Teilen in zwei Räume mit Raumteiler-Wand: Polygone, Wand, Fenster und Tür zugeordnet",
      max(p[0] for p in wc["polygon"]) == 2 and min(p[0] for p in bad["polygon"]) == 2 and len(sp["walls"]) == 3
      and sp["windows"][0]["room"] == "wc" and sp["doors"][0]["rooms"][0] == "bad" and wc["name"] == "WC",
      (wc, bad, sp["walls"][-1], sp["windows"], sp["doors"]))


def two_rooms():
    return {
        "id": "eg",
        "walls": [[[0, 0], [8, 0], [8, 0.2], [0, 0.2]], [[0, 2.8], [8, 2.8], [8, 3], [0, 3]],
                  [[0, 0], [0.2, 0], [0.2, 3], [0, 3]], [[7.8, 0], [8, 0], [8, 3], [7.8, 3]],
                  [[3.9, 0.2], [4.1, 0.2], [4.1, 2.8], [3.9, 2.8]]],
        "rooms": [{"id": "a", "name": "Wohnen", "polygon": [[0.2, 0.2], [3.9, 0.2], [3.9, 2.8], [0.2, 2.8]]},
                  {"id": "b", "name": "Essen", "polygon": [[4.1, 0.2], [7.8, 0.2], [7.8, 2.8], [4.1, 2.8]]}],
        "windows": [{"rect": [5, 0, 6, 0.2], "room": "b"}],
        "doors": [{"hinge": [4, 1], "end": [4, 1.9], "rooms": ["a", "b"]}, {"hinge": [6, 2.9], "end": [6.9, 2.9], "rooms": ["b", None]}],
    }


mg = merge_rooms(two_rooms(), [{"rooms": ["a", "b"], "id": "wohnen", "name": "Wohnen/Essen"}])
r = mg["rooms"][0]
check("Zusammenlegen: ein Raum über beide samt Wand dazwischen, Rechteck mit 4 Ecken",
      len(mg["rooms"]) == 1 and r["id"] == "wohnen" and len(r["polygon"]) == 4 and abs(abs(_area(r["polygon"])) - 7.6 * 2.6) < 0.05, r)
check("Zusammenlegen: Zwischenwand und Tür dazwischen entfallen, Außenwände/-tür bleiben, Fenster folgen",
      len(mg["walls"]) == 4 and len(mg["doors"]) == 1 and mg["doors"][0]["rooms"][0] == "wohnen" and mg["windows"][0]["room"] == "wohnen",
      (mg["walls"], mg["doors"]))

cl = clip_floor(floor("eg"), {"polygon": [[0, 0], [3, 0], [3, 2], [0, 2]], "wall": 0.2})
check("Beschneiden: Raum und Wände enden am Polygon, Tür außerhalb entfällt",
      max(p[0] for p in cl["rooms"][0]["polygon"]) == 3 and max(p[0] for w in cl["walls"] for p in w) <= 3 and not cl["doors"]
      and len(cl["windows"]) == 1, (cl["rooms"], cl["doors"]))
new_wall = cl["walls"][-1]
check("Beschneiden: Schnittkante mit Wand nach innen geschlossen",
      min(p[0] for p in new_wall) == 2.8 and max(p[0] for p in new_wall) == 3 and min(p[1] for p in new_wall) == 0.2 and max(p[1] for p in new_wall) == 1.8,
      new_wall)
try:
    clip_floor(floor("eg"), [[0, 0], [3, 0], [3, 1], [1, 1], [1, 2], [0, 2]])
    check("Beschneiden: nicht konvexes Polygon wird abgelehnt", False)
except ValueError:
    check("Beschneiden: nicht konvexes Polygon wird abgelehnt", True)

if failed:
    print(f"✖ {failed} Test(s) fehlgeschlagen")
    sys.exit(1)
