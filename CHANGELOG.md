# Changelog

## [0.2.0]

### Neu
- **HACS-Installation** (Kategorie Dashboard): `hacs.json`, Release-Workflow (`.github/workflows/release.yml`) hängt
  `ha-3d-dashboard.js` an ein GitHub-Release. Modul-URL: `/hacsfiles/3d-ha-dashboard/ha-3d-dashboard.js`.
- **Demo-Modus:** das Demo-Haus ist im Bundle eingebettet (+ ca. 10 KB). `panel_custom → config → demo: true` zeigt es;
  Antippen schaltet lokal, Sonne/Mond kommen weiter aus `sun.sun`, der Editor speichert nichts (Speichern, Export und
  Verknüpfen ausgeblendet), Link-Check ausgeblendet.
- **Fallback:** ist unter `data_url` bzw. neben dem Modul keine `house.json` ladbar, zeigt das Panel das Demo-Haus mit dem
  Hinweis „Demo-Haus – eigene Daten: siehe Anleitung“ statt nur einer Fehlermeldung. Defekte eigene Daten bleiben ein Fehler.
- `data_url` wird auch ohne abschließendes `/` richtig aufgelöst.
- Tests: `tests/demo-mode.mjs` (Demo-Modus, Fallback, lokales Schalten, keine externen Requests), `tests/data.test.mjs`;
  `PW_EXECUTABLE` für ein vorhandenes Chromium.

### Doku
- README und `docs/SETUP.md`: HACS-Weg, Demo-Haus ausprobieren, eigenes Haus mit `data_url`.

## [0.1.0]
- Erste Version der Engine: 3D-Grundriss-Panel, Licht, Himmel, Editor, Link-Check, Werkzeuge.
