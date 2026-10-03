// Prüft ein Modell (docs/DATA_MODEL.md → Prüfung): Schema, eindeutige IDs, Verweise, Lage, Entity-IDs, Texturen.
// Außerdem: Katalog in docs/DATA_MODEL.md stimmt mit src/model/catalog.js überein (nur im Engine-Repo).
//   node tests/validate-data.mjs            (Datenordner: DATA_DIR bzw. --data, Standard Demo-Haus)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { DATA_DIR, ENGINE_ROOT } from './lib/config.mjs';
import { pointInPoly } from '../src/geometry.js';
import { CATALOG, hasCapability } from '../src/model/catalog.js';
import { parseModel, spacesOf, roleEntities } from '../src/model/model.js';
import { FURNITURE, LAMPS } from '../src/models.js';

const errors = [], warnings = [];
const file = join(DATA_DIR, 'model.yaml');
if (!existsSync(file)) {
  console.error(`✖ ${file} fehlt (Datenmodell v2, docs/DATA_MODEL.md)`);
  process.exit(1);
}

let model;
try {
  model = parseModel(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exit(1);
}

// 1. Schema
const ajv = new Ajv({ allErrors: true, strict: false });
const schema = JSON.parse(readFileSync(join(ENGINE_ROOT, 'schema/model.schema.json'), 'utf8'));
if (!ajv.validate(schema, model)) {
  for (const e of ajv.errors) errors.push(`Schema: ${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`);
}

// 2. eindeutige IDs
const dupes = (kind, ids) => {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`${kind}: ID ${id} doppelt`);
    seen.add(id);
  }
};
const buildings = model.buildings || [];
dupes('Gebäude', buildings.map((b) => b.id));
for (const b of buildings) dupes(`Etagen von ${b.id}`, (b.floors || []).map((f) => f.id));
const spaceIds = [...buildings.flatMap((b) => (b.floors || []).flatMap((f) => (f.rooms || []).map((r) => r.id))), ...(model.outdoor || []).map((z) => z.id)];
dupes('Bereiche (Räume und Außenbereiche)', spaceIds);
dupes('Objekte', (model.objects || []).map((o) => o.id));

// 3. Verweise im Bauwerk
for (const b of buildings) {
  for (const f of b.floors || []) {
    const rooms = new Set((f.rooms || []).map((r) => r.id));
    for (const w of f.windows || []) if (w.room && !rooms.has(w.room)) errors.push(`${b.id}/${f.id}: Fenster ${JSON.stringify(w.rect)} verweist auf Raum "${w.room}", den es auf dieser Etage nicht gibt`);
    for (const d of f.doors || []) for (const r of d.rooms || []) if (!rooms.has(r)) errors.push(`${b.id}/${f.id}: Tür bei ${JSON.stringify(d.hinge)} verweist auf Raum "${r}", den es auf dieser Etage nicht gibt`);
  }
}

// 3./4. Objekte: Modell, Leuchten, Bereich, Lage, Entities, Texturen
const spaces = spacesOf(model);
for (const o of model.objects || []) {
  const cat = CATALOG[o.model];
  if (!cat) {
    errors.push(`Objekt ${o.id}: Modell "${o.model}" gibt es nicht im Katalog`);
    continue;
  }
  const isLight = hasCapability(o.model, 'light');
  if (isLight && !o.light) errors.push(`Objekt ${o.id}: Leuchte (${o.model}) braucht light: { height, range }`);
  if (!isLight && o.light) errors.push(`Objekt ${o.id}: ${o.model} ist keine Leuchte, light ist nicht erlaubt`);
  for (const k of Object.keys(o.params || {})) if (!cat.params.includes(k)) errors.push(`Objekt ${o.id}: Parameter "${k}" gibt es bei ${o.model} nicht (${cat.params.join(', ') || 'keine'})`);
  if (o.space) {
    const sp = spaces.get(o.space);
    if (!sp) errors.push(`Objekt ${o.id}: Bereich "${o.space}" gibt es nicht`);
    else {
      if (!pointInPoly(o.pos, sp.room.polygon)) errors.push(`Objekt ${o.id}: pos ${JSON.stringify(o.pos)} liegt nicht in ${o.space}`);
      if (isLight && sp.kind === 'room' && o.light?.height > sp.height) errors.push(`Objekt ${o.id}: light.height ${o.light.height} über der Raumhöhe (${sp.height})`);
    }
  }
  const tex = o.params?.texture;
  if (tex && !existsSync(join(DATA_DIR, tex))) errors.push(`Objekt ${o.id}: Textur ${tex} fehlt im Datenordner`);
}

// Entities mehrfach zugeordnet (Hinweis, kein Fehler: z. B. eine Steckdose für zwei Lampen)
const ents = (model.objects || []).flatMap((o) => roleEntities(o, 'power'));
for (const e of ents.filter((e, i) => ents.indexOf(e) !== i)) warnings.push(`Entity ${e} mehrfach als power zugeordnet`);

// Katalog in der Doku = Katalog im Code (nur im Engine-Repo, wo die Doku liegt)
const doc = join(ENGINE_ROOT, 'docs/DATA_MODEL.md');
if (existsSync(doc)) {
  const text = readFileSync(doc, 'utf8');
  const table = text.slice(text.indexOf('<!-- katalog:start -->'), text.indexOf('<!-- katalog:end -->'));
  const documented = new Set([...table.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]));
  for (const m of Object.keys(CATALOG)) if (!documented.has(m)) errors.push(`Katalog: Modell ${m} fehlt in docs/DATA_MODEL.md`);
  for (const m of documented) if (!CATALOG[m]) errors.push(`Katalog: docs/DATA_MODEL.md nennt ${m}, das es nicht gibt`);
  for (const [m, c] of Object.entries(CATALOG)) {
    const geo = c.capabilities?.includes('light') ? LAMPS : FURNITURE;
    if (!geo[m]) errors.push(`Katalog: Modell ${m} hat keine Geometrie in src/models.js`);
  }
}

const nRooms = buildings.reduce((n, b) => n + (b.floors || []).reduce((m, f) => m + (f.rooms || []).length, 0), 0);
console.log(`Modell (${file}): ${buildings.length} Gebäude, ${nRooms} Räume, ${(model.outdoor || []).length} Außenbereiche, ${(model.objects || []).length} Objekte`);
if (warnings.length) console.log(`ℹ ${warnings.join('; ')}`);
if (errors.length) {
  console.error('✖ Datenfehler:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('✔ Daten konsistent');
