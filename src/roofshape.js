// Form eines Steildachs (reine Geometrie, ohne three.js – auch für model.js und die Unit-Tests).
//
// Ein Dachteil hat einen konvexen Umriss (Außenkante der Wände). Jede Traufkante trägt eine Dachebene, die von der
// Kante aus mit der Neigung ansteigt; die Dachfläche ist überall die niedrigste dieser Ebenen (untere Hülle). Für
// konvexe Umrisse ergibt das genau Sattel-, Walm-, Krüppelwalm- und Pultdach: Ortgänge (Giebelkanten) tragen keine
// Ebene, beim Krüppelwalm beginnt dort eine Walmebene erst in einer gewissen Höhe. `top` schneidet das Dach waagrecht
// ab (Plateau), `opening` spart einen konvexen Bereich aus (Dachterrasse). Höhen relativ zur Traufe (Wandoberkante).

const EPS = 1e-7;
const rad = (d) => (d * Math.PI) / 180;

/** Umriss gegen den Uhrzeigersinn im Plan (x nach rechts, y nach unten: Fläche positiv) */
export function ccwPoly(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? [...poly].reverse() : poly;
}

/** Nach innen zeigende Einheitsnormale der Kante a→b eines Umrisses mit positiver Fläche */
function inward(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
}

/** Lineare Funktion f(p) = A·x + B·y + C */
const lin = (A, B, C) => ({ A, B, C });
const at = (f, p) => f.A * p[0] + f.B * p[1] + f.C;

/** Konvexes Polygon auf die Halbebene a·x + b·y + c ≤ 0 beschneiden (Sutherland–Hodgman) */
export function clipHalf(poly, a, b, c) {
  const out = [];
  const v = (p) => a * p[0] + b * p[1] + c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const vp = v(p), vq = v(q);
    if (vp <= EPS) out.push(p);
    if ((vp < -EPS && vq > EPS) || (vp > EPS && vq < -EPS)) {
      const t = vp / (vp - vq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  // doppelte Punkte entfernen
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length];
    return out.length < 2 || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
}

const area = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
};

/** Konvexen Umriss um d nach außen versetzen (Dachüberstand) */
export function offsetPoly(poly, d) {
  if (!d) return poly.map((p) => [...p]);
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n], m = inward(a, b);
    return { p: [a[0] - m[0] * d, a[1] - m[1] * d], d: [b[0] - a[0], b[1] - a[1]] };
  });
  return lines.map((l, i) => {
    const k = lines[(i + n - 1) % n];
    const den = k.d[0] * l.d[1] - k.d[1] * l.d[0];
    if (Math.abs(den) < EPS) return l.p;
    const t = ((l.p[0] - k.p[0]) * l.d[1] - (l.p[1] - k.p[1]) * l.d[0]) / den;
    return [k.p[0] + k.d[0] * t, k.p[1] + k.d[1] * t];
  });
}

/** Richtung als Einheitsvektor im Plan: 'x', 'y', '+x', '-y' … oder Grad (von +x Richtung +y) */
export function planDir(v, fallback = [1, 0]) {
  if (v == null) return fallback;
  if (typeof v === 'number') return [Math.cos(rad(v)), Math.sin(rad(v))];
  const m = /^([+-]?)([xy])$/.exec(String(v).trim());
  if (!m) return fallback;
  const s = m[1] === '-' ? -1 : 1;
  return m[2] === 'x' ? [s, 0] : [0, s];
}

/**
 * Dachform eines Dachteils.
 * @param part { type, polygon, pitch, ridge, slope, overhang, top, opening, hip_height, hip_pitch }
 */
