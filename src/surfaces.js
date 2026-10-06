// Oberflächen als Daten: Bodenbeläge, Fassaden, Dächer, Kanten. Die Engine liefert nur die Muster-Generatoren
// (Verlegearten); welche Beläge es gibt, steht in der Beispiel-Bibliothek library/surfaces.yaml und in `surfaces` der
// Instanz (model.yaml), die Einträge ergänzt, überschreibt oder per `base` ableitet. Alternativ ein eigenes Bild
// (`image`, Datei im Datenordner). Format: docs/LIBRARY.md.
import * as THREE from 'three';
import { normalFromCanvas, noiseCanvas } from './textures.js';

// ---------------------------------------------------------------------------------------------
// Definitionen: Bibliothek + Instanz, Vererbung über `base`
// ---------------------------------------------------------------------------------------------

let LIB = {};
let OWN = {};

/** Bibliothek (Engine) und eigene Einträge (model.yaml → surfaces) setzen */
export function setSurfaceDefs(library, own) {
  if (library) LIB = library;
  OWN = own || {};
}

export const surfaceIds = () => [...new Set([...Object.keys(LIB), ...Object.keys(OWN)])];
export const isSurface = (id) => typeof id === 'string' && (id in LIB || id in OWN);
export const isOwnSurface = (id) => id in OWN && !(id in LIB);

/** Aufgelöste Definition (gleiche ID in der Instanz ergänzt den Bibliothekseintrag; `base` erbt) */
export function surfaceDef(id, depth = 0) {
  const lib = LIB[id], own = OWN[id];
  if (!lib && !own) return null;
  const d = { ...(lib || {}), ...(own || {}) };
  if (!d.base || depth > 8) return d;
  const parent = surfaceDef(d.base, depth + 1) || {};
  const { base, ...rest } = d;
  return { ...parent, ...rest };
}

/** Bekannte Muster und ihre Standardwerte (für Prüfung und Doku) */
export const PATTERNS = {
  planks: 'Dielen/Stäbe im Versatz: size [Länge, Breite], bond (Versatz-Anteil, z. B. 0.33, 0.5 oder random)',
  herringbone: 'Fischgrät: size [Länge, Breite] (Länge = ganzzahliges Vielfaches der Breite), rows (1, 2 = doppelt, 3)',
  chevron: 'Französisches Fischgrät (schräg gestoßen): size [Länge, Breite], angle (Grad, Standard 45)',
  basket: 'Würfel-/Flechtmuster: size (Kantenlänge eines Quadrats), strips (Stäbe je Quadrat)',
  tiles: 'Fliesen, Platten, Pflaster, Ziegelmauerwerk: size [Breite, Höhe], bond (0 = Kreuzfuge, 0.5 = Läuferverband)',
  siding: 'Holzschalung waagrecht: size (Brettbreite)',
  roof_tiles: 'Dachziegel: size [Breite, Lattung]',
  stone: 'Naturstein in Lagen (Trockenmauer): size [min. Lagenhöhe, max. Lagenhöhe]',
  flagstone: 'Polygonalplatten: size (mittlere Plattengröße)',
  speckle: 'Körnig (Kies, Erde, Dachbahn): size (Kachelgröße), spread (Helligkeitsstreuung)',
  lawn: 'Rasen: size (Kachelgröße)',
  plain: 'Einfarbig mit feiner Struktur (Beton, Estrich, Putz, Wasser): size (Strukturgröße)',
};

