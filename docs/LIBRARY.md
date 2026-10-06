# Bibliothek: Beläge, Fassaden, Fenster, Türen, Tore, Möbel

Alles, was von Haus zu Haus verschieden ist, sind **Daten**. Die Engine liefert nur Generatoren (Verlegemuster,
Rahmen/Flügel/Türblatt, Grundformen) und eine **Beispiel-Bibliothek** (`library/surfaces.yaml`,
`library/openings.yaml`, prozedurale Beispielmodelle im Katalog). Die Instanz ergänzt oder ändert sie in ihren
eigenen Dateien – nie im Engine-Code.

| Was | Wo in der Instanz | Verwendet in |
|---|---|---|
| Beläge, Fassaden, Dachdeckung | `model.yaml` → `surfaces` | `rooms[].surface`, `zones[].surface`, `outdoor[].surface`/`edge`, `site.ground`, `roof.surface`, `facade.type`, `facade.plinth.material`, `params.material` |
| Fensterarten | `model.yaml` → `window_styles` | `windows[].style`, `buildings[].styles.window` |
| Türarten | `model.yaml` → `door_styles` | `doors[].style`, `buildings[].styles.door` / `exterior_door` / `front_door` |
| Möbel, Geräte, Leuchten, Tore | `models/<id>.yaml` | `objects[].model` |
| Bilder (Fotos, Texturen) | `textures/` | `surfaces.<id>.image` |

**Regeln für alle Einträge:** ID `[a-z0-9_]`. Gleiche ID wie ein Bibliothekseintrag = nur die genannten Felder
ändern (z. B. `parquet: { color: '#6b4a2e' }` dunkelt das Beispiel-Parkett überall ab). `base: <id>` = ableiten und
überschreiben. Alles ist optional außer dem Muster bzw. Bild. Jede neue Farbe/Oberfläche ist ein eigenes Material
(je Ebene ein Zeichenaufruf, Budget `npm run test:perf`) – wiederverwenden statt variieren.

**Prüfen ohne volle Screenshot-Reihe:** `npm run validate` (Verweise, Felder, Bilder) und
`npm run build && npm run preview -- <id> …` → ein Bild `tests/output/vorschau.png` (bzw. `out` der Instanz) mit
allen genannten Oberflächen und Modellen; ohne IDs alle eigenen, `--all-surfaces` die ganze Bibliothek.

## Oberflächen (`surfaces`)

```yaml
surfaces:
  eiche_rauch: { base: parquet, color: '#6b4a2e' }                           # Fischgrät, dunkler
  wohnen_dielen: { pattern: planks, size: [1.9, 0.19], bond: random, color: '#b08c62' }
  bad_fliesen: { pattern: tiles, size: [0.3, 0.6], bond: 0.5, color: '#d8d4cc', joint_color: '#8a8780' }
  kueche_foto: { image: textures/kueche_boden.jpg, size: [1.2, 0.6], roughness: 0.3 }   # eigenes Foto
  schiefer: { pattern: roof_tiles, size: [0.25, 0.18], color: '#3c3f44', outdoor: true }
```

| Feld | Bedeutung |
|---|---|
| `pattern` | Verlegemuster, siehe unten |
| `image` | statt Muster: Bilddatei im Datenordner (kachelbar), `size` = Meter je Bild |
| `size` | Elementmaß in Metern (Zahl oder `[a, b]`, je Muster) |
| `color` | Grundfarbe `#rrggbb` (Muster werden damit gezeichnet; bei Bildern Tönung) |
| `variation` | Helligkeits-/Farbstreuung je Element, 0..1 |
| `joint`, `joint_color` | Fugenbreite (m), Fugenfarbe |
| `bond` | Versatz je Reihe (Anteil der Länge: `0.5` Läufer-, `0.33` Drittelverband) oder `random` |
| `rows` | `herringbone`: Stäbe je Arm (1, 2 = doppelt, 3) |
| `angle` | `chevron`: Schnittwinkel (Grad, Standard 45) |
| `strips` | `basket`: Stäbe je Quadrat |
| `spread`, `seed` | `speckle`: Körnigkeit, Zufallsstartwert |
| `roughness`, `metalness` | Glanz (0 glänzend … 1 matt), Metall |
| `relief` | Tiefe der Fugen/Struktur (0 = flach) |
| `outdoor` | `true`: für draußen (nass bei Regen, Schnee); sonst innen mit Bodenverdeckung – draußen verwendet bekommt jeder Belag automatisch die Wetter-Variante |
| `edge` | Material der Kanten erhöhter Außenbereiche (Rasen → `soil`) |
| `label` | Name (Vorschau, Doku) |

| `pattern` | `size` | für |
|---|---|---|
| `herringbone` | `[Länge, Breite]` (Länge = Vielfaches der Breite) | Fischgrätparkett (`rows: 2` doppelt) |
| `chevron` | `[Länge, Breite]` | Französisches Fischgrät |
| `planks` | `[Länge, Breite]` | Dielen, Stabparkett, Schiffsboden, Holzdeck |
| `basket` | Kantenlänge | Würfelparkett |
| `tiles` | `[Breite, Höhe]` | Fliesen, Platten, Pflaster, Ziegelmauerwerk (`bond: 0.5`) |
| `siding` | Brettbreite | Holzschalung |
| `roof_tiles` | `[Breite, Lattung]` | Dachziegel, Schiefer |
| `stone` | `[min, max]` Lagenhöhe | Naturstein, Trockenmauer |
| `flagstone` | Plattengröße | Polygonalplatten |
| `speckle` | Kachelgröße | Kies, Erde, Dachbahn, Granit |
| `lawn` | Kachelgröße | Rasen |
| `plain` | Strukturgröße | Beton, Estrich, Wasser |

