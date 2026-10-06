// Prozedurale Texturen (Canvas) – keine Bilddateien, keine externen Requests.
import * as THREE from 'three';

// Deterministischer Zufall, damit Screenshots reproduzierbar sind
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

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, metersPerRepeat, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.userData.metersPerRepeat = metersPerRepeat;
  return t;
}

// Beläge, Fassaden und Dächer erzeugt src/surfaces.js (Muster aus den Daten).

// Radialer Verlauf für Lichtkegel auf dem Boden
export function glowTexture() {
  const size = 128;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Oberflächenstruktur: Normalen-Karten (Fugen, Maserung, Putz, Gewebe) – einmal pro Szene berechnet, pro Bild kostenlos.
// ---------------------------------------------------------------------------------------------

/**
 * Normalen-Karte aus der Helligkeit eines Canvas (dunkel = tiefer, z. B. Fugen). Halbe Auflösung reicht.
 * @param strength  Steilheit der Kanten
 */
export function normalFromCanvas(src, metersPerRepeat, strength = 2, size = 512) {
  const c = canvas(size, size);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, size, size);
  const px = g.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
  const out = g.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      out.data[o] = (-dx / len * 0.5 + 0.5) * 255;
      out.data[o + 1] = (dy / len * 0.5 + 0.5) * 255;
      out.data[o + 2] = (1 / len * 0.5 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return toTexture(c, metersPerRepeat, false);
}

/** Kachelbares Rauschen (Wertrauschen, mehrere Oktaven) als Graustufen-Canvas */
export function noiseCanvas(size = 256, seed = 11, cells = 8, octaves = 4) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const r = rng(seed);
  const grids = [];
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    grids.push({ n, v: Float32Array.from({ length: n * n }, () => r()) });
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 1, sum = 0;
      for (const { n, v: gv } of grids) {
        const fx = (x / size) * n, fy = (y / size) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
        const G = (i, j) => gv[((j % n) * n) + (i % n)];
        const a = G(x0, y0) + (G(x0 + 1, y0) - G(x0, y0)) * tx;
        const b = G(x0, y0 + 1) + (G(x0 + 1, y0 + 1) - G(x0, y0 + 1)) * tx;
        v += (a + (b - a) * ty) * amp;
        sum += amp;
        amp *= 0.5;
      }
      const o = (y * size + x) * 4, k = (v / sum) * 255;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = k;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Feines Gewebe (Leinwandbindung) als Graustufen-Canvas für Polster, Teppiche, Vorhänge */
export function weaveCanvas(size = 128, threads = 32) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const s = size / threads;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < threads; i++) {
    for (let j = 0; j < threads; j++) {
      const over = (i + j) % 2 === 0;
      const grad = g.createLinearGradient(i * s, j * s, over ? (i + 1) * s : i * s, over ? j * s : (j + 1) * s);
      grad.addColorStop(0, '#5a5a5a');
      grad.addColorStop(0.5, '#c8c8c8');
      grad.addColorStop(1, '#5a5a5a');
      g.fillStyle = grad;
      g.fillRect(i * s + 0.5, j * s + 0.5, s - 1, s - 1);
    }
  }
  return c;
}
