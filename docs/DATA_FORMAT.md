# Datenformat

Ein Haus besteht aus drei Dateien in einem Datenordner (in einer Instanz: `data/`). Sie werden zur Laufzeit geladen,
Änderungen brauchen also keinen Build. Ein vollständiges Beispiel ist `examples/demo/`.

| Schicht | Datei | ändert sich |
|---|---|---|
| Bauwerk | `house.json` | praktisch nie: Etagen, Räume, Wände, Fenster, Türen, Nordrichtung |
| Einrichtung | `furniture.yaml` | gelegentlich: Möbel |
| Geräte | `devices.yaml` | öfter: Leuchten (später Sensoren, Heizkörper …) mit Ort und HA-Entity |

Einrichtung und Geräte verweisen nur über `floor`/`room` (IDs aus `house.json`) und Koordinaten auf das Haus, nie
umgekehrt. Raum-IDs bleiben deshalb stabil. Bilder für Texturen liegen in `textures/` im Datenordner.

## Koordinaten

Meter, Plan-Koordinaten `[x, y]`: x nach rechts, y nach unten (wie ein Grundriss auf Papier). Ursprung: linke obere
Außenecke der Etage. In three.js wird Plan-x zu x, Plan-y zu z, die Höhe ist y.
`rot` (Drehung) in Grad **im Uhrzeigersinn**, von oben gesehen. Bei `rot: 0` zeigt die Vorderseite eines Objekts
(Sitzfläche, Bildschirm, Regalöffnung, Tastatur) nach Plan-unten (+y); 90 = nach links, 180 = oben, 270 = rechts.

## house.json

```jsonc
{
  "name": "Mein Haus",
  "north_deg": 20,            // Norden im Plan, Grad im Uhrzeigersinn von "oben" (Sonne, Mond, Kompass)
  "floors": [{
    "id": "eg", "name": "Erdgeschoss", "level": 0, "elevation": 0,
    "ceiling": 2.6,           // Wandhöhe (Schnitthöhe) der Etage
    "rooms": [{
      "id": "wohnen", "name": "Wohnzimmer",
      "polygon": [[0.3, 0.3], [5.94, 0.3], [5.94, 7.7], [0.3, 7.7]],
      "floor": "parkett",     // parkett | parkett_wuerfel | fliesen
      "floor_rot": 45,        // optional: Verlegerichtung des Bodens in Grad
      "ceiling": null         // optional: abweichende Raumhöhe (Licht, Leuchtenhöhe)
    }],
    "walls": [[[0, 0], [10, 0], [10, 0.3], [0, 0.3]]],   // Wandstücke als Polygone, Öffnungen ausgespart
    "windows": [{
      "rect": [1.2, 0, 2.4, 0.3],   // Öffnung in voller Wanddicke [x0, y0, x1, y1]
      "room": "wohnen", "sill": 0.9, "top": 2.1,
      "sashes": 2,                  // optional: Flügel (sonst ca. 50 cm je Flügel)
      "transom": 0.7                // optional: Kämpfer/Querteilung (Anteil der Glashöhe)
    }],
    "doors": [{
      "hinge": [6.0, 1.4], "end": [6.0, 2.3],   // Scharnier und geschlossene Türspitze (Wandmitte)
      "swing": 1,              // Aufschlagseite: +1/-1 entlang n = (-uy, ux) mit u = Richtung hinge→end
      "jamb": [-0.06, 0.06],   // Laibung (Wanddicke) relativ zur Linie hinge→end entlang n
      "type": "interior",      // interior | exterior
      "leaf": "glass",         // nur exterior: glass | solid
      "rooms": ["wohnen", "kueche"], "height": 2.0,
      "open_deg": 85           // optional: Öffnungswinkel der Innentür
    }]
  }]
}
```

Grundriss erzeugen: aus einem Magicplan-PDF (`scripts/extract_plan.py`, siehe `docs/SETUP.md`) oder von Hand bzw. per
Skript nach dem Vorbild `examples/demo/build-house.mjs`. `scripts/house_fixes.py` fasst nebeneinanderliegende
Fenster zu Bändern zusammen und entfernt Wandstreifen dazwischen.

## furniture.yaml

```yaml
items:
  - { id: sofa, kind: sofa_u, floor: eg, room: wohnen, pos: [1.55, 3.0], rot: 270, size: [3.0, 2.2, 0.82] }
  - { id: bild, kind: picture, floor: eg, room: wohnen, pos: [4.9, 0.32], rot: 0, elevation: 1.0, texture: textures/bild.jpg }
```

