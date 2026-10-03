# Änderungen

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
