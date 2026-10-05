// Offene Geodaten lesen (ohne zusätzliche Pakete) und in den Plan einpassen – gemeinsam für
// scripts/terrain-from-geotiff.mjs, scripts/orthophoto-crop.mjs und scripts/trees-from-ndom.mjs.
//
// Gelesen werden:
//   - GeoTIFF: Graustufen oder RGB(A), 8/16/32/64 Bit (Ganzzahl oder Gleitkomma), unkomprimiert, LZW, Deflate,
//     PackBits, Prädiktor 2/3, Streifen und Kacheln; Lage aus ModelTiepoint + ModelPixelScale oder
//     ModelTransformation. JPEG-komprimierte TIFFs (oft bei Orthophotos) bitte vorher umwandeln, z. B.
//     `gdal_translate -co COMPRESS=DEFLATE dop.tif dop_deflate.tif` oder als JPG mit World-Datei.
//   - XYZ/ASCII-Gitter (`x y z` je Zeile, Leerzeichen, Komma oder Semikolon), wie viele DGM1-Downloads.
//   - World-Dateien (.jgw/.pgw/.tfw) zu JPG/PNG.
// Koordinaten bleiben die des Datensatzes (z. B. UTM, EPSG:25832); die Einpassung in den Plan beschreibt
// site.georef (docs/DATA_MODEL.md) bzw. die Optionen --origin, --north und --floor.
import { inflateSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8 };

/** TIFF/GeoTIFF lesen -> { width, height, bands, data: Float64Array[] (je Band), affine, noData } */
export function readTiff(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = dv.getUint16(0) === 0x4949;
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const big = u16(2) === 43;
  if (!big && u16(2) !== 42) throw new Error('keine TIFF-Datei');
  const u64 = (o) => Number(dv.getBigUint64(o, le));
  const ifd = big ? u64(8) : u32(4);
  const n = big ? u64(ifd) : u16(ifd);
  const tags = {};
  for (let k = 0; k < n; k++) {
    const e = big ? ifd + 8 + k * 20 : ifd + 2 + k * 12;
    const tag = u16(e), type = u16(e + 2), count = big ? u64(e + 4) : u32(e + 4);
    const size = (TYPE_SIZE[type] || 1) * count;
    const inline = big ? 8 : 4;
    const off = size <= inline ? e + (big ? 12 : 8) : big ? u64(e + 12) : u32(e + 8);
    const read = (i) => {
      const o = off + i * (TYPE_SIZE[type] || 1);
      switch (type) {
        case 1: case 7: return dv.getUint8(o);
        case 2: return dv.getUint8(o);
        case 3: return u16(o);
        case 4: return u32(o);
        case 5: return u32(o) / u32(o + 4);
        case 6: return dv.getInt8(o);
        case 8: return dv.getInt16(o, le);
        case 9: return dv.getInt32(o, le);
        case 10: return dv.getInt32(o, le) / dv.getInt32(o + 4, le);
        case 11: return dv.getFloat32(o, le);
        case 12: return dv.getFloat64(o, le);
        case 16: return u64(o);
        case 17: return Number(dv.getBigInt64(o, le));
        default: return 0;
      }
    };
    tags[tag] = type === 2 ? new TextDecoder().decode(buf.subarray(off, off + count)).replace(/\0+$/, '') : Array.from({ length: count }, (_, i) => read(i));
  }
  const width = tags[256][0], height = tags[257][0];
  const bps = tags[258] || [1], spp = (tags[277] || [1])[0];
  const fmt = (tags[339] || [1])[0], comp = (tags[259] || [1])[0], pred = (tags[317] || [1])[0];
  const planar = (tags[284] || [1])[0];
  if (comp === 7 || comp === 6) throw new Error('JPEG-komprimiertes TIFF – bitte umwandeln (gdal_translate -co COMPRESS=DEFLATE … oder als JPG mit World-Datei)');
  if (![1, 5, 8, 32946, 32773].includes(comp)) throw new Error(`TIFF-Kompression ${comp} wird nicht unterstützt`);
  const bits = bps[0], bytes = bits / 8;
  if (![8, 16, 32, 64].includes(bits)) throw new Error(`${bits} Bit je Wert werden nicht unterstützt`);
  const tiled = !!tags[322];
  const tw = tiled ? tags[322][0] : width, th = tiled ? tags[323][0] : (tags[278] || [height])[0];
  const offsets = tiled ? tags[324] : tags[273], counts = tiled ? tags[325] : tags[279];
  const bandsPerChunk = planar === 2 ? 1 : spp;
  const data = Array.from({ length: spp }, () => new Float64Array(width * height));
  const across = Math.ceil(width / tw), down = Math.ceil(height / th);
  const chunksPerPlane = across * down;
  for (let c = 0; c < offsets.length; c++) {
    let raw = buf.subarray(offsets[c], offsets[c] + counts[c]);
    if (comp === 5) raw = lzw(raw);
    else if (comp === 8 || comp === 32946) raw = inflateSync(raw);
    else if (comp === 32773) raw = packbits(raw);
    const plane = planar === 2 ? Math.floor(c / chunksPerPlane) : 0;
    const ci = c % chunksPerPlane, cx = (ci % across) * tw, cy = Math.floor(ci / across) * th;
    const rowLen = tw * bandsPerChunk;
    const rows = Math.min(th, tiled ? th : height - cy);
    const vals = decodeRows(raw, rowLen, rows, bytes, fmt, le, pred, bandsPerChunk);
    for (let y = 0; y < rows; y++) {
      const gy = cy + y;
      if (gy >= height) break;
      for (let x = 0; x < tw; x++) {
        const gx = cx + x;
        if (gx >= width) break;
        for (let b = 0; b < bandsPerChunk; b++) data[plane + b][gy * width + gx] = vals[y * rowLen + x * bandsPerChunk + b];
      }
    }
  }
  // Lage
  let affine = null;
  if (tags[34264]) {
    const m = tags[34264];
    affine = [m[0], m[1], m[3], m[4], m[5], m[7]];
  } else if (tags[33922] && tags[33550]) {
    const [i, j, , X, Y] = tags[33922], [sx, sy] = tags[33550];
    affine = [sx, 0, X - i * sx, 0, -sy, Y + j * sy];
  }
  // RasterPixelIsPoint: der Passpunkt ist die Pixelmitte -> auf die Ecke umrechnen
  const keys = tags[34735];
  if (affine && keys) {
    for (let k = 4; k + 3 < keys.length; k += 4) {
      if (keys[k] === 1025 && keys[k + 3] === 2) {
        affine[2] -= (affine[0] + affine[1]) / 2;
        affine[5] -= (affine[3] + affine[4]) / 2;
      }
    }
  }
  const noData = tags[42113] != null ? Number(tags[42113]) : null;
  return { width, height, bands: spp, data, affine, noData };
}

