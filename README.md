# 3D-HA-Dashboard

Ein interaktiver 3D-Grundriss deines Hauses als Panel in [Home Assistant](https://www.home-assistant.io/):
isometrische Ansicht mit abgeschnittenen Decken, Licht und Schatten nach Sonnenstand, Lampen, die in ihrer echten
Farbe leuchten, und ein Editor, mit dem du Möbel und Leuchten direkt im Modell platzierst und mit HA verknüpfst.

![Demo-Haus am Abend](docs/screenshot-abend.png)

| Tag (Sonne aus `sun.sun`) | Editor: Anlegen an die Wand | Editor: Entity verknüpfen |
|---|---|---|
| ![Tag](docs/screenshot-tag.png) | ![Editor](docs/screenshot-editor.png) | ![Verknüpfen](docs/screenshot-verknuepfen.png) |

## Funktionen

- **three.js, ein JS-Bundle, offline:** keine CDNs, keine externen Requests, keine Tokens – das Panel nutzt die
  angemeldete HA-Sitzung (`panel_custom`).
- **Licht:** Raum antippen schaltet alle Lichter des Raums, Leuchte antippen nur diese. Farbe und Helligkeit kommen
  aus HA. Das Licht wirkt nur im eigenen Raum (kein Durchscheinen durch Wände) und ist mobil-tauglich.
- **Himmel:** Sonne mit Schatten nach `sun.sun`, nachts Mond; Kompass mit Einnorden.
- **Touch:** für Wand-Tablets und Touchscreens gebaut (große Bedienelemente, Gesten).
- **Editor:** Möbel/Leuchten antippen, mit Koordinatensystem verschieben und drehen, an Wände anlegen,
  mit HA-Entities verknüpfen (Liste aller Entities, vorgefiltert nach HA-Bereich), speichern.
- **Link-Check:** zeigt verknüpfte und fehlende Entities.
- **Daten statt Code:** Haus (`house.json`), Möbel (`furniture.yaml`) und Geräte (`devices.yaml`) werden zur
  Laufzeit geladen – Änderungen brauchen keinen Build. Grundriss-Import aus Magicplan-PDF-Reports.

## Schnell ausprobieren: Demo-Haus über HACS

Ohne eigene Daten und ohne Build auf deinem Rechner:

1. In Home Assistant **HACS → ⋮ → Benutzerdefinierte Repositories** → `https://github.com/zitroaen/3d-ha-dashboard`,
   Typ **Dashboard** → hinzufügen und **herunterladen**.
2. In der `configuration.yaml`:
```yaml
panel_custom:
  - name: ha-3d-dashboard
    url_path: haus-3d
    sidebar_title: Haus 3D
    sidebar_icon: mdi:home-floor-3
    module_url: /hacsfiles/3d-ha-dashboard/ha-3d-dashboard.js
    config:
      demo: true   # zum Ausprobieren; für das eigene Haus stattdessen data_url: /local/ha-3d-dashboard/
```
3. Home Assistant neu starten – in der Seitenleiste erscheint **Haus 3D** mit dem erfundenen Demo-Haus.

HACS legt die Datei nur als Dashboard-Ressource ab; das Seitenleisten-Panel entsteht erst durch `panel_custom`.
Im Demo-Modus schaltet Antippen nur lokal (die Demo-Leuchten gibt es in HA nicht), der Editor speichert nichts.
Sonne und Mond kommen weiter aus `sun.sun`. Fehlen die Daten unter `data_url`, zeigt das Panel ebenfalls das
Demo-Haus mit einem Hinweis. Für das eigene Haus siehe unten und [docs/SETUP.md](docs/SETUP.md).

## Mit Claude für das eigene Haus einrichten

Lege einen leeren Ordner für dein Haus an, öffne darin [Claude Code](https://claude.com/claude-code) und gib diesen
Prompt ein:

```text
Ich möchte das 3D-Dashboard https://github.com/zitroaen/3d-ha-dashboard für mein eigenes Haus in Home Assistant
einrichten. Arbeite in diesem leeren Ordner: Lege ihn als privates Git-Repo an, binde die Engine als Git-Submodul
unter engine/ ein (git submodule add https://github.com/zitroaen/3d-ha-dashboard.git engine) und folge dann
Schritt für Schritt engine/docs/SETUP.md. Frag mich nach allem, was du über mein Haus wissen musst (Grundriss,
Himmelsrichtung, Fotos, Lampen), und führe nichts auf meinem Home Assistant aus, ohne mich vorher zu fragen.
Meine Hausdaten bleiben in diesem privaten Ordner und gehen niemals in das öffentliche Engine-Repo.
```

Ohne Claude geht es genauso – siehe [docs/SETUP.md](docs/SETUP.md). Zum Ausprobieren ohne eigenen Grundriss:
`node engine/scripts/init-instance.mjs --demo`.

## Engine und Instanz

Dieses Repo ist die **Engine**: Code, Werkzeuge, Tests und ein erfundenes Demo-Haus (`examples/demo`). Die Daten
eines echten Hauses liegen in einer **privaten Instanz**, die die Engine als Submodul einbindet. So kann die Engine
öffentlich weiterentwickelt werden, ohne dass Daten eines Hauses im Internet landen
(`tests/privacy-guard.mjs` prüft das bei jedem Testlauf).

## Entwicklung

```bash
npm ci
npm run serve        # Vorschau mit Demo-Haus: http://127.0.0.1:8123/tests/harness.html
npm test             # Datenschutz-Check, Datenprüfung, Unit-Tests, Build, Screenshots, Bedien-Tests
```

Unter Linux/macOS einmalig `npx playwright-core install chromium` (Linux: `--with-deps`); Windows nutzt Edge.
Architektur und Regeln für Beiträge: [CLAUDE.md](CLAUDE.md). Datenformat: [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md).

## Lizenz

MIT