export function roofShape(part) {
  const type = part.type || 'flat';
  const outline = ccwPoly(part.polygon);
  const k = Math.tan(rad(part.pitch ?? (type === 'shed' ? 15 : 35)));
  const n = outline.length;
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { a, b, len, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n: inward(a, b) };
  });
  // Firstrichtung: angegeben, sonst entlang der längsten Kante
  const longest = edges.reduce((m, e) => (e.len > m.len ? e : m), edges[0]);
  const ridge = planDir(part.ridge, longest.dir);
  // Pultdach: Fallrichtung (dorthin läuft das Wasser), sonst quer zum First
  const slope = type === 'shed' ? planDir(part.slope, [-ridge[1], ridge[0]]) : null;
  const plane = (e, h0, kk) => lin(kk * e.n[0], kk * e.n[1], h0 - kk * (e.n[0] * e.a[0] + e.n[1] * e.a[1]));

  const fns = []; // { f, edge (Index oder -1), eave }
  const parallel = (e) => Math.abs(e.dir[0] * ridge[0] + e.dir[1] * ridge[1]) > Math.cos(rad(25));
  // Höhe des Firsts eines Satteldachs: halbe Gebäudetiefe quer zum First
  const across = [-ridge[1], ridge[0]];
  const proj = outline.map((p) => p[0] * across[0] + p[1] * across[1]);
  const ridgeHeight = (k * (Math.max(...proj) - Math.min(...proj))) / 2;
  edges.forEach((e, i) => {
    if (type === 'hip') fns.push({ f: plane(e, 0, k), edge: i, eave: true });
    else if (type === 'gable' || type === 'half_hip') {
      if (parallel(e)) fns.push({ f: plane(e, 0, k), edge: i, eave: true });
      else if (type === 'half_hip') {
        // Krüppelwalm: Walm erst ab hip_height über der Traufe (Standard: 60 % der Firsthöhe)
        const hh = part.hip_height ?? ridgeHeight * 0.6;
        fns.push({ f: plane(e, hh, Math.tan(rad(part.hip_pitch ?? Math.min(80, (part.pitch ?? 35) + 15)))), edge: i, eave: false, hip: true, h0: hh });
      }
    } else if (type === 'shed') {
      // Traufe(n): Kanten, deren Außenseite in Fallrichtung zeigt
      if (-(e.n[0] * slope[0] + e.n[1] * slope[1]) > Math.cos(rad(45))) fns.push({ f: plane(e, 0, k), edge: i, eave: true });
    }
  });
  if (part.top != null) fns.push({ f: lin(0, 0, part.top), edge: -1, eave: false, top: true });
  if (!fns.length) fns.push({ f: lin(0, 0, 0), edge: -1, eave: false, top: true }); // flach

  const opening = part.opening?.length >= 3 ? ccwPoly(part.opening) : null;
  const ext = offsetPoly(outline, part.overhang ?? 0);

  const height = (p) => Math.min(...fns.map((x) => at(x.f, p)));

  /** Fläche jeder Ebene (konvexe Polygone, ohne Aussparung): [{ fn, poly }] */
  const faces = (region = ext) => {
    const out = [];
    fns.forEach((x, i) => {
      let poly = region;
      for (let j = 0; j < fns.length && poly.length >= 3; j++) {
        if (j === i) continue;
        const g = fns[j].f;
        const a = x.f.A - g.A, b = x.f.B - g.B, c = x.f.C - g.C;
        if (Math.abs(a) < EPS && Math.abs(b) < EPS) {
          if (c > EPS || (Math.abs(c) <= EPS && j < i)) poly = []; // gleich: nur die erste Ebene behält die Fläche
          continue;
        }
        poly = clipHalf(poly, a, b, c);
      }
      if (poly.length < 3 || area(poly) < 1e-6) return;
      for (const piece of opening ? minusConvex(poly, opening) : [poly]) out.push({ fn: x, index: i, poly: piece });
    });
    return out;
  };

  /**
   * Höhenverlauf entlang der Strecke a→b: Knickstellen [{ t, h }] (stückweise linear dazwischen), t in 0..1.
   */
  const profile = (a, b) => {
    const ts = new Set([0, 1]);
    const d = [b[0] - a[0], b[1] - a[1]];
    for (let i = 0; i < fns.length; i++) {
      for (let j = i + 1; j < fns.length; j++) {
        const f = fns[i].f, g = fns[j].f;
        const fa = at(f, a) - at(g, a), slopeT = (f.A - g.A) * d[0] + (f.B - g.B) * d[1];
        if (Math.abs(slopeT) < EPS) continue;
        const t = -fa / slopeT;
        if (t > EPS && t < 1 - EPS) ts.add(t);
      }
    }
    return [...ts].sort((x, y) => x - y).map((t) => ({ t, h: height([a[0] + d[0] * t, a[1] + d[1] * t]) }));
  };

  return { type, outline, ext, edges, fns, opening, k, ridgeHeight, height, faces, profile, contains: (p) => insideConvex(ext, p) };
}

/** Punkt im konvexen Polygon (gegen den Uhrzeigersinn, positive Fläche)? */
export function insideConvex(poly, p) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], m = inward(a, b);
    if ((p[0] - a[0]) * m[0] + (p[1] - a[1]) * m[1] < -1e-6) return false;
  }
  return true;
}

/** Konvexes Polygon geschnitten mit einem konvexen Bereich (gegen den Uhrzeigersinn) */
export function clipToConvex(poly, region) {
  let out = poly;
  for (let i = 0; i < region.length && out.length >= 3; i++) {
    const a = region[i], b = region[(i + 1) % region.length], m = inward(a, b);
    out = clipHalf(out, -m[0], -m[1], m[0] * a[0] + m[1] * a[1]);
  }
  return out.length >= 3 && area(out) > 1e-6 ? out : [];
}

/** Konvexes Polygon minus konvexes Loch -> disjunkte konvexe Stücke */
export function minusConvex(poly, hole) {
  const pieces = [];
  let rest = poly;
  for (let i = 0; i < hole.length && rest.length >= 3; i++) {
    const a = hole[i], b = hole[(i + 1) % hole.length], m = inward(a, b);
    // außerhalb dieser Lochkante: m·(p − a) ≤ 0
    const c = -(m[0] * a[0] + m[1] * a[1]);
    const out = clipHalf(rest, m[0], m[1], c);
    if (out.length >= 3 && area(out) > 1e-6) pieces.push(out);
    rest = clipHalf(rest, -m[0], -m[1], -c); // innerhalb weiter zerlegen
  }
  return pieces;
}