/** Prüft eine Definition, liefert Fehlermeldungen (leer = in Ordnung) */
export function checkSurface(id, raw) {
  const errs = [];
  if (!/^[a-z0-9_]+$/.test(id)) errs.push(`ID „${id}“: nur Kleinbuchstaben, Ziffern und _`);
  if (!raw || typeof raw !== 'object') return [...errs, `${id}: Objekt erwartet`];
  if (raw.base && !isSurface(raw.base)) errs.push(`${id}: base „${raw.base}“ unbekannt`);
  const d = surfaceDef(id) || raw;
  if (!d.image && !d.pattern) errs.push(`${id}: pattern oder image nötig`);
  if (d.pattern && !PATTERNS[d.pattern]) errs.push(`${id}: pattern „${d.pattern}“ unbekannt (${Object.keys(PATTERNS).join(', ')})`);
  for (const k of ['color', 'joint_color']) if (d[k] != null && !/^#[0-9a-fA-F]{6}$/.test(d[k])) errs.push(`${id}: ${k} als #rrggbb`);
  if (d.size != null && !(typeof d.size === 'number' || (Array.isArray(d.size) && d.size.every((v) => typeof v === 'number' && v > 0)))) errs.push(`${id}: size als Zahl oder [a, b] in Metern`);
  return errs;
}

// ---------------------------------------------------------------------------------------------
// Muster-Generatoren: kachelbare Canvas-Bilder in Metern
// ---------------------------------------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashSeed = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
// #rrggbb -> [r, g, b] 0..255 (sRGB wie im Canvas; THREE.Color rechnet linear)
const rgbOf = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const css = ([r, g, b], f = 1, a = 1) => `rgba(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0},${a})`;
const pair = (v, d) => (Array.isArray(v) ? [v[0], v[1] ?? v[0]] : v != null ? [v, v] : d);

/** Zeichenfläche für eine Kachel mx × my Metern */
function sheet(mx, my, res) {
  const px = res || Math.min(512, Math.floor(1024 / Math.max(mx, my)));
  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(mx * px));
  c.height = Math.max(16, Math.round(my * px));
  const g = c.getContext('2d');
  return { c, g, sx: c.width / mx, sy: c.height / my };
}

/**
 * Elemente (Stäbe, Fliesen …) als Vielecke in Metern zeichnen, über den Kachelrand fortgesetzt. Jedes Element hat
 * eine Richtung `a` (Maserung) und Länge/Breite für die Maserungslinien.
 */