function decodeRows(raw, rowLen, rows, bytes, fmt, le, pred, spp) {
  const out = new Float64Array(rowLen * rows);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (pred === 3) {
    // Gleitkomma-Prädiktor: Bytes je Zeile differenziert und nach Byte-Ebenen sortiert
    const rowBytes = rowLen * bytes;
    const tmp = new Uint8Array(rowBytes);
    const tv = new DataView(tmp.buffer);
    for (let y = 0; y < rows; y++) {
      const o = y * rowBytes;
      const row = raw.subarray(o, o + rowBytes);
      const acc = Uint8Array.from(row);
      for (let i = spp; i < rowBytes; i++) acc[i] = (acc[i] + acc[i - spp]) & 255;
      for (let i = 0; i < rowLen; i++) for (let b = 0; b < bytes; b++) tmp[i * bytes + b] = acc[(bytes - 1 - b) * rowLen + i];
      for (let i = 0; i < rowLen; i++) out[y * rowLen + i] = bytes === 4 ? tv.getFloat32(i * 4, true) : tv.getFloat64(i * 8, true);
    }
    return out;
  }
  const get = (o) => {
    if (fmt === 3) return bytes === 4 ? dv.getFloat32(o, le) : dv.getFloat64(o, le);
    if (fmt === 2) return bytes === 1 ? dv.getInt8(o) : bytes === 2 ? dv.getInt16(o, le) : dv.getInt32(o, le);
    return bytes === 1 ? dv.getUint8(o) : bytes === 2 ? dv.getUint16(o, le) : dv.getUint32(o, le);
  };
  for (let i = 0; i < rowLen * rows && (i + 1) * bytes <= raw.byteLength; i++) out[i] = get(i * bytes);
  if (pred === 2) {
    const mod = fmt === 2 ? 0 : 2 ** (bytes * 8);
    for (let y = 0; y < rows; y++) {
      for (let i = spp; i < rowLen; i++) {
        let v = out[y * rowLen + i] + out[y * rowLen + i - spp];
        if (mod) v %= mod;
        out[y * rowLen + i] = v;
      }
    }
  }
  return out;
}

