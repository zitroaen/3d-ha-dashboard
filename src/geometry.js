// Geometrie-Helfer: Plan-Koordinaten (x, y) in Metern -> three.js (x, z), y = Höhe.
import * as THREE from 'three';

export function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function signedArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}

function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Punkt im Polygon mit größtem Abstand zum Rand (für Lampenposition bei L-förmigen Räumen). */
export function poleOfInaccessibility(poly, step = 0.1) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  let best = null, bestD = -1;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
      if (!pointInPoly([x, y], poly)) continue;
      let d = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distToSegment([x, y], poly[j], poly[i]));
      // leicht zur Mitte der Bounding-Box ziehen, damit große Räume mittig beleuchtet werden
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
  }
  return { point: best, radius: bestD };
}

/**
 * Sammelt Dreiecke mit Raum-Index pro Fläche (nicht indiziert, damit jede Fläche ihren eigenen Raum hat).
 */
export class Builder {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.room = [];
  }

  tri(a, b, c, roomIdx, uvScale = 1) {
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.room.push(roomIdx);
      this.uv.push(p[0] / uvScale, p[2] / uvScale);
    }
  }

  /** Senkrechte Rechteckfläche zwischen Plan-Punkten a und b, von y0 bis y1. UV: Länge × Höhe. */
  quadV(a, b, y0, y1, roomIdx) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const A = [a[0], y0, a[1]], B = [b[0], y0, b[1]], C = [b[0], y1, b[1]], D = [a[0], y1, a[1]];
    const uvs = [[0, y0], [len, y0], [len, y1], [0, y1]];
    const push = (i) => {
      const p = [A, B, C, D][i];
      this.pos.push(...p);
      this.room.push(roomIdx);
      this.uv.push(...uvs[i]);
    };
    [0, 1, 2, 0, 2, 3].forEach(push);
  }

  /** Waagrechtes Polygon auf Höhe y (Normale nach oben, oder nach unten wenn down). */
  polyH(poly, y, roomIdx, down = false, uvScale = 1) {
    const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    // Plan-Koordinaten: CCW in (x, y) mit y nach unten ist von oben gesehen CW -> Normale bestimmen
    for (const [i, j, k] of tris) {
      let a = [poly[i][0], y, poly[i][1]], b = [poly[j][0], y, poly[j][1]], c = [poly[k][0], y, poly[k][1]];
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if ((ny < 0) !== down) [b, c] = [c, b];
      this.tri(a, b, c, roomIdx, uvScale);
    }
  }

  /** @param attr Name des Index-Attributs (Raum oder Lampe) */
  geometry(attr = 'roomIdx') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute(attr, new THREE.Float32BufferAttribute(this.room, 1));
    g.computeVertexNormals();
    return g;
  }

  get empty() {
    return this.pos.length === 0;
  }
}

/** Seitenflächen nach außen orientieren: Polygon CCW in Plan-Koordinaten bringen. */
export function ccw(poly) {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}
