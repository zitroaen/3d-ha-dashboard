# Änderungen

## 0.30.0

- **Zustandsanzeige wählbar:** Je Objekt lässt sich im Editor festlegen, welche verknüpften Werte über dem Objekt
  stehen (Haken je Entity) und unter welcher Bedingung (Zustand ist / ist nicht, Wert größer / kleiner als) – z. B. den
  Saugroboter antippen und starten, ohne dass ständig sein Zustand angezeigt wird, oder die Temperatur nur über 25 °C.
- **Mini-Medienplayer:** Über einem Lautsprecher mit `media_player` (z. B. Sonos) erscheint, solange Musik spielt, ein
  kleiner Player mit Titel, Interpret und Zurück / Pause / Weiter; Antippen des Titels öffnet den HA-Dialog.
- Demo-Haus: Lautsprecher im Wohnzimmer, Saugroboter zeigt seinen Zustand nur unterwegs.

## 0.29.0

- **Screenshot-Ansichten:** `views.json` kennt `view.tilt` (Neigung der Kamera über dem Horizont, z. B. 25° für eine
  flache Schrägansicht von Haus und Hang); `view.at` ist optional. Neue eingebaute Ansicht `schraeg`.
- Bedien-Test der Standardansicht robuster (wartet, bis die Kamera steht, bevor der Inaktivitäts-Zeitgeber startet;
  gab auf langsamer CI-Grafik gelegentlich einen Fehlalarm).

## 0.28.0

- **Garten-Katalog:** Schaukel (`swing`), Rutsche (`slide`), Spielturm mit Rutsche (`climbing_frame`), Trampolin mit
  Netz (`trampoline`), Sandkasten (`sandbox`), Hochbeet aus Holz (`raised_bed`), Komposter (`compost`), Zaun
  (`fence`: Lattenzaun, Maschendraht, Stabgitter – entlang einer Linie oder eines Pfads) und Freileitung
  (`power_line`: Holzmasten mit durchhängenden Seilen). Zaun und Freileitung folgen dem Gelände; alle mit
  Katalog-Vorschau. Möglichst vorhandene Materialien (Leistungsbudget).
- Demo-Haus: Spielwiese östlich der Garage, Lattenzaun, Freileitung am Feldweg.
- Standardansicht: Die Kamerafahrt kommt auch an, wenn der Browser keine Bilder rechnet (verdeckter Tab, dunkles
  Wand-Tablet) – vorher blieb die Kamera dann am Start stehen.

## 0.27.0

- **Mehr Bereiche:** Die Lichttabelle wächst mit dem Haus (Spalten = Bereiche bzw. Leuchten, in 64er-Schritten, bis
  4096) – vorher endete das Raumlicht bei 128 Bereichen (Räume + Dächer + Außenbereiche), danach überschrieben sich
  die Einträge. `npm run validate` meldet verständlich, wenn eine Grenze erreicht ist (auch mehr als 12 Leuchten in
  einem Bereich).

## 0.26.0

- **Fenster unter Steildächern:** Fenster in Wänden, die unter der Dachfläche enden (Kniestock), ragen nicht mehr
  über das Dach – sie werden auf die verbleibende Wandhöhe gekürzt oder, wenn kaum Platz bleibt, weggelassen; unter
  einer Gaube übernimmt deren Fenster. `npm run validate` warnt („Fenster liegt über der Dachfläche – Gaube
  anlegen?“).
- **Wände ohne Dach:** `npm run validate` meldet Wände der obersten Etage, über denen kein Dachteil liegt, mit Lage.

## 0.25.0

- **Einpassung an amtliche Gebäudedaten:** `scripts/fit-footprint.mjs` dreht und verschiebt den Grundriss (Wände und
  Räume aller Etagen), bis er auf dem Umriss aus CityGML-LoD2 liegt – Ergebnis Nordrichtung und Plan-Ursprung in
  Landeskoordinaten (`site.georef`), Güte als Überdeckung (IoU); gleichwertige Lösungen werden genannt.
- **Dach aus LoD2:** `scripts/roof-from-lod2.mjs` schlägt Dachteile vor (Satteldach, Walm, Krüppelwalm, Pultdach,
  flache Teile – mit Neigung, First, Traufhöhe und Umriss im Plan), als Text zum Übernehmen.
