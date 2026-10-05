// Gelände als Höhenraster (site.terrain, docs/DATA_MODEL.md) – reine Geometrie ohne three.js (auch für model.js und
// die Unit-Tests). Zeilen laufen in +y, Spalten in +x; `null` = keine Angabe (aus den Nachbarn ergänzt). Jede Zelle
// besteht aus zwei Dreiecken mit fester Diagonale, die Höhe dazwischen ist linear – genau wie im gezeichneten Netz,
// damit Objekte und Bereiche, die dem Gelände folgen, exakt darauf liegen. Außerhalb setzt sich der Rand fort.
import { clipHalf, minusConvex } from './roofshape.js';

/** Raster aus dem Modell (site.terrain) oder null */
export function terrainGrid(spec) {
  if (!spec?.heights?.length) return null;
  const cell = spec.cell ?? 0.5;
  const [ox, oy] = spec.origin || [0, 0];
  const ny = spec.heights.length, nx = Math.max(...spec.heights.map((r) => r.length));
  if (nx < 2 || ny < 2) return null;
  const h = new Float64Array(nx * ny).fill(NaN);
  spec.heights.forEach((row, j) => row.forEach((v, i) => {
    if (v != null && Number.isFinite(Number(v))) h[j * nx + i] = Number(v);
  }));
  fillGaps(h, nx, ny);
  const H = (i, j) => h[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];

  /** Höhe an einem Plan-Punkt (außerhalb: Rand fortgesetzt) */
  const height = ([x, y]) => {
    let u = (x - ox) / cell, v = (y - oy) / cell;
    u = Math.max(0, Math.min(nx - 1, u));
    v = Math.max(0, Math.min(ny - 1, v));
    const i = Math.min(nx - 2, Math.floor(u)), j = Math.min(ny - 2, Math.floor(v));
    const fu = u - i, fv = v - j;
    const a = H(i, j), b = H(i + 1, j), c = H(i, j + 1), d = H(i + 1, j + 1);
    // Diagonale b–c: Dreiecke (a, b, c) und (b, d, c)
    return fu + fv <= 1 ? a + fu * (b - a) + fv * (c - a) : d + (1 - fu) * (c - d) + (1 - fv) * (b - d);
  };

  /** Weiche Normale an einem Rasterpunkt (zentrale Differenzen), [nx, ny, nz] mit y nach oben, z = Plan-y */
  const normalAt = (i, j) => {
    const dx = (H(i + 1, j) - H(i - 1, j)) / ((Math.min(nx - 1, i + 1) - Math.max(0, i - 1)) * cell || 1);
    const dz = (H(i, j + 1) - H(i, j - 1)) / ((Math.min(ny - 1, j + 1) - Math.max(0, j - 1)) * cell || 1);
    const l = Math.hypot(dx, 1, dz);
    return [-dx / l, 1 / l, -dz / l];
  };

  /**
   * Dreiecke des Rasters, die das Rechteck [x0, y0, x1, y1] berühren: [{ pts: [[x, y], …], hs, ns }]
   */
  const triangles = (x0 = -Infinity, y0 = -Infinity, x1 = Infinity, y1 = Infinity) => {
    const out = [];
    const i0 = Math.max(0, Math.floor((x0 - ox) / cell)), i1 = Math.min(nx - 2, Math.floor((x1 - ox) / cell));
    const j0 = Math.max(0, Math.floor((y0 - oy) / cell)), j1 = Math.min(ny - 2, Math.floor((y1 - oy) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const P = (a, b) => [ox + (i + a) * cell, oy + (j + b) * cell];
        const V = (a, b) => ({ p: P(a, b), h: H(i + a, j + b), n: normalAt(i + a, j + b) });
        out.push([V(0, 0), V(1, 0), V(0, 1)], [V(1, 0), V(1, 1), V(0, 1)]);
      }
    }
    return out;
  };

  const extent = [ox, oy, ox + (nx - 1) * cell, oy + (ny - 1) * cell];
  return { spec, cell, origin: [ox, oy], nx, ny, H, height, normalAt, triangles, extent };
}