function paintElements(els, mx, my, d, r) {
  const { c, g, sx, sy } = sheet(mx, my, d.res);
  const base = rgbOf(d.color || '#9f7c56');
  const joint = rgbOf(d.joint_color || (d.fill === 'wood' ? '#2a1a0c' : '#5a5650'));
  const jw = (d.joint ?? (d.fill === 'wood' ? 0.0015 : 0.004)) * sx;
  const v = d.variation ?? 0.12;
  g.fillStyle = css(joint);
  g.fillRect(0, 0, c.width, c.height);
  for (const el of els) {
    const f = 1 + (r() - 0.5) * 2 * v, hue = (r() - 0.5) * v * 0.4;
    const col = [base[0] * (1 + hue), base[1], base[2] * (1 - hue)];
    const grains = d.fill === 'wood' ? Array.from({ length: 6 }, () => [r(), 0.04 + r() * 0.09, 0.5 + r() * 1.2, r() * 6]) : null;
    const specks = d.fill === 'wood' ? 0 : 40 + Math.round(el.L * el.w * 400);
    for (const ox of [-mx, 0, mx]) {
      for (const oy of [-my, 0, my]) {
        const pts = el.pts.map(([x, y]) => [(x + ox) * sx, (y + oy) * sy]);
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        if (Math.max(...xs) < 0 || Math.min(...xs) > c.width || Math.max(...ys) < 0 || Math.min(...ys) > c.height) continue;
        g.save();
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p)));
        g.closePath();
        g.fillStyle = css(col, f);
        g.fill();
        g.clip();
        const ca = Math.cos(el.a), sa = Math.sin(el.a);
        const cx = (el.c[0] + ox) * sx, cy = (el.c[1] + oy) * sy;
        if (grains) {
          // Maserung: Linien entlang des Stabs, leicht gewellt
          for (const [o, alpha, lw, ph] of grains) {
            g.strokeStyle = `rgba(60,35,15,${alpha})`;
            g.lineWidth = lw;
            g.beginPath();
            for (let k = 0; k <= 10; k++) {
              const t = k / 10 - 0.5, q = (o - 0.5) * el.w + Math.sin(t * 9 + ph) * 0.002;
              const X = cx + (ca * t * el.L * 1.1 - sa * q) * sx, Y = cy + (sa * t * el.L * 1.1 + ca * q) * sy;
              k ? g.lineTo(X, Y) : g.moveTo(X, Y);
            }
            g.stroke();
          }
        } else {
          // Stein/Keramik: feine Sprenkel
          for (let k = 0; k < specks; k++) {
            g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.05})`;
            const t = r() - 0.5, q = r() - 0.5;
            g.fillRect(cx + (ca * t * el.L - sa * q * el.w) * sx, cy + (sa * t * el.L + ca * q * el.w) * sy, 1 + r() * 3, 1 + r() * 3);
          }
        }
        g.restore();
        if (jw > 0.3) {
          g.strokeStyle = css(joint, 1, 0.85);
          g.lineWidth = jw;
          g.beginPath();
          pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p)));
          g.closePath();
          g.stroke();
        }
      }
    }
  }
  return { canvas: c, meters: [mx, my] };
}

const rect = (x, y, w, h, a = 0) => ({
  pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
  c: [x + w / 2, y + h / 2], a, L: a ? h : w, w: a ? w : h,
});

const GEN = {
  planks(d, r) {
    const [L, W] = pair(d.size, [1.2, 0.2]);
    const random = d.bond === 'random';
    const bond = random ? 0 : d.bond ?? 1 / 3;
    // Versatz wiederholt sich nach `period` Reihen (1/3 -> 3, 0.5 -> 2); zufällig: 12 Reihen
    const period = random ? 12 : bond > 0 ? Math.max(1, Math.round(1 / bond)) : 1;
    const perL = Math.max(1, Math.round(2.4 / L));
    const mx = L * perL;
    let rows = period;
    while (rows * W < mx * 0.6) rows += period;
    const els = [];
    for (let row = 0; row < rows; row++) {
      const off = random ? r() * L : ((row % period) * bond * L) % L;
      for (let k = -1; k <= perL; k++) els.push(rect(off + k * L, row * W, L, W));
    }
    return paintElements(els, mx, rows * W, { fill: 'wood', ...d }, r);
  },

  herringbone(d, r) {
    const [L0, W0] = pair(d.size, [0.5, 0.5 / 7]);
    const n = Math.max(2, Math.round(L0 / W0)), W = L0 / n, L = L0;
    const k = Math.max(1, Math.min(3, d.rows ?? 1)); // doppelt/dreifach: k Stäbe nebeneinander bilden einen Arm
    const S = 2 * L; // (2L, 0) und (0, 2L) sind Gitterpunkte von (kW, kW) und (L, −L) -> nahtlos
    const A = k * W;
    const els = [];
    for (let m = -3; m <= 3; m++) {
      for (let j = -Math.ceil(3 * L / A) - 2; j <= Math.ceil(3 * L / A) + 2; j++) {
        const ox = j * A + m * L, oy = j * A - m * L;
        if (ox > S + L || oy > S + L || ox + 2 * L < -L || oy + 2 * L < -L) continue;
        for (let s = 0; s < k; s++) {
          els.push(rect(ox, oy + s * W, L, W)); // waagrecht
          els.push(rect(ox + L + s * W, oy + A - L, W, L, Math.PI / 2)); // senkrecht daneben
        }
      }
    }
    // nur Elemente nahe der Kachel behalten (paintElements setzt sie über den Rand fort)
    const keep = els.filter((e) => e.c[0] > -L && e.c[0] < S + L && e.c[1] > -L && e.c[1] < S + L)
      .map((e) => wrapEl(e, S, S));
    return paintElements(dedupe(keep), S, S, { fill: 'wood', ...d }, r);
  },

  chevron(d, r) {
    const [L, W] = pair(d.size, [0.6, 0.1]);
    const a = ((d.angle ?? 45) * Math.PI) / 180;
    const cw = L * Math.cos(a), t = Math.tan(a), h = W / Math.cos(a);
    const mx = 2 * cw;
    let n = Math.max(1, Math.round(mx / h));
    const my = n * h;
    const els = [];
    for (let i = 0; i < 2; i++) {
      const x0 = i * cw, x1 = x0 + cw;
      for (let k = -2; k < n + 2; k++) {
        const y = k * h;
        const pts = i === 0
          ? [[x0, y], [x1, y + cw * t], [x1, y + cw * t + h], [x0, y + h]]
          : [[x0, y + cw * t], [x1, y], [x1, y + h], [x0, y + cw * t + h]];
        els.push({ pts, c: [(x0 + x1) / 2, y + cw * t / 2 + h / 2], a: i === 0 ? a : -a, L, w: W });
      }
    }
    return paintElements(els, mx, my, { fill: 'wood', ...d }, r);
  },

  basket(d, r) {
    const s = pair(d.size, [0.35, 0.35])[0], k = d.strips ?? 4, sw = s / k;
    const els = [];
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const vertical = (i + j) % 2 === 0;
        for (let q = 0; q < k; q++) {
          els.push(vertical ? rect(i * s + q * sw, j * s, sw, s, Math.PI / 2) : rect(i * s, j * s + q * sw, s, sw));
        }
      }
    }
    return paintElements(els, 2 * s, 2 * s, { fill: 'wood', ...d }, r);
  },

  tiles(d, r) {
    const [w, h] = pair(d.size, [0.6, 0.6]);
    const bond = d.bond ?? 0;
    const period = bond > 0 ? Math.max(1, Math.round(1 / bond)) : 1;
    const cols = Math.max(1, Math.round(1.2 / w));
    let rows = period;
    while (rows * h < cols * w * 0.6) rows += period;
    const els = [];
    for (let row = 0; row < rows; row++) {
      const off = ((row % period) * bond * w) % w;
      for (let k = -1; k <= cols; k++) els.push(rect(off + k * w, row * h, w, h));
    }
    return paintElements(els, cols * w, rows * h, { fill: 'ceramic', variation: 0.04, ...d }, r);
  },

  siding(d, r) {
    const bw = pair(d.size, [0.15, 0.15])[0];
    const rows = Math.max(2, Math.round(1.2 / bw)), mx = 1.2, my = rows * bw;
    const { c, g, sx, sy } = sheet(mx, my, d.res);
    const col = rgbOf(d.color || '#8e2f22');
    for (let row = 0; row < rows; row++) {
      const y = row * bw * sy, hh = bw * sy, l = 1 + (r() - 0.5) * 2 * (d.variation ?? 0.04);
      const grad = g.createLinearGradient(0, y, 0, y + hh);
      grad.addColorStop(0, css(col, 0.62 * l));
      grad.addColorStop(0.2, css(col, 0.95 * l));
      grad.addColorStop(1, css(col, 1.02 * l));
      g.fillStyle = grad;
      g.fillRect(0, y, c.width, hh);
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.05})`;
        g.fillRect(r() * c.width, y + 3 + r() * (hh - 6), 20 + r() * 80, 1);
      }
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, y, c.width, 2);
    }
    return { canvas: c, meters: [mx, my] };
  },

  roof_tiles(d, r) {
    const [tw, th] = pair(d.size, [0.3, 0.3]);
    const cols = Math.max(1, Math.round(1.2 / tw)), rows = Math.max(1, Math.round(1.2 / th));
    const { c, g, sx, sy } = sheet(cols * tw, rows * th, d.res);
    const col = rgbOf(d.color || '#a4553b');
    const w = tw * sx, h = th * sy;
    for (let row = 0; row < rows; row++) {
      for (let k = 0; k < cols; k++) {
        const x = k * w, y = row * h, l = 1 + (r() - 0.5) * 2 * (d.variation ?? 0.06);
        const grad = g.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, css(col, 0.33 * l));
        grad.addColorStop(0.18, css(col, 0.8 * l));
        grad.addColorStop(0.92, css(col, 1.0 * l));
        grad.addColorStop(1, css(col, 1.1 * l));
        g.fillStyle = grad;
        g.fillRect(x, y, w, h);
        const across = g.createLinearGradient(x, 0, x + w, 0);
        across.addColorStop(0, 'rgba(255,255,255,0.10)');
        across.addColorStop(0.55, 'rgba(0,0,0,0.12)');
        across.addColorStop(1, 'rgba(255,255,255,0.06)');
        g.fillStyle = across;
        g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(x + w - 2, y, 2, h);
      }
    }
    return { canvas: c, meters: [cols * tw, rows * th] };
  },

  stone(d, r) {
    const [hmin, hmax] = pair(d.size, [0.13, 0.23]);
    const m = 1.2;
    const { c, g, sx } = sheet(m, m, d.res);
    const size = c.width, px = sx;
    const col = rgbOf(d.color || '#a8957a'), v = d.variation ?? 0.15;
    g.fillStyle = css(rgbOf(d.joint_color || '#3d3a35'));
    g.fillRect(0, 0, size, size);
    const rows = [];
    let y = 0;
    while (y < size) {
      const hh = Math.min(size - y, (hmin + r() * (hmax - hmin)) * px);
      rows.push([y, size - y - hh < hmin * 0.6 * px ? size - y : hh]);
      y += rows.at(-1)[1];
    }
    for (const [y0, hh] of rows) {
      let x = -r() * 0.3 * px;
      while (x < size) {
        const ww = (0.22 + r() * 0.4) * px;
        const f = 1 + (r() - 0.5) * 2 * v, hue = (r() - 0.5) * v;
        g.fillStyle = css([col[0] * (1 + hue), col[1], col[2] * (1 - hue)], f);
        for (const ox of [0, -size, size]) {
          g.beginPath();
          const j = () => (r() - 0.5) * 0.02 * px;
          g.moveTo(x + ox + 2 + j(), y0 + 2 + j());
          g.lineTo(x + ox + ww - 2 + j(), y0 + 2 + j());
          g.lineTo(x + ox + ww - 2 + j(), y0 + hh - 2 + j());
          g.lineTo(x + ox + 2 + j(), y0 + hh - 2 + j());
          g.closePath();
          g.fill();
        }
        for (let k = 0; k < 60; k++) {
          g.fillStyle = r() < 0.15 ? `rgba(70,80,60,${r() * 0.12})` : `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.06})`;
          g.fillRect(((x + r() * ww) % size + size) % size, y0 + r() * hh, 2 + r() * 6, 1 + r() * 4);
        }
        x += ww;
      }
    }
    return { canvas: c, meters: [m, m] };
  },

  flagstone(d, r) {
    const cell = pair(d.size, [0.28, 0.28])[0];
    const m = Math.max(0.8, cell * 5.7);
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const col = rgbOf(d.color || '#ded6c6'), jc = rgbOf(d.joint_color || '#5f5a52');
    const count = Math.max(6, Math.round((m / cell) ** 2));
    const pts = Array.from({ length: count }, () => ({ x: r() * size, y: r() * size, l: 0.9 + r() * 0.18, t: r() }));
    const img = g.createImageData(size, size);
    const jw = Math.max(2, ((d.joint ?? 0.01) * size) / m);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let d1 = Infinity, d2 = Infinity, best = pts[0];
        for (const p of pts) {
          let dx = Math.abs(x - p.x), dy = Math.abs(y - p.y);
          dx = Math.min(dx, size - dx);
          dy = Math.min(dy, size - dy);
          const q = dx * dx + dy * dy;
          if (q < d1) { d2 = d1; d1 = q; best = p; } else if (q < d2) d2 = q;
        }
        const edge = Math.sqrt(d2) - Math.sqrt(d1);
        const k = (y * size + x) * 4;
        let rgb;
        if (edge < jw) rgb = jc.map((v) => v * (0.85 + (edge / jw) * 0.2));
        else {
          let f = best.l;
          if ((x * 7 + y * 13 + Math.floor(best.t * 97)) % 53 === 0 || r() < 0.004) f *= 0.45;
          const warm = 0.97 + best.t * 0.06;
          rgb = [col[0] * f * warm, col[1] * f, col[2] * f / warm];
        }
        img.data[k] = Math.min(255, rgb[0]);
        img.data[k + 1] = Math.min(255, rgb[1]);
        img.data[k + 2] = Math.min(255, rgb[2]);
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return { canvas: c, meters: [m, m] };
  },

  speckle(d, r) {
    const m = pair(d.size, [0.6, 0.6])[0], spread = d.spread ?? 0.35;
    const n = noiseCanvas(256, d.seed ?? 5, 24, 3);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const src = n.getContext('2d').getImageData(0, 0, 256, 256).data;
    const img = g.createImageData(256, 256);
    const rgb = rgbOf(d.color || '#a69d8c');
    for (let i = 0; i < src.length; i += 4) {
      const f = 1 + (src[i] / 255 - 0.5) * spread * 2;
      img.data[i] = Math.min(255, rgb[0] * f);
      img.data[i + 1] = Math.min(255, rgb[1] * f);
      img.data[i + 2] = Math.min(255, rgb[2] * f);
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return { canvas: c, meters: [m, m], bump: n };
  },

  lawn(d, r) {
    const m = pair(d.size, [6, 6])[0], size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const col = rgbOf(d.color || '#26352a');
    g.fillStyle = css(col);
    g.fillRect(0, 0, size, size);
    for (let k = 0; k < 14; k++) {
      const x = r() * size, y = r() * size, rad = size * (0.12 + r() * 0.18);
      const light = r() > 0.5;
      for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        gr.addColorStop(0, light ? 'rgba(80,100,55,0.07)' : 'rgba(12,26,16,0.08)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, size, size);
      }
    }
    // Halme: Farbton und Helligkeit um die Grundfarbe
    const hsl = new THREE.Color().setStyle(d.color || '#26352a').getHSL({}, THREE.SRGBColorSpace);
    for (let k = 0; k < 9000; k++) {
      const l = (hsl.l * 100) * (0.75 + r() * 0.9);
      g.fillStyle = `hsla(${hsl.h * 360 - 10 + r() * 25}, ${Math.max(20, hsl.s * 100)}%, ${l}%, 0.5)`;
      g.fillRect(r() * size, r() * size, 1 + r() * 2, 2 + r() * 4);
    }
    return { canvas: c, meters: [m, m] };
  },

  plain(d) {
    const m = pair(d.size, [1.5, 1.5])[0];
    const n = noiseCanvas(256, d.seed ?? 21, 10, 4);
    return { canvas: null, meters: [m, m], bump: n };
  },
};

