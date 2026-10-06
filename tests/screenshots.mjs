// Headless-Screenshots gegen das simulierte HA – für beliebige Daten (Demo-Haus oder eigenes Haus).
//   node tests/screenshots.mjs [szenario …]          -> tests/output/ebene<n>_<szenario>_<viewport>.png
// Standard-Szenarien beleuchten Räume nach ihrer Reihenfolge im Modell (erste Gebäude-Etage); weitere Ebenen
// (Stockwerke) bekommen je ein Bild "abend", die Dächer (Ebene über der obersten) ein Bild "dach". Eigene Ansichten
// (z. B. Zoom auf einen Raum) kommen aus VIEWS:
//   { "wohnzimmer-abend": { "rooms": ["wohnzimmer"], "outdoor": true, "view": { "at": [3, 7.5], "zoom": 1.9, "az": 0 } } }
// rooms: Raum-IDs oder "all"; sun: { azimuth, elevation } (sonst Nacht); view.at: Plan-Punkt [x, y] oder [x, y, Höhe]; view.az: um die
// senkrechte Achse schwenken (Grad); view.tilt: Neigung der Kamera über dem Horizont (Grad, z. B. 25 = flache
// Schrägansicht für Haus und Hang; Standard wie die Startansicht, ~57°); level: Ebene.
import { mkdir, readFile } from 'node:fs/promises';
import { parseModel } from '../src/model/model.js';
import { join } from 'node:path';
import { DATA_DIR, ENTITIES, VIEWS, OUT, restArgs } from './lib/config.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, guardedPage } from './lib/browser.mjs';

const model = parseModel(await readFile(join(DATA_DIR, 'model.yaml'), 'utf8'));
const firstFloor = model.buildings[0].floors.find((f) => f.level === 0) || model.buildings[0].floors[0];
const firstRooms = (n) => firstFloor.rooms.slice(0, n).map((r) => r.id);
const levels = [...new Set(model.buildings.flatMap((b) => b.floors.map((f) => f.level)))].sort((a, b) => a - b);

const SCENARIOS = {
  'alles-aus': { rooms: [], outdoor: false },
  'abend': { rooms: firstRooms(2), outdoor: true },
  'alles-an': { rooms: 'all', outdoor: true },
  // Tag: Sonne am Nachmittag im Südwesten; Dämmerung: Sonne knapp unter dem Horizont
  'tag': { rooms: [], outdoor: false, sun: { azimuth: 215, elevation: 38 } },
  'daemmerung': { rooms: firstRooms(2), outdoor: true, sun: { azimuth: 290, elevation: -3 } },
  // Wetter (weather.home im simulierten HA): Regen am Tag, Schnee am Tag, Nebel in der Dämmerung
  'regen': { rooms: [], outdoor: false, sun: { azimuth: 200, elevation: 30 }, weather: 'rainy' },
  'schnee': { rooms: [], outdoor: false, sun: { azimuth: 200, elevation: 25 }, weather: 'snowy' },
  'nebel': { rooms: firstRooms(2), outdoor: true, sun: { azimuth: 250, elevation: 2 }, weather: 'fog' },
  // flache Gesamtansicht (Haus und Hang von der Seite)
  'schraeg': { rooms: [], outdoor: false, sun: { azimuth: 215, elevation: 38 }, view: { at: null, zoom: 1, tilt: 25 } },
  ...(VIEWS ? JSON.parse(await readFile(VIEWS, 'utf8')) : {}),
};
const VIEWPORTS = { desktop: { width: 1600, height: 1000 }, tablet: { width: 1024, height: 768 }, phone: { width: 390, height: 844 } };