/**
 * Hangschattierung je Rasterpunkt (0 = keine, bis ~0,5 = deutlich dunkler), einmal berechnet: Umgebungsverdeckung
 * aus dem Horizont in 8 Richtungen bis `radius` Meter (Mulden, Böschungsfüße) plus etwas Abdunklung steiler Flächen.
 * Unabhängig vom Sonnenstand, damit Böschungen auch bei hoher Sonne erkennbar bleiben.
 */
export function terrainShade(grid, { radius = 8, strength = 1 } = {}) {
  const { nx, ny, cell, H, normalAt } = grid;
  const out = new Float32Array(nx * ny);
  if (!(strength > 0)) return out;
  const steps = Math.max(2, Math.min(24, Math.round(radius / cell)));
  const dirs = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const h0 = H(i, j);
      let occ = 0;
      for (const [dx, dy] of dirs) {
        let best = 0;
        for (let s = 1; s <= steps; s++) {
          const a = Math.round(i + dx * s), b = Math.round(j + dy * s);
          if (a < 0 || b < 0 || a >= nx || b >= ny) break;
          const d = Math.hypot(a - i, b - j) * cell;
          best = Math.max(best, (H(a, b) - h0) / d);
        }
        occ += best / Math.hypot(1, best); // sin(Horizontwinkel)
      }
      const up = normalAt(i, j)[1];
      out[j * nx + i] = Math.min(0.55, strength * (0.85 * (occ / 8) + 1.2 * (1 - up)));
    }
  }
  return out;
}

/**
 * Lage eines Luftbilds im Plan (site.terrain.texture) -> Abbildung Plan -> Bild (u, v in 0..1, v nach unten).
 * Entweder origin (Plan-Punkt der linken oberen Bildecke), size [Breite, Höhe] in Metern und rot (Grad, Richtung der
 * Bildzeilen von +x nach +y) – oder affine [a, b, c, d, e, f] wie eine World-Datei: x = a·px + b·py + c,
 * y = d·px + e·py + f (px, py = Pixelspalte und -zeile). Liefert { U, V } mit u = U·[x, y, 1], v = V·[x, y, 1] und
 * die Umkehrung toPlan(u, v); null bei unbrauchbaren Angaben.
 */
export function aerialTransform(tex, imgW = 1, imgH = 1) {
  let m00, m01, m10, m11, c, f;
  if (Array.isArray(tex.affine) && tex.affine.length === 6) {
    const [a, b, cc, d, e, ff] = tex.affine.map(Number);
    [m00, m01, c, m10, m11, f] = [a * imgW, b * imgH, cc, d * imgW, e * imgH, ff];
  } else {
    const [ox, oy] = tex.origin || [0, 0];
    const [w, h] = Array.isArray(tex.size) ? tex.size : [tex.size, tex.size];
    if (!(w > 0) || !(h > 0)) return null;
    const r = ((tex.rot || 0) * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    [m00, m01, c, m10, m11, f] = [cs * w, -sn * h, ox, sn * w, cs * h, oy];
  }
  const det = m00 * m11 - m01 * m10;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const i00 = m11 / det, i01 = -m01 / det, i10 = -m10 / det, i11 = m00 / det;
  return {
    U: [i00, i01, -(i00 * c + i01 * f)],
    V: [i10, i11, -(i10 * c + i11 * f)],
    toPlan: (u, v) => [m00 * u + m01 * v + c, m10 * u + m11 * v + f],
  };
}

/** Lücken (NaN) aus den Nachbarn füllen, bis keine mehr da sind; ganz leer -> 0 */
function fillGaps(h, nx, ny) {
  if (!h.some(Number.isNaN)) return;
  if (h.every(Number.isNaN)) return h.fill(0);
  for (let guard = 0; guard < nx + ny && h.some(Number.isNaN); guard++) {
    const next = h.slice();
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!Number.isNaN(h[j * nx + i])) continue;
        let s = 0, n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
          const v = h[b * nx + a];
          if (!Number.isNaN(v)) { s += v; n++; }
        }
        if (n) next[j * nx + i] = s / n;
      }
    }
    h.set(next);
  }
}