- **Magicplan-Import:** `stretch` (Messfehler ab einer Linie ausgleichen), `merge` (Räume samt Wand dazwischen
  zusammenlegen), `clip` (Etage auf ein Polygon beschneiden und mit Wänden schließen), `split` mit `into` (eigener
  Raum) und `wall` (Raumteiler-Wand), `room_ids` mit Name und HA-Bereich.
- **Quellenangaben:** `site.attribution` erscheint im Info-Menü (Namensnennung für Geodaten).

## 0.24.0

- **Bäume und Sträucher als Instanzen:** je Form ein `InstancedMesh` – Hunderte Pflanzen mit wenigen
  Zeichenaufrufen. Detailstufen nach Bildschirmgröße (nah: Krone aus mehreren unregelmäßigen, verrauschten Teilen;
  fern: eine Low-Poly-Form); Drehung, Proportionen und Laubton variieren je Pflanze aus ihrer Position. Ein Laubbaum
  kostet nah ~260 statt ~1000 Dreiecke, fern ~90. Das Leistungsbudget prüft jetzt auch 200 Bäume.
- **Neue Formen:** Obstbaum (`shape: fruit`, niedrig und breit), überarbeitete Laub-, Nadel-, Säulenbäume und
  Birken (Stamm mit scharfen Ringen); **Hecke** (`hedge`) entlang einer Linie oder eines Pfads, folgt dem Gelände.
- **Werkzeug `scripts/trees-from-ndom.mjs`:** Bäume aus einem nDOM (Höhe über Gelände) – Wipfel, Kronendurchmesser,
  Gebäude ausgespart – als Objekte ins Modell.
- Kontaktschatten unter Objekten am Hang folgen dem Gelände (vorher schnitten sie gerade Kanten hinein).

## 0.23.0

- **Luftbild auf dem Gelände:** `site.terrain.texture` legt ein Bild (z. B. ein Orthophoto) auf den Boden und alle
  Flächen mit dem Boden-Belag; Lage über `origin`/`size`/`rot` oder eine World-Datei-Matrix (`affine`), ohne Angabe
  genau über dem Höhenraster. `strength` mischt mit dem Rasen, `exclude` spart Flächen aus; am Bildrand weicher
  Übergang. Höchstens 4096 Pixel je Seite, kein zusätzlicher Zeichenaufruf.
- **Hangschattierung:** Mulden, Böschungsfüße und steile Flächen werden einmalig berechnet etwas abgedunkelt
  (`site.terrain.shading`, 0 = aus) – Hänge bleiben auch bei hoher Sonne lesbar.
- **Geodaten-Werkzeuge:** `scripts/terrain-from-geotiff.mjs` (DGM als GeoTIFF oder XYZ -> `site.terrain`) und
  `scripts/orthophoto-crop.mjs` (Orthophoto zuschneiden und in Plan-Ausrichtung drehen); Einpassung über
  `site.georef` (Plan-Ursprung in Landeskoordinaten, Nordrichtung, Höhe des EG-Fußbodens). Ohne zusätzliche Pakete.
- Demo-Haus mit erfundenem Luftbild (SVG).

## 0.22.0

- **Standardansicht:** Einstellungen → „Aktuelle Ansicht als Standard“ merkt sich Ebene, Blickwinkel und Zoom (je
  Gerät). **Doppeltippen auf den Kompass** fährt dorthin zurück (einfaches Tippen nordet weiter ein); ohne
  festgelegte Ansicht gilt die Startansicht.
- **Nach Inaktivität zurück:** Aus, 30 s, 1, 2 oder 5 min ohne Berührung – dann fährt die Kamera in die
  Standardansicht (nicht im Editor und nicht bei offenen Fenstern), z. B. für Wand-Tablets.

## 0.21.0

- **Magicplan-Import:** Etagen drehen (`floors.<Name>.rotate`: 90/180/270, vor dem Versatz) – Magicplan legt jede
  Etage mit eigenem Ursprung und eigener Ausrichtung ab. Raum-IDs je Etage (`floors.<Name>.room_ids`); kommt eine ID
  schon in einer anderen Etage vor, bekommt sie automatisch das Etagenkürzel (`og_bad`), statt dass die Prüfung
  scheitert. `floors.<Name>.split` teilt einen Raum an einer Linie in zwei Böden (Belag-Zone). Die Debug-Grafik zeigt
  die Zonen.

