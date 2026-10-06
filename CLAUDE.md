# 3D-HA-Dashboard – Engine

Diese Datei ist das Briefing für die Entwicklung der Engine (z. B. durch einen Claude-Cloud-Agenten). Lies sie
vollständig, bevor du etwas änderst, und halte sie aktuell (Entscheidungen: `docs/DECISIONS.md`).

## Was das ist

Ein interaktiver 3D-Grundriss als Home-Assistant-Panel (Custom Element `<ha-3d-dashboard>`; Installation über HACS,
Kategorie Integration – die Integration `custom_components/ha_3d_dashboard` trägt das Panel ohne YAML in die Seitenleiste
ein; alternativ `panel_custom` von Hand):
three.js, ein JS-Bundle, offline, touch-tauglich. Das Panel lädt die Hausdaten zur Laufzeit aus seinem Ordner
(`model.yaml`, `textures/`) bzw. aus `panel_custom → config → data_url`. Das Datenmodell ist in `docs/DATA_MODEL.md`
spezifiziert (maschinenlesbar: `schema/model.schema.json`).

**Engine vs. Instanz:** Dieses Repo ist öffentlich und enthält nur Code, Werkzeuge, Doku und das erfundene Demo-Haus
(`examples/demo`). Echte Häuser leben in privaten Instanzen, die die Engine als Submodul `engine/` einbinden
(`templates/instance`, `scripts/init-instance.mjs`, `docs/SETUP.md`). Die Instanz konfiguriert die Werkzeuge über
`ha3d.config.json` in ihrem Ordner. Alles, was von Haus zu Haus verschieden ist (Beläge, Fassaden, Fenster-, Tür-,
Torarten, Möbel), sind Daten: Die Engine hat Generatoren und eine Beispiel-Bibliothek (`library/`), die Instanz
ergänzt/ändert sie in `model.yaml` bzw. `models/` (`docs/LIBRARY.md`) – nie Hausspezifisches in den Engine-Code.

## Harte Regeln

- **Keine privaten Daten.** Nie Grundrisse, Fotos, HA-Exporte, Entity-IDs, Namen oder Adressen echter Häuser
  committen. Testdaten = Demo-Haus. `npm run privacy` (Teil von `npm test`) blockiert PDFs, 3D-Scans, Bilder außerhalb von
  `docs/`, Datenordner und Hausdaten außerhalb von `examples/demo`. Lokal prüft er zusätzlich Begriffe aus einer
  gitignorierten `.privacy-terms`.
- **Offline:** three.js und alles andere wird gebündelt. Keine CDNs, keine externen Requests (die Tests scheitern
  daran). Keine Tokens – das Panel nutzt das `hass`-Objekt.
- **Performance:** Render-on-demand (keine Dauerschleife), schlanke Geometrie, ein Mesh pro Material, Licht im
  Shader statt Schatten-Maps pro Lampe. Muss auf Tablets flüssig laufen.
