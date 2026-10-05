// Bäume aus einem normalisierten Oberflächenmodell (nDOM: Höhe über Gelände, z. B. nDOM1 der Länder, GeoTIFF oder
// XYZ) als Objekte ins Modell (docs/DATA_MODEL.md, Katalog tree/shrub). Je Baum: lokales Maximum über einer
// Mindesthöhe (Wipfel), Krone = zusammenhängende Fläche um den Wipfel, die nach außen abfällt (Wasserscheide);
// Kronendurchmesser aus ihrer Fläche. Gebäude (Grundflächen im Modell, plus --exclude) werden ausgespart.
//
//   node scripts/trees-from-ndom.mjs ndom.tif [weitere Kacheln …] [--origin E,N] [--north 20] [--min 3]
//        [--cell 0.5] [--bounds x0,y0,x1,y1] [--margin 15] [--exclude polygone.json] [--write] [--out trees.json]
//
//   --min      Mindesthöhe eines Wipfels über Gelände (Meter, Standard 3; darunter Büsche, Hecken, Autos)
//   --shrubs   auch Sträucher: Wipfel ab 1,2 m bis --min (als shrub)
//   --exclude  JSON-Datei mit Polygonen im Plan [[[x, y], …], …], z. B. Nachbargebäude
//   --write    Objekte in model.yaml schreiben (ersetzt frühere Bäume aus diesem Werkzeug, IDs ndom_…)
// Form: schmal und hoch -> conifer, sonst round (Laubbaum); im Editor nachbessern (Birke, Obstbaum …).
// Einpassung wie bei scripts/terrain-from-geotiff.mjs (site.georef oder --origin/--north).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cli, readRaster, sampleAny, georefFrom } from './lib/geodata.mjs';

const VALUE_OPTS = ['--origin', '--north', '--floor', '--min', '--cell', '--bounds', '--margin', '--exclude', '--out', '--data'];
const { opt, free, flag } = cli(process.argv, VALUE_OPTS);
if (!free.length) {
  console.error('Aufruf: node scripts/trees-from-ndom.mjs <ndom.tif|ndom.xyz …> [--origin E,N] [--north Grad] [--min 3] [--shrubs] [--cell 0.5] [--bounds x0,y0,x1,y1] [--exclude polygone.json] [--write] [--out trees.json]');
  process.exit(1);
}

const { DATA_DIR } = await import('../tests/lib/config.mjs');
const { parseModel } = await import('../src/model/model.js');
const { pointInPoly } = await import('../src/geometry.js');
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
const rasters = free.map((f) => readRaster(f));

/** Grundflächen der Gebäude (Räume und Wände aller Etagen) plus --exclude */
const blocked = [];
for (const b of model?.buildings || []) for (const f of b.floors || []) {
  for (const r of f.rooms || []) if (r.polygon?.length >= 3) blocked.push(r.polygon);
  for (const w of f.walls || []) {
    // Wand als schmales Rechteck (0,4 m)
    const [[ax, ay], [bx, by]] = w, l = Math.hypot(bx - ax, by - ay) || 1, nx = (-(by - ay) / l) * 0.2, ny = ((bx - ax) / l) * 0.2;
    blocked.push([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]);
  }
}
if (opt('--exclude')) blocked.push(...JSON.parse(readFileSync(opt('--exclude'), 'utf8')));