## 0.20.0

- **Neue Möbel und Geräte:** Esstisch (Holz- oder Metallbeine), Schrank/Vitrine (modern weiß oder antik mit Füßen,
  geschwungener Front und Aufsatz, auf Wunsch mit Glastüren), Eckschrank mit gerundeter Front, Konsolentisch mit
  Fächern und Körben, Kühlschrank (auch Getränkekühlschrank mit Glastür), Saugroboter mit Absaugstation (fährt Runden,
  solange `vacuum.*` saugt, Schild „Saugt“/„Station“), Kindertisch mit Stühlchen, Hochstuhl, Wanduhr.
- **Neue Leuchten:** Kristallkronleuchter an der Kette, Pendelleuchte mit Stoffschirm (Farbe wählbar), Plissee-Säule
  auf drei Beinen, Papierlampe (Decke, Boden, Tisch).
- **Böden und Räume:** Polygonalplatten aus Naturstein (`flagstone`, innen und außen); Belag-Zonen
  (`rooms[].zones`) – zwei Böden in einem Raum; Deckenbalken (`rooms[].beams`, folgen der Dachschräge).
- `box`: `params.panel: false` (ohne Bedienblende), `elevation` stellt Geräte auf Möbel. Farben überall auch als
  `#rrggbb`.
- **Schneller:** Die Einrichtung aller Etagen einer Ebene wird je Material zusammengefasst (–13 Zeichenaufrufe je
  Ebene im Demo-Haus).
- **Demo-Haus:** Essplatz mit Natursteinboden, Kristallleuchter, Getränkekühlschrank, Konsole mit Kaffeemaschine,
  Wanduhr; Saugroboter und Kindertisch im Wohnzimmer; Plissee- und Pendelleuchte im Studio; Gartenhaus mit
  Deckenbalken, antiker Vitrine, Eckschrank und Papierlampe.

## 0.19.0

- **Fassaden:** `buildings[].facade` – Putz in beliebiger Farbe, Holzschalung (z. B. Schwedenrot mit weißen
  Eckbrettern), Ziegel oder Naturstein; optional ein Sockel (z. B. Naturstein), der auf der untersten Etage bis auf das
  Gelände reicht. Gilt für alle Außenwände samt Giebeln und Gauben.
- **Geländer und Brüstungen:** `railing` an Terrassen, Balkonen, Veranden und Dachterrassen – Balustrade mit weißen
  Docken, Metall oder Glas; Höhe und Kanten wählbar, am Hang folgt es dem Gelände.
- **Demo-Haus:** Putzfassade mit Natursteinsockel, Gartenhaus in Schwedenrot mit Veranda und Balustrade,
  Glasgeländer auf der Dachterrasse.

## 0.18.0

- **Gelände als Höhenraster:** `site.terrain` (Ursprung, Rasterweite, Höhen-Tabelle, Lücken erlaubt) – z. B. aus
  einem LiDAR-Scan. Sauber trianguliert mit weichen Normalen; außerhalb setzt der Boden das Raster fort.
- **Bereiche auf dem Gelände:** `follow: terrain` – Rasen, Wege, Beete am Hang brauchen nur ihr Polygon und liegen
  exakt auf dem Raster (kein Flackern, keine keilförmige Schattierung mehr).
- **Kanten zum tatsächlichen Gelände:** Terrassen, Mauern, Stufen und Hochbeete bekommen Kanten bis auf das, was
  daneben liegt – mit Raster auch hinauf zum höheren Hang (Stützmauer). Funktioniert auch, wenn das ganze Gelände
  unter dem EG-Fußboden liegt. Gebäudesockel reichen am Hang bis auf das Gelände.
- **Werkzeug** `scripts/terrain-from-scan.mjs`: OBJ-Scan (Scaniverse, Polycam, 3D Scanner App) einpassen (Drehung,
  Versatz, Fußbodenhöhe) und als `site.terrain` schreiben.
- Ohne Raster: weniger Flackern zwischen Boden und Gelände-Bereichen.
- **Demo-Haus:** Gelände als 1-m-Raster (Nordhang, Südhang, Wellen an den Rändern), Gärten folgen dem Raster.

