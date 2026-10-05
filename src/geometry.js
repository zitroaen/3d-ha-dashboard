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
 * Gelände: Höhe im Punkt p eines Polygons mit Höhen je Eckpunkt (Dreiecke zwischen den Eckpunkten, linear
 * interpoliert). Außerhalb: Höhe des nächsten Eckpunkts.
 */
export function heightAt(poly, heights, [x, y]) {
  if (heights.every((h) => h === heights[0])) return heights[0];
  const tris = THREE.ShapeUtils.triangulateShape(poly.map(([px, py]) => new THREE.Vector2(px, py)), []);
  for (const [i, j, k] of tris) {
    const [ax, ay] = poly[i], [bx, by] = poly[j], [cx, cy] = poly[k];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    if (u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9) return u * heights[i] + v * heights[j] + (1 - u - v) * heights[k];
  }
  let best = 0, bd = Infinity;
  poly.forEach(([px, py], i) => {
    const dd = Math.hypot(px - x, py - y);
    if (dd < bd) { bd = dd; best = i; }
  });
  return heights[best];
}

/**
 * Gelände nach außen fortsetzen: nächste Geländefläche zum Punkt p aus [{ polygon, heights }] – innen die Höhe wie
 * heightAt, außen die Höhe des nächstgelegenen Randpunkts (ein Hang läuft seitlich weiter). Liefert { h, area, inside }
 * oder null ohne Geländeflächen.
 */
export function nearestTerrain(areas, p) {
  let best = null, bd = Infinity;
  for (const area of areas) {
    const { polygon: poly, heights } = area;
    if (pointInPoly(p, poly)) return { h: heightAt(poly, heights, p), area, inside: true };
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[j], [bx, by] = poly[i];
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy);
      if (d < bd) { bd = d; best = { h: heights[j] + t * (heights[i] - heights[j]), area, inside: false }; }
    }
  }
  return best;
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

  /** Senkrechte Fläche zwischen a und b mit schräger Oberkante (ya1 bei a, yb1 bei b), einseitig. UV: Länge × Höhe. */
  quadVT(a, b, y0, ya1, yb1, roomIdx) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const A = [a[0], y0, a[1]], B = [b[0], y0, b[1]], C = [b[0], yb1, b[1]], D = [a[0], ya1, a[1]];
    const uvs = [[0, y0], [len, y0], [len, yb1], [0, ya1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(...[A, B, C, D][i]);
      this.room.push(roomIdx);
      this.uv.push(...uvs[i]);
    }
  }

  /** Dreieck mit eigenen UV-Koordinaten; up: Normale nach oben (true), unten (false) oder wie angegeben (null) */
  triUV(a, b, c, ua, ub, uc, roomIdx, up = null) {
    if (up != null) {
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if ((ny > 0) !== up) [b, c, ub, uc] = [c, b, uc, ub];
    }
    this.pos.push(...a, ...b, ...c);
    this.uv.push(...ua, ...ub, ...uc);
    this.room.push(roomIdx, roomIdx, roomIdx);
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

  /** Gelände: Polygon mit Höhe je Eckpunkt (Normale nach oben) */
  polyT(poly, heights, roomIdx, lift = 0, uvScale = 1) {
    const tris = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const P = (i) => [poly[i][0], heights[i] + lift, poly[i][1]];
    for (const [i, j, k] of tris) {
      let a = P(i), b = P(j), c = P(k);
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if (ny < 0) [b, c] = [c, b];
      this.tri(a, b, c, roomIdx, uvScale);
    }
  }

  /**
   * Senkrechte Fläche zwischen zwei Punkten mit eigener Ober-/Unterkante (Geländekante, Mauer), beidseitig.
   * UV: Länge entlang der Kante × Höhe (Mauerwerk liegt waagrecht).
   */
  skirt(a, ya0, ya1, b, yb0, yb1, roomIdx) {
    const A0 = [a[0], ya0, a[1]], A1 = [a[0], ya1, a[1]], B0 = [b[0], yb0, b[1]], B1 = [b[0], yb1, b[1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const uv = (p) => [p === B0 || p === B1 ? a[0] + a[1] + len : a[0] + a[1], p[1]];
    for (const tri of [[A0, B0, B1], [A0, B1, A1], [A0, B1, B0], [A0, A1, B1]]) {
      for (const p of tri) {
        this.pos.push(p[0], p[1], p[2]);
        this.room.push(roomIdx);
        this.uv.push(...uv(p));
      }
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