/** LZW (TIFF-Variante, MSB zuerst) */
function lzw(src) {
  const out = [];
  let dict = [], bitPos = 0, width = 9, prev = null;
  const reset = () => {
    dict = Array.from({ length: 258 }, (_, i) => (i < 256 ? [i] : []));
    width = 9;
  };
  reset();
  const read = () => {
    let v = 0;
    for (let i = 0; i < width; i++) {
      const byte = src[(bitPos + i) >> 3];
      if (byte === undefined) return 257;
      v = (v << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += width;
    return v;
  };
  for (;;) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { reset(); prev = null; continue; }
    let entry;
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else break;
    for (const b of entry) out.push(b);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length + 1 >= 1 << width && width < 12) width++;
  }
  return Uint8Array.from(out);
}

function packbits(src) {
  const out = [];
  for (let i = 0; i < src.length;) {
    const n = (src[i] << 24) >> 24;
    i++;
    if (n >= 0) { for (let k = 0; k <= n; k++) out.push(src[i + k]); i += n + 1; }
    else if (n !== -128) { for (let k = 0; k < 1 - n; k++) out.push(src[i]); i++; }
  }
  return Uint8Array.from(out);
}

/**
 * XYZ-Gitter (x y z je Zeile) -> Raster wie readTiff (ein Band). Die Punkte liegen auf einem regelmäßigen Gitter;
 * Abstand und Ausdehnung werden aus den Daten bestimmt, fehlende Punkte bleiben NaN.
 */