## 0.17.0

- **Steildächer:** `buildings[].roof` kennt `type` = Satteldach (`gable`), Walmdach (`hip`), Krüppelwalm
  (`half_hip`) und Pultdach (`shed`) mit Neigung, Firstrichtung, Dachüberstand und Traufhöhe/Kniestock (`eaves`);
  Dachziegel (`roof_tiles`) in frei wählbarer Farbe.
- **Mehrere Dachteile** je Gebäude (Liste): Hauptdach + Anbau, ein Walmdach rund um eine Dachterrasse (`opening`,
  die Terrasse bleibt ein begehbarer Bereich mit Objekten), abgesetzte Pultdächer.
- **Gauben** (Schlepp-, Flach-, Satteldachgaube mit Fenster) und **Schornsteine**.
- **Dachgeschoss:** Wände der obersten Etage enden unter der Dachfläche – Kniestock, Giebel und Dachschrägen sind zu
  sehen; Deckenleuchten hängen an der Schräge.
- **Knopf „Dach“** über der obersten Ebene zeigt alle Gebäude mit ihren Dächern.
- **Schneller:** Bauwerk-Meshes gleicher Ebene und gleichen Materials werden zusammengefasst (weniger
  Zeichenaufrufe, z. B. 1. OG im Demo-Haus 131 statt 152).
- **Demo-Haus:** Krüppelwalmdach mit Gaube und Schornstein, Dachterrasse auf dem Anbau, neues Gartenhaus mit
  abgesetztem Pultdach.

## 0.16.1

- **Garagentor als Sektionaltor:** Das Torblatt aus Lamellen sitzt innen hinter der Öffnung und fährt in seitlichen
  Schienen hoch und unter die Decke (mit Deckenantrieb) statt aufzuschwenken. Anzahl der Lamellen: `params.sections`.

## 0.16.0

- **Vorschaubilder im Katalog:** Jedes Modell erscheint mit einem kleinen Bild (einmal gerechnet, dann
  zwischengespeichert).
- **Dächer:** Gebäude ohne Obergeschoss zeigen ihr Flachdach, sobald eine höhere Ebene gewählt ist – z. B. die
  Garage, wenn das 1. OG des Hauses gezeigt wird. Das Dach ist ein eigener Bereich, auf dem Objekte stehen können.
- **Garagentor** mit Funktion: Antippen öffnet bzw. schließt (`cover`), das Tor schwenkt sichtbar auf und zu; die
  Anzeige zeigt Offen / Zu / Öffnet / Schließt.
- **Balkonkraftwerk:** zwei Solarmodule flach auf dem Dach; solange es Strom erzeugt, fließen Lichtpunkte durchs
  Kabel – je mehr Leistung, desto schneller. Im Demo-Haus auf dem Garagendach.

## 0.15.0

- **Katalog im Editor:** Zahnrad → Bearbeiten → **Katalog** listet alle Modelle (Möbel, Leuchten, Geräte,
  Pflanzen; Suche). Antippen setzt das Objekt in die Mitte der Ansicht – danach verschieben und verknüpfen.
- **Einlagern statt Löschen:** **Entfernen** fragt: **Einlagern** nimmt das Objekt aus der Welt, behält aber Lage und
  Verknüpfungen (z. B. Weihnachtsdekoration); im Katalog unter **Lager** lässt es sich wieder aufstellen. **Löschen**
  entfernt es ganz. Beides lässt sich rückgängig machen und wird mit **Fertig** gespeichert.
- **Animationen:** Modelle können sich bewegen, solange ihr Gerät an ist – neu: **Deckenventilator** und
  **Standventilator** (Tempo aus der Lüfterstufe). Ohne Entity lässt sich im Editor ein fester Zustand einstellen
  („Läuft immer“). Im Demo-Haus dreht sich ein Deckenventilator im Schlafzimmer.
- **Einstellungen:** Animationen **Automatisch / An / Aus** (Automatisch: aus bei „Bewegung reduzieren“) und eine
  **Leistungsanzeige** mit Bildern/s, Rechenzeit, Zeichenaufrufen und Dreiecken.
