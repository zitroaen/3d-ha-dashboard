// Boden des Grundstücks: Höhe des Bodens an jeder Stelle (für Kanten von Außenbereichen) und das Bodennetz selbst.
// Mit Höhenraster (site.terrain) ist der Boden das Raster – ausgespart unter Gebäuden und Außenbereichen, die ihre
// Fläche selbst zeichnen (Bereiche mit follow: terrain schneiden dieselben Dreiecke aus dem Raster, also ohne
// Flackern). Ohne Raster: eben auf GROUND_Y bzw. das alte Gitter, das Gelände-Bereiche nach außen fortsetzt.
import * as THREE from 'three';
import { pointInPoly, nearestTerrain } from './geometry.js';
import { clipTerrain, convexPieces } from './terrain.js';

/** Höhe der Bodenfläche außerhalb aller Außenbereiche (site.ground), etwas unter den Flächen */
export const GROUND_Y = -0.12;

export const triangulate = (poly) => THREE.ShapeUtils.triangulateShape(poly.map(([x, y]) => new THREE.Vector2(x, y)), []);

/** Rechteck einer Tür in der Wand (Scharnier–Ende, Laibung) */
function doorRect(d) {
  const [hx, hy] = d.hinge, [ex, ey] = d.end;
  const len = Math.hypot(ex - hx, ey - hy) || 1;
  const nx = -(ey - hy) / len, ny = (ex - hx) / len;
  const [j0, j1] = d.jamb || [-0.1, 0.1];
  const off = (p, t) => [p[0] + nx * t, p[1] + ny * t];
  return [off(d.hinge, j0), off(d.end, j0), off(d.end, j1), off(d.hinge, j1)];
}

/**
 * @param house  toScene().house
 * @returns { terrain, at(p), cuts, buildingCuts }
 */
export function makeGround(house) {
  const terrain = house.terrain || null;
  const outdoor = house.floors.filter((f) => f.outdoor).flatMap((f) => f.rooms);

  // Grundflächen der Gebäude (unterste Etage): Wände, Räume, Fenster und Türen in den Wandlücken
  const lowest = new Map();
  for (const f of house.floors) {
    if (f.outdoor || f.roof) continue;
    const cur = lowest.get(f.building);
    if (!cur || (f.level ?? 0) < (cur.level ?? 0)) lowest.set(f.building, f);
  }
  const footprints = [...lowest.values()].flatMap((f) => [
    ...f.walls, ...f.rooms.map((r) => r.polygon),
    ...(f.windows || []).map((w) => {
      const [x0, y0, x1, y1] = w.rect;
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }),
    ...(f.doors || []).map(doorRect),
  ]);

  if (terrain) {
    const pieces = (polys) => polys.filter((p) => p.length >= 3).flatMap((p) => convexPieces(p, triangulate));
    return {
      terrain,
      at: (p) => terrain.height(p),
      // Aussparungen im Bodennetz: Gebäude und alle Außenbereiche (sie zeichnen ihre Fläche selbst)
      cuts: pieces([...footprints, ...outdoor.map((r) => r.polygon)]),
      footprints,
      piecesOf: (poly) => pieces([poly]),
    };
  }

  // Ohne Raster: Gelände-Bereiche setzen sich nach außen fort (tiefer liegendes Gelände), sonst GROUND_Y
  const areas = outdoor.filter((r) => r.heights).map((r) => ({ polygon: r.polygon, heights: r.heights, extend: r.extend }));
  const flat = house.floors.flatMap((f) => f.rooms.filter((r) => !r.heights).map((r) => r.polygon));
  const at = (p) => {
    const t = areas.length ? nearestTerrain(areas, p) : null;
    // in Gelände-Bereichen deutlich darunter (der Bereich deckt ihn zu, kein Flackern)
    let y = t == null ? GROUND_Y : t.inside ? Math.min(GROUND_Y, t.h - 0.06) : t.area.extend ? t.h - 0.012 : Math.min(GROUND_Y, t.h - 0.012);
    if (y > GROUND_Y && flat.some((poly) => pointInPoly(p, poly))) y = GROUND_Y;
    return y;
  };
  return { terrain: null, at, areas, footprints };
}

/**
 * Bodennetz mit Höhenraster: Rasterdreiecke ohne die Aussparungen, weiche Normalen; außerhalb des Rasters ein grobes
 * Gitter, das den Rand fortsetzt (an der Nahtstelle mit denselben Punkten wie das Raster).
 */
export function terrainGroundGeometry(ground, cx, cz, R = 80) {
  const t = ground.terrain;
  const pos = [], nor = [], uv = [];
  const push = (p, h, n) => {
    pos.push(p[0], h, p[1]);
    nor.push(...n);
    uv.push(p[0], p[1]);
  };
  for (const poly of clipTerrain(t.triangles(), null, ground.cuts)) {
    for (let i = 1; i + 1 < poly.length; i++) for (const v of [poly[0], poly[i + 1], poly[i]]) push(v.p, v.h, v.n);
  }
  // Ring außerhalb: Achsen mit allen Rasterlinien (gleiche Punkte an der Naht) plus grobe Stützstellen nach außen
  const [x0, y0, x1, y1] = t.extent;
  const lines = (lo, hi, c, n) => {
    const out = new Set([c - R, c + R, lo, hi]);
    for (let k = 0; k < n; k++) out.add(lo + k * t.cell);
    for (const f of [0.5, 0.25, 0.12, 0.05]) { out.add(lo - (lo - (c - R)) * f); out.add(hi + (c + R - hi) * f); }
    return [...out].filter((v) => v >= c - R && v <= c + R).sort((a, b) => a - b);
  };
  const xs = lines(x0, x1, cx, t.nx), zs = lines(y0, y1, cz, t.ny);
  const nrm = (p) => {
    const e = 0.5, dx = (t.height([p[0] + e, p[1]]) - t.height([p[0] - e, p[1]])) / (2 * e);
    const dz = (t.height([p[0], p[1] + e]) - t.height([p[0], p[1] - e])) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    return [-dx / l, 1 / l, -dz / l];
  };
  for (let j = 0; j + 1 < zs.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const ax = xs[i], bx = xs[i + 1], az = zs[j], bz = zs[j + 1];
      if (ax >= x0 - 1e-9 && bx <= x1 + 1e-9 && az >= y0 - 1e-9 && bz <= y1 + 1e-9) continue; // im Raster
      const q = [[ax, az], [bx, az], [ax, bz], [bx, bz]];
      const V = (k) => [q[k], t.height(q[k]), nrm(q[k])];
      for (const k of [0, 2, 1, 1, 2, 3]) push(...V(k));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('roomIdx', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  return g;
}
