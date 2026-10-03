# {{HAUS}} – 3D-Dashboard-Instanz

Dieser Ordner ist die **private Instanz** des 3D-Dashboards für ein bestimmtes Haus. Hier liegen ausschließlich die
Daten dieses Hauses. Der Code liegt im Git-Submodul `engine/` (öffentliches Repo
https://github.com/zitroaen/3d-ha-dashboard).

## Regeln

- **Nur Hausdaten pflegen.** Hier bearbeitest du `data/`, `reference/`, `views.json`, `plan.json`,
  `ha3d.config.json` und diese Datei – sonst nichts.
- **`engine/` nicht verändern.** Fehler oder fehlende Funktionen (z. B. ein neues Möbelmodell) gehören als Issue oder
  Pull Request ins Engine-Repo, generisch und ohne Daten dieses Hauses. Lokal holst du Engine-Updates mit
  `npm run update-engine`.
- **Datenschutz.** Dieses Repo bleibt privat. Nichts aus `data/`, `reference/` oder `Fotos/` darf ins Engine-Repo,
  auch keine Namen, Entity-IDs oder Koordinaten in Issues/PRs. Fotos bleiben gitignored (`reference/photos/`).
- **Kein Zugriff auf Home Assistant ohne Freigabe.** Deploys nur mit `npm run deploy` / `npm run deploy:data` und nur,
  wenn der Besitzer es ausdrücklich sagt.
- **Schau dir Screenshots an** (`tests/output/`), bevor du eine Änderung als fertig meldest.

## Befehle (aus diesem Ordner)

| Befehl | Zweck |
|---|---|
| `npm run setup` | Engine-Submodul holen und ihre Abhängigkeiten installieren |
| `npm run serve` | Vorschau: http://127.0.0.1:8123/tests/harness.html (Editor speichert direkt nach `data/`) |
| `npm test` | Datenprüfung, Link-Check gegen `reference/entities.txt`, Build, Screenshots (inkl. `views.json`) |
| `npm run import-plan` | Grundriss aus `reference/plan.pdf` (Magicplan) nach `data/house.json` – **überschreibt** die Datei |
| `npm run placeholders` | fehlende Platzhalter-Leuchten in `data/devices.yaml` ergänzen |
| `npm run deploy` / `deploy:data` | nach Home Assistant kopieren (nur mit Freigabe) |
| `npm run update-engine` | neueste Engine holen, danach `npm test` |

Datenformat, Modelle und Felder: `engine/docs/DATA_FORMAT.md`. Einrichtung Schritt für Schritt: `engine/docs/SETUP.md`.

## Haus

(Hier hält Claude fest, was über das Haus bekannt ist: Etagen, Deckenhöhen, Nordrichtung, Besonderheiten,
offene Fragen an den Besitzer.)

## Entscheidungslog

(Entscheidungen mit Datum.)
