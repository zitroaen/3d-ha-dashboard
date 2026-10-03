# Einrichtung für das eigene Haus

Diese Anleitung ist so geschrieben, dass ein Coding-Agent (z. B. Claude Code) sie Schritt für Schritt abarbeiten kann –
Menschen können ihr genauso folgen. **Agent: Frag den Besitzer nach allem, was du über das Haus nicht sicher weißt,
und führe auf seinem Home Assistant nichts aus, ohne ausdrücklich zu fragen.**

## Prinzip: Engine und Instanz

- **Engine** (dieses Repo, öffentlich): Code, Werkzeuge, Demo-Haus. Enthält keine Daten eines echten Hauses.
- **Instanz** (ein eigener, privater Ordner/Repo pro Haus): Grundriss, Möbel, Geräte, Fotos, Konfiguration. Die Engine
  hängt darin als Git-Submodul unter `engine/`.

So bleiben alle Daten des Hauses privat, und Engine-Updates kommen per `npm run update-engine`.

## 0. Voraussetzungen

- git, Node.js ≥ 20
- Für den Grundriss-Import aus Magicplan: Python 3 und `pip install pymupdf`
- Für die Screenshot-Tests: Windows nutzt den vorhandenen Edge. Linux/macOS einmalig
  `npx --prefix engine playwright-core install chromium` (Linux ggf. mit `--with-deps`).
- Home Assistant mit Zugriff auf den Ordner `/config/www` (SSH-Add-on, Samba oder File-Editor)

## 1. Instanz anlegen

Im leeren Ordner für das Haus:

```bash
git init
git submodule add https://github.com/zitroaen/3d-ha-dashboard.git engine
node engine/scripts/init-instance.mjs --name "Mein Haus"        # mit --demo: erst mal das Demo-Haus
npm run setup
```

`init-instance` legt `CLAUDE.md` (Arbeitsregeln für den Agenten in dieser Instanz), `package.json`, `ha3d.config.json`,
`plan.json`, `views.json`, `.gitignore`, `data/` und `reference/photos/` an. Das Repo der Instanz bleibt **privat**
(lokal oder als privates Repo).

## 2. Grundriss

**A) Magicplan-PDF-Report (deutschsprachig):** nach `reference/plan.pdf` legen, dann

```bash
npm run import-plan     # -> data/house.json (überschreibt!) + data/plan_debug_<etage>.svg
```

Etagen, Räume, Wände, Fenster, Türen, Maßstab und Deckenhöhen werden automatisch erkannt. In `plan.json` lässt sich
nachsteuern: Raum-IDs (`room_ids`), Bodenbeläge (`floor_material`), Räume mit massiver Haustür (`front_door_rooms`),
Etagen-ID, -Höhe und -Versatz (`floors`). Danach die Debug-Grafik ansehen und mit dem Besitzer abgleichen.
Mehrere Räume gleichen Namens werden durchnummeriert (`schlafzimmer_2`) – nach richtigen Namen fragen.

**B) Ohne Magicplan:** `house.json` nach `docs/DATA_FORMAT.md` erstellen, am einfachsten per Skript nach dem Vorbild
`engine/examples/demo/build-house.mjs` (Räume als Rechtecke, Wände mit ausgesparten Öffnungen).

**Nordrichtung:** Besitzer fragen, welcher Raum in welche Himmelsrichtung liegt (oder Luftbild), und `north_deg` in
`house.json` setzen (Norden im Plan, Grad im Uhrzeigersinn von oben). Beispiel: Wohnzimmer links im Plan liegt im
Süden → Norden zeigt nach rechts → 90.

Prüfen: `npm run validate`, dann `npm run serve` und http://127.0.0.1:8123/tests/harness.html öffnen.

## 3. Leuchten und HA-Verknüpfung

1. `npm run placeholders` legt pro Raum eine Platzhalter-Deckenleuchte und Außenleuchten an Außentüren an.
2. Mit dem Besitzer klären, welche Leuchten es wirklich gibt (Fotos helfen), und `data/devices.yaml` anpassen
   (Modelle und Felder: `docs/DATA_FORMAT.md`).
3. Optional den HA-Export (Template in `docs/DATA_FORMAT.md`) als `reference/entities.txt` speichern – dann prüft
   `npm test` alle Verknüpfungen, und die Vorschau simuliert HA mit den echten Entities.
4. Verknüpfen im Panel: Stift → Leuchte antippen → **Verknüpfen** → Entity wählen → **Speichern**. In der lokalen
   Vorschau schreibt das direkt nach `data/devices.yaml`.

## 4. Möbel