export function readXyz(text) {
  const pts = [];
  for (const line of text.split(/\r?\n/)) {
    const v = line.trim().split(/[\s,;]+/).map(Number);
    if (v.length >= 3 && v.slice(0, 3).every(Number.isFinite)) pts.push(v);
  }
  if (!pts.length) throw new Error('keine XYZ-Punkte gefunden');
  const step = (vals) => {
    const s = [...new Set(vals.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
    let d = Infinity;
    for (let i = 1; i < s.length; i++) d = Math.min(d, s[i] - s[i - 1]);
    return { min: s[0], max: s[s.length - 1], d: Number.isFinite(d) ? d : 1 };
  };
  const X = step(pts.map((p) => p[0])), Y = step(pts.map((p) => p[1]));
  const width = Math.round((X.max - X.min) / X.d) + 1, height = Math.round((Y.max - Y.min) / Y.d) + 1;
  const data = new Float64Array(width * height).fill(NaN);
  for (const [x, y, z] of pts) data[Math.round((Y.max - y) / Y.d) * width + Math.round((x - X.min) / X.d)] = z;
  // Punkte = Pixelmitten
  return { width, height, bands: 1, data: [data], affine: [X.d, 0, X.min - X.d / 2, 0, -Y.d, Y.max + Y.d / 2], noData: null };
}

/** World-Datei (6 Zeilen: a, d, b, e, c, f; Bezug Pixelmitte) -> affine [a, b, c, d, e, f] (Bezug Pixelecke) */
export function readWorldFile(text) {
  const [a, d, b, e, c, f] = text.trim().split(/\s+/).map(Number);
  return [a, b, c - a / 2 - b / 2, d, e, f - d / 2 - e / 2];
}

/** World-Datei neben einer Bilddatei suchen (.jgw, .pgw, .tfw, .wld) */
export function worldFileFor(path) {
  const base = path.replace(/\.[^.]+$/, '');
  const ext = path.slice(base.length + 1).toLowerCase();
  const cands = [`${ext[0]}${ext[ext.length - 1]}w`, `${ext}w`, 'wld', 'tfw', 'jgw', 'pgw'];
  for (const c of cands) for (const p of [`${base}.${c}`, `${base}.${c.toUpperCase()}`]) if (existsSync(p)) return readWorldFile(readFileSync(p, 'utf8'));
  return null;
}

/** Raster-Datei nach Endung lesen (GeoTIFF oder XYZ) */
export function readRaster(path) {
  if (/\.(tiff?|gtiff?)$/i.test(path)) return readTiff(readFileSync(path));
  if (/\.(xyz|txt|asc|csv)$/i.test(path)) return readXyz(readFileSync(path, 'utf8'));
  throw new Error(`${path}: unbekanntes Format (GeoTIFF oder XYZ erwartet)`);
}

/** Wert eines Rasters an Koordinaten (E, N), bilinear; null außerhalb oder bei NoData */
export function sampleRaster(r, E, N, band = 0) {
  const [a, b, c, d, e, f] = r.affine;
  const det = a * e - b * d;
  const px = (e * (E - c) - b * (N - f)) / det - 0.5, py = (-d * (E - c) + a * (N - f)) / det - 0.5;
  if (px < -0.5 || py < -0.5 || px > r.width - 0.5 || py > r.height - 0.5) return null;
  const x0 = Math.max(0, Math.min(r.width - 1, Math.floor(px))), y0 = Math.max(0, Math.min(r.height - 1, Math.floor(py)));
  const x1 = Math.min(r.width - 1, x0 + 1), y1 = Math.min(r.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, px - x0)), fy = Math.max(0, Math.min(1, py - y0));
  const D = r.data[band];
  const ok = (v) => Number.isFinite(v) && (r.noData == null || Math.abs(v - r.noData) > 1e-6) && v > -9000;
  const P = [[D[y0 * r.width + x0], (1 - fx) * (1 - fy)], [D[y0 * r.width + x1], fx * (1 - fy)], [D[y1 * r.width + x0], (1 - fx) * fy], [D[y1 * r.width + x1], fx * fy]];
  let s = 0, w = 0;
  for (const [v, k] of P) if (ok(v) && k > 0) { s += v * k; w += k; }
  if (!w) return ok(P[0][0]) ? P[0][0] : null;
  return s / w;
}

/** Mehrere Raster (Kacheln) zusammen abtasten: das erste mit Daten gewinnt */
export function sampleAny(rasters, E, N, band = 0) {
  for (const r of rasters) {
    const v = sampleRaster(r, E, N, band);
    if (v != null) return v;
  }
  return null;
}

/**
 * Einpassung Plan <-> Landeskoordinaten (z. B. UTM). origin = [E, N] des Plan-Ursprungs, north_deg wie
 * site.north_deg (Norden im Plan, Grad im Uhrzeigersinn von Plan-oben), floor = Höhe des EG-Fußbodens im
 * Höhensystem der Daten (z. B. NHN). Plan-y zeigt nach unten.
 */
export function georef({ origin = [0, 0], north_deg = 0, floor = 0 } = {}) {
  const t = (north_deg * Math.PI) / 180;
  const nP = [Math.sin(t), -Math.cos(t)], eP = [Math.cos(t), Math.sin(t)];
  return {
    origin, north_deg, floor,
    toGeo: ([x, y]) => [origin[0] + x * eP[0] + y * eP[1], origin[1] + x * nP[0] + y * nP[1]],
    toPlan: ([E, N]) => {
      const dE = E - origin[0], dN = N - origin[1];
      return [dE * eP[0] + dN * nP[0], dE * eP[1] + dN * nP[1]];
    },
  };
}

/** Kommandozeile: Option mit Wert, Schalter, freie Argumente */
export function cli(argv, valueOpts) {
  const args = argv.slice(2);
  const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
  const free = args.filter((a, i) => !a.startsWith('--') && !valueOpts.includes(args[i - 1]));
  return { args, opt, free, flag: (n) => args.includes(n) };
}

/**
 * Einpassung aus Optionen (--origin E,N, --north Grad, --floor m) und/oder site.georef bzw. site.north_deg des
 * Modells; Optionen haben Vorrang.
 */
export function georefFrom(opt, model) {
  const g = model?.site?.georef || {};
  const num = (v) => (v == null ? undefined : Number(v));
  const origin = opt('--origin') ? opt('--origin').split(',').map(Number) : g.origin;
  if (!origin || origin.length !== 2 || !origin.every(Number.isFinite)) {
    throw new Error('Einpassung fehlt: --origin E,N (Landeskoordinaten des Plan-Ursprungs) oder site.georef.origin im Modell');
  }
  return georef({
    origin,
    north_deg: num(opt('--north')) ?? g.north_deg ?? model?.site?.north_deg ?? 0,
    floor: num(opt('--floor')) ?? g.floor ?? 0,
  });
}