| Feld | Bedeutung |
|---|---|
| `id` | eindeutig, stabil |
| `kind` | Modell (siehe unten) |
| `floor`, `room` | Etage und Raum aus `house.json` |
| `pos`, `rot` | Mittelpunkt [x, y] und Drehung |
| `size` | [Breite, Tiefe, Höhe] in Metern (optional, sonst Standardmaß) |
| `elevation` | Unterkante über dem Boden (Bilder, TV, Vorhänge, Heizkörper) |
| `color` | Material aus der Palette (`PALETTE` in `src/models.js`) |
| `texture` | Bilddatei relativ zum Datenordner (bei `picture`) |

Modelle (`FURNITURE` in `src/models.js`): `sofa_u` (Parameter `seat_depth`, `left`, `right`), `armchair`,
`chest_table`, `rug`, `sideboard`, `tv`, `speaker`, `stove`, `hearth`, `bookshelf`, `grand_piano`, `storage_cube`,
`toy_storage` (`columns`), `chair` (`guitar: true`), `picture` (`frame`, `mat`), `curtain`, `radiator`.

## devices.yaml

```yaml
areas:                # optional: Raum -> HA-Bereich (area_id), wo der Name nicht passt
  eg/bad: badezimmer
devices:
  - id: eg_wohnen_stehlampe
    type: light
    kind: floor        # ceiling | pendant | floor | table | wall | spot
    model: floor_spots # Aussehen, siehe unten (ohne: Scheibe bzw. Wandbox)
    name: Stehlampe
    floor: eg
    room: wohnen       # aussen = außerhalb des Hauses
    pos: [0.65, 0.7]
    height: 1.45       # Höhe der Lichtquelle
    range: 2.8         # Reichweite des Lichts
    color: '#ffcc88'   # optional: Farbe, solange HA keine liefert
    entity: [light.spot_1, light.spot_2, light.spot_3]   # String, Liste oder null
```

Leuchten-Modelle (`LAMPS`): `chandelier_tulip`, `chandelier_candles`, `floor_spots`, `sconce`, `ball`, `disc`,
`wall_box`. Außenleuchten (`room: aussen`, `kind: wall`) werfen einen Lichtschein auf den Boden in Richtung `facing`.

Im Panel: Leuchte antippen schaltet, **lange drücken** (½ s) öffnet den HA-Dialog der Entity (bei mehreren die erste).
Verknüpfen geht am bequemsten im Panel: Stift → Leuchte antippen → **Verknüpfen** (Liste aller Entities, die HA gerade
kennt, vorgefiltert auf den HA-Bereich des Raums; Filter Licht, Steckdosen oder Alle).

## HA-Export für Link-Check und Vorschau (optional)

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

## views.json (Instanz, optional)

Zusätzliche Screenshot-Ansichten für `npm test` der Instanz:

```json
{ "wohnzimmer-abend": { "rooms": ["wohnzimmer"], "outdoor": true, "view": { "at": [3.0, 7.5], "zoom": 1.9, "az": 0 } } }
```

`rooms`: Raum-IDs oder `"all"`, `sun`: `{ "azimuth": 215, "elevation": 38 }` (sonst Nacht), `view.at`: Plan-Punkt,
`zoom`, `az`: Schwenk um die Hochachse in Grad.

## Panel-Konfiguration (`panel_custom` → `config`)

Mit der HACS-Integration stellt man das in der Oberfläche ein (Geräte & Dienste → 3D-HA-Dashboard → Konfigurieren);
sie setzt `data_url`, voreingestellt `/local/ha-3d-dashboard/`. Bei `panel_custom` von Hand sind alle Felder optional:

| Feld | Bedeutung |
|---|---|
| `data_url` | Ordner mit `house.json`, `furniture.yaml`, `devices.yaml`, `textures/` (z. B. `/local/ha-3d-dashboard/`). Ohne Angabe: neben dem Modul. |
| `demo` | `true`: eingebettetes Demo-Haus statt eigener Daten (unverknüpft, lokales Schalten; Speichern nur in eigene Demo-Benutzerdaten). |
| `save_url` | nur Entwicklung: Dev-Server-Endpunkt zum Speichern des Editors. |

Sind die Daten nicht erreichbar (HTTP-Fehler), zeigt das Panel das Demo-Haus mit Hinweis.