- **Touch:** Bedienelemente ≥ 48 px, Gesten (1 Finger drehen, 2 Finger zoomen/verschieben).
- **Datenmodell versioniert:** Instanzen (und Agenten) pflegen `model.yaml` von Hand. Optionale neue Felder mit
  Standardwert im Code gehen ohne neue Version. Alles andere (Umbenennen, Umstrukturieren, Pflichtfelder) nur mit
  neuer `version` und Migration in `src/model/migrate.js` (`MIGRATIONS[n]` hebt n−1 → n, mit Test) – alte Modelle
  werden beim Laden automatisch migriert. Jede Änderung in `docs/DATA_MODEL.md` (inkl. „Änderungen“) und
  `schema/model.schema.json` nachziehen; `npm run validate` prüft Doku-Katalog und Code. Raum-IDs, Element-Name
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
| `npm run test:webkit` | Safari/iOS-Engine, HA-Einbettung (nach `npx playwright-core install webkit`; in der CI) |
| `npm run package` | `dist/ha_3d_dashboard.zip` (Integration + Bundle, für HACS; nach `npm run build`) |
| `bash tests/ha/install.sh && python -m pytest tests/ha` | Tests der HA-Integration (Python ≥ 3.13) |
| `npm run demo` | Demo-Haus aus `examples/demo/build-house.mjs` neu erzeugen |
| `npm run test:perf` | Leistungsbudget: Zeichenaufrufe und Dreiecke pro Bild (Teil von `npm test`) |
| `node scripts/logo.mjs` | Logo: `docs/logo.svg` und Markenbilder `custom_components/ha_3d_dashboard/brand/*.png` |
| `npm run test:unit` | Modell: Migration, YAML, Szenen-Adapter, Zurückschreiben (Teil von `npm test`) |
| `npm run preview -- <id> …` | Kontaktbogen (ein Bild) von Oberflächen/Modellen, ohne IDs alle eigenen, `--all-surfaces` (nach `npm run build`) |
| `python scripts/extract_plan.py <pdf> --out building.json [--config plan.json] [--debug]` | Magicplan-Import (ein Gebäude; Etagen drehen/verschieben, Raum-IDs, Räume teilen: `scripts/plan_transform.py`) |
| `node scripts/import-building.mjs building.json` | Gebäude in `model.yaml` einfügen/ersetzen |
| `node scripts/terrain-from-scan.mjs scan.obj --cell 0.5 --rotate … --offset x,y --floor … --write` | Höhenraster `site.terrain` aus einem LiDAR-Scan (OBJ) |
| `node scripts/terrain-from-geotiff.mjs dgm.tif … --write` | Höhenraster aus DGM (GeoTIFF/XYZ), Einpassung `site.georef` oder `--origin/--north/--floor` |
| `node scripts/fit-footprint.mjs lod2.gml --write` | Grundriss an CityGML-LoD2 einpassen -> `site.georef` (Nordrichtung, Ursprung, IoU) |
| `node scripts/roof-from-lod2.mjs lod2.gml` | Dachteile aus LoD2 vorschlagen (Text) |
| `node scripts/trees-from-ndom.mjs ndom.tif … --write` | Bäume aus einem nDOM (Wipfel, Kronendurchmesser) als Objekte |
| `node scripts/orthophoto-crop.mjs dop.tif … --write` | Luftbild `site.terrain.texture` aus einem Orthophoto (zuschneiden, in Plan-Ausrichtung drehen) |

Alle Werkzeuge nehmen den Datenordner aus `DATA_DIR` (bzw. `--data` oder `ha3d.config.json` der Instanz), Standard
ist das Demo-Haus. `ENTITIES` = HA-Export für Link-Check/Harness, `VIEWS` = zusätzliche Screenshot-Ansichten.

## Code-Aufbau

- `src/main.js` Custom Element, Kompass (Tippen: einnorden, Doppeltippen: Standardansicht), Editier-Werkzeugleiste,
  Link-Check, HA-Anbindung · `src/menu.js` Einstellungsmenü (Zahnrad: Tageszeit, Qualität, Bearbeiten, Link-Check,
  Standardansicht, Info; Ansicht pro Gerät in localStorage)
- `src/model/` Datenmodell: `model.js` (Parsen, `toScene()` = Adapter Modell → Szene, `writeBack()` Editor → Modell,
  Gesten/Aktionen), `migrate.js` (Version, Migrationen), `catalog.js` (Modellkatalog mit Fähigkeiten), `yaml.js`
  (YAML-Schreiber) · `schema/model.schema.json` JSON-Schema
- `src/data.js` lädt `model.yaml` zur Laufzeit (js-yaml im Browser) · `src/demo.js` eingebettetes Demo-Haus
- `src/scene.js` Kamera, Himmel (Sonne/Mond aus `sun.sun`), Render-on-demand, Antippen, Licht-Zustand
- `src/house.js` Bauwerk einer Etage (Räume, Wände, Böden) · `src/openings.js` Fenster und Türen im Detail
  · `src/roofshape.js` Dachform (Ebenen, Flächen, Profile) · `src/roof.js` Steildach zeichnen, Wände unter der Schräge
- `src/furnishing.js` Einrichtungs-Schicht (austauschbar ohne das Haus neu zu bauen) · `src/vegetation.js` Bäume und
  Sträucher als Instanzen (Vorlagen je Form/Detailstufe, Variation, Detailstufen nach Bildschirmgröße)
- `src/models.js` prozedurale Möbel (`FURNITURE`) und Leuchten (`LAMPS`), Material-`PALETTE` (Beispielmodelle; eigene
  Modelle gleicher ID ersetzen sie) · `src/usermodels.js` eigene Modelle (Grundformen, bewegliche Gruppen, glTF)
- `library/*.yaml` Beispiel-Bibliothek (Oberflächen, Fenster-/Türarten, als Text im Bundle) · `src/library.js` lädt sie
  und legt `model.yaml` darüber · `src/surfaces.js` Oberflächen: Definitionen (`base`), Muster-Generatoren, Bilder,
  Materialien · `src/styles.js` Fenster-/Türarten