// Elemente in die Kachel verschieben (Mittelpunkt in [0, S)) und doppelte entfernen
function wrapEl(e, mx, my) {
  const dx = Math.floor(e.c[0] / mx) * mx, dy = Math.floor(e.c[1] / my) * my;
  if (!dx && !dy) return e;
  return { ...e, pts: e.pts.map(([x, y]) => [x - dx, y - dy]), c: [e.c[0] - dx, e.c[1] - dy] };
}
function dedupe(els) {
  const seen = new Set();
  return els.filter((e) => {
    const k = `${e.c[0].toFixed(4)},${e.c[1].toFixed(4)},${e.a}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Kachel eines Musters erzeugen: { canvas (null = einfarbig), meters [x, y], bump? } */
export function generatePattern(d) {
  const gen = GEN[d.pattern] || GEN.plain;
  return gen(d, rng(d.seed ?? hashSeed(d.pattern + (d.color || ''))));
}

// ---------------------------------------------------------------------------------------------
// Materialien
// ---------------------------------------------------------------------------------------------

let assetBase = null;
let onAssetLoaded = () => {};

/** Basisadresse für Bilder (`image`) und Rückruf, sobald ein Bild geladen ist (neu zeichnen) */
export function setSurfaceAssets(base, onLoaded) {
  assetBase = base;
  if (onLoaded) onAssetLoaded = onLoaded;
}

const BUMP = { planks: 3, herringbone: 3, chevron: 3, basket: 3, tiles: 6, siding: 5, roof_tiles: 6, stone: 10, flagstone: 7, speckle: 8, lawn: 4, plain: 3 };
const RELIEF = { planks: 0.35, herringbone: 0.35, chevron: 0.35, basket: 0.35, tiles: 0.6, siding: 0.8, roof_tiles: 0.9, stone: 1.2, flagstone: 0.8, speckle: 1, lawn: 0.6, plain: 0.5 };

const repeatOf = (tex, [mx, my]) => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / mx, 1 / my);
  return tex;
};

/**
 * Material einer Oberfläche: Muster (mit der gewünschten Farbe gezeichnet) oder Bild. `lit` legt das Raumlicht an
 * (withRoomLight mit opts); outdoor = Variante im Freien (Regen/Schnee) statt Bodenverdeckung innen.
 */
export function surfaceMaterial(id, { color = null, outdoor = false, lit }) {
  const d0 = surfaceDef(id);
  if (!d0) return null;
  const d = color && !d0.image ? { ...d0, color } : d0;
  const params = { roughness: d.roughness ?? 0.6, metalness: d.metalness ?? 0 };
  const opts = outdoor || d.outdoor ? { weather: true } : d.floor === false ? {} : { floorAO: true };
  const relief = new THREE.Vector2(1, 1).multiplyScalar(d.relief ?? RELIEF[d.pattern] ?? 0.5);
  if (d.image) {
    const meters = pair(d.size, [1, 1]);
    const m = lit({ ...params, color: color || d.color || 0xffffff }, opts);
    if (assetBase !== false) {
      const url = new URL(d.image, assetBase || location.href).href;
      new THREE.TextureLoader().load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        m.map = repeatOf(tex, meters);
        if (d.relief !== 0) {
          m.normalMap = repeatOf(normalFromCanvas(tex.image, meters[0], d.bump ?? 3), meters);
          m.normalScale = relief;
        }
        m.needsUpdate = true;
        onAssetLoaded();
      }, undefined, () => console.warn(`ha-3d-dashboard: Bild für Oberfläche ${id} nicht geladen: ${url}`));
    }
    return m;
  }
  const tile = generatePattern(d);
  if (!tile.canvas) {
    // einfarbig mit feiner Struktur
    const normal = repeatOf(normalFromCanvas(tile.bump, tile.meters[0], d.bump ?? BUMP.plain, 256), tile.meters);
    return lit({ ...params, color: d.color || '#9a968f', normalMap: d.relief === 0 ? null : normal, normalScale: relief }, opts);
  }
  const map = new THREE.CanvasTexture(tile.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  repeatOf(map, tile.meters);
  const normal = d.relief === 0 ? null : repeatOf(normalFromCanvas(tile.bump || tile.canvas, tile.meters[0], d.bump ?? BUMP[d.pattern] ?? 4), tile.meters);
  return lit({ ...params, map, normalMap: normal, normalScale: relief }, opts);
}