- **Sparsam bei Animationen:** Nur solange sich etwas bewegt, wird laufend gerechnet – gedrosselt auf 30 Bilder/s
  (Sparsam: 20), ohne die Schatten neu zu berechnen; in Ruhe wie bisher kein einziges Bild.

## 0.14.1

- **Keine Nachverfeinerung mehr:** Das Bild wurde nach kurzem Stillstand noch einmal mit Raumschatten neu gerechnet
  und sprang dabei sichtbar um. Das ist entfernt – jedes Bild sieht gleich aus, ob in Bewegung oder nicht. Die
  Qualitätsstufen Hoch/Sparsam regeln weiter Schattenauflösung und Bildschärfe.

## 0.14.0

- **Logo:** Die Integration hat ein eigenes Symbol und Logo; Home Assistant zeigt es ab 2026.3 unter Geräte & Dienste.
- **Demo-Haus: Terrasse am Nordhang,** in den Hang gegraben: Großformatplatten, Trockenmauern aus Naturstein mit
  Hochbeet (Gräser, Lavendel, Leuchtkugeln, Strahler), Blockstufen hinauf zum Rasen, Pollerleuchte, Lichterkette,
  Gartentisch mit Bank und Stühlen, Kinder-Picknicktisch, Grill und Regentonne.
- **Datenmodell (abwärtskompatibel):** Außenbereiche mit `edge` (z. B. Naturstein-Kante für Mauern, Hochbeete, Stufen)
  und `extend` (ein Hang läuft über den Rand hinaus weiter, auch bergauf); Oberflächen `slabs` und `stone`; neue
  Katalog-Modelle `garden_table`, `garden_chair`, `bench`, `picnic_table`, `grill`, `barrel`, `grass`, `bollard`,
  `spike_spot`, `string_lights`; Bäume mit Pfahl-Dreibock (`stakes`).
## 0.13.1

- **Weiße Seite in Home Assistant behoben** (seit 0.13.0): Das Panel setzte die Darstellung (hell/dunkel) schon beim
  Anlegen; Home Assistant legt Panels mit `document.createElement` an, und dort sind Attribute im Konstruktor
  verboten. Die Test-Seite legt das Panel mit `?ha=1` jetzt genauso an wie HA.

## 0.13.0

- **Glas-Design:** Alle Bedienelemente sind durchscheinend mit Weichzeichner und feiner Lichtkante, die Formen sind
  eckiger. Ausgewählte Optionen erscheinen invertiert.
- **Stockwerk-Auswahl** als eine durchgehende Glas-Leiste (obere Ebene oben, gewählte Ebene invertiert).
- **Darstellung Automatisch / Hell / Dunkel** im Zahnrad-Menü; Automatisch folgt dem Hell-/Dunkel-Modus von Home
  Assistant. Die 3D-Szene bleibt davon unberührt (sie folgt Tageszeit und Wetter).

## 0.12.0

- **Wetter:** Das Panel nimmt das Wetter aus Home Assistant (`weather.home` bzw. die erste `weather.*`, oder fest
  per `site.weather` im Modell). Wolken dämpfen Sonne und Schatten und machen den Himmel grau, Regen macht Terrasse,
  Wege und Rasen nass und glänzend, Schnee legt sich auf Rasen, Beete, Wege und Baumkronen, Nebel verschluckt den
  hinteren Garten. Regen und Schneefall erscheinen als leichter Bildschirm-Effekt (das 3D-Bild wird dafür nicht neu
  gerechnet; bei „Bewegung reduzieren“ steht er still).
- **Wetteranzeige** oben mit Symbol und Temperatur; antippen öffnet den HA-Wetterdialog mit Vorhersage.
- **Testschalter** im Zahnrad-Menü: Wetter Automatisch / Klar / Bewölkt / Regen / Schnee / Nebel.
- **Kompass** folgt dem Drehen ohne Verzögerung (vorher lief die Nadel um 80 ms nach).

## 0.11.0

- **Einstellungsmenü (Zahnrad):** ersetzt Stift und Ketten-Knopf. Darin: Tageszeit **Automatisch / Tag / Nacht**
  (zum Testen oder für Wand-Tablets), Qualität **Automatisch / Hoch / Sparsam**, **Bearbeiten** (nur Administratoren),
  **Verknüpfungen prüfen** (Link-Check), Version und Datenquelle. Tageszeit und Qualität gelten pro Gerät.
