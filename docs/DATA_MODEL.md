# Datenmodell (Version 2)

Diese Spezifikation beschreibt vollständig, wie ein Zuhause für das 3D-Dashboard beschrieben wird – so, dass ein
Mensch oder ein KI-Agent ein gültiges Modell erstellen kann. Maschinenlesbar: [`schema/model.schema.json`](../schema/model.schema.json)
(JSON Schema 2020-12). Prüfen: `npm run validate` (Schema + inhaltliche Prüfungen, siehe unten).

## Überblick

Ein Modell ist **ein Dokument** (JSON bzw. YAML als Datei `model.yaml`). Es hat drei Ebenen, die sich unterschiedlich oft
ändern:

| Ebene | Abschnitt | Inhalt | ändert sich |
|---|---|---|---|
| Grundstück und Bauwerk | `site`, `buildings`, `outdoor` | Gelände, Gebäude, Etagen, Räume, Wände, Fenster, Türen, Außenbereiche | selten |
| Objekte | `objects` | alles, was dort steht: Möbel, Leuchten, Geräte, Sensoren | gelegentlich |
| Verbindungen | `connections` | (reserviert) Energie- und Datenflüsse zwischen Objekten | selten |

```yaml
schema: ha3d
version: 2
site: { ... }        # Grundstück: Name, Nordrichtung, Boden
buildings: [ ... ]   # Wohnhaus, Garage, Gartenhaus … mit Etagen und Räumen
outdoor: [ ... ]     # Außenbereiche („Gartenräume“): Terrasse, Rasen, Einfahrt …
objects: [ ... ]     # Möbel, Leuchten, Geräte – mit Verknüpfung zu Home Assistant
```

## Grundregeln

- **Einheiten:** Meter und Grad. Zahlen ohne Einheit.
- **Ein Koordinatensystem für alles:** Plan-Koordinaten `[x, y]` des Grundstücks – x nach rechts, y nach unten, wie ein
  Lageplan auf Papier. Der Ursprung ist frei wählbar (üblich: linke obere Ecke des Wohnhauses). Alle Gebäude, Räume,
  Außenbereiche und Objekte verwenden dieselben Koordinaten.
- **Höhen** (`elevation`) in Metern über dem Nullpunkt; üblich: 0 = Fußboden Erdgeschoss.
- **Drehung** `rot`: Grad **im Uhrzeigersinn**, von oben gesehen. Bei `rot: 0` zeigt die Vorderseite eines Objekts
  (Sitzfläche, Bildschirm, Tür eines Geräts) nach Plan-unten (+y); 90 = nach links, 180 = nach oben, 270 = nach rechts.
- **Polygone:** Liste von Punkten `[[x, y], …]`, mindestens 3, nicht geschlossen (letzter Punkt ≠ erster), ohne
  Selbstüberschneidung. Umlaufsinn beliebig.
- **IDs:** Kleinbuchstaben, Ziffern, Unterstrich (`^[a-z0-9_]+$`), stabil (nicht umbenennen – Verknüpfungen hängen
  daran). Eindeutigkeit:
  - Gebäude: im Modell
  - Etagen: im Gebäude
  - **Bereiche** (Räume aller Gebäude und Außenbereiche zusammen): im Modell
  - Objekte: im Modell
- **Unbekannte Felder** sind nicht erlaubt (das Schema lehnt sie ab) – Tippfehler fallen so sofort auf. Ausnahme:
  `params` eines Objekts (modellabhängig, siehe Katalog).
- **Optionale Felder** haben Standardwerte (in den Tabellen genannt).

