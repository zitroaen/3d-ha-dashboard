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
npm run import-plan     # -> reference/building.json + data/plan_debug_<etage>.svg, dann als Gebäude in data/model.yaml
```

Etagen, Räume, Wände, Fenster, Türen, Maßstab und Deckenhöhen werden automatisch erkannt. Der Import **ersetzt** das
Gebäude gleicher ID in `data/model.yaml`; andere Gebäude, Außenbereiche und Objekte bleiben. In `plan.json` lässt sich
nachsteuern: Gebäude-ID, -Name und -Art (`building`), Raum-IDs (`room_ids`), Bodenbeläge (`surface`), Räume mit
massiver Haustür (`front_door_rooms`), Etagen-ID, -Ebene, -Höhe, -Drehung und -Versatz (`floors`). Magicplan legt
jede Etage mit eigenem Ursprung und eigener Ausrichtung ab: `floors.<Name>.rotate` (90/180/270, im Uhrzeigersinn) dreht
sie vor dem `offset`. Raum-IDs je Etage: `floors.<Name>.room_ids`; doppelte IDs bekommen automatisch das Etagenkürzel
(`og_bad`). `floors.<Name>.split: [{ room, line: [[x, y], [x, y]], surface }]` teilt einen Raum an einer Linie in zwei
Böden (die Seite links der Linie, wie in der Debug-Grafik gesehen, wird eine Belag-Zone). Weitere Gebäude (Garage,
Gartenhaus) als eigene PDFs mit eigener `building.id` importieren oder von Hand ergänzen. Danach die Debug-Grafik ansehen und mit dem Besitzer abgleichen.
Mehrere Räume gleichen Namens werden durchnummeriert (`schlafzimmer_2`) – nach richtigen Namen fragen.

**B) Ohne Magicplan:** Gebäude in `data/model.yaml` nach `docs/DATA_MODEL.md` beschreiben, am einfachsten per Skript nach
dem Vorbild `engine/examples/demo/build-house.mjs` (Räume als Rechtecke, Wände mit ausgesparten Öffnungen). Das Kapitel
„Anleitung für Agenten“ dort beschreibt die Reihenfolge.

**Außenbereiche** (Terrasse, Einfahrt, Beete, „Gartenräume“) stehen unter `outdoor` in `data/model.yaml`.

**Gelände am Hang:** Grundstück mit dem iPhone (LiDAR) scannen, z. B. mit Scaniverse, Polycam oder 3D Scanner App, als
OBJ exportieren (nicht ins Repo legen – das ist ein Foto des Grundstücks) und einpassen:

```bash
node engine/scripts/terrain-from-scan.mjs ~/scan.obj --cell 0.5 --rotate 12 --offset 3.2,-1.5 --floor 0.84 --write
```

`--floor` ist die Höhe des EG-Fußbodens im Scan, Drehung und Versatz legen den Scan auf den Grundriss (zwei
Hausecken als Passpunkte). Danach Rasen, Wege und Beete mit `follow: terrain` auf das Gelände legen; ebene Terrassen und
Mauern bekommen ihre Höhe über `elevation` und Kanten zum Hang automatisch.

**Nordrichtung:** Besitzer fragen, welcher Raum in welche Himmelsrichtung liegt (oder Luftbild), und `site.north_deg`
in `data/model.yaml` setzen (Norden im Plan, Grad im Uhrzeigersinn von oben). Beispiel: Wohnzimmer links im Plan liegt im
Süden → Norden zeigt nach rechts → 90.

Prüfen: `npm run validate`, dann `npm run serve` und http://127.0.0.1:8123/tests/harness.html öffnen.

## 3. Leuchten und HA-Verknüpfung

1. `npm run placeholders` legt pro Raum eine Platzhalter-Deckenleuchte und Außenleuchten an Außentüren an.
2. Mit dem Besitzer klären, welche Leuchten es wirklich gibt (Fotos helfen), und die Objekte in
   `data/model.yaml` anpassen (Katalog und Felder: `docs/DATA_MODEL.md`).
3. Optional den HA-Export (Template in `docs/DATA_MODEL.md`) als `reference/entities.txt` speichern – dann prüft
   `npm test` alle Verknüpfungen, und die Vorschau simuliert HA mit den echten Entities.
4. Verknüpfen im Panel: Zahnrad → **Bearbeiten** → Objekt antippen → **Verknüpfen** öffnet seine Einstellungen: unter **Schalten** bzw.
   **Anzeigen** „+ Entity“ → Entity wählen; darunter, was Antippen, Doppeltippen und langes Drücken tun und ob der
   Zustand über dem Objekt erscheint → **Fertig** (speichert; **Abbrechen** verwirft). In der lokalen Vorschau schreibt
   das direkt nach `data/model.yaml`.
5. Geräte, die keine Leuchten sind (Waschmaschine, Kamin, PV-Wechselrichter, Saugroboter), als Objekt anlegen –
   als Möbelmodell oder als neutrale Box/Markierung (`box`, `marker`) – und genauso verknüpfen.

## 4. Möbel

Fotos pro Raum nach `reference/photos/<raum>/` (gitignored). Daraus die Möbel als Objekte in `data/model.yaml`
anlegen – Katalog und Parameter in `docs/DATA_MODEL.md`. Ein Agent setzt Objekte direkt in die Welt (`model`,
`space`, `pos`); der Besitzer ergänzt oder entfernt später im Panel: Zahnrad → Bearbeiten → **Katalog** (hinzufügen,
Lager) bzw. Objekt antippen → **Entfernen** (einlagern oder löschen). Feinjustieren geht im Panel: Zahnrad → Bearbeiten → Möbel antippen → verschieben,
drehen, **Anlegen** an Wand oder Boden → **Fertig**. Bilder an der Wand können eine Textur bekommen
(`data/textures/`, Feld `texture`). Fehlt ein Modell, ein generisches Modell in der Engine vorschlagen (Issue/PR),
nicht in `engine/` der Instanz ändern.

`npm test` erzeugt Screenshots in `tests/output/`; eigene Ansichten (z. B. Zoom auf einen Raum) in `views.json`.

## 5. In Home Assistant installieren

**Variante HACS** (empfohlen; Engine über HACS, nur die Daten des Hauses liegen selbst in HA, kein YAML):

1. HACS → ⋮ → Benutzerdefinierte Repositories → `https://github.com/zitroaen/3d-ha-dashboard`, Typ **Integration** →
   **3D-HA-Dashboard** herunterladen → Home Assistant neu starten.
