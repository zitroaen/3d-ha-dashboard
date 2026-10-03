# Änderungen

## 0.6.0

- **Neues Datenmodell (Version 2):** Ein Dokument `model.yaml` ersetzt `house.json`, `furniture.yaml` und
  `devices.yaml`. Es beschreibt das Grundstück, mehrere Gebäude (Haus, Garage, Gartenhaus) mit Etagen und Ebenen,
  Außenbereiche (Terrasse, Einfahrt, Beete, „Gartenräume“) und alle Objekte in einer Liste. Jedes Objekt kann
  Entities tragen (Rollen `power`, `info`) und Aktionen für Tippen, Doppeltippen und langes Drücken festlegen.
  Spezifikation für Menschen und KI-Agenten: `docs/DATA_MODEL.md`, JSON-Schema: `schema/model.schema.json`.
- **Bitte umstellen:** Daten im alten Format werden nicht mehr geladen. Der Grundriss lässt sich mit
  `npm run import-plan` neu importieren (legt `model.yaml` an); Objekte nach `docs/DATA_MODEL.md` übertragen.
  Künftige Formatänderungen werden beim Laden automatisch migriert.
- **Ebenen:** Knöpfe unten links schalten zwischen den Stockwerken (UG, EG, 1. OG …); die Kamera richtet sich neu aus.
- Neue Bodenbeläge für außen und Nebengebäude: `concrete`, `paving`, `gravel`, `soil`, `wood`, `water`; neue
  Geräte-Modelle `box` und `marker`.
- Demo-Haus mit Obergeschoss, Garage, Terrasse, Einfahrt und Beet.

## 0.5.1

- **Filter „Steckdosen“** in der Entity-Auswahl: „Licht“ zeigt nur `light.*`, „Steckdosen“ nur `switch.*` (z. B. Lampen
  an schaltbaren Steckdosen). Ist eine Leuchte schon mit einer Steckdose verknüpft, öffnet die Auswahl mit diesem Filter.

## 0.5.0

- **Fertig speichert, Abbrechen verwirft:** Der Speichern-Knopf entfällt. „Fertig“ (und der Stift) speichert alle
  Änderungen und schließt den Editor; scheitert das Speichern, bleibt er mit Meldung offen. Neuer Knopf „Abbrechen“
  verwirft alle Änderungen seit dem Öffnen.
- Im Editor ist der Demo-Hinweis ausgeblendet (lag auf dem iPhone über der Lampenauswahl).

## 0.4.1

- **Demo-Haus speichern:** Der Editor speichert Änderungen am Demo-Haus (z. B. Verknüpfungen mit echten Lampen) in
  eigene HA-Benutzerdaten (`ha_3d_dashboard_layout_demo`) – getrennt von den Daten des eigenen Hauses, nie in Dateien.
- **Werkzeugleiste auf dem iPhone:** Knöpfe brechen in eine zweite Zeile um statt rechts abgeschnitten zu werden
  („Fertig“ war nicht erreichbar).

## 0.4.0

- **iPhone (HA-App, Hochformat):** Die Werkzeugleiste war unten abgeschnitten. Das Panel beginnt dort unter der
  Statusleiste, war aber bildschirmhoch. Es misst jetzt, wo es beginnt, und reicht genau bis zum unteren Rand; Leisten
  halten Abstand zum Home-Balken (`safe-area-inset-bottom`).
- **Leuchte lange drücken** öffnet den HA-Dialog der verknüpften Entity (Farbe, Helligkeit, Farbtemperatur, Verlauf).
- **Demo-Haus ohne Verknüpfungen:** Die erfundenen Demo-Entities sind entfernt. Leuchten schalten lokal; im Editor mit
  einer echten Lampe verknüpft, schalten sie über HA (im Demo-Modus nicht gespeichert).

- CI schneller: keine doppelten Läufe für Push + PR, veraltete Läufe werden abgebrochen, Doku-Änderungen lösen keine
  Tests aus, vorinstalliertes Chrome statt Chromium-Download, Python-Pakete mit uv und Cache.
- Neuer CI-Job WebKit (Safari/iOS): Panel lädt in der HA-Einbettung auf iPhone- und iPad-Größe (`npm run test:webkit`).
- Release automatisch, sobald die Tests auf main grün sind und die Version aus `package.json` noch kein Release hat;
  kein zweiter Testlauf mehr im Release.

## 0.3.1

- **Weiße Seite ab HA 2026.9 behoben:** Der Panel-Container hat dort keine Höhe mehr, das Panel war 0 px hoch. Es füllt
  jetzt mindestens den Bildschirm (`min-height: 100dvh`). Test: Harness mit `?ha=1` bettet das Panel wie HA 2026.9 ein.

## 0.3.0

- **Ohne YAML in die Seitenleiste:** Das Repo ist in HACS jetzt eine *Integration* (`custom_components/ha_3d_dashboard`).
  Nach dem Hinzufügen (Geräte & Dienste → Integration hinzufügen → 3D-HA-Dashboard) erscheint **Haus 3D** in der
  Seitenleiste; die Integration liefert das Bundle selbst aus. Titel, Symbol und Datenordner unter „Konfigurieren“.
  Voreingestellter Datenordner: `/local/ha-3d-dashboard/`, ohne Daten das Demo-Haus.
- **Umstieg von 0.2.0:** In HACS das Repository (Typ Dashboard) entfernen, den `panel_custom`-Eintrag löschen und als
  Integration neu hinzufügen.
- Release: `ha_3d_dashboard.zip` (für HACS) und weiterhin `ha-3d-dashboard.js` (für `panel_custom` von Hand).
- Tests: `tests/ha` (pytest mit Home Assistant), `tests/integration-check.mjs` (Versionen, HACS-Angaben, Übersetzungen).
- Tests: großzügiges Seiten-Timeout für langsames Software-WebGL auf CI-Runnern.

## 0.2.0

- **HACS:** Installation über HACS (Benutzerdefiniertes Repository, Typ *Dashboard*); `hacs.json`, Release-Workflow
  (`.github/workflows/release.yml`) hängt `ha-3d-dashboard.js` an das GitHub-Release.
- **Demo-Modus:** Das Demo-Haus steckt im Bundle. `panel_custom → config → demo: true` zeigt es ohne eigene Daten.
  Sind die Daten (neben dem Modul bzw. unter `data_url`) nicht erreichbar, zeigt das Panel automatisch das Demo-Haus
  mit Hinweis. Im Demo-Modus wird lokal geschaltet, Sonne/Mond kommen weiter aus `sun.sun`, der Editor speichert
  nichts (Speichern/Export ausgeblendet) – eigene Daten werden nie überschrieben.
- `data_url` ohne abschließenden Schrägstrich wird als Ordner behandelt.
- Tests: `tests/demo.mjs` (Demo-Modus und Fallback); `PW_EXECUTABLE` wählt den Browser für die Tests.

## 0.1.0

- Erste Version: 3D-Grundriss-Panel mit Licht, Himmel, Editor und Link-Check.