- **Realistischer:** Spiegelungen von Himmel und Licht (Glas, Böden, Lack), Struktur auf Parkett, Fliesen, Pflaster,
  Rasen, Kies, Putz und Stoffen, schärfere Böden bei flachem Blick, weiche Kontaktschatten unter Möbeln, Bäumen und
  Sträuchern, Sockelleisten, nachts Lichtschein vor erleuchteten Fenstern, Horizont in Himmelsfarbe.
- **Ruhebild-Verfeinerung:** Steht die Ansicht still, wird das Bild mit weichen Raumschatten (Ecken, unter Möbeln)
  gerechnet; beim Drehen bleibt das schnelle Bild. „Automatisch“ schaltet bei ruckelnder Darstellung auf „Sparsam“.
- Neue Baumformen `column` (Säulenbaum) und `birch` (Birke); das Demo-Haus hat je einen.
- Neuer Test: Leistungsbudget (Zeichenaufrufe und Dreiecke pro Bild).

## 0.10.0

- **Ebenen gestapelt:** Das Obergeschoss steht jetzt auf dem Erdgeschoss – darunterliegende Geschosse und der Garten
  bleiben sichtbar. Auf einer unteren Ebene sind die Geschosse darüber ausgeblendet. Die Geschossdecke schließt an
  die Wände darunter an.
- **Version im Panel:** Der Link-Check (Ketten-Symbol) zeigt die laufende Version und woher das Modell kommt
  (Demo-Haus, gespeichertes Modell oder `model.yaml`); die Browser-Konsole meldet die Version beim Laden.

## 0.9.0

- **Gelände:** Außenbereiche können Höhen je Eckpunkt haben (`[x, y, z]`) – z. B. ein Garten als Hang. Objekte stehen
  auf dem Gelände; der umgebende Boden setzt den Hang fort. Das Format bleibt abwärtskompatibel.
- **Pflanzen im Katalog:** `tree` (Laub- oder Nadelbaum), `shrub` (Strauch) und `flowers` (Blumenbeet).
- **Demo-Haus:** Garten als Südhang mit Apfelbaum, Kirschbaum, Tanne und Sträuchern; Blumenbeete rund um die Terrasse
  und ein Weg in den Garten.

## 0.8.0

- **Entities an allen Objekten:** Nicht nur Leuchten – jedes Möbel und Gerät lässt sich mit HA verknüpfen: Rolle
  **Schalten** (An/Aus, z. B. Steckdose, Kamin) und **Anzeigen** (Werte wie Restzeit oder Leistung).
- **Gesten je Objekt:** Antippen, Doppeltippen und langes Drücken lösen wählbare Aktionen aus – Umschalten, HA-Dialog,
  Dienst aufrufen (z. B. ein Skript), Seite öffnen oder nichts, auf Wunsch mit Rückfrage. Ohne Angabe gelten sinnvolle
  Standards (Leuchten wie bisher).
- **Einstellungen im Editor:** „Verknüpfen“ öffnet für das gewählte Objekt einen Bildschirm mit Entities, Gesten und
  Zustandsanzeige. Die Entity-Auswahl hat einen neuen Filter „Sensoren“.
- **Zustandsanzeige:** Ein kleines Schild über dem Objekt zeigt den Wert (z. B. „42 min“) bzw. An/Aus, hervorgehoben
  solange das Gerät läuft. Keine Animationen.

## 0.7.0

- **Gemeinsames Modell für alle Benutzer:** Mit der Integration speichert „Fertig“ das Modell in Home Assistant
  (Teil jedes Backups) statt pro Benutzer. Alle offenen Panels übernehmen Änderungen sofort. Bearbeiten dürfen nur
  Administratoren; andere Benutzer sehen keinen Stift.
- **Import/Export:** Eine neue oder geänderte `model.yaml` im Datenordner ersetzt das gespeicherte Modell; „Export“ im
  Editor lädt es als `model.yaml` herunter. Nach dem ersten Speichern ist die Datei unter `/local/` nicht mehr nötig.
- Speichern zwei Administratoren gleichzeitig, scheitert das zweite Speichern mit Meldung (nichts wird überschrieben).

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