2. Einstellungen → Geräte & Dienste → **Integration hinzufügen** → **3D-HA-Dashboard** → OK. Das Panel **Haus 3D**
   erscheint in der Seitenleiste (Adresse `/haus-3d`).
3. Daten des Hauses nach `/config/www/ha-3d-dashboard/` kopieren: `model.yaml` und
   `textures/*` (`npm run deploy:data` bzw. von Hand). Das ist der voreingestellte Datenordner
   (`/local/ha-3d-dashboard/`); ein anderer lässt sich unter Geräte & Dienste → 3D-HA-Dashboard → **Konfigurieren**
   einstellen, ebenso Titel und Symbol in der Seitenleiste.
4. Updates kommen über HACS (danach HA **neu starten**); die Integration hängt ihre Version an die Bundle-Adresse, der
   Browser lädt das neue Bundle also von selbst – aber erst nach dem Neustart. Welche Version das Panel wirklich
   ausführt und woher das Modell kommt (Demo-Haus, gespeichertes Modell oder `model.yaml`), steht im
   Zahnrad-Menü unter „Info“. Zeigt die iOS-App danach noch den alten Stand: in der App unter
   Einstellungen → Companion App → Fehlerbehebung den Frontend-Cache zurücksetzen.

**Gemeinsames Modell (nur mit der Integration):** Das Dashboard ist für alle Benutzer gleich. **Fertig** im Editor
speichert das ganze Modell in der Integration (`/config/.storage/ha_3d_dashboard.model`, Teil jedes HA-Backups); alle
offenen Panels übernehmen es sofort. Bearbeiten dürfen nur Administratoren, alle anderen sehen im Zahnrad-Menü kein „Bearbeiten“.
- **Import:** eine neue `model.yaml` in den Datenordner legen und das Panel neu öffnen. Eine Datei, die sich seit dem
  letzten Speichern geändert hat (oder neu ist), **ersetzt** das gespeicherte Modell – vorher exportieren, wenn im
  Editor Änderungen gemacht wurden, die erhalten bleiben sollen.
- **Export:** Zahnrad → Bearbeiten → **Export** lädt das aktuelle Modell als `model.yaml` herunter (z. B. für `data/` der Instanz).
- Nach dem ersten Speichern braucht das Panel die Datei nicht mehr: Wer den Grundriss nicht unter `/local/` (ohne
  Anmeldung, siehe unten) liegen lassen möchte, kann `model.yaml` dann aus dem Datenordner löschen; nur `textures/`
  bleibt dort.
- Ein Konflikt (zwei Administratoren speichern gleichzeitig) wird erkannt: Das zweite Speichern scheitert mit
  Meldung, der Editor bleibt offen – **Abbrechen** lädt den neuen Stand.

Solange im Datenordner nichts liegt, zeigt das Panel das eingebaute **Demo-Haus** mit Hinweis: Seine Leuchten sind
unverknüpft und schalten lokal; im Editor mit einer echten Lampe verknüpfte schalten über HA. Sonne/Mond kommen aus
`sun.sun`. **Fertig** speichert Änderungen am Demo-Haus in eigene HA-Benutzerdaten (`ha_3d_dashboard_layout_demo`), nie in
die des eigenen Hauses.
Kaputte eigene Daten zeigen dagegen eine Fehlermeldung und werden nie durch das Demo-Haus ersetzt.

**Variante Selbst bauen (Instanz mit Submodul, mit `panel_custom` in der YAML):**

1. Bauen und Dateien nach `/config/www/ha-3d-dashboard/` bringen:
   - per SSH: in `ha3d.config.json` unter `ha.ssh` z. B. `root@homeassistant.local` eintragen, dann `npm run deploy`
     (nur Daten: `npm run deploy:data`);
   - oder von Hand: `engine/dist/ha-3d-dashboard.js` (nach `npm run build`), `data/model.yaml`
     und `data/textures/*` in diesen Ordner kopieren.
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

**Speichern im Panel:** **Fertig** speichert, **Abbrechen** verwirft alle Änderungen seit dem Öffnen des Editors.
Mit der Integration (Variante HACS) speichert das Panel gemeinsam für alle (siehe oben). Ohne Integration
(`panel_custom` von Hand) kann es nichts Gemeinsames schreiben: Änderungen landen in den HA-Benutzerdaten (pro
Benutzer) und werden über die Datei gelegt; **Export** im Editor liefert das fertige `model.yaml` für die Instanz.

## 6. Pflege

- Engine aktualisieren: `npm run update-engine`, dann `npm test`, dann deployen.
- Verbesserungen an der Engine: als Issue/PR im Engine-Repo, generisch und **ohne** Daten des Hauses.