- `src/roomlight.js` Raumlicht im Shader (Lampen in einer Float-Textur, `roomIdx` pro Fläche)
- `src/environment.js` Himmel als Umgebung (PMREM, Spiegelungen)
- `src/editor.js` Editiermodus (TransformControls, Anlegen, Rückgängig) · `src/store.js` Speichern (ganzes Modell
  über den Dev-Server bzw. HA-Benutzerdaten, Export) · `src/picker.js` Entity-Auswahl
  · `src/objsettings.js` Einstellungen eines Objekts (Rollen, Gesten, Zustandsanzeige, fester Zustand)
  · `src/catalogpanel.js` Katalog und Lager im Editor · `src/preview.js` Vorschaubilder · `src/ha.js` Zustand/Dienste
- `src/railing.js` Geländer · `src/terrain.js` Höhenraster (Höhe, Normalen, Zuschnitt auf Bereiche, Hangschattierung,
  Luftbild-Lage) · `src/ground.js` Boden (Höhe daneben für Kanten, Bodennetz mit Aussparungen, Schattierungs-Textur,
  Luftbild laden)
- `src/geometry.js`, `src/textures.js` Helfer (Normalen aus Bildern, Rauschen, Gewebe)
- `tests/` Harness + simuliertes HA (`mock-hass.js`), `screenshots.mjs` (beliebige Daten), `interaction.mjs`
  (Demo-IDs), `demo.mjs`, `shared.mjs` (gemeinsamer Speicher), `performance.mjs` (Leistungsbudget), `validate-data.mjs`, `link-check.mjs`, `model.test.mjs`, `privacy-guard.mjs`, `lib/`
- `custom_components/ha_3d_dashboard/` HA-Integration: Config-Flow (ein Klick), liefert `frontend/ha-3d-dashboard.js`
  aus (nur im Release-Zip) und registriert das Panel `/haus-3d`; Optionen Titel, Symbol, `data_url`; `storage.py`
  gemeinsames Modell (WebSocket `ha_3d_dashboard/model/get|save|subscribe`)
- `scripts/lib/geodata.mjs` GeoTIFF/XYZ/World-Datei lesen (ohne Pakete), Einpassung Plan <-> Landeskoordinaten
  · `scripts/lib/citygml.mjs` CityGML-LoD2 lesen (Boden-/Dachflächen), Raster, Dachflächen-Neigung
- `scripts/` Build, Magicplan-Import, `import-building.mjs`, `house_fixes.py`, Platzhalter-Leuchten, Deploy, `init-instance.mjs`

## Lichtmodell

Jede Fläche trägt ein Vertex-Attribut `roomIdx`. Eine Leuchte wirkt nur auf Flächen ihres Raums (Abfall mit
Entfernung und Einfallswinkel plus wenig indirektes Licht), daher kein Licht durch Wände und keine Schatten-Maps pro
Lampe. Lampen-/Raumdaten in einer Float-Textur (`LightTable`). Nur Sonne/Mond werfen Schatten; die Schatten-Map wird
nur bei Änderungen neu berechnet. Außenleuchten: Pseudo-Raum `aussen`.

## Arbeitsweise (Tempo und Token sparen)

- **Ein Auftrag = ein Branch, ein PR, eine Version.** Innerhalb des PRs ein Commit pro Schritt; Version
  (`package.json` + `manifest.json`) nur einmal pro PR erhöhen. Keine gestapelten Branches, keine Zwischen-Releases.
- **Lokal gezielt testen, die CI testet alles:** `npm run test:unit`, `npm run validate`, `npm run build` und nur die
  Screenshots der betroffenen Ansichten (`node tests/screenshots.mjs <namen>`), die du dir ansiehst. Bei Änderungen an
  Bedienung, Leistung oder Demo zusätzlich den passenden Einzeltest (`test:perf`, `test:demo`, `tests/interaction.mjs`).
  Den vollen `npm test` nicht vor jedem Push; die CI prüft jeden PR vollständig.
- **Mergen bei grüner CI:** Auto-Merge einschalten, wenn im Repo erlaubt; sonst beim CI-Ereignis mergen. Keine
  Zwischenmeldungen an den Nutzer, nur Rückfragen, Probleme und ein kurzer Abschlussbericht.
- **Bibliothek:** neue Beläge, Fenster-/Türarten und Modelle als Daten (`docs/LIBRARY.md`), prüfen mit
  `npm run validate` und `npm run preview -- <id>` (ein Bild).
- **Entscheidungslog:** `docs/DECISIONS.md` – nur den Eintrag zum Bereich lesen, an dem du arbeitest
  (`grep`), und neue Entscheidungen dort unten anhängen (ein bis drei Zeilen). Reine Doku-Änderungen lösen keine CI
  aus.
