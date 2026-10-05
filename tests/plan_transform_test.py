"""Tests der Etagen-Umformungen des Magicplan-Imports (scripts/plan_transform.py), ohne PDF.
    python3 tests/plan_transform_test.py       (läuft in npm run test:unit)
"""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from plan_transform import rotate_floor, translate_floor, unique_room_ids, split_rooms  # noqa: E402

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

if failed:
    print(f"✖ {failed} Test(s) fehlgeschlagen")
    sys.exit(1)
