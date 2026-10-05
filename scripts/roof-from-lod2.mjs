// Dachform aus CityGML-LoD2: liest die Dachflächen eines Gebäudes und schlägt `buildings[].roof` vor (Dachteile mit
// Typ, Neigung, Firstrichtung, Traufhöhe, Umriss im Plan; flache Teile; Pultdächer). Nur zur Kontrolle als Text –
// das Ergebnis von Hand übernehmen und anpassen (Überstand, Gauben, Schornsteine kennt LoD2 nicht genau).
//
//   node scripts/roof-from-lod2.mjs lod2.gml [--id DEBY_…] [--building haus] [--origin E,N] [--north 20] [--floor 312.4]
//
// Die Einpassung (Plan <-> Landeskoordinaten, EG-Fußboden) kommt aus site.georef (scripts/fit-footprint.mjs) oder
// den Optionen. Zusammenhängende geneigte Flächen bilden einen Dachteil: eine Fallrichtung = Pultdach, zwei
// entgegengesetzte = Satteldach, vier = Walmdach (kleine, steile Walme = Krüppelwalm); flache Flächen = Flachdach.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cli, georefFrom } from './lib/geodata.mjs';
import { parseCityGML, footprintOf, centroid, pickBuilding, roofFace, convexHull } from './lib/citygml.mjs';

