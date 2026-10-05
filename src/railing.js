// Geländer und Brüstungen an den Kanten eines Bereichs (outdoor[].railing, Dachteile mit railing): Balustrade mit
// Docken (weiß), Metallgeländer mit Stäben oder Glas zwischen Pfosten. Steht 5 cm innerhalb der Kante auf der Fläche
// (auch am Hang: jede Docke auf ihrer Höhe, Handlauf schräg dazwischen).
import { pointInPoly } from './geometry.js';

// color: null = vorhandenes Material (weiß wie Fensterrahmen bzw. helles Metall) – spart Zeichenaufrufe
const STYLES = {
  balusters: { post: 0.09, spacing: 2.0, rail: [0.09, 0.06], bar: 0.04, barStep: 0.13, color: null, base: 'frame' },
  metal: { post: 0.05, spacing: 1.5, rail: [0.05, 0.04], bar: 0.016, barStep: 0.12, color: '#3a3d40', base: 'frame' },
  glass: { post: 0.05, spacing: 1.25, rail: [0.05, 0.04], bar: 0, color: null, base: 'metal' },
};

/** Quader entlang a→b (Plan) mit Breite w, unten ya0/yb0, oben ya1/yb1 (Höhen dürfen an a und b verschieden sein) */
export function beam(B, a, b, w, ya0, ya1, yb0, yb1, idx) {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n = [(-(b[1] - a[1]) / l) * (w / 2), ((b[0] - a[0]) / l) * (w / 2)];
  const A1 = [a[0] + n[0], a[1] + n[1]], A2 = [a[0] - n[0], a[1] - n[1]], B1 = [b[0] + n[0], b[1] + n[1]], B2 = [b[0] - n[0], b[1] - n[1]];
  B.skirt(A1, ya0, ya1, B1, yb0, yb1, idx);
  B.skirt(A2, ya0, ya1, B2, yb0, yb1, idx);
  B.skirt(A1, ya0, ya1, A2, ya0, ya1, idx);
  B.skirt(B1, yb0, yb1, B2, yb0, yb1, idx);
  // Deckel oben (schräg möglich)
  B.triUV([A1[0], ya1, A1[1]], [B1[0], yb1, B1[1]], [B2[0], yb1, B2[1]], [0, 0], [l, 0], [l, w], idx, true);
  B.triUV([A1[0], ya1, A1[1]], [B2[0], yb1, B2[1]], [A2[0], ya1, A2[1]], [0, 0], [l, w], [0, w], idx, true);
}

/** Senkrechter Pfosten (Quadrat s) an p von y0 bis y1 */
function post(B, p, s, y0, y1, idx) {
  beam(B, [p[0] - s / 2, p[1]], [p[0] + s / 2, p[1]], s, y0, y1, y0, y1, idx);
}

/**
 * @param poly   Umriss des Bereichs
 * @param spec   { style, height, edges, color }
 * @param baseAt (p) => Höhe der Fläche an p
 * @param get    (role, color) => Builder: 'frame' (weiß bzw. Farbe), 'metal' (helles Metall), 'glass'
 */
export function buildRailing(poly, spec, baseAt, get, idx) {
  const st = STYLES[spec.style] || STYLES.balusters;
  const H = spec.height ?? 1.0;
  const frame = get(spec.color ? 'frame' : st.base, spec.color || st.color);
  const edges = Array.isArray(spec.edges) ? spec.edges : poly.map((_, i) => i);
  for (const i of edges) {
    const a0 = poly[i % poly.length], b0 = poly[(i + 1) % poly.length];
    const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
    if (len < 0.2) continue;
    const d = [(b0[0] - a0[0]) / len, (b0[1] - a0[1]) / len];
    let n = [-d[1], d[0]];
    const mid = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
    if (!pointInPoly([mid[0] + n[0] * 0.1, mid[1] + n[1] * 0.1], poly)) n = [-n[0], -n[1]];
    // 5 cm nach innen, an den Enden um die Pfostenbreite eingerückt
    const inset = 0.05 + st.post / 2;
    const P = (t) => [a0[0] + d[0] * t + n[0] * inset, a0[1] + d[1] * t + n[1] * inset];
    const t0 = inset, t1 = len - inset;
    const k = Math.max(1, Math.round((t1 - t0) / st.spacing));
    const posts = Array.from({ length: k + 1 }, (_, m) => t0 + ((t1 - t0) * m) / k);
    const [rw, rh] = st.rail;
    for (const t of posts) {
      const p = P(t), y = baseAt(p);
      post(frame, p, st.post, y, y + H + 0.02, idx);
    }
    for (let m = 0; m < k; m++) {
      const ta = posts[m], tb = posts[m + 1], pa = P(ta), pb = P(tb), ya = baseAt(pa), yb = baseAt(pb);
      // Handlauf und untere Leiste
      beam(frame, pa, pb, rw, ya + H - rh, ya + H, yb + H - rh, yb + H, idx);
      if (spec.style !== 'glass') beam(frame, pa, pb, rw * 0.8, ya + 0.08, ya + 0.08 + rh * 0.8, yb + 0.08, yb + 0.08 + rh * 0.8, idx);
      if (spec.style === 'glass') {
        // Glasscheibe zwischen den Pfosten (beidseitig sichtbar)
        const g = get('glass');
        const ia = [pa[0] + d[0] * st.post, pa[1] + d[1] * st.post], ib = [pb[0] - d[0] * st.post, pb[1] - d[1] * st.post];
        g.skirt(ia, ya + 0.06, ya + H - rh - 0.02, ib, yb + 0.06, yb + H - rh - 0.02, idx);
        continue;
      }
      // Docken bzw. Stäbe dazwischen
      const n2 = Math.max(1, Math.floor((tb - ta - st.post) / st.barStep));
      for (let q = 1; q < n2; q++) {
        const t = ta + ((tb - ta) * q) / n2, p = P(t), y = baseAt(p);
        post(frame, p, st.bar, y + 0.08 + rh * 0.8, y + H - rh, idx);
      }
    }
  }
}
