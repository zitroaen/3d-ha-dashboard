// Headless-Screenshots gegen das simulierte HA – für beliebige Daten (Demo-Haus oder eigenes Haus).
//   node tests/screenshots.mjs [szenario …]          -> tests/output/<etage>_<szenario>_<viewport>.png
// Standard-Szenarien beleuchten Räume nach ihrer Reihenfolge in house.json; eigene Ansichten (z. B. Zoom
// auf einen Raum) kommen aus einer JSON-Datei in VIEWS:
//   { "wohnzimmer-abend": { "rooms": ["wohnzimmer"], "outdoor": true, "view": { "at": [3, 7.5], "zoom": 1.9, "az": 0 } } }
// rooms: Raum-IDs oder "all"; sun: { azimuth, elevation } (sonst Nacht); view.at: Plan-Punkt [x, y].
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, ENTITIES, VIEWS, OUT, restArgs } from './lib/config.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, guardedPage } from './lib/browser.mjs';

const house = JSON.parse(await readFile(join(DATA_DIR, 'house.json'), 'utf8'));
const firstRooms = (n) => house.floors[0].rooms.slice(0, n).map((r) => r.id);

const SCENARIOS = {
  'alles-aus': { rooms: [], outdoor: false },
  'abend': { rooms: firstRooms(2), outdoor: true },
  'alles-an': { rooms: 'all', outdoor: true },
  // Tag: Sonne am Nachmittag im Südwesten; Dämmerung: Sonne knapp unter dem Horizont
  'tag': { rooms: [], outdoor: false, sun: { azimuth: 215, elevation: 38 } },
  'daemmerung': { rooms: firstRooms(2), outdoor: true, sun: { azimuth: 290, elevation: -3 } },
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
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      if (only.length && !only.includes(name)) continue;
      if (vpName !== 'desktop' && name !== 'abend') continue; // andere Größen nur im Hauptszenario
      await page.evaluate((sc) => {
        // Sonnenstand über das simulierte HA setzen (wie im echten Betrieb über hass.states)
        const sun = sc.sun || { azimuth: 330, elevation: -25 };
        const mh = window.mockHass;
        mh.states = { ...mh.states, 'sun.sun': { state: sun.elevation > 0 ? 'above_horizon' : 'below_horizon', attributes: { ...sun } } };
        window.panel.hass = mh;
        const v = window.panel.view;
        for (const id of v.activeFloor.rooms.keys()) v.setRoomLight(id, sc.rooms === 'all' || sc.rooms.includes(id));
        v.setOutdoorLight(sc.outdoor);
        // Kamera für Detailansichten verschieben (danach wiederherstellen)
        if (!v._home) v._home = { pos: v.camera.position.clone(), target: v.controls.target.clone(), zoom: v.camera.zoom };
        const h = v._home;
        v.camera.position.copy(h.pos);
        v.controls.target.copy(h.target);
        v.camera.zoom = h.zoom;
        if (sc.view) {
          const shift = new v.camera.position.constructor(sc.view.at[0], 0, sc.view.at[1]).sub(h.target);
          v.camera.position.add(shift);
          v.controls.target.add(shift);
          v.camera.zoom = sc.view.zoom || 1;
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
      }, sc);
      await page.waitForTimeout(150);
      const file = join(OUT, `${house.floors[0].id}_${name}_${vpName}.png`);
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
