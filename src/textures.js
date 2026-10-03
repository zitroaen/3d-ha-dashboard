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

// Dunkler Rasen / Erde für die Umgebung
export function groundTexture() {
  const size = 512, meters = 6;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(11);
  g.fillStyle = '#26352a';
  g.fillRect(0, 0, size, size);
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
