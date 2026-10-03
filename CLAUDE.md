# 3D-HA-Dashboard – Engine

Diese Datei ist das Briefing für die Entwicklung der Engine (z. B. durch einen Claude-Cloud-Agenten). Lies sie
vollständig, bevor du etwas änderst, und halte sie aktuell (Entscheidungslog unten).

## Was das ist

Ein interaktiver 3D-Grundriss als Home-Assistant-Panel (`panel_custom`, Custom Element `<ha-3d-dashboard>`; Installation über HACS, Kategorie Dashboard):
three.js, ein JS-Bundle, offline, touch-tauglich. Das Panel lädt die Hausdaten zur Laufzeit aus seinem Ordner
(`house.json`, `furniture.yaml`, `devices.yaml`, `textures/`) bzw. aus `panel_custom → config → data_url`.

**Engine vs. Instanz:** Dieses Repo ist öffentlich und enthält nur Code, Werkzeuge, Doku und das erfundene Demo-Haus
(`examples/demo`). Echte Häuser leben in privaten Instanzen, die die Engine als Submodul `engine/` einbinden
(`templates/instance`, `scripts/init-instance.mjs`, `docs/SETUP.md`). Die Instanz konfiguriert die Werkzeuge über
`ha3d.config.json` in ihrem Ordner.

## Harte Regeln

- **Keine privaten Daten.** Nie Grundrisse, Fotos, HA-Exporte, Entity-IDs, Namen oder Adressen echter Häuser
  committen. Testdaten = Demo-Haus. `npm run privacy` (Teil von `npm test`) blockiert PDFs, Bilder außerhalb von
  `docs/`, Datenordner und Hausdaten außerhalb von `examples/demo`. Lokal prüft er zusätzlich Begriffe aus einer
  gitignorierten `.privacy-terms`.
- **Offline:** three.js und alles andere wird gebündelt. Keine CDNs, keine externen Requests (die Tests scheitern
  daran). Keine Tokens – das Panel nutzt das `hass`-Objekt.
- **Performance:** Render-on-demand (keine Dauerschleife), schlanke Geometrie, ein Mesh pro Material, Licht im
  Shader statt Schatten-Maps pro Lampe. Muss auf Tablets flüssig laufen.
- **Touch:** Bedienelemente ≥ 48 px, Gesten (1 Finger drehen, 2 Finger zoomen/verschieben).
- **Datenformat stabil halten:** Instanzen pflegen ihre Daten von Hand. Änderungen am Format nur abwärtskompatibel
  (neue Felder optional, Standardwerte im Code) und in `docs/DATA_FORMAT.md` dokumentieren. Raum-IDs, Element-Name
  (`ha-3d-dashboard`), Bundle-Name (`dist/ha-3d-dashboard.js`) und Speicherschlüssel (`ha_3d_dashboard_layout`)
  nicht ändern.
- **Sprache:** Oberfläche, Kommentare und Doku auf Deutsch.
- **Schau dir die Screenshots an** (`tests/output/`), bevor du eine sichtbare Änderung als fertig meldest.
- Kleine Schritte, ein Commit pro Schritt.

## Umgebung (Cloud/Linux)