**Beispiele der Engine** (`library/surfaces.yaml`):

<!-- oberflaechen:start -->
| ID | Darstellung |
|---|---|
| `parquet` | Fischgrätparkett Eiche (Stäbe 50 × 7 cm) |
| `parquet_double` | Doppeltes Fischgrät |
| `parquet_chevron` | Französisches Fischgrät (Chevron) |
| `parquet_strip` | Stabparkett wilder Verband |
| `parquet_ship` | Schiffsboden |
| `parquet_cube` | Würfelparkett |
| `planks` | Landhausdielen Eiche (bis 0.30 hieß das `parquet`) |
| `planks_wide` | Breite Dielen geölt |
| `planks_white` | Dielen weiß geölt |
| `tiles` | Großformatfliesen 60 × 60 |
| `tiles_small` | Fliesen 30 × 30 |
| `tiles_metro` | Metrofliesen |
| `concrete` | Beton/Estrich |
| `flagstone` | Polygonalplatten aus Naturstein |
| `lawn` | Rasen |
| `paving` | Pflaster/Platten |
| `cobble` | Pflaster 20 × 10 |
| `slabs` | Großformatplatten 60 × 30 |
| `gravel` | Kies |
| `soil` | Erde/Beet |
| `wood` | Holzdeck |
| `water` | Wasser |
| `stone` | Naturstein (Trockenmauer, Blockstufen) |
| `sandstone` | Sandstein |
| `granite` | Granit |
| `roof` | Dachbahn (Flachdach) |
| `roof_tiles` | Dachziegel |
| `wood_siding` | Holzschalung (Fassade) |
| `brick` | Ziegelmauerwerk (Fassade) |
<!-- oberflaechen:end -->

Fassade: `facade.type` = `plaster` (Putz in Wandfarbe, `color`) oder jede Oberfläche.

## Fenster- und Türarten (`window_styles`, `door_styles`)

```yaml
window_styles:
  holz_weiss: { base: wood, color: '#f4f1ea', bars: [2, 2] }
door_styles:
  innen_eiche: { leaf: flush, color: '#a3825c', frame_color: '#a3825c', handle: '#2b2b2b' }
buildings:
  - id: haus
    styles: { window: holz_weiss, door: innen_eiche, front_door: front_glass }   # Standard des Gebäudes
    floors: [{ …, windows: [{ rect: […], style: fixed }] }]                     # je Öffnung
```

Fenster: `frame` (Blendrahmen, m), `depth` (Bautiefe), `sash` (Flügelrahmen), `offset` (Lage in der Wand, Anteil
nach außen), `color`, `sash_color`, `board` (Fensterbank: Farbe oder `false`), `bars: [Spalten, Reihen]` (Sprossen je
Flügel), `bar` (Sprossenbreite), `fixed: true` (Festverglasung). Flügelzahl und Kämpfer bleiben am Fenster
(`sashes`, `transom`). Beispiele: `standard`, `wood`, `bars`, `wood_bars`, `anthracite`, `fixed`.

Türen: `kind` (`interior` mit Zarge und Türblatt, `exterior` mit Rahmen), `leaf` (`panel` Füllung, `flush` glatt,
`glass` Glas mit Friesen, `solid` Haustür), `panels` (Füllungen übereinander), `glass` (Haustür: Glasfelder),
`color`, `frame_color` (Zarge), `handle`, `bars`. Ohne `style` gilt je Tür: innen `interior`, außen mit Glas
`patio`, außen massiv `front`. Beispiele: `interior`, `interior_panels`, `interior_flush`, `interior_glass`,
`interior_oak`, `patio`, `patio_bars`, `front`, `front_glass`.

## Modelle (`models/<id>.yaml`)

Format, Grundformen und Ausdrücke: [DATA_MODEL.md → Eigene Modelle](DATA_MODEL.md#eigene-modelle-modelsidyaml).
Gleiche ID wie ein Beispielmodell der Engine (z. B. `armchair`) ersetzt dieses (in `models:` eintragen). Bewegliche Teile
als `group` – Tore, Flügel, Räder:

```yaml
parts:
  - group:
      pivot: [-0.8, 0, 0]                                  # Drehpunkt bzw. Ursprung der Bewegung
      anim: { type: swing, axis: y, angle: 95, duration: 4 }   # swing (Grad) | slide (distance, m) | spin (speed, U/s)
      parts: [ { box: { size: [0.78, 0.9, 0.04], at: [-0.4, 0.5, 0] } } ]
```

Die Gruppe bewegt sich, solange das Objekt aktiv ist (`ha.entities.power`, z. B. `cover` offen), `swing` und `slide`
fahren beim Schließen zurück. Beispiel: `examples/demo/models/gartentor.yaml`.
