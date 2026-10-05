// Luftbild für site.terrain.texture (docs/DATA_MODEL.md) aus einem Orthophoto (z. B. DOP20 der Länder): schneidet
// das Bild auf den Bereich des Höhenrasters zu, dreht es in Plan-Ausrichtung und speichert es als JPEG im
// Datenordner (höchstens 4096 Pixel je Seite). Ohne Lageangabe deckt das Bild dann genau das Raster ab.
//
//   node scripts/orthophoto-crop.mjs dop.tif|dop.jpg [weitere Kacheln …] [--origin E,N] [--north 20]
//        [--res 0.2] [--bounds x0,y0,x1,y1] [--out textures/luftbild.jpg] [--quality 0.85] [--write]
//
//   Eingaben: GeoTIFF (RGB, unkomprimiert/LZW/Deflate) oder JPG/PNG mit World-Datei (.jgw/.pgw). JPEG-komprimierte
//   GeoTIFFs vorher umwandeln: gdal_translate -co COMPRESS=DEFLATE dop.tif dop_deflate.tif
//   --res     Meter je Pixel (Standard 0,2 = DOP20; wird gröber, wenn das Bild sonst größer als 4096 wäre)
//   --bounds  Ausschnitt im Plan (Standard: Bereich von site.terrain)
//   --write   site.terrain.texture im Modell setzen
// Die Einpassung (Plan-Ursprung in Landeskoordinaten, Nordrichtung) kommt aus site.georef oder den Optionen –
// dieselbe wie bei scripts/terrain-from-geotiff.mjs. Den Browser zum Umrechnen stellen die Tests (tests/lib/browser.mjs).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { cli, readTiff, worldFileFor, georefFrom } from './lib/geodata.mjs';

const MAX = 4096;
const VALUE_OPTS = ['--origin', '--north', '--res', '--bounds', '--out', '--quality', '--data'];
const { opt, free, flag } = cli(process.argv, VALUE_OPTS);
if (!free.length) {
  console.error('Aufruf: node scripts/orthophoto-crop.mjs <dop.tif|dop.jpg …> [--origin E,N] [--north Grad] [--res 0.2] [--bounds x0,y0,x1,y1] [--out textures/luftbild.jpg] [--write]');
  process.exit(1);
}

const { DATA_DIR } = await import('../tests/lib/config.mjs');
const { parseModel, terrainOf } = await import('../src/model/model.js');
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
const grid = terrainOf(model);
const bounds = opt('--bounds') ? opt('--bounds').split(',').map(Number) : grid?.extent;
if (!bounds) {
  console.error('Ausschnitt fehlt: --bounds x0,y0,x1,y1 oder site.terrain im Modell');
  process.exit(1);
}
const [x0, y0, x1, y1] = bounds;
let res = Number(opt('--res', 0.2));
res = Math.max(res, (x1 - x0) / MAX, (y1 - y0) / MAX);
const W = Math.max(1, Math.round((x1 - x0) / res)), H = Math.max(1, Math.round((y1 - y0) / res));

/** Abbildung Quellpixel -> Ausgabepixel (affine Matrix für canvas.setTransform) */
function toOutput(affine) {
  const [a, b, c, d, e, f] = affine;
  // Quellpixel -> Plan: Plan = toPlan(geo) ist affin; aus drei Punkten bestimmen
  const P = (px, py) => geo.toPlan([a * px + b * py + c, d * px + e * py + f]);
  const o = P(0, 0), ux = P(1, 0), uy = P(0, 1);
  const U = (p) => [(p[0] - x0) / res, (p[1] - y0) / res];
  const O = U(o), X = U(ux), Y = U(uy);
  return [X[0] - O[0], X[1] - O[1], Y[0] - O[0], Y[1] - O[1], O[0], O[1]];
}

/** Bereich der Quelle (Pixel), der den Ausschnitt abdeckt */
function sourceWindow(affine, w, h) {
  const [a, b, c, d, e, f] = affine;
  const det = a * e - b * d;
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((p) => {
    const [E, N] = geo.toGeo(p);
    return [(e * (E - c) - b * (N - f)) / det, (-d * (E - c) + a * (N - f)) / det];
  });
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  const cx0 = Math.max(0, Math.floor(Math.min(...xs)) - 2), cy0 = Math.max(0, Math.floor(Math.min(...ys)) - 2);
  const cx1 = Math.min(w, Math.ceil(Math.max(...xs)) + 2), cy1 = Math.min(h, Math.ceil(Math.max(...ys)) + 2);
  return cx1 > cx0 && cy1 > cy0 ? [cx0, cy0, cx1, cy1] : null;
}

