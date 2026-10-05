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

// Eichenparkett, Landhausdielen 1,2 m × 0,2 m (12 Reihen × 2 Dielen -> nahtlos kachelbar)
export function parquetTexture() {
  const size = 1024, meters = 2.4;
  const px = size / meters;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(7);
  const plankW = 0.2 * px, plankL = 1.2 * px;
  for (let row = 0; row * plankW < size; row++) {
    const offset = (row % 3) * plankL / 3 + r() * 30;
    for (let x = -plankL; x < size + plankL; x += plankL) {
      const x0 = x + offset, y0 = row * plankW;
      const base = 0.85 + r() * 0.3;
      const hue = 33 + r() * 5;
      g.fillStyle = `hsl(${hue}, ${24 + r() * 8}%, ${50 * base}%)`;
      g.fillRect(x0, y0, plankL, plankW);
      // Maserung
      for (let k = 0; k < 14; k++) {
        const yy = y0 + r() * plankW;
        g.strokeStyle = `rgba(60,35,15,${0.05 + r() * 0.1})`;
        g.lineWidth = 0.6 + r() * 1.4;
        g.beginPath();
        g.moveTo(x0, yy);
        for (let s = 0; s <= 8; s++) g.lineTo(x0 + (plankL * s) / 8, yy + Math.sin(s * 0.9 + k) * (1 + r() * 2));
        g.stroke();
      }
      // Fugen
      g.fillStyle = 'rgba(30,18,8,0.55)';
      g.fillRect(x0, y0, 1.5, plankW);
      g.fillRect(x0, y0, plankL, 1.2);
    }
  }
  return toTexture(c, meters);
}

// Würfelparkett: Quadrate 35 × 35 cm aus je 4 Eichenstäben, Richtung schachbrettartig wechselnd,
// honigfarben. 4 × 4 Quadrate je Kachel -> nahtlos.
export function cubeParquetTexture() {
  const squares = 4, sq = 0.35, meters = squares * sq;
  const size = 1024, px = size / meters, s = sq * px;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(23);
  const strips = 4, sw = s / strips;
  for (let j = 0; j < squares; j++) {
    for (let i = 0; i < squares; i++) {
      const x0 = i * s, y0 = j * s;
      const vertical = (i + j) % 2 === 0;
      for (let k = 0; k < strips; k++) {
        // Stab: leicht variierende Honig-/Bernsteintöne
        const l = 47 + (r() - 0.5) * 9;
        g.fillStyle = `hsl(${33 + r() * 6}, ${52 + r() * 12}%, ${l}%)`;
        const [rx, ry, rw, rh] = vertical ? [x0 + k * sw, y0, sw, s] : [x0, y0 + k * sw, s, sw];
        g.fillRect(rx, ry, rw, rh);
        // Maserung längs des Stabs
        for (let m = 0; m < 9; m++) {
          g.strokeStyle = `rgba(${r() < 0.5 ? '90,50,15' : '255,225,170'},${0.05 + r() * 0.08})`;
          g.lineWidth = 0.5 + r() * 1.2;
          g.beginPath();
          const off = r() * (vertical ? rw : rh);
          if (vertical) {
            g.moveTo(rx + off, ry);
            g.bezierCurveTo(rx + off + (r() - 0.5) * 4, ry + rh / 3, rx + off + (r() - 0.5) * 4, ry + (2 * rh) / 3, rx + off, ry + rh);
          } else {
            g.moveTo(rx, ry + off);
            g.bezierCurveTo(rx + rw / 3, ry + off + (r() - 0.5) * 4, rx + (2 * rw) / 3, ry + off + (r() - 0.5) * 4, rx + rw, ry + off);
          }
          g.stroke();
        }
        // Fuge zwischen den Stäben
        g.fillStyle = 'rgba(60,32,10,0.35)';
        if (vertical) g.fillRect(rx, ry, 1, rh);
        else g.fillRect(rx, ry, rw, 1);
      }
      // Fuge um das Quadrat
      g.fillStyle = 'rgba(50,26,8,0.55)';
      g.fillRect(x0, y0, s, 1.5);
      g.fillRect(x0, y0, 1.5, s);
    }
  }
  return toTexture(c, meters);
}