/** Polygon mit positiver Fläche (gegen den Uhrzeigersinn im Plan) */
export function ccw(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? [...poly].reverse() : poly;
}

const bbox = (poly) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
};
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Konvexes Polygon a ∩ konvexes Polygon b (beide gegen den Uhrzeigersinn) */
export function clipConvex(a, b) {
  let out = a;
  for (let i = 0; i < b.length && out.length >= 3; i++) {
    const p = b[i], q = b[(i + 1) % b.length];
    // innen = links der Kante p→q (positive Fläche): (q − p) × (x − p) ≥ 0  ⇔  −(…) ≤ 0
    const ex = q[0] - p[0], ey = q[1] - p[1];
    out = clipHalf(out, ey, -ex, -(ey * p[0] - ex * p[1]));
  }
  return out.length >= 3 ? out : [];
}

/**
 * Zerlegung eines Bereichs in konvexe Stücke (für Schnitte mit dem Raster). triangulate: (poly) => [[i, j, k], …]
 * (THREE.ShapeUtils.triangulateShape oder ein anderer Ohrenschnitt). Konvexe Polygone bleiben ganz.
 */
export function convexPieces(poly, triangulate) {
  const p = ccw(poly);
  if (isConvex(p)) return [p];
  return triangulate(p).map((t) => ccw(t.map((k) => p[k])));
}

function isConvex(p) {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-12) continue;
    if (sign && Math.sign(cr) !== sign) return false;
    sign = Math.sign(cr);
  }
  return true;
}

/**
 * Raster-Dreiecke zuschneiden. Liefert Polygone mit Höhe und Normale je Punkt (aus dem Rasterdreieck interpoliert –
 * die Schattierung bleibt weich, egal wie fein zerschnitten wird).
 * @param tris     grid.triangles(…)
 * @param keep     konvexe Stücke, auf die beschnitten wird (null = alles)
 * @param remove   konvexe Stücke, die ausgespart werden
 */
export function clipTerrain(tris, keep, remove = []) {
  const out = [];
  const keepB = keep?.map((k) => ({ k, b: bbox(k) }));
  const remB = remove.map((k) => ({ k, b: bbox(k) }));
  for (const tri of tris) {
    const poly = ccw(tri.map((v) => v.p));
    const tb = bbox(poly);
    let pieces = keepB ? keepB.filter((x) => overlaps(x.b, tb)).map((x) => clipConvex(poly, x.k)).filter((x) => x.length >= 3) : [poly];
    for (const r of remB) {
      if (!pieces.length) break;
      if (!overlaps(r.b, tb)) continue;
      pieces = pieces.flatMap((pc) => (overlaps(bbox(pc), r.b) ? minusConvex(pc, r.k) : [pc]));
    }
    if (!pieces.length) continue;
    const bary = baryOf(tri);
    for (const pc of pieces) out.push(pc.map((p) => ({ p, ...bary(p) })));
  }
  return out;
}

/** Höhe und Normale im Rasterdreieck an p (baryzentrisch) */
function baryOf([A, B, C]) {
  const [ax, ay] = A.p, [bx, by] = B.p, [cx, cy] = C.p;
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  return ([x, y]) => {
    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    const w = 1 - u - v;
    const n = [0, 1, 2].map((k) => u * A.n[k] + v * B.n[k] + w * C.n[k]);
    const l = Math.hypot(...n) || 1;
    return { h: u * A.h + v * B.h + w * C.h, n: n.map((c) => c / l) };
  };
}
