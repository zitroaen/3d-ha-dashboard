// Höhenraster (site.terrain, docs/DATA_MODEL.md) aus einem 3D-Scan des Grundstücks, z. B. iPhone-LiDAR mit
// Scaniverse, Polycam oder 3D Scanner App, exportiert als OBJ (texturiert oder nicht; USDZ bitte in der App als OBJ
// exportieren). Der Scan wird in die Plan-Koordinaten eingepasst (Drehung, Versatz, Höhe des EG-Fußbodens) und auf
// ein Raster abgetastet: je Rasterpunkt die niedrigste Fläche darüber (Boden unter Büschen; `--mode max` nimmt die
// höchste). Ohne Scan-Fläche bleibt der Punkt `null` (wird beim Laden aus den Nachbarn ergänzt).
//
//   node scripts/terrain-from-scan.mjs scan.obj [--cell 0.5] [--rotate 0] [--offset x,y] [--floor 0]
//        [--up y|z] [--mode min|max|mean] [--bounds x0,y0,x1,y1] [--write] [--out terrain.json]
//
//   --rotate  Drehung des Scans im Plan (Grad, gegen den Uhrzeigersinn von +x nach +y), vor dem Versatz
//   --offset  Verschiebung danach (Meter, Plan-Koordinaten)
//   --floor   Höhe des EG-Fußbodens im Scan (wird zu 0)
//   --up      Hochachse des Scans: y (Standard, OBJ aus den Scan-Apps) oder z
//   --write   site.terrain in model.yaml des Datenordners schreiben (DATA_DIR, --data, ha3d.config.json)
// Tipp: Passpunkte (z. B. zwei Hausecken) im Scan ablesen, Drehung/Versatz so wählen, dass sie auf den Ecken im
// Modell liegen; danach mit `npm run serve` ansehen.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const VALUE_OPTS = ['--cell', '--rotate', '--offset', '--floor', '--up', '--mode', '--bounds', '--out', '--data'];
const src = args.find((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(args[i - 1]));
if (!src) {
  console.error('Aufruf: node scripts/terrain-from-scan.mjs <scan.obj> [--cell 0.5] [--rotate 0] [--offset x,y] [--floor 0] [--up y|z] [--mode min|max|mean] [--bounds x0,y0,x1,y1] [--write] [--out terrain.json]');
  process.exit(1);
}
if (/\.usdz$/i.test(src)) {
  console.error('USDZ wird nicht gelesen – bitte den Scan in der App als OBJ exportieren.');
  process.exit(1);
}

const cell = Number(opt('--cell', 0.5));
const rot = (Number(opt('--rotate', 0)) * Math.PI) / 180;
const [dx, dy] = opt('--offset', '0,0').split(',').map(Number);
const floor = Number(opt('--floor', 0));
const up = opt('--up', 'y');
const mode = opt('--mode', 'min');

/** OBJ lesen: Punkte und Flächen (Polygone als Fächer in Dreiecke zerlegt) */
export function readObj(text) {
  const v = [], tris = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/).map(Number);
      v.push([x, y, z]);
    } else if (line.startsWith('f ')) {
      const idx = line.trim().split(/\s+/).slice(1).map((t) => {
        const k = parseInt(t.split('/')[0], 10);
        return k < 0 ? v.length + k : k - 1;
      });
      for (let i = 1; i + 1 < idx.length; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
    }
  }
  return { v, tris };
}

/** Scan-Punkt -> [Plan-x, Plan-y, Höhe] */
function toPlan([x, y, z]) {
  const [px, py, h] = up === 'z' ? [x, -y, z] : [x, z, y];
  const c = Math.cos(rot), s = Math.sin(rot);
  return [px * c - py * s + dx, px * s + py * c + dy, h - floor];
}

const { v, tris } = readObj(readFileSync(src, 'utf8'));
if (!tris.length) {
  console.error(`${src}: keine Flächen gefunden`);
  process.exit(1);
}
const P = v.map(toPlan);
const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
const [bx0, by0, bx1, by1] = opt('--bounds') ? opt('--bounds').split(',').map(Number) : [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
const snap = (a) => Math.round(Math.floor(a / cell + 1e-6) * cell * 1000) / 1000;
const ox = snap(bx0), oy = snap(by0);
const nx = Math.floor((bx1 - ox) / cell + 1e-6) + 1, ny = Math.floor((by1 - oy) / cell + 1e-6) + 1;
const acc = Array.from({ length: nx * ny }, () => null);
const sum = new Float64Array(nx * ny), cnt = new Uint32Array(nx * ny);

for (const [a, b, c] of tris) {
  const A = P[a], B = P[b], C = P[c];
  const d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
  if (Math.abs(d) < 1e-12) continue; // senkrechte Fläche (Wand) – trägt nichts zur Höhe bei
  const E = 1e-6; // Rundung (z. B. nach 90° Drehung): Punkte auf dem Rand mitnehmen
  const i0 = Math.max(0, Math.ceil((Math.min(A[0], B[0], C[0]) - ox) / cell - E)), i1 = Math.min(nx - 1, Math.floor((Math.max(A[0], B[0], C[0]) - ox) / cell + E));
  const j0 = Math.max(0, Math.ceil((Math.min(A[1], B[1], C[1]) - oy) / cell - E)), j1 = Math.min(ny - 1, Math.floor((Math.max(A[1], B[1], C[1]) - oy) / cell + E));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = ox + i * cell, y = oy + j * cell;
      const u = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / d;
      const w = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / d;
      if (u < -1e-6 || w < -1e-6 || u + w > 1 + 1e-6) continue;
      const h = u * A[2] + w * B[2] + (1 - u - w) * C[2], k = j * nx + i;
      if (mode === 'mean') { sum[k] += h; cnt[k]++; }
      else if (acc[k] == null || (mode === 'max' ? h > acc[k] : h < acc[k])) acc[k] = h;
    }
  }
}
if (mode === 'mean') for (let k = 0; k < acc.length; k++) if (cnt[k]) acc[k] = sum[k] / cnt[k];

const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const terrain = { origin: [ox, oy], cell, heights: Array.from({ length: ny }, (_, j) => acc.slice(j * nx, (j + 1) * nx).map(r3)) };
const filled = acc.filter((x) => x != null).length;
console.log(`Raster ${nx} × ${ny} (${cell} m) ab [${ox}, ${oy}], ${filled} von ${nx * ny} Punkten aus dem Scan`);

if (opt('--out')) {
  writeFileSync(opt('--out'), JSON.stringify(terrain));
  console.log(`-> ${opt('--out')}`);
}
if (args.includes('--write')) {
  const { DATA_DIR } = await import('../tests/lib/config.mjs');
  const { parseModel } = await import('../src/model/model.js');
  const { toYaml, yamlHeader } = await import('../src/model/yaml.js');
  const file = join(DATA_DIR, 'model.yaml');
  if (!existsSync(file)) {
    console.error(`${file} fehlt – erst ein Modell anlegen (scripts/import-building.mjs)`);
    process.exit(1);
  }
  const text = readFileSync(file, 'utf8');
  const model = parseModel(text);
  model.site.terrain = terrain;
  writeFileSync(file, toYaml(model, yamlHeader(text)));
  console.log(`site.terrain -> ${file}. Außenbereiche ohne eigene Höhen mit "follow: terrain" auf das Gelände legen; dann npm run validate`);
} else if (!opt('--out')) {
  console.log(JSON.stringify({ terrain }));
}
