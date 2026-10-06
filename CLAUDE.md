# 3D-HA-Dashboard – Engine

Diese Datei ist das Briefing für die Entwicklung der Engine (z. B. durch einen Claude-Cloud-Agenten). Lies sie
vollständig, bevor du etwas änderst, und halte sie aktuell (Entscheidungslog unten).

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
`ha3d.config.json` in ihrem Ordner.

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
- `src/models.js` prozedurale Möbel (`FURNITURE`) und Leuchten (`LAMPS`), Material-`PALETTE`
- `src/roomlight.js` Raumlicht im Shader (Lampen in einer Float-Textur, `roomIdx` pro Fläche)
- `src/environment.js` Himmel als Umgebung (PMREM, Spiegelungen)
- `src/editor.js` Editiermodus (TransformControls, Anlegen, Rückgängig) · `src/store.js` Speichern (ganzes Modell
  über den Dev-Server bzw. HA-Benutzerdaten, Export) · `src/picker.js` Entity-Auswahl
  · `src/objsettings.js` Einstellungen eines Objekts (Rollen, Gesten, Zustandsanzeige, fester Zustand)
  · `src/catalogpanel.js` Katalog und Lager im Editor · `src/preview.js` Vorschaubilder · `src/ha.js` Zustand/Dienste
- `src/railing.js` Geländer · `src/terrain.js` Höhenraster (Höhe, Normalen, Zuschnitt auf Bereiche, Hangschattierung,
  Luftbild-Lage) · `src/ground.js` Boden (Höhe daneben für Kanten, Bodennetz mit Aussparungen, Schattierungs-Textur,
  Luftbild laden)
- `src/geometry.js`, `src/textures.js` Helfer, prozedurale Texturen
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

## Entscheidungslog

- Datenschichten Bauwerk/Einrichtung/Geräte; Daten zur Laufzeit statt im Bundle.
- Möbel und Leuchten prozedural (klein, offline, per Daten parametrierbar) statt 3D-Dateien.
- Editor speichert lokal über den Dev-Server (YAML-Text-Patch, Kommentare bleiben), in HA in die Benutzerdaten
  (`frontend/set_user_data`), plus Export. Eine HA-Integration für gemeinsames Speichern ist eine mögliche
  Weiterentwicklung.
- Drehwinkel aus der Quaternion lesen (nicht `rotation.y`, das ist über 90° gespiegelt).
- CI: Tests nur für PRs und main (nicht doppelt), veraltete Läufe werden abgebrochen, Doku-Änderungen lösen nichts aus.
  Die Bedien-Tests nutzen das auf den Runnern vorinstallierte Google Chrome (`PW_CHANNEL=chrome`), ein eigener Job
  prüft WebKit (Safari/iOS, `npm run test:webkit`), die Python-Tests installieren mit uv und Cache. Release
  (`release.yml`) automatisch, sobald die Tests auf main grün sind und es zur Version aus `package.json` noch kein
  Release gibt – ohne zweiten Testlauf. Neue Version = `package.json` und `manifest.json` erhöhen und mergen.
- HACS (Kategorie Integration, seit 0.3.0; vorher Dashboard): Eine Dashboard-Ressource kann kein Seitenleisten-Panel
  anlegen, nur `panel_custom` in der YAML oder eine Integration – daher `custom_components/ha_3d_dashboard` mit
  Config-Flow und `panel_custom.async_register_panel`. `hacs.json` mit `zip_release`; das Zip (Integration + Bundle)
  und `ha-3d-dashboard.js` baut `.github/workflows/release.yml` (Version = `package.json` = `manifest.json`). `dist/` und `custom_components/ha_3d_dashboard/frontend/` bleiben
  gitignored. Panel-Adresse `/haus-3d`, Domain `ha_3d_dashboard` nicht ändern. Eine HACS-Validierung (hacs/action) fehlt bewusst: sie scheitert vor dem ersten Release
  und braucht Repo-Beschreibung/Topics in den GitHub-Einstellungen.
