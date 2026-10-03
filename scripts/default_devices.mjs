// Ergänzt Platzhalter-Lampen in data/devices.yaml: eine Deckenleuchte pro Raum ohne Lampe,
// eine Außenleuchte je Gruppe von Außentüren. Vorhandene Einträge (und Kommentare davor) bleiben
// unangetastet – neue Einträge werden nur angehängt.
//   node scripts/default_devices.mjs        (Datenordner: DATA_DIR bzw. --data, Standard Demo-Haus)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../tests/lib/config.mjs';
import * as yaml from 'js-yaml';
import { poleOfInaccessibility, pointInPoly } from '../src/geometry.js';

const PATH = join(DATA_DIR, 'devices.yaml');
const house = JSON.parse(readFileSync(join(DATA_DIR, 'house.json'), 'utf8'));
const text = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';
const devices = ((text.trim() && yaml.load(text)) || {}).devices || [];
const ids = new Set(devices.map((d) => d.id));
const litRooms = new Set(devices.filter((d) => d.type === 'light').map((d) => `${d.floor}/${d.room}`));
const r2 = (v) => Math.round(v * 100) / 100;
const added = [];

for (const floor of house.floors) {
  for (const room of floor.rooms) {
    if (litRooms.has(`${floor.id}/${room.id}`)) continue;
    const id = `${floor.id}_${room.id}_decke`;
    if (ids.has(id)) continue;
    const { point } = poleOfInaccessibility(room.polygon);
    added.push({
      id, type: 'light', kind: 'ceiling', name: `Decke ${room.name}`, floor: floor.id, room: room.id,
      pos: [r2(point[0]), r2(point[1])], height: r2((room.ceiling || floor.ceiling) - 0.3), range: 4.5,
      entity: null, placeholder: true,
    });
  }
  // Außenleuchten neben Außentüren; nahe beieinanderliegende Türen teilen sich eine
  if (litRooms.has(`${floor.id}/aussen`)) continue;
  const placed = [];
  const inRoom = (p) => floor.rooms.some((r) => pointInPoly(p, r.polygon));
  for (const d of floor.doors.filter((d) => d.type === 'exterior')) {
    const [hx, hy] = d.hinge, [ex, ey] = d.end;
    const mx = (hx + ex) / 2, my = (hy + ey) / 2;
    if (placed.some(([x, y]) => Math.hypot(x - mx, y - my) < 2.5)) continue;
    placed.push([mx, my]);
    const len = Math.hypot(ex - hx, ey - hy), ux = (ex - hx) / len, uy = (ey - hy) / len;
    const nx = -uy, ny = ux;
    const out = inRoom([mx + nx * 0.5, my + ny * 0.5]) ? -1 : 1;
    const face = out > 0 ? d.jamb[1] : -d.jamb[0]; // Abstand Türlinie -> Außenfläche der Wand
    const id = `${floor.id}_aussen_${placed.length}`;
    if (ids.has(id)) continue;
    added.push({
      id, type: 'light', kind: 'wall', name: `Außenleuchte ${placed.length}`, floor: floor.id, room: 'aussen',
      pos: [r2(hx - ux * 0.3 + nx * out * (face + 0.06)), r2(hy - uy * 0.3 + ny * out * (face + 0.06))],
      height: 2.1, range: 3.5, facing: [r2(nx * out), r2(ny * out)], entity: null, placeholder: true,
    });
  }
}

const HEADER = `# Geräte im Haus: Ort + Home-Assistant-Entity. Ändert sich ein Ort, nur hier anpassen –
# das Hausmodell (house.json) bleibt unberührt.
#
#   id          eindeutig, stabil (wird von Tests und später von Automationen referenziert)
#   type        light (weitere folgen: door_sensor, radiator, sensor, …)
#   kind        bei light: ceiling | pendant | floor | table | wall | spot
#   floor/room  Etage und Raum-ID aus house.json; room: aussen = außerhalb des Hauses
#   pos         [x, y] in Metern, Plan-Koordinaten (siehe CLAUDE.md)
#   height      Höhe der Lichtquelle über dem Boden der Etage (m)
#   range       Reichweite des Lichts (m)
#   entity      HA-Entity, z. B. light.wohnzimmer_decke, oder Liste [light.a, light.b] (null = nicht verknüpft)
#   placeholder true = von scripts/default_devices.mjs geraten, noch nicht bestätigt
`;

if (!added.length) {
  console.log('Nichts zu ergänzen.');
} else {
  let out = text.trim() ? text.replace(/\s*$/, '\n') : `${HEADER}\ndevices:\n`;
  out += yaml.dump(added, { flowLevel: 2, lineWidth: 200 }).replace(/^/gm, '  ').replace(/\s+$/, '') + '\n';
  writeFileSync(PATH, out);
  console.log(`${added.length} Platzhalter in ${PATH} ergänzt.`);
}