Fotos pro Raum nach `reference/photos/<raum>/` (gitignored). Daraus die Möbel in `data/furniture.yaml` anlegen –
Modelle und Parameter in `docs/DATA_FORMAT.md`. Feinjustieren geht im Panel: Stift → Möbel antippen → verschieben,
drehen, **Anlegen** an Wand oder Boden → **Speichern**. Bilder an der Wand können eine Textur bekommen
(`data/textures/`, Feld `texture`). Fehlt ein Modell, ein generisches Modell in der Engine vorschlagen (Issue/PR),
nicht in `engine/` der Instanz ändern.

`npm test` erzeugt Screenshots in `tests/output/`; eigene Ansichten (z. B. Zoom auf einen Raum) in `views.json`.

## 5. In Home Assistant installieren

**Variante HACS** (Engine über HACS, nur die Daten des Hauses liegen selbst in HA):

1. HACS → ⋮ → Benutzerdefinierte Repositories → `https://github.com/zitroaen/3d-ha-dashboard`, Typ **Dashboard** →
   herunterladen. HACS legt nur `ha-3d-dashboard.js` unter `/hacsfiles/3d-ha-dashboard/` ab und registriert es als
   Ressource – das Seitenleisten-Panel entsteht erst durch `panel_custom`.
2. Zum **Ausprobieren** mit dem eingebauten Demo-Haus (kein Build, keine eigenen Daten):
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
3. Für das **eigene Haus**: `demo: true` durch `data_url: /local/ha-3d-dashboard/` ersetzen und `house.json`,
   `furniture.yaml`, `devices.yaml`, `textures/*` nach `/config/www/ha-3d-dashboard/` kopieren (`npm run deploy:data`
   bzw. von Hand; `engine/dist/` und das Bundle brauchst du dann nicht). `data_url` ist ein Ordner (absolut oder
   relativ zur Panel-Seite; ein fehlender abschließender `/` wird ergänzt).
4. Home Assistant neu starten. Nach einem Update über HACS ggf. `?v=2` an `module_url` hängen oder den Browser-Cache
   leeren (`panel_custom` kennt den HACS-Versionsparameter nicht).

Der **Demo-Modus** schaltet Raum/Leuchte lokal (die Demo-Entities existieren in HA nicht), Sonne/Mond kommen aus
`sun.sun`, der Editor speichert nichts. Sind die Daten nicht erreichbar (404), fällt das Panel automatisch auf das
Demo-Haus mit Hinweis zurück – kaputte eigene Daten zeigen dagegen weiter eine Fehlermeldung und werden nie durch das
Demo-Haus ersetzt.

**Variante Selbst bauen (Instanz mit Submodul):**

1. Bauen und Dateien nach `/config/www/ha-3d-dashboard/` bringen:
   - per SSH: in `ha3d.config.json` unter `ha.ssh` z. B. `root@homeassistant.local` eintragen, dann `npm run deploy`
     (nur Daten: `npm run deploy:data`);
   - oder von Hand: `engine/dist/ha-3d-dashboard.js` (nach `npm run build`), `data/house.json`,
     `data/furniture.yaml`, `data/devices.yaml` und `data/textures/*` in diesen Ordner kopieren.
2. In der `configuration.yaml`:
   ```yaml
   panel_custom:
     - name: ha-3d-dashboard
       url_path: haus-3d
       sidebar_title: Haus 3D
       sidebar_icon: mdi:home-floor-3
       module_url: /local/ha-3d-dashboard/ha-3d-dashboard.js?v=1
   ```
3. Home Assistant neu starten. Nach jedem Code-Update `?v=` erhöhen (Browser-Cache); Daten-Updates brauchen das
   nicht, das Panel lädt sie beim Öffnen neu.

**Datenschutz:** Was unter `/config/www` liegt, liefert HA unter `/local/` **ohne Anmeldung** aus. Grundriss und
Geräteliste sind damit für jeden lesbar, der die HA-Adresse erreicht. Für reine Heimnetz-Installationen meist
unkritisch – bei Fernzugriff abwägen.

**Speichern im Panel:** In HA kann das Panel keine Dateien schreiben. Änderungen aus dem Editor landen in den
HA-Benutzerdaten (pro Benutzer) und werden über die Dateien gelegt; **Export** im Editor liefert die fertigen YAML-
Dateien für die Instanz.

## 6. Pflege

- Engine aktualisieren: `npm run update-engine`, dann `npm test`, dann deployen.
- Verbesserungen an der Engine: als Issue/PR im Engine-Repo, generisch und **ohne** Daten des Hauses.