// Großformatfliesen 60 × 60 cm, warmes Grau
export function tileTexture(seed = 3, tone = [38, 8, 62]) {
  const size = 512, meters = 1.2;
  const px = size / meters;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(seed);
  const tile = 0.6 * px;
  g.fillStyle = '#5a5650';
  g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += tile) {
    for (let x = 0; x < size; x += tile) {
      const l = tone[2] + (r() - 0.5) * 4;
      g.fillStyle = `hsl(${tone[0]}, ${tone[1]}%, ${l}%)`;
      g.fillRect(x + 1.5, y + 1.5, tile - 3, tile - 3);
      // leichte Steinstruktur
      for (let k = 0; k < 400; k++) {
        g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.04})`;
        g.fillRect(x + r() * tile, y + r() * tile, 2 + r() * 4, 2 + r() * 4);
      }
    }
  }
  return toTexture(c, meters);
}

// Großformatplatten (Terrasse): 60 × 30 cm hellgrau im Läuferverband, feine Fugen; 1,2 m kachelbar
export function slabTexture(seed = 17) {
  const size = 512, meters = 1.2;
  const px = size / meters;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(seed);
  const w = 0.6 * px, h = 0.3 * px;
  g.fillStyle = '#6f7275';
  g.fillRect(0, 0, size, size);
  for (let row = 0; row * h < size; row++) {
    const off = (row % 2) * w / 2;
    for (let x = -w; x < size + w; x += w) {
      const l = 70 + (r() - 0.5) * 5;
      g.fillStyle = `hsl(210, 3%, ${l}%)`;
      const X = x + off;
      // kachelbar: am rechten Rand umlaufen
      for (const ox of [0, -size]) g.fillRect(X + ox + 1.2, row * h + 1.2, w - 2.4, h - 2.4);
      for (let k = 0; k < 160; k++) {
        g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.035})`;
        g.fillRect(((X + r() * w) % size + size) % size, row * h + r() * h, 1 + r() * 3, 1 + r() * 3);
      }
    }
  }
  return toTexture(c, meters);
}

