// Link-Check gegen einen HA-Export (ENTITIES, erzeugt mit dem Template aus docs/DATA_MODEL.md):
// Jede im Modell (model.yaml) verknüpfte Entity muss im Export existieren; Lichter im Export ohne Zuordnung werden gelistet.
//   node tests/link-check.mjs [--all]   (--all: alle Bereiche, sonst nur Bereiche mit passendem Raumnamen)
// Im Panel selbst gibt es denselben Check live gegen HA (Ketten-Knopf).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ENTITIES } from './lib/config.mjs';
import { normName } from '../src/picker.js';
import { parseModel, spacesOf } from '../src/model/model.js';

const EXPORT = ENTITIES;
if (!EXPORT) {
  console.log('ℹ Kein HA-Export (ENTITIES) – Link-Check übersprungen');
  process.exit(0);
}
const exported = new Map(); // entity -> { name, area }
let area = '';
for (const line of readFileSync(EXPORT, 'utf8').split(/\r?\n/)) {
  if (line.startsWith('## ')) { area = line.slice(3).trim(); continue; }
  const [id, name] = line.split('|').map((s) => s?.trim());
  if (id && /^[a-z_]+\.[a-z0-9_]+$/.test(id)) exported.set(id, { name, area });
}
const model = parseModel(readFileSync(join(DATA_DIR, 'model.yaml'), 'utf8'));
const used = new Map();
const missing = [];
for (const o of model.objects || []) {
  for (const [role, v] of Object.entries(o.ha?.entities || {})) {
    for (const e of [].concat(v)) {
      used.set(e, o.id);
      if (!exported.has(e)) missing.push(`${o.id} (${role}): ${e}`);
    }
  }
}
// Relevant: Bereiche, die wie ein Raum des Modells heißen, außerdem Außen und Lichter ohne Bereich
const roomNames = new Set([...spacesOf(model).values()].flatMap((s) => [normName(s.room.name), normName(s.room.id)]));
const relevant = (area) => roomNames.has(normName(area)) || /^(außen|aussen|ohne bereich)$/i.test(area);
const all = process.argv.includes('--all');
const free = [...exported].filter(([e, x]) => e.startsWith('light.') && !used.has(e) && (all || relevant(x.area)));
const byArea = {};
for (const [e, x] of free) (byArea[x.area] ??= []).push(`${e} (${x.name})`);

const linked = [...used.keys()].length;
console.log(`Link-Check: ${linked} verknüpfte Entities, ${missing.length} fehlen im HA-Export, ${free.length} Lichter ohne Zuordnung${all ? '' : ' (Räume des Modells, Außen)'}`);
for (const [a, list] of Object.entries(byArea)) console.log(`  ${a}: ${list.length}`);
if (missing.length) {
  console.error('✖ Entities nicht im HA-Export:\n  ' + missing.join('\n  '));
  process.exit(1);
}
console.log('✔ Alle verknüpften Entities existieren in HA');