- Demo-Modus: Das Demo-Haus steckt als Text im Bundle (esbuild-Plugin `demo-data`, ~15 kB). Aktiv per
  `config.demo: true` oder als Fallback, wenn die Daten unerreichbar sind (`DataUnavailableError`, nur ohne
  vorhandene Ansicht). Die erfundenen Entities werden beim Laden entfernt (`src/demo.js`; `examples/demo` behält sie
  für die Tests). Dann: unverknüpfte Leuchten lokal schalten, im Editor mit einer in HA vorhandenen Entity
  verknüpfte über HA (`_liveEntities`), Sonne weiter aus `sun.sun`, kein Export. Speichern nur in eigene
  Benutzerdaten `ha_3d_dashboard_layout_demo` (`DEMO_USER_DATA_KEY`), nie in Dateien oder `ha_3d_dashboard_layout` –
  eigene Daten werden nie überschrieben, kaputte eigene Daten nie durch die Demo ersetzt.
- Editor ohne Speichern-Knopf: **Fertig** (und der Stift) speichert und schließt; scheitert das Speichern, bleibt der
  Editor offen. **Abbrechen** verwirft alle ungespeicherten Änderungen (Daten neu laden) und schließt.
  `setEditing(false)` = Abbrechen.
- Werkzeugleiste des Editors: volle Breite, bricht auf schmalen Bildschirmen in eine zweite Zeile um (das Panel fängt
  Wischgesten ab, seitliches Scrollen ginge auf dem iPhone nicht); Lampenauswahl/Meldungen richten sich nach ihrer Höhe
  (`--ha3d-editbar-h`).
- `data_url` wird als Ordner behandelt (fehlender `/` wird ergänzt).
- Gesten auf Objekten (0.8.0): Antippen, Doppeltippen (zweites Antippen binnen 300 ms; nur Objekte mit
  Doppeltippen-Aktion warten), langes Drücken (500 ms ruhig). Aktionen aus `ha` mit Standards
  (`gestureAction()`); Leuchten reagieren immer, andere Objekte nur mit Aktion – sonst geht das Antippen an den Raum.
  `more-info` = `hass-more-info`-Ereignis (HA öffnet seinen Dialog), `navigate` = `history.pushState` +
  `location-changed`, Rückfrage als eigener Dialog im Panel. Nicht im Editiermodus; Kontextmenü/iOS-Callout unterdrückt.
- Zustandsanzeige als HTML-Schilder über den Objekten (scharf, ohne Texturen), nach jedem Bild per `onRender`
  nachgeführt; Weltpunkte zwischengespeichert bis zur nächsten Einrichtung/Ebene. Keine Animationen.
- Panel-Höhe nicht vom Container erben: ab HA 2026.9 ist `partial-panel-resolver` inline und `ha-panel-custom` ohne
  Höhe, `height: 100%` ergibt 0 (weiße Seite). `100dvh` reicht nicht: In der iOS-App beginnt das Panel unter der
  Statusleiste und ragte unten hinaus. Daher misst `_fitHeight()` den Abstand vom oberen Panelrand bis zum unteren
  Bildschirmrand (`--ha3d-fit-height`, bei resize/visualViewport neu); untere Leisten mit `env(safe-area-inset-bottom)`.
  `tests/harness.html?ha=1&top=47` bildet das nach (`tests/demo.mjs`, `tests/webkit.mjs`).
- Datenmodell v2 (0.6.0) ersetzt `house.json`/`furniture.yaml`/`devices.yaml` ohne Migration (es gab nur Testdaten):
  ein Dokument `model.yaml` mit `site`, `buildings[].floors[]` (`level`), `outdoor[]`, `objects[]`; globales
  Koordinatensystem; Raum- und Außenbereichs-IDs im ganzen Modell eindeutig. Möbel, Leuchten und Geräte sind alle
  Objekte; Leuchte = Katalog-Fähigkeit `light` plus `light`-Block. Entities je Objekt mit Rollen (`power`, `info`),
  Gesten `tap`/`double_tap`/`hold` mit Standardaktionen.
