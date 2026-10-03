"""Bereinigt ein Gebäude (building.json aus extract_plan.py) nach der Extraktion (idempotent, ändert nur, was zu bereinigen ist):

- Fenster, die direkt nebeneinander liegen (Lücke < 10 cm), werden zu einem Fensterband zusammengefasst.
  Magicplan zeichnet sie einzeln, mit einem wenige Millimeter dünnen Wandstreifen dazwischen. Im Modell
  stünde dort ein Pfeiler in voller Raumhöhe, den es in Wirklichkeit nicht gibt.
- Wandstreifen innerhalb solcher Bänder und entartete Wände (weniger als 3 Punkte, keine Fläche) fallen weg.

    python scripts/house_fixes.py <ordner>/building.json     # bereinigt die Datei an Ort und Stelle
"""
import json
import sys
from pathlib import Path
MAX_GAP = 0.10


def _axis(r):
    return "h" if r[2] - r[0] > r[3] - r[1] else "v"


def _area(poly):
    return abs(sum(poly[i - 1][0] * p[1] - p[0] * poly[i - 1][1] for i, p in enumerate(poly)) / 2)


def merge_adjacent_windows(floor):
    wins = [dict(w) for w in floor["windows"]]
    changed = True
    while changed:
        changed = False
        for i, a in enumerate(wins):
            for j, b in enumerate(wins):
                if i >= j or _axis(a["rect"]) != _axis(b["rect"]):
                    continue
                A, B = a["rect"], b["rect"]
                h = _axis(A) == "h"
                # quer überlappend (gleiche Wand) und entlang der Wand höchstens MAX_GAP auseinander
                lo, hi = (1, 3) if h else (0, 2)
                al0, al1 = (0, 2) if h else (1, 3)
                if min(A[hi], B[hi]) - max(A[lo], B[lo]) < 0.05:
                    continue
                gap = max(A[al0], B[al0]) - min(A[al1], B[al1])
                if not (-0.01 < gap < MAX_GAP):
                    continue
                merged = dict(a)
                merged["rect"] = [round(min(A[0], B[0]), 3), round(min(A[1], B[1]), 3),
                                  round(max(A[2], B[2]), 3), round(max(A[3], B[3]), 3)]
                sash = lambda w: w.get("sashes") or max(1, min(4, round(max(w["rect"][2] - w["rect"][0], w["rect"][3] - w["rect"][1]) / 0.52)))
                merged["sashes"] = sash(a) + sash(b)
                wins[i] = merged
                del wins[j]
                changed = True
                break
            if changed:
                break
    floor["windows"] = wins

    def inside_window(poly):
        for w in wins:
            x0, y0, x1, y1 = w["rect"]
            if all(x0 - 0.01 <= x <= x1 + 0.01 and y0 - 0.01 <= y <= y1 + 0.01 for x, y in poly):
                return True
        return False

    floor["walls"] = [w for w in floor["walls"] if len(w) >= 3 and _area(w) > 1e-4 and not inside_window(w)]


def fix_house(house):
    for f in house["floors"]:
        merge_adjacent_windows(f)
    return house


def main():
    """Gebäude im Datenmodell v2 (building.json aus extract_plan.py) nachbearbeiten."""
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    p = Path(sys.argv[1])
    building = json.loads(p.read_text(encoding="utf-8"))
    house = {"floors": [{**f, "walls": [w["polygon"] for w in f["walls"]], "windows": f.get("windows", [])} for f in building["floors"]]}
    before = [(len(f["windows"]), len(f["walls"])) for f in house["floors"]]
    fix_house(house)
    for f, h in zip(building["floors"], house["floors"]):
        f["walls"] = [{"polygon": w} for w in h["walls"]]
        f["windows"] = h["windows"]
    p.write_text(json.dumps(building, ensure_ascii=False, indent=1), encoding="utf-8")
    for f, (w, wl) in zip(building["floors"], before):
        print(f'{f["id"]}: Fenster {w} -> {len(f["windows"])}, Wände {wl} -> {len(f["walls"])}')


if __name__ == "__main__":
    main()