const cell = Number(opt('--cell', 0.5));
const minH = Number(opt('--min', 3));
const lowH = flag('--shrubs') ? 1.2 : minH;
let bounds = opt('--bounds')?.split(',').map(Number);
if (!bounds) {
  const pts = [...blocked.flat(), ...(model?.outdoor || []).flatMap((o) => o.polygon || [])];
  const t = model?.site?.terrain;
  if (t?.heights?.length) {
    const c = t.cell ?? 0.5, [ox, oy] = t.origin || [0, 0];
    pts.push([ox, oy], [ox + (t.heights[0].length - 1) * c, oy + (t.heights.length - 1) * c]);
  }
  if (!pts.length) {
    console.error('Ausschnitt fehlt: --bounds x0,y0,x1,y1 (oder ein Modell mit Gebäuden/Raster)');
    process.exit(1);
  }
  const m = opt('--margin') != null ? Number(opt('--margin')) : t?.heights?.length ? 0 : 15;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  bounds = [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
}
const [x0, y0, x1, y1] = bounds;
const nx = Math.floor((x1 - x0) / cell) + 1, ny = Math.floor((y1 - y0) / cell) + 1;

// nDOM im Plan-Raster, Gebäude = 0
const h = new Float32Array(nx * ny);
for (let j = 0; j < ny; j++) {
  for (let i = 0; i < nx; i++) {
    const p = [x0 + i * cell, y0 + j * cell];
    const v = sampleAny(rasters, ...geo.toGeo(p));
    h[j * nx + i] = v != null && v > 0 && !blocked.some((poly) => pointInPoly(p, poly)) ? v : 0;
  }
}

// Wipfel: Maximum im Umkreis von 1,5 m, über der Mindesthöhe; höchste zuerst
const R = Math.max(1, Math.round(1.5 / cell));
const peaks = [];
for (let j = 0; j < ny; j++) {
  for (let i = 0; i < nx; i++) {
    const v = h[j * nx + i];
    if (v < lowH) continue;
    let top = true;
    for (let b = -R; b <= R && top; b++) {
      for (let a = -R; a <= R; a++) {
        if ((a || b) && a * a + b * b <= R * R) {
          const ii = i + a, jj = j + b;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const w = h[jj * nx + ii];
          if (w > v || (w === v && (b < 0 || (b === 0 && a < 0)))) { top = false; break; }
        }
      }
    }
    if (top) peaks.push({ i, j, v });
  }
}
peaks.sort((a, b) => b.v - a.v);

// Kronen: von allen Wipfeln gleichzeitig nach außen wachsen (höchste Zellen zuerst), solange es abwärts geht und die
// Höhe über der Hälfte des Wipfels liegt
const owner = new Int32Array(nx * ny).fill(-1);
const order = [];
peaks.forEach((p, k) => {
  owner[p.j * nx + p.i] = k;
  order.push(p.j * nx + p.i);
});
for (let q = 0; q < order.length; q++) {
  const c = order[q], k = owner[c], i = c % nx, j = (c - i) / nx;
  for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ii = i + a, jj = j + b;
    if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
    const n = jj * nx + ii;
    if (owner[n] >= 0 || h[n] < Math.max(lowH * 0.5, peaks[k].v * 0.45) || h[n] > h[c] + 0.3) continue;
    owner[n] = k;
    order.push(n);
  }
}
const area = new Float64Array(peaks.length);
for (const k of owner) if (k >= 0) area[k] += cell * cell;

const r1 = (x) => Math.round(x * 10) / 10;
const trees = peaks.map((p, k) => {
  const D = Math.max(1, 2 * Math.sqrt(area[k] / Math.PI));
  const H = p.v;
  const shrub = H < minH;
  const o = { id: `ndom_${k + 1}`, name: shrub ? 'Strauch' : 'Baum', model: shrub ? 'shrub' : 'tree', pos: [r1(x0 + p.i * cell), r1(y0 + p.j * cell)] };
  if (shrub) o.size = [r1(D), r1(D), r1(H)];
  else {
    o.size = [r1(D), r1(D), r1(H)];
    if (D / H < 0.38) o.params = { shape: 'conifer' };
  }
  return o;
}).filter((o) => o.size[0] >= 0.8);

console.log(`${trees.length} Bäume/Sträucher (Wipfel ab ${lowH} m) im Bereich [${x0}, ${y0}] … [${x1}, ${y1}]`);
for (const t of trees.slice(0, 12)) console.log(`  ${t.id}: ${t.model}${t.params?.shape ? ` (${t.params.shape})` : ''} bei [${t.pos}], Krone ${t.size[0]} m, Höhe ${t.size[2]} m`);
if (trees.length > 12) console.log(`  … und ${trees.length - 12} weitere`);

if (opt('--out')) writeFileSync(opt('--out'), JSON.stringify(trees, null, 1));
if (flag('--write')) {
  if (!model) {
    console.error(`${file} fehlt`);
    process.exit(1);
  }
  const { toYaml, yamlHeader } = await import('../src/model/yaml.js');
  model.objects = [...(model.objects || []).filter((o) => !String(o.id).startsWith('ndom_')), ...trees];
  writeFileSync(file, toYaml(model, yamlHeader(text)));
  console.log(`-> ${file} (Objekte ohne Bereich stehen auf dem Gelände; im Editor einem Bereich zuordnen oder nachbessern)`);
} else if (!opt('--out')) {
  console.log(JSON.stringify(trees));
}