## Kopf

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `schema` | ja | immer `ha3d` |
| `version` | ja | Formatversion, hier `2` (siehe [Versionen und Migration](#versionen-und-migration)) |

## `site` – Grundstück

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `name` | ja | | Anzeigename (oben links im Panel) |
| `north_deg` | nein | 0 | Richtung Norden im Plan, Grad im Uhrzeigersinn von Plan-oben (Sonne, Mond, Kompass). Beispiel: Norden zeigt im Plan nach rechts → 90 |
| `ground` | nein | `{ surface: lawn }` | Boden außerhalb aller Außenbereiche: `{ surface }` |
| `weather` | nein | automatisch | Wetter-Entity für Himmel, Regen, Schnee, Nebel und die Anzeige oben, z. B. `weather.home`. Ohne Angabe: `weather.home`, `weather.forecast_home`, sonst die erste `weather.*` |
| `terrain` | nein | eben | Gelände als Höhenraster, siehe unten |

**Höhenraster (`site.terrain`):** das Gelände des Grundstücks als Tabelle von Höhen (Meter, wie `elevation`; 0 =
EG-Fußboden), z. B. aus einem LiDAR-Scan (`scripts/terrain-from-scan.mjs`).

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `origin` | nein | `[0, 0]` | Plan-Punkt des ersten Werts (Zeile 0, Spalte 0) |
| `cell` | nein | 0.5 | Rasterweite (Meter) |
| `heights` | ja | | Zeilen in +y, Werte darin in +x: `heights[j][i]` liegt bei `origin + [i, j] · cell`; `null` = keine Angabe (aus den Nachbarn ergänzt) |

Jede Zelle besteht aus zwei Dreiecken (Diagonale von rechts oben nach links unten), dazwischen ist die Höhe linear;
gezeichnet mit weichen Normalen. Außerhalb des Rasters setzt der Boden den Rand fort. Unter Gebäuden und
Außenbereichen ist der Boden ausgespart – Gebäude stehen auf ihrem Sockel (auf der Talseite reicht er bis auf das
Gelände), Außenbereiche zeichnen ihre Fläche selbst. Objekte ohne Bereich stehen auf dem Raster.

## `buildings` – Gebäude

Wohnhaus, Garage, Gartenhaus, Carport … jeweils mit Etagen.

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `id` | ja | | z. B. `haus`, `garage`, `gartenhaus` |
| `name` | ja | | Anzeigename |
| `kind` | nein | `house` | `house`, `garage`, `garden_house`, `carport`, `other` (nur Information) |
| `floors` | ja | | Etagen, mindestens eine |
| `facade` | nein | Putz (Wandfarbe) | Außenwände des Gebäudes, siehe unten |
| `roof` | nein | Flachdach | Dach über der obersten Etage: ein Dachteil oder eine Liste davon, siehe unten; `false` = keins |

**Fassade (`buildings[].facade`):** Material der Außenseiten aller Wände (auch Giebel und Gauben); innen bleibt die
Wandfarbe.

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `type` | nein | `plaster` | `plaster` (Putz), `wood_siding` (Holzschalung, waagrechte Bretter), `brick` (Ziegel), `stone` (Naturstein) |
| `color` | nein | je Art | Farbe (`#rrggbb`), z. B. `#8e2f22` Schwedenrot (Standard bei `wood_siding`), `#ece5d8` Putz |
| `corners` | nein | weiß bei `wood_siding` | Farbe der Eckbretter (an Hausecken und Fensterlaibungen); `false` = keine |
| `plinth` | nein | | Sockel: `{ height (0.4), material (Oberfläche, z. B. stone), color }` – auf der untersten Etage bis auf das Gelände davor |


**Dach:** Jedes Gebäude bekommt ein Dach über seiner obersten Etage – ohne Angabe ein Flachdach. Es erscheint, sobald
eine höhere Ebene gezeigt wird (z. B. die Garage, wenn das 1. OG des Hauses gewählt ist); über der obersten Ebene
gibt es dafür den Knopf **Dach**. Jeder Dachteil ist ein eigener Bereich: Objekte darauf (Balkonkraftwerk,
Satellitenschüssel …) haben `space: <Dach-ID>`, ihre Höhen zählen ab der Dachfläche (auf Steildächern an ihrer Stelle).

Mehrere Dachteile (Liste) beschreiben z. B. Hauptdach und Anbau, eine Dachterrasse in einem Walmdach (Steildach mit
`opening` plus flacher Teil mit demselben Umriss) oder ein abgesetztes Pultdach (zwei Pultdächer mit Höhenversatz).
Jeder Teil hat einen **konvexen** Umriss; L-förmige Häuser bekommen zwei Teile, die sich durchdringen.

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `id` | nein | `<Gebäude-ID>_dach` (weitere `_dach_2` …) | Bereichs-ID des Dachteils |
| `name` | nein | `Dach` | Anzeigename |
| `type` | nein | `flat` | `flat` (Flachdach), `gable` (Satteldach), `hip` (Walmdach), `half_hip` (Krüppelwalm), `shed` (Pultdach) |
| `surface` | nein | `roof` bzw. `roof_tiles` | Oberfläche: `roof` (Dachbahn, Standard flach), `roof_tiles` (Ziegel, Standard geneigt) oder ein Belag (z. B. `slabs` für eine Dachterrasse) |
| `color` | nein | Ziegelrot | Farbe der Oberfläche (`#rrggbb`), z. B. `#4a4d52` für anthrazit |
| `polygon` | nein | Hülle der obersten Etage | Umriss = Außenkante der Wände (Traufe ohne Überstand), konvex |
| `thickness` | nein | 0.2 | Dachaufbau (Meter) |
| `eaves` | nein | Höhe der obersten Etage | Traufhöhe bzw. Kniestock über dem Fußboden der obersten Etage (Oberkante der Wand unter dem Dach); bei flachen Teilen die Lage der Dachfläche |
| `pitch` | nein | 35 (Pultdach 15) | Dachneigung in Grad |
| `ridge` | nein | entlang der längsten Kante | Firstrichtung: `x`, `y` oder Grad (von +x Richtung +y); Kanten parallel dazu sind Traufen, die anderen Giebel |
| `slope` | nein | quer zum First | nur Pultdach: Fallrichtung (dorthin läuft das Wasser) – `+x`, `-x`, `+y`, `-y` oder Grad |
| `overhang` | nein | 0 | Dachüberstand an Traufe und Ortgang (Meter) |
| `top` | nein | | Dach in dieser Höhe über der Traufe waagrecht abschneiden (Plateau) |
| `opening` | nein | | Aussparung (konvexes Polygon), z. B. für eine Dachterrasse; die Kante bekommt eine Brüstung bis auf den flachen Teil darin |
| `hip_height` | nein | 60 % der Firsthöhe | nur Krüppelwalm: Höhe über der Traufe, ab der der Walm beginnt |
| `hip_pitch` | nein | Neigung + 15 | nur Krüppelwalm: Neigung des Walms |
| `dormers` | nein | | Gauben, siehe unten |
| `chimneys` | nein | | Schornsteine, siehe unten |
| `railing` | nein | | nur flache Teile (Dachterrasse): Geländer, siehe Außenbereiche |

Die Dachfläche ist an jeder Stelle die niedrigste der Dachebenen (jede Traufe trägt eine Ebene mit `pitch`). Das
ergibt auf konvexen Umrissen genau Sattel-, Walm-, Krüppelwalm- und Pultdach.

**Oberste Etage unter einem Steildach:** Liegt die Traufe (`eaves`) unter der Etagenhöhe, enden die Wände der obersten
Etage unter der Dachfläche – Kniestock, Giebelwände und Innenwände zeigen die Dachschräge (höchstens bis zur
Etagenhöhe, z. B. Kehlbalkenlage). Darüber zeichnet das Dach die Giebelwände bis zum First. Deckenleuchten unter der
Schräge hängen an der Schräge. Dachteile über einer tieferen Etage (Anbau) schneiden nichts; ihre Giebelwände
beginnen an der Traufe.

**Gauben** (`roof.dormers[]`): stehen auf der Dachfläche an `pos`, die Front zeigt zur Traufe.

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `pos` | ja | | Mitte der Front (Plan) |
| `width` | nein | 1.6 | Breite |
| `height` | nein | 1.4 | Höhe der Front über der Dachfläche |
| `type` | nein | `shed` | `shed` (Schleppgaube), `flat` (Flachdachgaube), `gable` (Satteldachgaube) |
| `pitch` | nein | 10 / 0 / 40 | Neigung des Gaubendachs |
| `window` | nein | `true` | Fenster in der Front |
| `window_width` | nein | Breite − 0,4 | Fensterbreite |

**Schornsteine** (`roof.chimneys[]`): `pos` (Mitte, Plan), `size` (`[Breite, Tiefe]`, Standard `[0.5, 0.5]`),
`height` (über dem höchsten Punkt der Dachfläche darunter, Standard 0.8).

### Etage (`buildings[].floors[]`)

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `id` | ja | | z. B. `eg`, `og`, `kg` |
| `name` | ja | | z. B. „Erdgeschoss“ |
| `level` | ja | | **Ebene** als ganze Zahl: 0 = Erdgeschoss, 1 = 1. OG, −1 = Keller. Das Panel zeigt die gewählte Ebene auf allen darunter (höhere sind ausgeblendet); Etagen verschiedener Gebäude mit gleichem `level` erscheinen zusammen (Wohnhaus-EG mit Garage und Gartenhaus) |
| `elevation` | nein | 0 | Höhe des Fußbodens |
| `height` | ja | | Wandhöhe (Schnitthöhe der Darstellung, Raumhöhe für Licht) |
| `ha_floor` | nein | | `floor_id` der HA-Etage |
| `rooms` | ja | | Räume |
| `walls` | ja | | Wandstücke |
| `windows` | nein | `[]` | Fenster |
| `doors` | nein | `[]` | Türen |

**Raum** (`rooms[]`):

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `id` | ja | | Bereichs-ID, im ganzen Modell eindeutig (z. B. `wohnen`, `garage`) |
| `name` | ja | | Anzeigename; dient auch zum Finden des HA-Bereichs |
| `polygon` | ja | | Grundfläche (Innenmaß) |
| `surface` | nein | `parquet` | Bodenbelag, siehe [Oberflächen](#oberflächen) |
| `surface_rot` | nein | 0 | Verlegerichtung des Bodens in Grad |
| `height` | nein | Etage | abweichende Raumhöhe |
| `ha_area` | nein | nach Name | `area_id` des HA-Bereichs (sonst über Name oder ID gefunden) |

**Wand** (`walls[]`): `{ polygon }` – ein Wandstück als Grundriss-Polygon, Öffnungen (Fenster, Türen) ausgespart.
Höhe = Etagenhöhe.

**Fenster** (`windows[]`):

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `rect` | ja | | Öffnung in voller Wanddicke `[x0, y0, x1, y1]` |
| `room` | nein | | Raum, zu dem das Fenster gehört (Licht) |
| `sill` | nein | 0.9 | Brüstungshöhe |
| `top` | nein | 2.1 | Oberkante |
| `sashes` | nein | ca. 50 cm je Flügel | Anzahl Flügel |
| `transom` | nein | | Kämpfer: Anteil der Glashöhe für die Querteilung |

**Tür** (`doors[]`):

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `hinge`, `end` | ja | | Scharnier und Spitze des geschlossenen Türblatts (Wandmitte) |
| `swing` | ja | | Aufschlagseite: +1/−1 entlang n = (−uy, ux) mit u = Richtung hinge→end |
| `jamb` | ja | | Laibung relativ zur Linie hinge→end entlang n: `[innen, außen]`, z. B. `[-0.06, 0.06]` |
| `type` | nein | `interior` | `interior` oder `exterior` |
| `leaf` | nein | `glass` | nur `exterior`: `glass` oder `solid` |
| `rooms` | nein | | angrenzende Räume |
| `height` | nein | 2.05 | Durchgangshöhe |
| `open_deg` | nein | 85 | Öffnungswinkel (Innentüren) |

## `outdoor` – Außenbereiche („Gartenräume“)

Flächen außerhalb der Gebäude: Terrasse, Rasen, Beet, Einfahrt, Teich … Sie werden auf Ebene 0 gezeigt und sind
Bereiche wie Räume: Objekte können darin stehen, Außenleuchten beleuchten sie.

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `id` | ja | | Bereichs-ID (eindeutig zusammen mit allen Räumen) |
| `name` | ja | | Anzeigename |
| `polygon` | ja | | Fläche; Eckpunkte `[x, y]` oder mit Höhe `[x, y, z]` (Gelände, siehe unten) |
| `surface` | nein | `lawn` | Oberfläche |
| `elevation` | nein | 0 | Höhe der Fläche (Terrasse auf Fußbodenhöhe, Garten tiefer); bei Gelände: Höhe der Eckpunkte ohne `z` |
| `follow` | nein | | `terrain`: der Bereich liegt auf dem Höhenraster (`site.terrain`) – Rasen, Wege, Beete am Hang brauchen nur ihr Polygon |
| `extend` | nein | false | Gelände je Eckpunkt: der Boden setzt den Bereich nach außen fort, auch wo er höher liegt (Hang, der über das Grundstück hinausläuft) – statt Erdkante |
| `railing` | nein | | Geländer/Brüstung an den Kanten, siehe unten |
| `edge` | nein | Erde bzw. Belag | Oberfläche der Kante, wo der Bereich über dem Boden liegt (z. B. `stone` für Mauern, Hochbeete, Stufen); ohne Angabe Erde bei `lawn`/`soil`, sonst der Belag selbst |
| `ha_area` | nein | nach Name | HA-Bereich |

**Gelände mit Höhenraster:** Außenbereiche mit `follow: terrain` liegen auf dem Raster (dieselben Dreiecke wie der
Boden, also ohne Flackern). Ebene Bereiche mit `elevation` schneiden sich ins Gelände ein oder stehen darüber: Wo der
Hang daneben höher ist, bekommen sie eine Kante bis hinauf zum Gelände (Stützmauer, z. B. `edge: stone`), wo er tiefer
ist, eine Kante bis hinunter. Kanten richten sich immer nach dem, was tatsächlich daneben liegt (Gelände oder
Nachbarbereich) – auch wenn das ganze Gelände unter 0 liegt.

**Gelände je Eckpunkt (Hang, Böschung, ältere Form):** Hat mindestens ein Eckpunkt eine dritte Koordinate `z`, ist der Bereich schräg: `z` ist
die Höhe dieses Eckpunkts (Meter, wie `elevation`), zwischen den Eckpunkten wird in Dreiecken linear interpoliert.
Ein Hang mit gleichmäßigem Gefälle braucht also nur ein Viereck, dessen obere Kante höher liegt als die untere;
für einen geknickten Hang mehr Eckpunkte am Rand setzen (Punkte im Inneren gibt es nicht). Objekte im Bereich stehen auf dem Gelände (Höhe an ihrer Position),
`elevation` und `light.height` zählen ab dort. Liegt das Gelände tiefer als der umgebende Boden (`site.ground`, Höhe ≈ 0),
setzt der Boden es nach außen fort (ein Hang läuft seitlich weiter, unterhalb bleibt es unten); liegt es höher (Hügel,
Wall), zeigt das Panel eine Erdkante wie bei einem Geländemodell. Das gilt auch für ebene Bereiche mit `elevation` über
dem Boden.

**Geländer (`railing`)** für Terrassen, Balkone, Veranden und Dachterrassen (auch an flachen Dachteilen): steht 5 cm
innerhalb der Kante auf der Fläche (am Hang jede Docke auf ihrer Höhe).

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `style` | nein | `balusters` | `balusters` (Balustrade mit Docken, weiß), `metal` (Metall mit Stäben, anthrazit), `glass` (Glas zwischen Pfosten) |
| `height` | nein | 1.0 | Höhe über der Fläche |
| `edges` | nein | alle | Kanten, an denen es steht: Index i = Kante von `polygon[i]` nach `polygon[i+1]` |
| `color` | nein | je Art | Farbe von Pfosten, Handlauf und Docken |

**Mauern, Hochbeete, Stufen:** als schmale Außenbereiche mit `elevation` und `edge: stone`. Eine Trockenmauer ist ein
Streifen mit `surface: stone`, ein Hochbeet dahinter `surface: soil`, Blockstufen sind Streifen mit steigender Höhe. Eine
in den Hang gegrabene Terrasse: Terrasse auf Fußbodenhöhe, rundherum Mauerstreifen, dahinter ansteigendes Gelände
(Beispiel: `northTerrace()` in `examples/demo/build-house.mjs`). Kanten zu höheren Nachbarn verschwinden in deren Kante.

```yaml
site:
  terrain:
    origin: [-10, -14]
    cell: 1
    heights:
      - [2.08, 2.08, 2.0, …]   # Zeile y = -14
      - [1.81, 1.81, 1.82, …]  # Zeile y = -13
outdoor:
  - { id: garten, name: Garten, surface: lawn, follow: terrain, polygon: [[-4, 11.3], [11.2, 11.3], [11.2, 18], [-4, 18]] }
  # ältere Form ohne Raster: Südhang, oben auf Terrassenhöhe, unten 1,5 m tiefer
  - { id: hang, name: Hang, surface: lawn, polygon: [[-4, 11.3, -0.05], [11.2, 11.3, -0.05], [11.2, 18, -1.5], [-4, 18, -1.5]] }
```

**Höhenraster aus einem Scan:** `node scripts/terrain-from-scan.mjs scan.obj --cell 0.5 --rotate <Grad> --offset x,y
--floor <Höhe des EG-Fußbodens im Scan> --write` liest einen texturierten oder untexturierten OBJ-Export (Scaniverse,
Polycam, 3D Scanner App; USDZ in der App als OBJ exportieren), passt ihn ein und schreibt `site.terrain`. Je
Rasterpunkt zählt die niedrigste Fläche (Boden unter Büschen, `--mode max` für die höchste).

## `objects` – Objekte

Alles, was in einem Bereich steht oder hängt. **Ein Schema für alle Arten**: Was ein Objekt kann (z. B. leuchten),
legt sein Modell im [Katalog](#katalog) fest.

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `id` | ja | | eindeutig |
| `name` | nein | Modellname | Anzeigename (Editor, Meldungen) |
| `model` | ja | | Modell aus dem Katalog |
| `space` | nein | | Bereich (Raum oder Außenbereich), in dem das Objekt steht. Ohne `space`: freies Gelände. Bestimmt Etage, Höhenbezug und Licht |
| `pos` | ja | | Position `[x, y]` (Mittelpunkt bzw. Befestigungspunkt, siehe Katalog) |
| `rot` | nein | 0 | Drehung |
| `elevation` | nein | 0 | Unterkante über dem Boden des Bereichs (Bilder, TV, Heizkörper, Wandgeräte) |
| `size` | nein | Modell | `[Breite, Tiefe, Höhe]` bzw. `[Breite, Tiefe]` bei flachen Modellen |
| `params` | nein | `{}` | modellabhängige Parameter (Katalog) |
| `light` | bei Fähigkeit `light` | | Lichtquelle, siehe unten |
| `ha` | nein | | Verknüpfung mit Home Assistant, siehe unten |
| `state` | nein | `off` | fester Zustand ohne Entity für Modelle mit Animation (`on` = bewegt sich immer, z. B. Ventilator) |
| `stored` | nein | false | eingelagert: bleibt mit allen Verknüpfungen im Modell, steht aber nicht in der Welt (Editor → Katalog → Lager) |

**Höhenbezug:** `elevation` und `light.height` zählen ab dem Boden des Bereichs: Raum → `elevation` der Etage;
Außenbereich → dessen `elevation`; ohne `space` → 0.

**Objekte anlegen, einlagern, löschen:** Ein Objekt ist ein Eintrag in `objects` – wer ein Modell automatisch
erstellt (z. B. ein Agent), setzt Möbel, Leuchten und Geräte direkt mit `model`, `space`, `pos` (und `rot`, `size`,
`light`, `ha`) in die Welt; der Benutzer passt danach im Editor an. Im Editor fügt **Katalog** ein Modell neu hinzu
(in der Mitte der Ansicht, danach verschieben); **Entfernen → Einlagern** setzt `stored: true` (z. B.
Weihnachtsdekoration, die nur ein paar Monate steht – Verknüpfungen bleiben), **Katalog → Lager → Aufstellen** holt
es zurück, **Entfernen → Löschen** streicht den Eintrag.

**Animationen:** Modelle mit Animation (Spalte Parameter im [Katalog](#katalog), z. B. `ceiling_fan`) bewegen sich,
solange das Objekt aktiv ist: mit `ha.entities.power` (ohne power: `info`) sobald eine Entity aktiv ist (nicht `off`,
`idle`, `paused`, `standby`, `closed`, `closing`, `docked`, `unavailable`, `unknown`; Messwerte ab 1), das Tempo folgt
dem Attribut `percentage` (Ventilatorstufe) bzw. dem Messwert (Leistung/`peak`); ohne Entity gilt `state`. Tore
(`garage_door`, Sektionaltor) fahren in rund 8 s hoch bzw. zu. Die Einstellungen (Zahnrad) schalten Animationen für das Gerät ab.

```yaml
- { id: ventilator, name: Deckenventilator, model: ceiling_fan, space: schlafen, pos: [7, 4.7], state: on,
    ha: { entities: { power: fan.schlafzimmer } } }
```

### `light` – Lichtquelle (Modelle mit Fähigkeit `light`)

| Feld | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `mount` | nein | Modell | Montage: `ceiling`, `pendant`, `floor`, `table`, `wall`, `spot` (Helligkeit, Standardmodell) |
| `height` | ja | | Höhe der Lichtquelle über dem Boden des Bereichs |
| `range` | ja | | Reichweite in Metern |
| `color` | nein | warmweiß | Lichtfarbe `#rrggbb`, solange HA keine liefert |
| `facing` | nein | | Außen-Wandleuchte: Richtung des Lichtscheins auf den Boden `[dx, dy]` |

Licht wirkt nur im eigenen Bereich (kein Licht durch Wände). Leuchten in Außenbereichen oder ohne `space` beleuchten
das Gelände.

### `ha` – Verknüpfung mit Home Assistant

```yaml
ha:
  entities:
    power: [light.spot_1, light.spot_2]   # Rolle -> eine Entity oder eine Liste
    info: sensor.stehlampe_leistung
  tap: toggle
  double_tap: none
  hold: more-info
```

| Feld | Standard | Bedeutung |
|---|---|---|
| `entities` | `{}` | Entities nach **Rolle** (Tabelle unten) |
| `tap` | siehe Standards | Aktion beim Antippen |
| `double_tap` | `none` | Aktion beim Doppeltippen |
| `hold` | `more-info` | Aktion beim langen Drücken (½ s) |
| `badge` | siehe Standards | Zustand über dem Objekt anzeigen (`true`/`false`) |

**Rollen:**

| Rolle | Bedeutung | typische Domains |
|---|---|---|
| `power` | Ein/Aus und – bei Leuchten – Farbe und Helligkeit. Mehrere Entities: an, sobald eine an ist; Schalten betrifft alle | `light`, `switch`, `fan`, `input_boolean`, `climate`, `media_player` |
| `info` | Werte zur Anzeige (Zustand, Leistung, Restzeit …) | `sensor`, `binary_sensor`, beliebige |

Reserviert für spätere Versionen: `speed` (Drehzahl), `flow` (Leistung für Energiefluss), `progress` (Fortschritt).

**Aktionen** (`tap`, `double_tap`, `hold`) – Kurzform als Text oder ausführlich als Objekt:

| Aktion | Kurzform | ausführlich | Wirkung |
|---|---|---|---|
| Umschalten | `toggle` | `{ action: toggle }` | `power`-Entities gemeinsam umschalten: ist eine an, gehen alle aus, sonst alle an (`<domain>.turn_on/turn_off`, andere Domains über `homeassistant.turn_on/turn_off`) |
| HA-Dialog | `more-info` | `{ action: more-info, entity: sensor.x }` | HA-eigenen Dialog öffnen (ohne `entity`: erste `power`-, sonst erste `info`-Entity) |
| Dienst | – | `{ action: service, service: script.kamin_an, data: { … } }` | HA-Dienst aufrufen; ohne `entity_id` in `data` gelten die `power`-Entities |
| Seite | – | `{ action: navigate, path: /lovelace/energie }` | HA-Seite öffnen |
| nichts | `none` | `{ action: none }` | – |

Jede ausführliche Aktion kann `confirm: "Text der Rückfrage"` haben.

**Standards:** `tap` = `toggle`, wenn `power` verknüpft ist, sonst `more-info`, wenn irgendeine Entity verknüpft ist,
sonst `none`. `hold` = `more-info`, wenn irgendeine Entity verknüpft ist, sonst `none`. `double_tap` = `none`.
Leuchten (Fähigkeit `light`) haben immer `tap` = `toggle` und `hold` = `more-info` – unverknüpft schalten sie im
Demo-Haus und in der Vorschau lokal. Ein anderes Objekt ohne `ha` ist reine Einrichtung (Antippen geht an den Raum).
Hat ein Objekt eine Aktion für `double_tap`, wartet ein einzelnes Antippen kurz (0,3 s), ob ein zweites folgt.

**Zustandsanzeige** (`badge`): ein kleines Schild über dem Objekt mit dem Wert der `info`-Entities (mit Einheit,
mehrere durch „·“ getrennt) oder – ohne `info` – „An“/„Aus“ der `power`-Entities; hervorgehoben, solange eine
`power`-Entity an ist. Als „an“ gilt jeder Zustand außer `off`, `idle`, `standby`, `closed`, `locked`, `docked`,
`not_home`, `unavailable`, `unknown` und `0`. Standard: angezeigt bei `info`-Entities oder bei geschalteten Objekten,
die keine Leuchte sind (Leuchten zeigen ihren Zustand durch ihr Licht). Keine Animationen.

**Räume** schalten beim Antippen alle `power`-Entities der Leuchten im Raum (alle an bzw. alle aus).

## Oberflächen

`surface` von Räumen, Außenbereichen und `site.ground`:

| Wert | Darstellung |
|---|---|
| `parquet` | Fischgrätparkett |
| `parquet_cube` | Würfelparkett |
| `tiles` | Fliesen |
| `concrete` | Beton/Estrich |
| `lawn` | Rasen |
| `paving` | Pflaster/Platten |
| `gravel` | Kies |
| `soil` | Erde/Beet |
| `wood` | Holzdeck |
| `water` | Wasser |
| `slabs` | Großformatplatten (60 × 30 cm, hellgrau) |
| `stone` | Naturstein (Trockenmauer, Blockstufen) |
| `roof` | Flachdach (dunkle Dachbahn) |
| `roof_tiles` | Dachziegel (Falzziegel, Farbe über `color` des Dachs) |

## Katalog

Modelle für `objects[].model`. **Fähigkeit** `light` = das Objekt ist eine Leuchte und braucht `light`. Maße als
Standard `[B, T, H]` in Metern. Parameter gehören nach `params`. Farben (`params.color`) sind Materialien der Palette
(`PALETTE` in `src/models.js`): `fabric_grey`, `fabric_dark`, `fabric_chair`, `cushion_green`, `cushion_light`, `oak_light`,
`teak`, `wood_dark`, `white`, `plaster`, `black_gloss`, `black_matte`, `slate`, `brass`, `steel_dark`, `rug_red`,
`rug_navy`, `curtain_green`, `curtain_grey`, `teal`, `book_brown`, `book_mix`, `frame_dark`, `canvas_art`, `screen`,
`glass_fire`, `bin_clear`, `toy_red`, `toy_yellow`, `toy_blue`; Garten: `bark`, `birch_bark`, `leaf_green`, `leaf_dark`,
`leaf_light`, `leaf_silver`, `conifer`, `flower_red`, `flower_yellow`, `flower_violet`, `flower_white`, `flower_pink`, `grass_straw`,
`grass_green`, `alu_dark`, `sling_grey`, `table_top`, `pine`, `barrel_green`.

Die Liste unten ist mit `src/model/catalog.js` abgeglichen (`npm run validate` prüft, dass beide übereinstimmen).

<!-- katalog:start -->
| Modell | Art | Fähigkeiten | Standardmaß | Parameter |
|---|---|---|---|---|
| `armchair` | Möbel | | 0.66 × 0.78 | `color` |
| `barrel` | Möbel | | 0.6 × 0.6 × 0.9 | `color` (Regentonne) |
| `bench` | Möbel | | 1.6 × 0.62 × 0.85 | `color` (Auflage; Gartenbank) |
| `bookshelf` | Möbel | | 2.0 × 0.3 × 2.0 | |
| `box` | Gerät | | 0.6 × 0.6 × 0.85 | `color` |
| `ceiling_fan` | Gerät | | 1.2 | `color` (Flügel) – Animation: Flügel drehen sich, Tempo aus `percentage`; hängt an der Decke des Raums |
| `chair` | Möbel | | | `guitar` |
| `chest_table` | Möbel | | 0.8 × 0.6 × 0.48 | |
| `curtain` | Möbel | | | `color` |
| `floor_fan` | Gerät | | 0.42 × 0.42 × 1.15 | `color` (Rotor) – Animation: Rotor dreht sich, Tempo aus `percentage` |
| `flowers` | Pflanze | | 1.5 × 0.8 × 0.35 | `color` |
| `garage_door` | Gerät | | 3.0 × 0.2 × 2.1 | `color`, `sections` (Lamellen, Standard 5) – Sektionaltor innen hinter einer Wandöffnung, Ursprung an der Innenkante; Schienen, Deckenantrieb; Animation: die Lamellen fahren die Schienen hoch unter die Decke, solange offen (`cover`: open/opening); Sturz bis zur Decke |
| `garden_chair` | Möbel | | | `color` (Bespannung; Gartenstuhl) |
| `garden_table` | Möbel | | 1.6 × 0.9 × 0.74 | `color` (Platte; Gartentisch) |
| `grand_piano` | Möbel | | 1.48 × 1.6 | |
| `grass` | Pflanze | | 0.6 × 0.6 × 0.7 | `color` (Ziergras: `grass_straw`, `grass_green`) |
| `grill` | Möbel | | 1.3 × 0.55 × 1.15 | (Gasgrill) |
| `hearth` | Möbel | | | |
| `marker` | Gerät | | 0.12 | `color` |
| `picnic_table` | Möbel | | 0.9 × 0.9 × 0.5 | `color` (Kinder-Picknicktisch) |
| `picture` | Möbel | | | `frame`, `mat`, `color`, `texture` |
| `radiator` | Möbel | | | |
| `rug` | Möbel | | 2.0 × 3.0 | `color` |
| `shrub` | Pflanze | | 1.2 × 1.0 × 1.0 | `color` |
| `sideboard` | Möbel | | 1.2 × 0.45 × 0.6 | |
| `sofa_u` | Möbel | | 3.5 × 2.4 × 0.82 | `seat_depth`, `left`, `right`, `color` |
| `solar_panels` | Gerät | | 2.29 × 1.72 × 0.1 | `panels` (2), `cable_to` (`[x, z]` Kabel bis zum Dachrand), `drop` (Kabel hinunter, m), `peak` (800 W) – Balkonkraftwerk flach; Animation: Energiefluss im Kabel, solange Leistung ≥ 1 W (Tempo aus Leistung/`peak`) |
| `speaker` | Möbel | | 0.22 × 0.3 × 1.0 | |
| `storage_cube` | Möbel | | | |
| `stove` | Möbel | | | |
| `toy_storage` | Möbel | | | `columns` |
| `tree` | Pflanze | | 3 × 3 × 5 | `shape` (`round`, `conifer`, `column`, `birch`), `color`, `stakes` (Dreibock aus Baumpfählen) |
| `tv` | Gerät | | 1.45 × 0.06 × 0.84 | |
| `ball` | Leuchte | `light` | | `radius` |
| `bollard` | Leuchte | `light` | | (Pollerleuchte, Licht unter dem Schirm) |
| `chandelier_candles` | Leuchte | `light` | | `arms` |
| `chandelier_tulip` | Leuchte | `light` | | `arms` |
| `disc` | Leuchte | `light` | | |
| `floor_spots` | Leuchte | `light` | | |
| `sconce` | Leuchte | `light` | | |
| `spike_spot` | Leuchte | `light` | | (Erdspießstrahler im Beet) |
| `string_lights` | Leuchte | `light` | | `length` (8), `sag` (0.4), `bulbs` (12), `poles` (true) – Lichterkette entlang der x-Achse, `light.height` = Höhe der Enden |
| `wall_box` | Leuchte | `light` | | |
<!-- katalog:end -->

Hinweise:
- `box` ist der allgemeine Platzhalter für Geräte ohne eigenes Modell (Waschmaschine, Wärmepumpe …): ein Quader in
  `size` und `params.color`. `marker` ist ein kleiner Punkt (Sensoren, Taster).
- `picture.params.texture`: Bilddatei relativ zum Datenordner, z. B. `textures/gemaelde.jpg`.
- Wandmodelle (`sconce`, `wall_box`, `picture`, `tv`, `radiator`, `curtain`): `pos` liegt an der Wand, `rot` zeigt in
  den Raum.

## Versionen und Migration

- `version` ist eine ganze Zahl. Jede **inkompatible** Änderung am Format erhöht sie.
- Für jede neue Version gibt es eine Migration in `src/model/migrate.js` (`MIGRATIONS[n]` wandelt Version n−1 in n
  um). Beim Laden wendet das Panel alle nötigen Migrationen nacheinander an; das nächste Speichern schreibt die
  aktuelle Version. Werkzeuge (`npm run validate`, Import) tun dasselbe.
- Ein Dokument mit einer **neueren** Version als der Code kennt, wird nicht geladen (Meldung: Engine aktualisieren).
- Version 1 (getrennte Dateien `house.json`, `furniture.yaml`, `devices.yaml`) wird nicht migriert.
- **Kompatible** Erweiterungen (neue optionale Felder, neue Modelle, neue Werte) brauchen keine neue Version; sie
  werden hier und im Schema ergänzt.
- Zu jeder Version steht unten ein Eintrag unter [Änderungen](#änderungen).

## Prüfung

`npm run validate` (bzw. `DATA_DIR=… npm run validate`) prüft:
1. das Schema (`schema/model.schema.json`),
2. eindeutige IDs (Gebäude, Etagen je Gebäude, Bereiche, Objekte),
3. Verweise: `space`, `windows[].room`, `doors[].rooms`, Modelle aus dem Katalog, `light` genau bei Leuchten,
4. Lage: jedes Objekt mit `space` liegt in dessen Polygon; Leuchten unter der Raumhöhe,
5. Entity-IDs syntaktisch gültig, Texturen vorhanden.

Mit HA-Export (`ENTITIES`) prüft `npm run link-check` zusätzlich, ob die verknüpften Entities existieren.

## Vollständiges Beispiel

```yaml
schema: ha3d
version: 2
site:
  name: Musterhaus
  north_deg: 90
  ground: { surface: lawn }
buildings:
  - id: haus
    name: Wohnhaus
    floors:
      - id: eg
        name: Erdgeschoss
        level: 0
        elevation: 0
        height: 2.6
        rooms:
          - { id: wohnen, name: Wohnzimmer, polygon: [[0.3, 0.3], [5.7, 0.3], [5.7, 4.7], [0.3, 4.7]], surface: parquet }
        walls:
          - { polygon: [[0, 0], [6, 0], [6, 0.3], [0, 0.3]] }
          - { polygon: [[0, 4.7], [6, 4.7], [6, 5], [0, 5]] }
          - { polygon: [[0, 0.3], [0.3, 0.3], [0.3, 4.7], [0, 4.7]] }
          - { polygon: [[5.7, 0.3], [6, 0.3], [6, 4.7], [5.7, 4.7]] }
        windows:
          - { rect: [2, 4.7, 3.5, 5], room: wohnen }
  - id: garage
    name: Garage
    kind: garage
    floors:
      - id: eg
        name: Garage
        level: 0
        height: 2.4
        rooms:
          - { id: garage, name: Garage, polygon: [[8.2, 0.2], [11.3, 0.2], [11.3, 5.8], [8.2, 5.8]], surface: concrete }
        walls:
          - { polygon: [[8, 0], [11.5, 0], [11.5, 0.2], [8, 0.2]] }
outdoor:
  - { id: terrasse, name: Terrasse, polygon: [[0, 5], [6, 5], [6, 8], [0, 8]], surface: paving }
objects:
  - { id: sofa, model: sofa_u, space: wohnen, pos: [1.6, 2.5], rot: 270, size: [3.0, 2.2, 0.82] }
  - id: wohnen_decke
    name: Deckenleuchte
    model: disc
    space: wohnen
    pos: [3, 2.5]
    light: { mount: ceiling, height: 2.5, range: 4.5 }
    ha:
      entities: { power: light.wohnzimmer }
  - id: waschmaschine
    name: Waschmaschine
    model: box
    space: garage
    pos: [10.9, 5.4]
    rot: 180
    size: [0.6, 0.6, 0.85]
    params: { color: white }
    ha:
      entities: { power: switch.waschmaschine, info: [sensor.waschmaschine_restzeit] }
      tap: more-info
  - id: terrassenleuchte
    model: wall_box
    space: terrasse
    pos: [3, 5.05]
    light: { mount: wall, height: 2.0, range: 3, facing: [0, 1] }
    ha: { entities: { power: light.terrasse } }
```

## Anleitung für Agenten

1. **Bauwerk:** aus einem Magicplan-PDF (`scripts/extract_plan.py`) oder per Skript nach dem Vorbild
   `examples/demo/build-house.mjs`. Mehrere Gebäude (Garage, Gartenhaus) in dieselben Grundstückskoordinaten legen.
2. **Nordrichtung** beim Besitzer erfragen (welcher Raum liegt wo?), `site.north_deg` setzen.
3. **Etagen:** `level` je Stockwerk; gleiche Ebene in mehreren Gebäuden ist erlaubt und erwünscht.
4. **Außenbereiche** für Terrasse, Garten, Einfahrt anlegen (Polygone, `surface`).
5. **Objekte:** zuerst Leuchten (Fähigkeit `light`), dann Möbel und Geräte. Unbekannte Geräte: `box`.
6. **Verknüpfen:** HA-Export lesen, `ha.entities.power` bzw. `info` setzen; Aktionen nur angeben, wenn sie vom Standard
   abweichen.
7. `npm run validate` muss fehlerfrei sein, dann `npm test` und die Screenshots ansehen.

## Anhang: HA-Export für Link-Check und Vorschau (optional)

In Home Assistant unter *Entwicklerwerkzeuge → Template* ausführen und das Ergebnis als `reference/entities.txt` der
Instanz speichern. Der Link-Check in den Tests und die lokale Vorschau nutzen ihn, das Panel selbst braucht ihn nicht.

```jinja
{%- for area in areas() %}
## {{ area_name(area) }}
{%- for e in area_entities(area) | select('match', '^(light|switch|binary_sensor|sensor|climate|cover|vacuum|lawn_mower|media_player)\.') %}
{{ e }} | {{ state_attr(e, 'friendly_name') }}
{%- endfor %}
{%- endfor %}

## Ohne Bereich
{%- for s in states | selectattr('domain', 'in', ['light','switch','binary_sensor','climate','cover','media_player']) %}
{%- if not area_id(s.entity_id) %}
{{ s.entity_id }} | {{ s.name }}
{%- endif %}
{%- endfor %}
```

## Anhang: views.json (Instanz, optional)

Zusätzliche Screenshot-Ansichten für `npm test` der Instanz:

```json
{ "wohnzimmer-abend": { "rooms": ["wohnzimmer"], "outdoor": true, "view": { "at": [3.0, 7.5], "zoom": 1.9, "az": 0 } } }
```

`rooms`: Bereichs-IDs oder `"all"`, `level`: Ebene (Standard 0), `sun`: `{ "azimuth": 215, "elevation": 38 }` (sonst Nacht), `view.at`: Plan-Punkt,
`zoom`, `az`: Schwenk um die Hochachse in Grad.

## Anhang: Panel-Konfiguration (`panel_custom` → `config`)

Mit der HACS-Integration stellt man das in der Oberfläche ein (Geräte & Dienste → 3D-HA-Dashboard → Konfigurieren);
sie setzt `data_url`, voreingestellt `/local/ha-3d-dashboard/`. Bei `panel_custom` von Hand sind alle Felder optional:

| Feld | Bedeutung |
|---|---|
| `data_url` | Ordner mit `model.yaml` und `textures/` (z. B. `/local/ha-3d-dashboard/`). Ohne Angabe: neben dem Modul. |
| `demo` | `true`: eingebettetes Demo-Haus statt eigener Daten (unverknüpft, lokales Schalten; Speichern nur in eigene Demo-Benutzerdaten). |
| `save_url` | nur Entwicklung: Dev-Server-Endpunkt zum Speichern des Editors. |
| `shared` | `true` (setzt die Integration): Modell gemeinsam über die Integration laden und speichern, siehe unten. |

Sind die Daten nicht erreichbar (HTTP-Fehler), zeigt das Panel das Demo-Haus mit Hinweis.

## Anhang: Gemeinsamer Speicher der Integration

Mit `shared: true` hält die Integration das Modell für alle Benutzer (HA-Speicher `ha_3d_dashboard.model`). Sie
speichert das Modell als JSON-Objekt (gleicher Inhalt wie `model.yaml`), den Kopfkommentar (`header`), den Prüfwert
der `model.yaml`, aus der es hervorging (`file_hash`), und eine fortlaufende `revision`. WebSocket-Befehle:

| Befehl | Rechte | Inhalt |
|---|---|---|
| `ha_3d_dashboard/model/get` | alle | `{model, header, file_hash, revision, updated_at, updated_by}`; ohne Modell `{model: null, revision: 0}` |
| `ha_3d_dashboard/model/save` | Administratoren | `{model, header?, file_hash?, revision?}` → `{revision}`; weicht `revision` ab: Fehler `conflict` |
| `ha_3d_dashboard/model/subscribe` | alle | Ereignis `{revision}` nach jedem Speichern |

Quelle beim Laden: das gespeicherte Modell, außer im Datenordner liegt eine `model.yaml` mit anderem Prüfwert (neue
oder geänderte Datei = Import, sie gewinnt). Ohne beides: Demo-Haus. Das gespeicherte Modell wird beim Laden wie eine
Datei migriert; beim nächsten Speichern steht es in der aktuellen Version im Speicher.

## Änderungen

- **Version 2:** ein Dokument statt drei Dateien; Grundstück mit mehreren Gebäuden, Ebenen (`level`) und
  Außenbereichen; einheitliche Objekte mit Katalog, Rollen und Aktionen; Bodenbelag heißt `surface`.
- **Version 2, Ergänzung (0.19.0, abwärtskompatibel):** `buildings[].facade` (Putz, Holzschalung, Ziegel, Naturstein;
  Farbe, Eckbretter, Sockel), `railing` an Außenbereichen und flachen Dachteilen.
- **Version 2, Ergänzung (0.18.0, abwärtskompatibel):** `site.terrain` (Höhenraster) und `outdoor[].follow:
  terrain`; Kanten von Außenbereichen relativ zum tatsächlichen Gelände bzw. Nachbarbereich (mit Raster auch nach
  oben); Werkzeug `scripts/terrain-from-scan.mjs`.
- **Version 2, Ergänzung (0.17.0, abwärtskompatibel):** Steildächer – `buildings[].roof` auch als Liste von
  Dachteilen mit `type` (`gable`, `hip`, `half_hip`, `shed`), `pitch`, `ridge`, `slope`, `overhang`, `eaves`, `top`,
  `opening`, `hip_height`, `hip_pitch`, `color`, `dormers`, `chimneys`; Oberfläche `roof_tiles`.
- **Version 2, Ergänzung (0.16.0, abwärtskompatibel):** `buildings[].roof` (Flachdach als eigener Bereich, sichtbar
  ab der Ebene darüber); Oberfläche `roof`; Katalog `garage_door`, `solar_panels`.
- **Version 2, Ergänzung (0.15.0, abwärtskompatibel):** Objekte mit `state` (fester Zustand für Animationen) und
  `stored` (eingelagert); Katalog `ceiling_fan`, `floor_fan` mit Animation.
- **Version 2, Ergänzung (0.14.0, abwärtskompatibel):** `outdoor[].edge`, `outdoor[].extend`; Kanten auch bei ebenen, erhöhten
  Außenbereichen; Oberflächen `slabs`, `stone`; Katalog `garden_table`, `garden_chair`, `bench`, `picnic_table`,
  `grill`, `barrel`, `grass`, `bollard`, `spike_spot`, `string_lights`; `tree` mit `stakes`.
- **Version 2, Ergänzung (0.12.0, abwärtskompatibel):** `site.weather` (Wetter-Entity).
- **Version 2, Ergänzung (0.11.0, abwärtskompatibel):** `tree` mit `shape: column` (Säulenbaum) und `birch` (Birke).
- **Version 2, Ergänzung (0.9.0, abwärtskompatibel):** Gelände – Eckpunkte von Außenbereichen mit Höhe
  `[x, y, z]`; Katalog-Art „Pflanze“ mit `tree`, `shrub`, `flowers`.
- **Version 2, Ergänzung (0.8.0, abwärtskompatibel):** `ha.badge`; Standardaktionen für Leuchten; „Umschalten“ schaltet
  über `turn_on`/`turn_off` der jeweiligen Domain.