const VALUE_OPTS = ['--id', '--building', '--origin', '--north', '--floor', '--data'];
const { opt, free } = cli(process.argv, VALUE_OPTS);
if (!free.length) {
  console.error('Aufruf: node scripts/roof-from-lod2.mjs <lod2.gml> [--id …] [--building haus] [--origin E,N] [--north Grad] [--floor m]');
  process.exit(1);
}
const { DATA_DIR } = await import('../tests/lib/config.mjs');
const { parseModel } = await import('../src/model/model.js');
const file = join(DATA_DIR, 'model.yaml');
const model = existsSync(file) ? parseModel(readFileSync(file, 'utf8')) : null;
let geo;
try {
  geo = georefFrom(opt, model);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const bModel = model && (opt('--building') ? model.buildings.find((b) => b.id === opt('--building')) : model.buildings?.[0]);
const top = bModel?.floors?.reduce((a, f) => ((f.level ?? 0) > (a.level ?? 0) ? f : a), bModel.floors[0]);
const topElev = top?.elevation ?? 0;

const buildings = free.flatMap((f) => parseCityGML(readFileSync(f, 'utf8')));
const near = bModel ? geo.toGeo(centroid(bModel.floors.flatMap((f) => (f.rooms || []).map((r) => r.polygon)).filter((p) => p?.length >= 3))) : geo.origin;
const b = pickBuilding(buildings, { id: opt('--id'), near });
if (!b) {
  console.error(`Welches Gebäude? ${buildings.length} in der Datei – --id angeben`);
  process.exit(1);
}
if (!b.roofs.length) {
  console.error(`${b.id}: keine Dachflächen (RoofSurface) – ist das LoD2?`);
  process.exit(1);
}

const faces = b.roofs.map((poly) => ({ poly, ...roofFace(poly) }));
// Richtungen in den Plan: Plan-Vektor aus einem Landes-Vektor (ohne Verschiebung)
const planDirOf = ([dE, dN]) => {
  const o = geo.toPlan([0, 0]), p = geo.toPlan([dE, dN]);
  return [p[0] - o[0], p[1] - o[1]];
};

// Zusammenhang: Flächen mit gemeinsamer Kante (zwei gemeinsame Eckpunkte, auf 5 cm gerundet)
const key = (p) => p.map((v) => Math.round(v * 20)).join();
const parent = faces.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const owners = new Map();
faces.forEach((f, i) => {
  if (f.pitch < 5) return; // flache Flächen getrennt
  for (const k of new Set(f.poly.map(key))) {
    if (!owners.has(k)) owners.set(k, []);
    owners.get(k).push(i);
  }
});
const shared = new Map();
for (const list of owners.values()) {
  for (let a = 0; a < list.length; a++) for (let c = a + 1; c < list.length; c++) {
    const k = `${list[a]}|${list[c]}`;
    shared.set(k, (shared.get(k) || 0) + 1);
  }
}
for (const [k, n] of shared) if (n >= 2) {
  const [a, c] = k.split('|').map(Number);
  parent[find(a)] = find(c);
}
const groups = new Map();
faces.forEach((f, i) => {
  const g = f.pitch < 5 ? `flach_${i}` : `g${find(i)}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(f);
});

const deg = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const angleOf = ([x, y]) => (Math.atan2(y, x) * 180) / Math.PI;
const dirText = (v) => {
  // Firstrichtung im Plan: x, y oder Grad (von +x Richtung +y), ohne Vorzeichen (0 … 180)
  let a = ((angleOf(v) % 180) + 180) % 180;
  if (a < 3 || a > 177) return 'x';
  if (Math.abs(a - 90) < 3) return 'y';
  return deg(a);
};
const slopeText = (v) => {
  const a = ((angleOf(v) % 360) + 360) % 360;
  for (const [t, s] of [[0, '+x'], [90, '+y'], [180, '-x'], [270, '-y'], [360, '+x']]) if (Math.abs(a - t) < 3) return s;
  return deg(a);
};

const parts = [];
for (const list of groups.values()) {
  const area = list.reduce((s, f) => s + f.area, 0);
  const zEave = Math.min(...list.map((f) => f.zMin)), zTop = Math.max(...list.map((f) => f.zMax));
  const hull = convexHull(list.flatMap((f) => f.poly.map((p) => geo.toPlan([p[0], p[1]])))).map((p) => p.map(r2));
  const eaves = r2(zEave - geo.floor - topElev);
  if (list[0].pitch < 5) {
    parts.push({ part: { type: 'flat', eaves, polygon: hull }, note: `flach, ${deg(area)} m², Höhe ${r2(zTop - geo.floor)} m über EG-Fußboden`, area });
    continue;
  }
  // Fallrichtungen bündeln (±20°), mit Flächenanteil
  const dirs = [];
  for (const f of list) {
    const v = planDirOf(f.down), a = angleOf(v);
    const d = dirs.find((x) => Math.abs(((a - x.a + 540) % 360) - 180) < 20);
    if (d) { d.area += f.area; d.pitchA += f.pitch * f.area; d.v = [d.v[0] + v[0] * f.area, d.v[1] + v[1] * f.area]; }
    else dirs.push({ a, area: f.area, pitchA: f.pitch * f.area, v: [v[0] * f.area, v[1] * f.area] });
  }
  dirs.sort((x, y) => y.area - x.area);
  const opposite = (x, y) => Math.abs(((x.a - y.a + 540) % 360) - 180) > 160;
  const main = dirs[0];
  const pitch = deg(main.pitchA / main.area);
  let part, note;
  if (dirs.length === 1) {
    part = { type: 'shed', pitch, slope: slopeText(main.v), eaves, polygon: hull };
    note = 'Pultdach';
  } else {
    const pair = dirs.find((d) => d !== main && opposite(d, main));
    const across = dirs.filter((d) => d !== main && d !== pair);
    const ridgeV = [-main.v[1], main.v[0]];
    if (pair && !across.length) {
      part = { type: 'gable', pitch, ridge: dirText(ridgeV), eaves, polygon: hull };
      note = 'Satteldach';
    } else if (pair && across.length) {
      const hipArea = across.reduce((s, d) => s + d.area, 0), hipPitch = across.reduce((s, d) => s + d.pitchA, 0) / hipArea;
      const half = hipArea < 0.25 * (main.area + pair.area) && hipPitch > pitch + 8;
      part = { type: half ? 'half_hip' : 'hip', pitch, ridge: dirText(ridgeV), eaves, polygon: hull };
      if (half) part.hip_pitch = deg(hipPitch);
      note = half ? 'Krüppelwalmdach' : 'Walmdach';
    } else {
      part = { type: 'gable', pitch, ridge: dirText(ridgeV), eaves, polygon: hull };
      note = `unklar (${dirs.length} Richtungen ohne Gegenstück) – vermutlich mehrere Teile, z. B. L-Form: Umriss teilen`;
    }
  }
  parts.push({ part, note: `${note}, ${deg(area)} m², First ${r2(zTop - geo.floor)} m über EG-Fußboden`, area });
}
parts.sort((a, b) => b.area - a.area);

const fmt = (v) => (Array.isArray(v) ? `[${v.map(fmt).join(', ')}]` : String(v));
console.log(`# Dachteile aus ${b.id} (${faces.length} Dachflächen) – Vorschlag für buildings[].roof${bModel ? ` (${bModel.id}, oberste Etage ${top.id} auf ${topElev} m)` : ''}`);
console.log('roof:');
for (const { part, note } of parts) {
  console.log(`  # ${note}`);
  console.log(`  - { ${Object.entries(part).map(([k, v]) => `${k}: ${fmt(v)}`).join(', ')} }`);
}
console.log('# Umrisse = konvexe Hülle der Dachflächen (mit Überstand, falls LoD2 ihn enthält); Dachteile müssen konvex sein.');
