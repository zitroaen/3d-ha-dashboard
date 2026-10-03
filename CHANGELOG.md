# Änderungen

## 0.2.0

- **HACS:** Installation über HACS (Benutzerdefiniertes Repository, Typ *Dashboard*); `hacs.json`, Release-Workflow
  (`.github/workflows/release.yml`) hängt `ha-3d-dashboard.js` an das GitHub-Release.
- **Demo-Modus:** Das Demo-Haus steckt im Bundle. `panel_custom → config → demo: true` zeigt es ohne eigene Daten.
  Sind die Daten (neben dem Modul bzw. unter `data_url`) nicht erreichbar, zeigt das Panel automatisch das Demo-Haus
  mit Hinweis. Im Demo-Modus wird lokal geschaltet, Sonne/Mond kommen weiter aus `sun.sun`, der Editor speichert
  nichts (Speichern/Export ausgeblendet) – eigene Daten werden nie überschrieben.
- `data_url` ohne abschließenden Schrägstrich wird als Ordner behandelt.
- Tests: `tests/demo.mjs` (Demo-Modus und Fallback); `PW_EXECUTABLE` wählt den Browser für die Tests.

## 0.1.0

- Erste Version: 3D-Grundriss-Panel mit Licht, Himmel, Editor und Link-Check.
