// Höhenraster (site.terrain, docs/DATA_MODEL.md) aus einem digitalen Geländemodell (DGM, z. B. DGM1 der Länder:
// GeoTIFF oder XYZ-Text, auch mehrere Kacheln). Die Einpassung sagt, wo der Plan in den Landeskoordinaten liegt:
// Plan-Ursprung (E, N), Nordrichtung (wie site.north_deg) und Höhe des EG-Fußbodens (z. B. NHN); sie steht in
// site.georef des Modells oder kommt als Option.
//
//   node scripts/terrain-from-geotiff.mjs dgm.tif [weitere Kacheln …] [--origin E,N] [--north 20] [--floor 312.4]
//        [--cell 1] [--bounds x0,y0,x1,y1] [--margin 15] [--write] [--out terrain.json]
//
//   --cell    Rasterweite im Plan (Meter, Standard 1 = DGM1)
//   --bounds  Ausschnitt im Plan; Standard: alles im Modell plus --margin Meter
//   --write   site.terrain in model.yaml des Datenordners schreiben (vorhandenes Luftbild/shading bleiben)
// Beispiele für Quellen (offene Daten, Namensnennung beachten – site.attribution): die Geoportale der Länder
// (Suchbegriffe „DGM1 Download“, „Digitales Geländemodell 1 m“); Koordinaten meist ETRS89/UTM (EPSG:25832/25833).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cli, readRaster, sampleAny, georefFrom } from './lib/geodata.mjs';

const VALUE_OPTS = ['--origin', '--north', '--floor', '--cell', '--bounds', '--margin', '--out', '--data'];
const { opt, free, flag } = cli(process.argv, VALUE_OPTS);
if (!free.length) {
  console.error('Aufruf: node scripts/terrain-from-geotiff.mjs <dgm.tif|dgm.xyz …> [--origin E,N] [--north Grad] [--floor m] [--cell 1] [--bounds x0,y0,x1,y1] [--margin 15] [--write] [--out terrain.json]');
  process.exit(1);
}

const { DATA_DIR } = await import('../tests/lib/config.mjs');
const { parseModel } = await import('../src/model/model.js');
const file = join(DATA_DIR, 'model.yaml');
const text = existsSync(file) ? readFileSync(file, 'utf8') : null;
const model = text ? parseModel(text) : null;

let geo;
try {
  geo = georefFrom(opt, model);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const rasters = free.map((f) => {
  const r = readRaster(f);
  if (!r.affine) throw new Error(`${f}: keine Lage (GeoTIFF ohne Georeferenz?)`);
  return r;
});

/** Ausdehnung des Modells im Plan (Wände, Räume, Außenbereiche) */
function modelBounds(m) {
  const pts = [];
  for (const b of m?.buildings || []) for (const f of b.floors || []) {
    for (const w of f.walls || []) pts.push(...w);
    for (const r of f.rooms || []) pts.push(...(r.polygon || []));
  }
  for (const o of m?.outdoor || []) pts.push(...(o.polygon || []).map((p) => p.slice(0, 2)));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const cell = Number(opt('--cell', 1));
const margin = Number(opt('--margin', 15));
let bounds = opt('--bounds') ? opt('--bounds').split(',').map(Number) : modelBounds(model);
if (!bounds) {
  console.error('Ausschnitt fehlt: --bounds x0,y0,x1,y1 (oder ein Modell mit Wänden/Bereichen)');
  process.exit(1);
}
if (!opt('--bounds')) bounds = [bounds[0] - margin, bounds[1] - margin, bounds[2] + margin, bounds[3] + margin];
const snap = (a) => Math.round(Math.floor(a / cell + 1e-6) * cell * 1000) / 1000;
const ox = snap(bounds[0]), oy = snap(bounds[1]);
const nx = Math.floor((bounds[2] - ox) / cell + 1e-6) + 1, ny = Math.floor((bounds[3] - oy) / cell + 1e-6) + 1;

const r3 = (x) => Math.round(x * 1000) / 1000;
let filled = 0;
const heights = Array.from({ length: ny }, (_, j) => Array.from({ length: nx }, (_, i) => {
  const [E, N] = geo.toGeo([ox + i * cell, oy + j * cell]);
  const z = sampleAny(rasters, E, N);
  if (z == null) return null;
  filled++;
  return r3(z - geo.floor);
}));
const terrain = { origin: [ox, oy], cell, heights };
const all = heights.flat().filter((v) => v != null);
console.log(`Raster ${nx} × ${ny} (${cell} m) ab [${ox}, ${oy}], ${filled} von ${nx * ny} Punkten aus dem DGM` +
  (all.length ? `, Höhen ${Math.min(...all).toFixed(2)} … ${Math.max(...all).toFixed(2)} m relativ zum EG-Fußboden` : ''));
if (!filled) console.warn('Kein Punkt im DGM – Einpassung (--origin/--north) oder Kacheln prüfen.');

if (opt('--out')) {
  writeFileSync(opt('--out'), JSON.stringify(terrain));
  console.log(`-> ${opt('--out')}`);
}
if (flag('--write')) {
  if (!model) {
    console.error(`${file} fehlt – erst ein Modell anlegen (scripts/import-building.mjs)`);
    process.exit(1);
  }
  const { toYaml, yamlHeader } = await import('../src/model/yaml.js');
  const keep = model.site.terrain || {};
  model.site.terrain = { ...terrain, ...(keep.texture ? { texture: keep.texture } : {}), ...(keep.shading != null ? { shading: keep.shading } : {}) };
  writeFileSync(file, toYaml(model, yamlHeader(text)));
  console.log(`site.terrain -> ${file}. Außenbereiche mit "follow: terrain" auf das Gelände legen; dann npm run validate`);
} else if (!opt('--out')) {
  console.log(JSON.stringify({ terrain }));
}
