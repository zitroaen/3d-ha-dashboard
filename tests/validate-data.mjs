// Prüft die Daten-Schichten gegeneinander: Bauwerk (house.json) <- Einrichtung (furniture.yaml) und
// Geräte (devices.yaml). Geräte und Möbel dürfen nur auf existierende Räume verweisen und müssen dort stehen.
//   node tests/validate-data.mjs            (Datenordner: DATA_DIR bzw. --data, Standard Demo-Haus)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './lib/config.mjs';
import * as yaml from 'js-yaml';
import { pointInPoly } from '../src/geometry.js';
import { FURNITURE, LAMPS } from '../src/models.js';

const load = (p) => {
  const t = readFileSync(p, 'utf8');
  return p.endsWith('.json') ? JSON.parse(t) : (t.trim() && yaml.load(t)) || {};
};
const house = load(join(DATA_DIR, 'house.json'));
const devices = load(join(DATA_DIR, 'devices.yaml')).devices || [];
const items = load(join(DATA_DIR, 'furniture.yaml')).items || [];

const errors = [], warnings = [];
const floors = new Map(house.floors.map((f) => [f.id, f]));

// Bauwerk
for (const f of house.floors) {
  const ids = f.rooms.map((r) => r.id);
  for (const id of ids.filter((id, i) => ids.indexOf(id) !== i)) errors.push(`house: Raum-ID ${f.id}/${id} doppelt`);
}

// Gemeinsame Prüfung für alles, was in einem Raum steht
function checkPlacement(kind, o) {
  const f = floors.get(o.floor);
  if (!f) return errors.push(`${kind} ${o.id}: Etage "${o.floor}" gibt es nicht`);
  if (!Array.isArray(o.pos) || o.pos.length !== 2) return errors.push(`${kind} ${o.id}: pos fehlt oder ist kein [x, y]`);
  const inside = f.rooms.find((r) => pointInPoly(o.pos, r.polygon));
  if (o.room === 'aussen') {
    if (inside) errors.push(`${kind} ${o.id}: steht laut pos in "${inside.id}", ist aber als aussen eingetragen`);
    return;
  }
  const room = f.rooms.find((r) => r.id === o.room);
  if (!room) return errors.push(`${kind} ${o.id}: Raum "${o.floor}/${o.room}" gibt es nicht`);
  if (!pointInPoly(o.pos, room.polygon)) {
    errors.push(`${kind} ${o.id}: pos ${JSON.stringify(o.pos)} liegt nicht in ${o.room}${inside ? ` (sondern in ${inside.id})` : ''}`);
  }
  const ceiling = room.ceiling || f.ceiling;
  if (o.height != null && o.height > ceiling) errors.push(`${kind} ${o.id}: height ${o.height} über der Decke (${ceiling})`);
}

function checkIds(kind, list) {
  const seen = new Set();
  for (const o of list) {
    if (!o.id) errors.push(`${kind}: Eintrag ohne id`);
    else if (seen.has(o.id)) errors.push(`${kind}: id ${o.id} doppelt`);
    seen.add(o.id);
  }
}

checkIds('devices', devices);
checkIds('furniture', items);
const LIGHT_KINDS = ['ceiling', 'pendant', 'floor', 'table', 'wall', 'spot'];
for (const d of devices) {
  checkPlacement('Gerät', d);
  if (d.type === 'light' && !LIGHT_KINDS.includes(d.kind)) errors.push(`Gerät ${d.id}: kind "${d.kind}" unbekannt (${LIGHT_KINDS.join(', ')})`);
  if (d.type === 'light' && !(d.range > 0)) errors.push(`Gerät ${d.id}: range fehlt`);
  for (const e of d.entity == null ? [] : [].concat(d.entity)) {
    if (!/^[a-z_]+\.[a-z0-9_]+$/.test(e)) errors.push(`Gerät ${d.id}: entity "${e}" ist keine gültige Entity-ID`);
  }
  if (d.model && !LAMPS[d.model]) errors.push(`Gerät ${d.id}: model "${d.model}" unbekannt (${Object.keys(LAMPS).join(', ')})`);
  if (d.placeholder) warnings.push(d.id);
}
for (const i of items) {
  checkPlacement('Möbel', i);
  if (i.texture && !existsSync(join(DATA_DIR, i.texture))) errors.push(`Möbel ${i.id}: Textur ${i.texture} fehlt im Datenordner`);
  if (!FURNITURE[i.kind]) errors.push(`Möbel ${i.id}: kind "${i.kind}" unbekannt (${Object.keys(FURNITURE).join(', ')})`);
}

const entities = devices.flatMap((d) => (d.entity == null ? [] : [].concat(d.entity)));
for (const e of entities.filter((e, i) => entities.indexOf(e) !== i)) warnings.push(`(Entity ${e} mehrfach zugeordnet)`);

console.log(`Daten (${DATA_DIR}): ${house.floors.reduce((n, f) => n + f.rooms.length, 0)} Räume, ${devices.length} Geräte, ${items.length} Möbel`);
if (warnings.length) console.log(`ℹ ${warnings.length} Platzhalter/Hinweise: ${warnings.join(', ')}`);
if (errors.length) {
  console.error('✖ Datenfehler:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('✔ Daten konsistent');