const sources = [];
for (const f of free) {
  if (/\.tiff?$/i.test(f)) {
    const r = readTiff(readFileSync(f));
    if (!r.affine) throw new Error(`${f}: keine Lage (GeoTIFF ohne Georeferenz?)`);
    const win = sourceWindow(r.affine, r.width, r.height);
    if (!win) continue;
    const [cx0, cy0, cx1, cy1] = win, cw = cx1 - cx0, ch = cy1 - cy0;
    const rgba = new Uint8ClampedArray(cw * ch * 4);
    const max = r.data[0].reduce((m, v) => Math.max(m, v), 0) > 255 ? 65535 : 255; // 16-Bit-Bilder
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const s = (cy0 + y) * r.width + cx0 + x, o = (y * cw + x) * 4;
        for (let k = 0; k < 3; k++) rgba[o + k] = (r.data[Math.min(k, r.bands - 1)][s] * 255) / max;
        rgba[o + 3] = r.bands >= 4 ? (r.data[3][s] * 255) / max : 255;
      }
    }
    const [a, b, c, d, e, ff] = r.affine;
    const shifted = [a, b, c + a * cx0 + b * cy0, d, e, ff + d * cx0 + e * cy0];
    sources.push({ kind: 'raw', w: cw, h: ch, data: Buffer.from(rgba.buffer).toString('base64'), m: toOutput(shifted) });
  } else {
    const affine = worldFileFor(f);
    if (!affine) throw new Error(`${f}: keine World-Datei (.jgw/.pgw) daneben gefunden`);
    const mime = /\.png$/i.test(f) ? 'image/png' : 'image/jpeg';
    sources.push({ kind: 'img', url: `data:${mime};base64,${readFileSync(f).toString('base64')}`, m: toOutput(affine) });
  }
}
if (!sources.length) {
  console.error('Keine Kachel überdeckt den Ausschnitt – Einpassung (--origin/--north) prüfen.');
  process.exit(1);
}

const { launchBrowser } = await import('../tests/lib/browser.mjs');
const browser = await launchBrowser();
const page = await browser.newPage();
const quality = Number(opt('--quality', 0.85));
const dataUrl = await page.evaluate(async ({ W, H, sources, quality }) => {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#6b7f4a'; // Lücken (keine Kachel): neutrales Grün
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  for (const s of sources) {
    let src;
    if (s.kind === 'raw') {
      const bin = atob(s.data), arr = new Uint8ClampedArray(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      src = await createImageBitmap(new ImageData(arr, s.w, s.h));
    } else {
      const img = new Image();
      img.src = s.url;
      await img.decode();
      src = img;
    }
    ctx.setTransform(...s.m);
    ctx.drawImage(src, 0, 0);
  }
  return cv.toDataURL('image/jpeg', quality);
}, { W, H, sources, quality });
await browser.close();

const rel = opt('--out', 'textures/luftbild.jpg');
const outPath = join(DATA_DIR, rel);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`Luftbild ${W} × ${H} px (${res.toFixed(3)} m/px) für Plan [${x0}, ${y0}] … [${x1}, ${y1}] -> ${outPath}`);

if (flag('--write')) {
  if (!model) {
    console.error(`${file} fehlt`);
    process.exit(1);
  }
  const { toYaml, yamlHeader } = await import('../src/model/yaml.js');
  const prev = model.site.terrain?.texture;
  const keep = prev && typeof prev === 'object' ? { strength: prev.strength, exclude: prev.exclude } : {};
  const tex = { file: rel, ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v != null)) };
  if (opt('--bounds')) Object.assign(tex, { origin: [x0, y0], size: [x1 - x0, y1 - y0] });
  model.site.terrain = { ...(model.site.terrain || {}), texture: Object.keys(tex).length === 1 ? rel : tex };
  writeFileSync(file, toYaml(model, yamlHeader(text)));
  console.log(`site.terrain.texture -> ${file}`);
}
