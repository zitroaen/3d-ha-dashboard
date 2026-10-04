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
  committen. Testdaten = Demo-Haus. `npm run privacy` (Teil von `npm test`) blockiert PDFs, Bilder außerhalb von
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
| `python scripts/extract_plan.py <pdf> --out building.json [--config plan.json] [--debug]` | Magicplan-Import (ein Gebäude) |
| `node scripts/import-building.mjs building.json` | Gebäude in `model.yaml` einfügen/ersetzen |

Alle Werkzeuge nehmen den Datenordner aus `DATA_DIR` (bzw. `--data` oder `ha3d.config.json` der Instanz), Standard
ist das Demo-Haus. `ENTITIES` = HA-Export für Link-Check/Harness, `VIEWS` = zusätzliche Screenshot-Ansichten.

## Code-Aufbau

- `src/main.js` Custom Element, Kompass, Editier-Werkzeugleiste, Link-Check, HA-Anbindung · `src/menu.js` Einstellungsmenü
  (Zahnrad: Tageszeit, Qualität, Bearbeiten, Link-Check, Info; Ansicht pro Gerät in localStorage)
- `src/model/` Datenmodell: `model.js` (Parsen, `toScene()` = Adapter Modell → Szene, `writeBack()` Editor → Modell,
  Gesten/Aktionen), `migrate.js` (Version, Migrationen), `catalog.js` (Modellkatalog mit Fähigkeiten), `yaml.js`
  (YAML-Schreiber) · `schema/model.schema.json` JSON-Schema
- `src/data.js` lädt `model.yaml` zur Laufzeit (js-yaml im Browser) · `src/demo.js` eingebettetes Demo-Haus
- `src/scene.js` Kamera, Himmel (Sonne/Mond aus `sun.sun`), Render-on-demand, Antippen, Licht-Zustand
- `src/house.js` Bauwerk einer Etage (Räume, Wände, Böden) · `src/openings.js` Fenster und Türen im Detail
- `src/furnishing.js` Einrichtungs-Schicht (austauschbar ohne das Haus neu zu bauen)
- `src/models.js` prozedurale Möbel (`FURNITURE`) und Leuchten (`LAMPS`), Material-`PALETTE`
- `src/roomlight.js` Raumlicht im Shader (Lampen in einer Float-Textur, `roomIdx` pro Fläche)
- `src/environment.js` Himmel als Umgebung (PMREM, Spiegelungen)
- `src/editor.js` Editiermodus (TransformControls, Anlegen, Rückgängig) · `src/store.js` Speichern (ganzes Modell
  über den Dev-Server bzw. HA-Benutzerdaten, Export) · `src/picker.js` Entity-Auswahl
  · `src/objsettings.js` Einstellungen eines Objekts (Rollen, Gesten, Zustandsanzeige, fester Zustand)
  · `src/catalogpanel.js` Katalog und Lager im Editor · `src/ha.js` Zustand/Dienste
- `src/geometry.js`, `src/textures.js` Helfer, prozedurale Texturen
- `tests/` Harness + simuliertes HA (`mock-hass.js`), `screenshots.mjs` (beliebige Daten), `interaction.mjs`
  (Demo-IDs), `demo.mjs`, `shared.mjs` (gemeinsamer Speicher), `performance.mjs` (Leistungsbudget), `validate-data.mjs`, `link-check.mjs`, `model.test.mjs`, `privacy-guard.mjs`, `lib/`
- `custom_components/ha_3d_dashboard/` HA-Integration: Config-Flow (ein Klick), liefert `frontend/ha-3d-dashboard.js`
  aus (nur im Release-Zip) und registriert das Panel `/haus-3d`; Optionen Titel, Symbol, `data_url`; `storage.py`
  gemeinsames Modell (WebSocket `ha_3d_dashboard/model/get|save|subscribe`)
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