- Die Szene arbeitet weiter mit internen Etagen: `toScene()` macht aus jeder Gebäude-Etage eine (`gebäude/etage`) und
  aus den Außenbereichen die Pseudo-Etage `__aussen` (Ebene 0, ohne Wände). Ebenen-Knöpfe zeigen alle Etagen einer
  Ebene; Objekte in Außenbereichen bekommen deren Höhe als `base`.
- Der Editor schreibt über `writeBack()` ins Modell, gespeichert wird das ganze Modell mit eigenem YAML-Schreiber
  (`src/model/yaml.js`, kurze Einträge einzeilig, Kopfkommentar bleibt; andere Kommentare gehen verloren).
- Gemeinsamer Speicher (0.7.0): Das Dashboard ist für alle Benutzer gleich. Mit der Integration (`config.shared`)
  liegt das Modell im HA-Speicher `ha_3d_dashboard.model` (WebSocket, Speichern nur für Administratoren, `revision`
  gegen gleichzeitiges Speichern, Abo für sofortiges Nachladen). Import = neue/geänderte `model.yaml` im Datenordner
  (Prüfwert `file_hash` weicht ab -> Datei gewinnt), Export = Knopf im Editor. Benutzerdaten-Overrides
  (`ha_3d_dashboard_layout`) nur noch ohne Integration; das Demo-Haus speichert weiter pro Benutzer.
- Gelände (0.9.0): Höhe je Eckpunkt eines Außenbereichs (`[x, y, z]`, abwärtskompatibel), dazwischen Dreiecke.
  Objekte bekommen die Höhe an ihrer Position als `base` (der Editor folgt ihr nach dem Verschieben). Der Boden
  (`site.ground`) ist dann ein Gitter, das tiefer liegendes Gelände nach außen fortsetzt (sonst sähe ein Hang wie eine
  Grube aus); höheres Gelände bekommt Erdkanten. Pflanzen (`tree`, `shrub`, `flowers`) prozedural wie Möbel.
- Ebenen gestapelt (0.10.0): Eine Ebene zeigt ihre Etagen auf allen darunter (samt Garten), höhere Ebenen sind
  ausgeblendet. `activeFloors` = alle sichtbaren Etagen (Antippen, Editor, Bildausschnitt), `levelFloors` = genau die
  gewählte Ebene. Die Bodenplatte einer oberen Etage reicht als Geschossdecke bis auf die Wände darunter.
- Version im Bundle (`__HA3D_VERSION__`, esbuild define aus package.json): Konsole und Link-Check zeigen Version und
  Datenquelle – zum Prüfen, ob nach einem Update wirklich das neue Bundle läuft.
- Realismus ohne Dauerkosten (0.11.0): Render-on-demand heißt, Einmal- und Stillstands-Kosten sind fast gratis.
  Umgebung (PMREM-Himmel je Tageszeit, nur bei merklicher Änderung neu) für Spiegelungen; Normalen-Karten aus den
  vorhandenen Texturen (Fugen/Maserung), Putz, Gewebe; Kontaktschatten als weiche Rechtecke unter Objekten statt
  teurer Verdeckung pro Bild; Sockelleisten; Lichtschein vor erleuchteten Fenstern (lampIdx der ersten Leuchte).
  Qualität „Hoch“ = große Schatten-Map, volle Auflösung. „Automatisch“ misst Bildabstände beim Drehen (> 45 ms im
  Mittel -> „Sparsam“: kleinere Schatten-Map, geringere Auflösung). `tests/performance.mjs` begrenzt
  Zeichenaufrufe/Dreiecke.