// Dachziegel (Falzziegel): Reihen 0,3 m (Lattung), 4 Ziegel je 1,2 m, grau – die Farbe kommt aus dem Material
// (Ziegelrot, Anthrazit …). v läuft die Dachfläche hinauf: Schatten oben unter der Nase des Ziegels darüber.
export function roofTileTexture(seed = 29) {
  const size = 512, meters = 1.2;
  const px = size / meters;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(seed);
  const w = 0.3 * px, h = 0.3 * px;
  for (let row = 0; row * h < size; row++) {
    for (let col = 0; col * w < size; col++) {
      const x = col * w, y = row * h, l = 0.86 + (r() - 0.5) * 0.12;
      const grad = g.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, `rgb(${70 * l | 0},${70 * l | 0},${70 * l | 0})`);
      grad.addColorStop(0.18, `rgb(${170 * l | 0},${170 * l | 0},${170 * l | 0})`);
      grad.addColorStop(0.92, `rgb(${215 * l | 0},${215 * l | 0},${215 * l | 0})`);
      grad.addColorStop(1, `rgb(${235 * l | 0},${235 * l | 0},${235 * l | 0})`);
      g.fillStyle = grad;
      g.fillRect(x, y, w, h);
      // Wölbung: Mulde in der Mitte etwas dunkler, Falz rechts als feine Fuge
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
  return toTexture(c, meters);
}

// Holzfassade (Stülpschalung): waagrechte Bretter 0,15 m mit Schattenfuge, hell – Farbe aus dem Material
// (Schwedenrot, Grau …); 1,2 m kachelbar
export function sidingTexture(seed = 37) {
  const size = 512, meters = 1.2;
  const px = size / meters;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(seed);
  const h = 0.15 * px;
  for (let row = 0; row * h < size; row++) {
    const y = row * h, l = 0.9 + (r() - 0.5) * 0.08;
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, `rgb(${150 * l | 0},${150 * l | 0},${150 * l | 0})`);
    grad.addColorStop(0.2, `rgb(${225 * l | 0},${225 * l | 0},${225 * l | 0})`);
    grad.addColorStop(1, `rgb(${240 * l | 0},${240 * l | 0},${240 * l | 0})`);
    g.fillStyle = grad;
    g.fillRect(0, y, size, h);
    // Maserung
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.05})`;
      g.fillRect(r() * size, y + 3 + r() * (h - 6), 20 + r() * 80, 1);
    }
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, y, size, 2);
  }
  return toTexture(c, meters);
}

// Ziegelmauerwerk: Läuferverband 24 × 7,1 cm, helle Fugen, Steine leicht unterschiedlich – Farbe aus dem Material;
// 1,2 m kachelbar (5 Steine, 15 Schichten)
export function brickTexture(seed = 41) {
  const size = 512, meters = 1.2;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(seed);
  const cols = 5, rows = 15, w = size / cols, h = size / rows, j = 3;
  g.fillStyle = '#d8d4cc';
  g.fillRect(0, 0, size, size);
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * w / 2;
    for (let col = -1; col <= cols; col++) {
      const l = 170 + (r() - 0.5) * 60;
      g.fillStyle = `rgb(${l | 0},${l * 0.97 | 0},${l * 0.95 | 0})`;
      const x = col * w + off;
      for (const ox of [0, size]) g.fillRect(x - ox + j / 2, row * h + j / 2, w - j, h - j);
    }
  }
  return toTexture(c, meters);
}

// Polygonalplatten (Naturstein in Bruchstücken): helle, unregelmäßige Platten mit dunklen Einsprengseln und Fugen,
// innen wie außen; 1,6 m kachelbar (Zellen um Zufallspunkte, Abstand über den Kachelrand hinweg)
export function flagstoneTexture(seed = 53) {
  const size = 512, meters = 1.6;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(seed);
  const pts = Array.from({ length: 34 }, () => ({ x: r() * size, y: r() * size, l: 0.82 + r() * 0.16, t: r() }));
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d1 = Infinity, d2 = Infinity, best = pts[0];
      for (const p of pts) {
        let dx = Math.abs(x - p.x), dy = Math.abs(y - p.y);
        dx = Math.min(dx, size - dx);
        dy = Math.min(dy, size - dy);
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1); // Abstand zur Fuge
      const k = (y * size + x) * 4;
      let v = edge < 4 ? 0.38 + edge * 0.08 : best.l;
      if (edge >= 4 && ((x * 7 + y * 13 + Math.floor(best.t * 97)) % 53 === 0 || r() < 0.004)) v *= 0.45; // Einsprengsel
      const warm = 0.96 + best.t * 0.06;
      img.data[k] = 222 * v * warm;
      img.data[k + 1] = 214 * v;
      img.data[k + 2] = 198 * v / warm;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, meters);
}

// Naturstein-Trockenmauer (auch Blockstufen): Lagen unregelmäßiger Sandsteinblöcke, dunkle Fugen; 1,2 m kachelbar
export function stoneTexture(seed = 23) {
  const size = 512, meters = 1.2;
  const px = size / meters;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = '#3d3a35';
  g.fillRect(0, 0, size, size);
  // Lagenhöhen so wählen, dass sie genau die Kachel füllen
  const rows = [];
  let y = 0;
  while (y < size) {
    const hh = Math.min(size - y, (0.13 + r() * 0.1) * px);
    rows.push([y, size - y - hh < 0.08 * px ? size - y : hh]);
    y += rows.at(-1)[1];
  }
  const tones = [[38, 18, 66], [34, 14, 58], [30, 10, 70], [40, 22, 52], [28, 8, 62]];
  for (const [y0, hh] of rows) {
    let x = -r() * 0.3 * px;
    while (x < size) {
      const ww = (0.22 + r() * 0.4) * px;
      const [hu, sa, li] = tones[Math.floor(r() * tones.length)];
      g.fillStyle = `hsl(${hu}, ${sa}%, ${li + (r() - 0.5) * 8}%)`;
      // leicht unregelmäßige Kanten (Bruchstein)
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
      // Struktur und Flechten
      for (let k = 0; k < 60; k++) {
        g.fillStyle = r() < 0.15 ? `rgba(70,80,60,${r() * 0.12})` : `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.06})`;
        g.fillRect(((x + r() * ww) % size + size) % size, y0 + r() * hh, 2 + r() * 6, 1 + r() * 4);
      }
      x += ww;
    }
  }
  return toTexture(c, meters);
}

// Dunkler Rasen / Erde für die Umgebung
export function groundTexture() {
  const size = 512, meters = 6;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(11);
  g.fillStyle = '#26352a';
  g.fillRect(0, 0, size, size);
  // großflächige Schwankung (trockenere und sattere Stellen), kachelbar durch Wiederholung an den Rändern
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
  for (let k = 0; k < 9000; k++) {
    const l = 14 + r() * 16;
    g.fillStyle = `hsla(${95 + r() * 25}, 30%, ${l}%, 0.5)`;
    g.fillRect(r() * size, r() * size, 1 + r() * 2, 2 + r() * 4);
  }
  return toTexture(c, meters);
}

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

/** Farbtextur aus Rauschen (Kies, Erde): Grundfarbe [r, g, b] mit Helligkeitsschwankung */
export function speckleTexture(rgb, metersPerRepeat, seed = 5, spread = 0.35) {
  const n = noiseCanvas(256, seed, 24, 3);
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  const src = n.getContext('2d').getImageData(0, 0, 256, 256).data;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < src.length; i += 4) {
    const f = 1 + (src[i] / 255 - 0.5) * spread * 2;
    img.data[i] = Math.min(255, rgb[0] * f);
    img.data[i + 1] = Math.min(255, rgb[1] * f);
    img.data[i + 2] = Math.min(255, rgb[2] * f);
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, metersPerRepeat);
  t.userData.source = n;
  return t;
}
