// CityGML (LoD2-Gebäude der Länder) lesen, ohne XML-Paket: Gebäude mit ihren Boden-, Dach- und Wandflächen als
// 3D-Polygone in den Koordinaten der Datei (meist ETRS89/UTM + NHN). Gebäudeteile (BuildingPart) zählen zum Gebäude.
// Außerdem kleine Helfer für Flächen im Raster (Umriss vergleichen) und Dachflächen (Neigung, Richtung).

const tag = (name) => `(?:[\\w-]+:)?${name}`;

/** Polygone (Außenring) in einem XML-Ausschnitt: [[x, y, z], …] je Polygon */
function polygonsIn(xml) {
  const out = [];
  const polyRe = new RegExp(`<${tag('Polygon')}[\\s>][\\s\\S]*?</${tag('Polygon')}>`, 'g');
  for (const [poly] of xml.matchAll(polyRe)) {
    const ext = poly.match(new RegExp(`<${tag('exterior')}>([\\s\\S]*?)</${tag('exterior')}>`))?.[1] ?? poly;
    let nums = [];
    const posList = ext.match(new RegExp(`<${tag('posList')}[^>]*>([^<]*)</`));
    if (posList) nums = posList[1].trim().split(/\s+/).map(Number);
    else for (const [, p] of ext.matchAll(new RegExp(`<${tag('pos')}[^>]*>([^<]*)</`, 'g'))) nums.push(...p.trim().split(/\s+/).map(Number));
    const dim = Number(ext.match(/srsDimension="(\d)"/)?.[1] || 3);
    const pts = [];
    for (let i = 0; i + dim - 1 < nums.length; i += dim) pts.push([nums[i], nums[i + 1], dim === 3 ? nums[i + 2] : 0]);
    if (pts.length > 1 && pts[0].every((v, k) => Math.abs(v - pts[pts.length - 1][k]) < 1e-9)) pts.pop(); // Ring geschlossen
    if (pts.length >= 3) out.push(pts);
  }
  return out;
}

/** Flächen einer Art (GroundSurface, RoofSurface, WallSurface) in einem Ausschnitt */
function surfaces(xml, kind) {
  const re = new RegExp(`<${tag(kind)}[\\s>][\\s\\S]*?</${tag(kind)}>`, 'g');
  return [...xml.matchAll(re)].flatMap(([s]) => polygonsIn(s));
}

/** Gebäude einer CityGML-Datei: [{ id, ground, roofs, walls }] */
export function parseCityGML(xml) {
  const out = [];
  const re = new RegExp(`<${tag('Building')}\\b([^>]*)>([\\s\\S]*?)</${tag('Building')}>`, 'g');
  for (const [, attrs, body] of xml.matchAll(re)) {
    const id = attrs.match(/(?:gml:)?id="([^"]+)"/)?.[1] || `gebaeude_${out.length + 1}`;
    out.push({ id, ground: surfaces(body, 'GroundSurface'), roofs: surfaces(body, 'RoofSurface'), walls: surfaces(body, 'WallSurface') });
  }
  return out;
}

/** Grundriss eines Gebäudes (2D-Polygone): Bodenflächen, sonst die Dachflächen von oben */
export const footprintOf = (b) => (b.ground.length ? b.ground : b.roofs).map((p) => p.map(([x, y]) => [x, y]));

export function centroid(polys) {
  let a = 0, cx = 0, cy = 0;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], c = x0 * y1 - x1 * y0;
      a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    }
  }
  if (Math.abs(a) < 1e-9) {
    const all = polys.flat();
    return [all.reduce((s, q) => s + q[0], 0) / all.length, all.reduce((s, q) => s + q[1], 0) / all.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointIn(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Rastermaske einer Vereinigung von Polygonen: { res, x0, y0, nx, ny, mask, cells: [[x, y] Zellmitten innen] } */
export function rasterize(polys, res) {
  const pts = polys.flat();
  const x0 = Math.min(...pts.map((p) => p[0])) - res, y0 = Math.min(...pts.map((p) => p[1])) - res;
  const nx = Math.ceil((Math.max(...pts.map((p) => p[0])) - x0) / res) + 2, ny = Math.ceil((Math.max(...pts.map((p) => p[1])) - y0) / res) + 2;
  const mask = new Uint8Array(nx * ny), cells = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = [x0 + (i + 0.5) * res, y0 + (j + 0.5) * res];
      if (polys.some((q) => pointIn(p, q))) {
        mask[j * nx + i] = 1;
        cells.push(p);
      }
    }
  }
  return { res, x0, y0, nx, ny, mask, cells };
}

/** Neigung (Grad), Fallrichtung (Einheitsvektor in x/y der Daten, nach unten), Fläche (3D) einer Dachfläche */
export function roofFace(poly) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0, z0] = poly[i], [x1, y1, z1] = poly[(i + 1) % poly.length];
    nx += (y0 - y1) * (z0 + z1);
    ny += (z0 - z1) * (x0 + x1);
    nz += (x0 - x1) * (y0 + y1);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  if (nz < 0) [nx, ny, nz] = [-nx, -ny, -nz]; // nach oben
  const h = Math.hypot(nx, ny);
  return {
    pitch: (Math.atan2(h, nz) * 180) / Math.PI,
    down: h > 1e-9 ? [nx / h, ny / h] : [0, 0],
    area: l / 2,
    zMin: Math.min(...poly.map((p) => p[2])),
    zMax: Math.max(...poly.map((p) => p[2])),
  };
}

/** Konvexe Hülle (2D, Andrew) */
export function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Gebäude wählen: --id, sonst das mit dem Schwerpunkt am nächsten an `near` [E, N], sonst das einzige */
export function pickBuilding(buildings, { id, near } = {}) {
  if (id) return buildings.find((b) => b.id === id) || null;
  if (buildings.length === 1) return buildings[0];
  if (!near) return null;
  let best = null, bd = Infinity;
  for (const b of buildings) {
    const fp = footprintOf(b);
    if (!fp.length) continue;
    const c = centroid(fp), d = Math.hypot(c[0] - near[0], c[1] - near[1]);
    if (d < bd) [best, bd] = [b, d];
  }
  return best;
}