- Keine Ruhebild-Verfeinerung (0.14.1 entfernt): GTAO im Stillstand ließ das Bild nach dem Anhalten sichtbar
  „nachschärfen“ – störte mehr, als es brachte. Jedes Bild wird gleich gerechnet.
- Einstellungsmenü (0.11.0): Zahnrad statt Stift und Ketten-Knopf; Bearbeiten nur für Administratoren
  (`readonly`); Tageszeit Automatisch/Tag/Nacht überschreibt sun.sun (zum Testen, Wand-Tablets).
- Wetter (0.12.0): `src/weather.js` bildet `weather.*`-Zustände auf { cloud, rain, snow, fog } ab; `scene.setWeather`
  ändert nur Licht, Schatten-Intensität, Umgebung, Nebel und zwei Shader-Uniforms (`uWet`, `uSnow` in roomlight.js,
  nur Materialien mit `weather: true`: Flächen im Freien, Laub). Niederschlag als CSS-Ebene mit transform-Animation
  (Compositing, kein Neurendern; reduzierte Bewegung respektiert) – die Regel „keine Dauerschleife“ gilt fürs WebGL.
  Wetter-Entity: `site.weather` oder automatisch. Testschalter im Menü wie bei der Tageszeit.
- Kompass: Nadel ohne CSS-Übergang und im `onRender` nachgeführt (vorher 80 ms Verzögerung beim Drehen).
- Glas-Design (0.13.0): Farben und Radien als CSS-Variablen auf `:host` (`--g-*`, `--r-*`), Hell über
  `:host([theme="light"])`. Darstellung Automatisch folgt `hass.themes.darkMode` (ohne HA: prefers-color-scheme).
  Ausgewählt = invertiert (`--g-sel-*`), Bernstein (`--g-accent`) nur für Zustände. Neue Elemente nutzen die
  Variablen statt fester Farben.
