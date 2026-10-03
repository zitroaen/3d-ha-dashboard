// Ergänzt Platzhalter-Leuchten im Modell (model.yaml, docs/DATA_MODEL.md): eine Deckenleuchte (disc) für jeden
// Raum ohne Leuchte und eine Außenleuchte (wall_box) je Gruppe von Außentüren. Vorhandene Objekte bleiben unverändert;
// Platzhalter sind am Namen "(Platzhalter)" zu erkennen und noch nicht verknüpft.
//   node scripts/default_devices.mjs        (Datenordner: DATA_DIR bzw. --data, Standard Demo-Haus)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../tests/lib/config.mjs';
import { poleOfInaccessibility, pointInPoly } from '../src/geometry.js';
import { parseModel } from '../src/model/model.js';
import { hasCapability } from '../src/model/catalog.js';
import { toYaml, yamlHeader } from '../src/model/yaml.js';

const file = join(DATA_DIR, 'model.yaml');
const text = readFileSync(file, 'utf8');
const model = parseModel(text);
model.objects ??= [];
const ids = new Set(model.objects.map((o) => o.id));
const litSpaces = new Set(model.objects.filter((o) => hasCapability(o.model, 'light')).map((o) => o.space));
const r2 = (v) => Math.round(v * 100) / 100;
const added = [];
const outdoorAt = (p) => (model.outdoor || []).find((z) => pointInPoly(p, z.polygon))?.id;

for (const b of model.buildings) {
  for (const f of b.floors) {
    for (const room of f.rooms) {
      if (litSpaces.has(room.id)) continue;
      const id = `${room.id}_decke`;
      if (ids.has(id)) continue;
      const { point } = poleOfInaccessibility(room.polygon);
      added.push({
        id, name: `Decke ${room.name} (Platzhalter)`, model: 'disc', space: room.id, pos: [r2(point[0]), r2(point[1])],
        light: { height: r2((room.height ?? f.height) - 0.3), range: 4.5 },
      });
    }
    // Außenleuchten neben Außentüren der Etagen auf Ebene 0; nahe beieinanderliegende Türen teilen sich eine
    if (f.level !== 0) continue;
    const placed = [];
    const inRoom = (p) => f.rooms.some((r) => pointInPoly(p, r.polygon));
    for (const d of (f.doors || []).filter((d) => d.type === 'exterior')) {
      const [hx, hy] = d.hinge, [ex, ey] = d.end;
      const mx = (hx + ex) / 2, my = (hy + ey) / 2;
      if (placed.some(([x, y]) => Math.hypot(x - mx, y - my) < 2.5)) continue;
      placed.push([mx, my]);
      const len = Math.hypot(ex - hx, ey - hy), ux = (ex - hx) / len, uy = (ey - hy) / len;
      const nx = -uy, ny = ux;
      const out = inRoom([mx + nx * 0.5, my + ny * 0.5]) ? -1 : 1;
      const face = out > 0 ? d.jamb[1] : -d.jamb[0]; // Abstand Türlinie -> Außenfläche der Wand
      const id = `${b.id}_aussen_${placed.length}`;
      if (ids.has(id)) continue;
      const pos = [r2(hx - ux * 0.3 + nx * out * (face + 0.06)), r2(hy - uy * 0.3 + ny * out * (face + 0.06))];
      const space = outdoorAt(pos);
      added.push({
        id, name: `Außenleuchte ${b.name} ${placed.length} (Platzhalter)`, model: 'wall_box', ...(space ? { space } : {}), pos,
        light: { height: 2.1, range: 3.5, facing: [r2(nx * out), r2(ny * out)] },
      });
    }
  }
}

if (!added.length) {
  console.log('Nichts zu ergänzen.');
} else {
  model.objects.push(...added);
  writeFileSync(file, toYaml(model, yamlHeader(text)));
  console.log(`${added.length} Platzhalter in ${file} ergänzt: ${added.map((a) => a.id).join(', ')}`);
}
