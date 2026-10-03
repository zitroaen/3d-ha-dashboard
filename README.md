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
  angemeldete HA-Sitzung.
- **Ohne YAML:** HACS-Integration, die das Panel selbst in die Seitenleiste einträgt.
- **Licht:** Raum antippen schaltet alle Lichter des Raums, Leuchte antippen nur diese. Farbe und Helligkeit kommen
  aus HA. Das Licht wirkt nur im eigenen Raum (kein Durchscheinen durch Wände) und ist mobil-tauglich.
- **Himmel:** Sonne mit Schatten nach `sun.sun`, nachts Mond; Kompass mit Einnorden.
- **Touch:** für Wand-Tablets und Touchscreens gebaut (große Bedienelemente, Gesten).
- **Editor:** Möbel/Leuchten antippen, mit Koordinatensystem verschieben und drehen, an Wände anlegen,
  mit HA-Entities verknüpfen (Liste aller Entities, vorgefiltert nach HA-Bereich), speichern.
- **Link-Check:** zeigt verknüpfte und fehlende Entities.
- **Daten statt Code:** Haus (`house.json`), Möbel (`furniture.yaml`) und Geräte (`devices.yaml`) werden zur
  Laufzeit geladen – Änderungen brauchen keinen Build. Grundriss-Import aus Magicplan-PDF-Reports.

## Über HACS installieren und ausprobieren

Ohne Build, ohne YAML und ohne eigene Hausdaten – das Panel bringt das erfundene Demo-Haus mit:

1. In Home Assistant: **HACS → ⋮ → Benutzerdefinierte Repositories** → `https://github.com/zitroaen/3d-ha-dashboard`,
   Typ **Integration** → hinzufügen, dann **3D-HA-Dashboard** öffnen und **herunterladen**.
2. Home Assistant neu starten (HACS bietet das unter **Einstellungen → Reparaturen** an).
3. **Einstellungen → Geräte & Dienste → Integration hinzufügen → 3D-HA-Dashboard → OK** – oder direkt:
   [![Integration hinzufügen](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=ha_3d_dashboard)

In der Seitenleiste erscheint **Haus 3D**. Ohne eigene Daten zeigt es das Demo-Haus: Raum oder Leuchte antippen
schaltet **lokal** (die Demo-Entities gibt es in deiner HA nicht), Sonne und Mond folgen `sun.sun`, der Editor
funktioniert, speichert aber nichts.

**Eigenes Haus:** `house.json`, `furniture.yaml`, `devices.yaml` und `textures/` nach `/config/www/ha-3d-dashboard/`
legen – das Panel findet sie dort automatisch (Seite neu laden). Titel, Symbol und Datenordner lassen sich unter
**Einstellungen → Geräte & Dienste → 3D-HA-Dashboard → Konfigurieren** ändern. Wie die Daten entstehen:
[docs/SETUP.md](docs/SETUP.md).

> **Umstieg von 0.2.0:** Bis 0.2.0 war das Repo in HACS ein *Dashboard* mit `panel_custom`-Eintrag. Dort das
> Repository entfernen, den `panel_custom`-Eintrag aus der `configuration.yaml` löschen und wie oben als
> *Integration* neu hinzufügen.

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