- Logo (0.14.0): isometrischer Grundriss mit erleuchtetem Raum auf einer Glas-Kachel, erzeugt von `scripts/logo.mjs`
  (SVG, PNG über den Test-Browser). HA zeigt ab 2026.3 die Bilder aus `custom_components/ha_3d_dashboard/brand/`
  (icon/logo, @2x, dark_logo) ohne Eintrag in home-assistant/brands; der Datenschutz-Check erlaubt genau diese PNGs.
  Die HACS-Liste zeigt eigene Markenbilder noch nicht (hacs/integration#5171).
- Mauern, Hochbeete, Stufen (0.14.0): keine eigene Objektart, sondern schmale Außenbereiche mit `elevation` und
  `edge` (Material der Kante; ebene erhöhte Bereiche bekommen jetzt auch Kanten). `extend` lässt den Boden
  ansteigendes Gelände fortsetzen (Nordhang des Demo-Hauses); unter Gebäuden und ebenen Bereichen bleibt der Boden
  unten, Kanten von `extend`-Bereichen nur zu Nachbarbereichen. Kanten-UV = Länge × Höhe (Mauerwerk liegt waagrecht).
- Im Konstruktor des Elements keine Attribute setzen (auch nicht indirekt): HA legt das Panel mit
  `document.createElement` an, das wirft dann NotSupportedError (0.13.0: weiße Seite). `tests/harness.html?ha=1`
  legt das Panel wie HA an (createElement, Properties, einhängen); `tests/demo.mjs` und `tests/webkit.mjs` nutzen das.
- Katalog/Lager (0.15.0): Hinzufügen, Einlagern (`stored: true`), Aufstellen und Löschen ändern das Modell direkt
  (`_changeObjects` in main.js: erst ungespeicherte Lagen per writeBack ins Modell, dann ändern, Einrichtung aus
  `toScene()` neu bauen; Rückgängig = Bestand vorher). Gespeichert wird mit Fertig wie sonst; die
  Benutzerdaten-Overrides (ohne Integration) kennen dafür `added` (ganze Objekte) und `removed` (IDs). Neue Objekte
  landen in der Mitte der Ansicht im Raum darunter (sonst Außenbereich/freies Gelände).
- Animationen (0.15.0): Ein Modell markiert bewegliche Teile mit `P.beginAnim(spec, pivot)`/`endAnim()`; sie werden
  als eigene kleine Gruppe gebaut (`FurnishingLayer.animated`), der Rest bleibt zusammengefasst. Die Szene dreht sie
  nur, solange `setActivity(id)` aktiv ist (Entity nicht ruhend, Tempo aus `percentage`, sonst `state`), in einem
  gedrosselten Takt (30, Sparsam 20 Bilder/s) ohne Schatten-Neuberechnung; in Ruhe bleibt es bei null Bildern
  (`tests/performance.mjs` prüft das). Im Editor ist das gewählte Objekt statisch. Tests schalten Animationen im
  Harness aus (sonst steht die Kamera nie „still“) und gezielt wieder ein.
- Dächer (0.16.0): `toScene()` legt für jedes Gebäude eine Dach-Etage (`<gebäude>/__dach`, `roof: true`) eine Ebene
  über der obersten an; sie bekommt keinen Ebenen-Knopf (`scene.levels` ohne Dächer), erscheint also nur, wenn eine
  höhere Ebene eines anderen Gebäudes gewählt ist. Der Dachraum ist ein Bereich (`spacesOf`, Standard-ID
  `<gebäude>_dach`), Umriss = konvexe Hülle der obersten Etage (sonst `roof.polygon`). Dachrand als Blende bis auf die
  Wände plus niedrige Attika.
- Weitere Animationsarten (0.16.0): `swing` (Tor; Fortschritt 0..1 läuft auch beim Schließen, nach dem Laden ohne
  Aufschwenken in der richtigen Lage) und `flow` (Lichtpunkte entlang eines Pfads, nur sichtbar, solange aktiv).
  Aktivität aus Messwerten (≥ 1, Tempo = Wert/`peak`), ohne power-Entity aus den info-Entities.
- Sektionaltor (0.16.1, statt Schwingtor): Animation `sectional` – die Lamellen eines Meshes (ein Zeichenaufruf)
  werden je Bild direkt in der Geometrie entlang der Schiene (senkrecht, Viertelbogen, waagrecht) als Sehne gelegt;
  Zuordnung Dreieck → Lamelle über die Höhe im geschlossenen Tor. Fortschritt wie `swing` (`PROGRESS` in scene.js).
- Steildächer (0.17.0): `roof` ist ein Dachteil oder eine Liste (`roofParts()` in model.js). Form in
  `src/roofshape.js` ohne three.js: jede Traufkante trägt eine Ebene, Dachfläche = untere Hülle der Ebenen (exakt für
  konvexe Umrisse, daher Teile konvex; L-Form = zwei Teile). Flächen per Halbebenen-Schnitt (konvexe Polygone),
  Aussparung als konvexe Differenz, Profile entlang von Strecken für Giebelwände. Zeichnen in `src/roof.js`. Die
  oberste Etage bekommt `roofCut` (nur Teile über ihr): Wände enden bei min(Etagenhöhe, Traufe + Dachfläche)
  (`ceilingFn`, adaptives Profil, Wandkappen als Band). Dach-Etage liegt wie bisher auf Geschosshöhe + Dicke des
  ersten Teils; `offset` je Teil. Knopf „Dach“ nur, wenn Dächer über der obersten Ebene liegen.
- Ebenen zusammenfassen (0.17.0): `scene._mergeLevels()` fasst Bauwerk-Meshes aller Etagen einer Ebene je Material in
  der ersten Etage zusammen (Etagen einer Ebene sind immer gemeinsam sichtbar), Bodenplatten je Ebene ebenso;
  Treffer-Flächen bleiben je Etage. Spart ~20 Zeichenaufrufe je Ebene im Demo-Haus.
- Höhenraster (0.18.0): `site.terrain` (`src/terrain.js`, ohne three.js), Zellen mit fester Diagonale, Lücken aus
  den Nachbarn gefüllt, außerhalb Rand fortgesetzt. Der Boden ist das Raster minus Gebäude-Grundflächen (unterste
  Etage: Wände, Räume, Fenster-/Türrechtecke) und aller Außenbereiche (`clipTerrain`: Rasterdreiecke gegen konvexe
  Stücke, Normalen baryzentrisch aus dem Raster → weiche Schattierung unabhängig vom Zuschnitt). `follow: terrain`
  zeichnet dieselben Dreiecke im Umriss mit dem eigenen Belag (kein z-fighting, keine Fächer aus langen Dreiecken).
  Kanten aller Außenbereiche richten sich nach dem, was daneben liegt (`FloorModel._outsideAt`: Nachbarbereich, Gebäude
  = keine Kante, sonst `ground.at`), mit Raster auch nach oben (Stützmauer). Gebäudesockel (Bodenplatte der untersten
  Etage) reicht bis auf den Boden. Ohne Raster bleibt das alte Gitter (`ground.at`), nur unter Gelände-Bereichen
  6 cm statt 1,2 cm tiefer (Flackern). YAML-Schreiber: Zahlentabellen mit langen Zeilen als eine Zeile je Zeile.
- Fassaden und Geländer (0.19.0): Außenseite = Wandfläche ohne Raum davor (`roomBeside` = 0); mit `facade` geht sie
  in einen eigenen Builder (`shared.facadeKey`: Putz = Wandmaterial mit Farbe, `wood_siding`, `brick`, `stone`), der
  Sockel 1,5 cm davor (`floor.lowest`: bis auf `ground.at`). Eckbretter, wo zwei Außenseiten im Winkel
  zusammentreffen (auch an Fensterlaibungen). Giebel- und Gaubenwände im Dach nutzen dieselbe Fassade. Geländer
  (`src/railing.js`) aus Quadern in vorhandenen Materialien (pvc mit Farbe, Glas) – keine eigenen Zeichenaufrufe je
  Geländer, durch `_mergeLevels` mit den Fenstern der Ebene zusammengefasst.
- Innenausstattung (0.20.0): neue Modelle wie bisher prozedural in `src/models.js`; möglichst vorhandene
  Palettenmaterialien (jedes neue Material kostet je Ebene einen Zeichenaufruf), Farben auch `#rrggbb`
  (`paletteParams`). Leuchten behalten `params` (Stofffarbe), weil `color` die Lichtfarbe ist. Saugroboter: `spin` um
  einen Punkt vor der Station mit `home: true` (ruhend zurück in die Ausgangslage). `rooms[].zones` 2 mm über dem Boden
  (Orthokamera: lineare Tiefe, kein Flackern), `rooms[].beams` als Quader unter der Decke bzw. Schräge; draußen nimmt
  ein Belag seine Wetter-Variante (`<name>_out`, z. B. `flagstone_out`). Einrichtung je Ebene zusammengefasst
  (`scene._mergeFurnishing`, nur Meshes mit `userData.mergeable`; Treffer, Animationen und Einzelaufbau im Editor
  bleiben je Etage).
- Magicplan-Import (0.21.0): Umformungen nach der Extraktion in `scripts/plan_transform.py` (ohne pymupdf,
  getestet über `tests/plan_transform_test.py` aus `npm run test:unit`): erst im eigenen Ursprung extrahieren, dann
  `rotate` (um die Umrandung der Außenwände, Ursprung bleibt links oben), dann `offset`; doppelte Raum-IDs bekommen
  das Etagenkürzel (Türen/Fenster folgen); `split` macht aus der Seite links einer Linie eine Belag-Zone (`zones`).
- Standardansicht (0.22.0): je Gerät in den Ansichts-Einstellungen (`prefs.homeView` = `scene.getView()`: Ebene,
  Drehpunkt, Kamera relativ dazu, Zoom, halbe Bildhöhe; `prefs.homeAfter` Sekunden). `scene.setView()` fährt sanft hin
  und passt den Bildausschnitt bewusst nicht neu ein (sonst verschöbe `_fitFrustum` die Ansicht); ohne Standard
  `resetView()` (Startansicht). Kompass: zweites Tippen binnen 350 ms = Standardansicht. Inaktivität: `pointerdown`/
  `wheel`/`keydown` im Shadow-DOM starten den Zeitgeber neu; im Editor und bei offenen Fenstern wird verschoben.
- Kamerafahrten (`setView`, `faceNorth`) enden spätestens nach Dauer + 250 ms per Zeitgeber (`_animFallback`):
  ohne Bildtakt (verdeckter Tab, dunkles Wand-Tablet, überlastete CI-Grafik) blieb die Kamera sonst am Start stehen –
  Ursache des wackligen Standardansicht-Tests, der jetzt ohne `requestAnimationFrame` prüft.
- Katalog-Vorschau (0.16.0): `preview.js` rechnet jedes Modell einmal mit dem vorhandenen Renderer in ein
  Render-Target (eigene Mini-Szene, kein zweiter WebGL-Kontext), liest die Pixel und speichert eine data-URL; das
  Panel füllt die Bilder nach und nach (eins pro Durchgang).
- Luftbild und Hangschattierung (0.23.0): Das Luftbild liegt auf dem Boden-Belag-Material (`site.ground`, Shader-Option
  `aerial`: Plan -> Bild über zwei vec3, globale Uniforms in roomlight.js) – damit auch auf Rasen-Bereichen, ohne
  eigenes Mesh oder Material. Laden über ein Canvas (verkleinert auf 4096, `exclude` ausgestanzt = Alpha 0, am Rand
  5 % Überblendung); `whenReady()` wartet darauf. Hangschattierung einmal je Rasterpunkt (Horizont in 8 Richtungen +
  Steilheit) als HalfFloat-Textur (r = Abdunklung, g = Geländehöhe); alle Materialien im Freien lesen sie, aber nur
  auf Flächen nahe der Geländehöhe und nach oben gerichtet (nicht auf Dächern, Mauerkronen). Geodaten-Werkzeuge ohne
  Pakete (eigener TIFF-Leser: LZW/Deflate/Prädiktoren; JPEG-TIFF -> gdal_translate); Bild-Umrechnung im Test-Browser.
  Das Demo-Luftbild ist ein erfundenes SVG (Bilder außerhalb von docs/ blockt der Datenschutz-Check); im Bundle-Demo
  fehlt es (src/demo.js entfernt es).
- Bäume als Instanzen (0.24.0): `tree`/`shrub` gehen im Haus nicht in den PartCollector, sondern über `P.plants` in
  ein `VegetationSet` je Einrichtungs-Schicht: je Form zwei `InstancedMesh` (nah/fern) mit einer Vorlage aus
  Vertex-Farben und `vegCrown` (Laub), ein gemeinsames Material (`patchVegetation`: Laub × `vegTint` je Instanz).
  `roomIdx` und `vegTint` sind Instanz-Attribute; roomlight.js rechnet bei Instanzen mit `instanceMatrix`. Detailstufe
  je Pflanze in `scene._vegetationLod()` vor jedem Bild (Kronendurchmesser × Pixel je Meter ≥ `NEAR_PX`, nur bei
  Änderung neu verteilt, dann Schatten neu). Editor und Katalog-Vorschau bauen die Pflanze einzeln aus derselben
  Vorlage (Laubfarbe eingebacken). Keine Sichtbarkeitsprüfung je Instanz: nah herangezoomt werden alle Pflanzen in
  voller Stufe gezeichnet (200 Bäume ~117k Dreiecke, knapp im Budget) – bei Bedarf als Nächstes nachrüsten.
- Einpassung und Import (0.25.0): `fit-footprint` vergleicht Raster (0,2 m) der Umrisse: grob alle 1° mit
  Schwerpunkt-Abgleich, dann je Kandidat zweistufig fein (Drehung/Verschiebung); `site.north_deg` entscheidet zwischen
  gleich guten Lösungen (symmetrische Häuser), wird aber nicht überschrieben (geografisch vs. Gitternord).
  `roof-from-lod2` bündelt Dachflächen über gemeinsame Kanten, Typ aus den Fallrichtungen. Magicplan-Korrekturen in
  `scripts/plan_transform.py` (ohne pymupdf, getestet): `merge` per Rastermaske mit morphologischem Schließen
  (überbrückt die Wand), Umriss aus den Rasterkanten mit Douglas-Peucker; Wände im Zwischenraum werden (achsparallel)
  gekürzt; `clip` nur mit konvexen Polygonen (Sutherland–Hodgman). XML ohne Paket per regulären Ausdrücken.
- Fenster unter Steildächern (0.26.0): `windowUnderRoof()` (roof.js, ohne three.js – auch für die Prüfung) misst die
  niedrigste Wandoberkante (`ceilingFn`) über die Fensterbreite: kürzen (5 cm darunter) oder weglassen (< 30 cm über
  der Brüstung; die Öffnung wird als volle Wand gezeichnet, vom Dach gekappt), unter einer Gaube (`roofCut[].dormers`)
  immer weglassen. Die Prüfung meldet dieselben Fälle und Wände der obersten Etage ohne Dachteil darüber.
- Lichttabelle dynamisch (0.27.0): `LightTable.ensure(n)` legt die Float-Textur bei Bedarf breiter an (64er-Schritte,
  höchstens `LIGHT_TABLE_MAX` = 4096); `scene._growLightTable` gibt die neue Textur an das gemeinsame Uniform
  `uLights` (die Shader lesen per texelFetch, unabhängig von der Breite). Der Pseudo-Raum `aussen` ist
  `scene.outdoorIdx` = Zahl der Bereiche + 1 (vorher fest 64 – kollidierte ab 64 Bereichen). 12 Leuchten je Bereich
  bleiben die Schleifengrenze im Shader.
- Garten-Katalog (0.28.0): prozedural in `src/models.js`; lange Objekte (`fence`, `power_line`, `hedge`) entlang
  `linePath()` (gerade oder `path`) und mit `groundAt` aus furnishing.js auf dem Gelände, ohne Kontaktschatten.
  Farben bewusst aus vorhandenen Materialien (Eiche hell, Regentonnen-Grün, Alu dunkel, Laub) – Ebene 2 des
  Demo-Hauses liegt damit genau am Budget (145; neu ist nur das Netz des Trampolins). Weitere Modelle: erst Material
  teilen oder zusammenfassen.
- Zoomgrenze (0.28.0): `controls.maxZoom` = Bildausschnitt-Halbhöhe / `ZOOM_MIN_HALF` (1,2 m), mindestens 5, neu nach
  jedem `_fitFrustum` und jeder `setView`-Fahrt (`_zoomLimit`); `zoomToCursor` zoomt auf den Zeiger bzw. die Fingermitte.
- Zustandsanzeige und Medienplayer (0.30.0): `badgeSpec`/`badgeEntities`/`conditionMet`/`playerSpec` in model.js
  (ohne three.js, getestet); `ha.badge` bleibt als Kurzform true/false gültig. Der Player ist ein HTML-Element in der
  Schild-Ebene (`.player`, eigene pointer-events, stoppt Zeiger-Ereignisse, damit die Kamera nicht dreht) und ersetzt
  das Schild, solange seine Bedingung gilt (Standard: playing). Keine Laufzeit-Animation, keine externen Bilder.