```bash
npm ci
npx playwright-core install --with-deps chromium   # einmalig, für die Screenshot-/Bedien-Tests
pip install pymupdf                                 # nur für scripts/extract_plan.py
```

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run build` | `dist/ha-3d-dashboard.js` (esbuild) |
| `npm run serve` | Vorschau mit Demo-Haus: http://127.0.0.1:8123/tests/harness.html |
| `npm test` | Datenschutz-Check, Datenprüfung, Unit-Tests, Link-Check, Build, Screenshots, Bedien-Tests |
| `npm run test:demo` | Demo-Modus und Fallback (Teil von `npm test`) |
| `npm run demo` | Demo-Haus aus `examples/demo/build-house.mjs` neu erzeugen |
| `python scripts/extract_plan.py <pdf> --out <ordner>/house.json [--config plan.json] [--debug]` | Magicplan-Import |

Alle Werkzeuge nehmen den Datenordner aus `DATA_DIR` (bzw. `--data` oder `ha3d.config.json` der Instanz), Standard
ist das Demo-Haus. `ENTITIES` = HA-Export für Link-Check/Harness, `VIEWS` = zusätzliche Screenshot-Ansichten.

## Code-Aufbau

- `src/main.js` Custom Element, Kompass, Editier-Werkzeugleiste, Link-Check, HA-Anbindung
- `src/data.js` lädt die Daten zur Laufzeit (js-yaml im Browser) · `src/demo.js` eingebettetes Demo-Haus
- `src/scene.js` Kamera, Himmel (Sonne/Mond aus `sun.sun`), Render-on-demand, Antippen, Licht-Zustand
- `src/house.js` Bauwerk aus `house.json` · `src/openings.js` Fenster und Türen im Detail
- `src/furnishing.js` Einrichtungs-Schicht (austauschbar ohne das Haus neu zu bauen)
- `src/models.js` prozedurale Möbel (`FURNITURE`) und Leuchten (`LAMPS`), Material-`PALETTE`
- `src/roomlight.js` Raumlicht im Shader (Lampen in einer Float-Textur, `roomIdx` pro Fläche)
- `src/editor.js` Editiermodus (TransformControls, Anlegen, Rückgängig) · `src/store.js` Speichern (YAML-Patch,
  Dev-Server bzw. HA-Benutzerdaten, Export) · `src/picker.js` Entity-Auswahl · `src/ha.js` Zustand/Dienste
- `src/geometry.js`, `src/textures.js` Helfer, prozedurale Texturen
- `tests/` Harness + simuliertes HA (`mock-hass.js`), `screenshots.mjs` (beliebige Daten), `interaction.mjs`
  (Demo-IDs), `validate-data.mjs`, `link-check.mjs`, `store.test.mjs`, `privacy-guard.mjs`, `lib/`
- `scripts/` Build, Magicplan-Import, `house_fixes.py`, Platzhalter-Leuchten, Deploy, `init-instance.mjs`

## Lichtmodell

Jede Fläche trägt ein Vertex-Attribut `roomIdx`. Eine Leuchte wirkt nur auf Flächen ihres Raums (Abfall mit
Entfernung und Einfallswinkel plus wenig indirektes Licht), daher kein Licht durch Wände und keine Schatten-Maps pro
Lampe. Lampen-/Raumdaten in einer Float-Textur (`LightTable`). Nur Sonne/Mond werfen Schatten; die Schatten-Map wird
nur bei Änderungen neu berechnet. Außenleuchten: Pseudo-Raum `aussen`.

## Entscheidungslog

- Datenschichten Bauwerk/Einrichtung/Geräte; Daten zur Laufzeit statt im Bundle.
- Möbel und Leuchten prozedural (klein, offline, per Daten parametrierbar) statt 3D-Dateien.
- Editor speichert lokal über den Dev-Server (YAML-Text-Patch, Kommentare bleiben), in HA in die Benutzerdaten
  (`frontend/set_user_data`), plus Export. Eine HA-Integration für gemeinsames Speichern ist eine mögliche
  Weiterentwicklung.
- Drehwinkel aus der Quaternion lesen (nicht `rotation.y`, das ist über 90° gespiegelt).
- YAML-Patch erhält das Zeilenende (CRLF-Dateien unter Windows).
- HACS (Kategorie Dashboard): `hacs.json` im Root, das Release-Asset `ha-3d-dashboard.js` kommt aus
  `.github/workflows/release.yml` (Tag `v*` oder Actions → Release → Run workflow mit Version = `package.json`).
  `dist/` bleibt gitignored. Eine HACS-Validierung (hacs/action) fehlt bewusst: sie scheitert vor dem ersten Release
  und braucht Repo-Beschreibung/Topics in den GitHub-Einstellungen.
- Demo-Modus: Das Demo-Haus steckt als Text im Bundle (esbuild-Plugin `demo-data`, ~15 kB). Aktiv per
  `config.demo: true` oder als Fallback, wenn die Daten unerreichbar sind (`DataUnavailableError`, nur ohne
  vorhandene Ansicht). Dann: lokal schalten statt HA-Dienste, Sonne weiter aus `sun.sun`, kein Speichern/Export, keine
  Benutzerdaten-Overrides – eigene Daten werden nie überschrieben, kaputte eigene Daten nie durch die Demo ersetzt.
- `data_url` wird als Ordner behandelt (fehlender `/` wird ergänzt).