await mkdir(OUT, { recursive: true });
const { server, base } = await startServer({ dataDir: DATA_DIR, entities: ENTITIES });
const browser = await launchBrowser();
const only = restArgs();
const errors = [];
try {
  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    const page = await guardedPage(browser, base, errors, { viewport, label: vpName });
    // Bilder in voller Qualität („Hoch“), unabhängig von der automatischen Wahl auf dem Testrechner
    await page.evaluate((q) => window.panel.view.setQuality(q), process.env.QUALITY || 'high');
    // Ebene 0 mit allen Szenarien, weitere Ebenen nur "abend" (alle Räume an)
    const runs = [
      ...Object.entries(SCENARIOS).map(([name, sc]) => [sc.level ?? firstFloor.level, name, sc]),
      ...levels.filter((l) => l !== firstFloor.level).map((l) => [l, 'abend', { rooms: 'all', outdoor: false }]),
      // Dächer (Knopf „Dach“ über der obersten Ebene) am Tag
      [levels.at(-1) + 1, 'dach', { rooms: [], outdoor: false, sun: { azimuth: 215, elevation: 38 } }],
    ];
    for (const [level, name, sc] of runs) {
      if (only.length && !only.includes(name)) continue;
      if (vpName !== 'desktop' && (name !== 'abend' || level !== firstFloor.level)) continue; // andere Größen nur im Hauptszenario
      const shown = await page.evaluate(([level, sc]) => {
        // Sonnenstand über das simulierte HA setzen (wie im echten Betrieb über hass.states)
        const sun = sc.sun || { azimuth: 330, elevation: -25 };
        const mh = window.mockHass;
        mh.states = {
          ...mh.states,
          'sun.sun': { state: sun.elevation > 0 ? 'above_horizon' : 'below_horizon', attributes: { ...sun } },
          'weather.home': { state: sc.weather || (sun.elevation > 0 ? 'sunny' : 'clear-night'), attributes: { temperature: 14, temperature_unit: '°C' } },
        };
        window.panel.hass = mh;
        if (!window.panel.view.levels.includes(level)) return false; // z. B. keine Dächer über der obersten Ebene
        window.panel.setLevel(level);
        const v = window.panel.view;
        for (const f of v.activeFloors) for (const id of f.rooms.keys()) v.setRoomLight(id, sc.rooms === 'all' || sc.rooms.includes(id));
        v.setOutdoorLight(sc.outdoor);
        // Kamera für Detailansichten verschieben (danach wiederherstellen)
        // Ausgangslage je Ebene (der Ebenenwechsel passt den Bildausschnitt neu ein)
        v._homes ??= {};
        if (!v._homes[level]) v._homes[level] = { pos: v.camera.position.clone(), target: v.controls.target.clone(), zoom: v.camera.zoom };
        const h = v._homes[level];
        v.camera.position.copy(h.pos);
        v.controls.target.copy(h.target);
        v.camera.zoom = h.zoom;
        if (sc.view) {
          // ohne at: Drehpunkt der Ausgangslage
          const at = sc.view.at || [h.target.x, h.target.z];
          // dritter Wert: Höhe des Drehpunkts (z. B. Dachansichten), sonst wie die Ausgangslage
          const shift = new v.camera.position.constructor(at[0], at[2] ?? h.target.y, at[1]).sub(h.target);
          v.camera.position.add(shift);
          v.controls.target.add(shift);
          v.camera.zoom = sc.view.zoom || 1;
          if (sc.view.tilt != null) {
            // Neigung: Kamera so viel Grad über dem Horizont (z. B. 25 = flache Schrägansicht), Richtung und Abstand bleiben
            const t = v.controls.target, p = v.camera.position;
            const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z, r = Math.hypot(dx, dy, dz), hz = Math.hypot(dx, dz) || 1;
            const el = (Math.max(5, Math.min(89, sc.view.tilt)) * Math.PI) / 180;
            p.set(t.x + (dx / hz) * r * Math.cos(el), t.y + r * Math.sin(el), t.z + (dz / hz) * r * Math.cos(el));
            v.camera.lookAt(t);
          }
          if (sc.view.az) {
            // um die senkrechte Achse durch den Drehpunkt schwenken
            const a = (sc.view.az * Math.PI) / 180, t = v.controls.target, p = v.camera.position;
            const dx = p.x - t.x, dz = p.z - t.z;
            p.x = t.x + dx * Math.cos(a) - dz * Math.sin(a);
            p.z = t.z + dx * Math.sin(a) + dz * Math.cos(a);
            v.camera.lookAt(t);
          }
        }
        v.camera.updateProjectionMatrix();
        v.renderer.shadowMap.needsUpdate = true;
        v.renderNow();
        return true;
      }, [level, sc]);
      if (!shown) continue;
      await page.waitForTimeout(150);
      const file = join(OUT, `ebene${level}_${name}_${vpName}.png`);
      await page.screenshot({ path: file });
      console.log('📸', file);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error('\n✖ Fehler:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\n✔ Alle Screenshots erstellt');
