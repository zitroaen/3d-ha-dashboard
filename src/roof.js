import { ccwPoly, clipHalf, clipToConvex, minusConvex } from './roofshape.js';

// Steildach eines Dachteils zeichnen (Form aus roofshape.js): Dachflächen mit Ziegel-UV entlang der Neigung,
// Untersicht, Blende an Traufe und Ortgang, Giebelwände über der obersten Etage, Gauben und Schornsteine.
// Außerdem: Oberkante der Wände der obersten Etage unter einem Steildach (Kniestock, Giebel, Abseiten).
const fnAt = (f, p) => f.A * p[0] + f.B * p[1] + f.C;
const P3 = (p, y) => [p[0], y, p[1]];

/**
 * @param room  Raum der Dach-Etage (room.roof = Dachteil mit shape)
 * @param idx   Raum-Index (Licht)
 * @param b     Builder: surf (Dachfläche), under (Untersicht), edge (Blende), walls, glass, pvc, chimney
 * @param yb    Oberkante der obersten Etage in Koordinaten der Dach-Etage (Giebelwände beginnen dort)
 * @returns Builder der Dachflächen (für das Antippen)
 */
export function buildPitchedRoof(room, idx, b, yb, others = []) {
  const part = room.roof, s = part.shape, off = room.elevation || 0, t = part.thickness ?? 0.2;
  // Durchdringung: Flächen nur dort, wo kein anderer Dachteil höher liegt (Kehlen ergeben sich so); Gauben bis zur
  // Traufe unterbrechen Traufe und Überstand über ihre Breite
  // unter jeder Gaube keine Dachfläche (sonst sieht man sie durchs Gaubenfenster)
  const holes = (part.dormers || []).map((d) => dormerFrame(d, s)).filter(Boolean).map((fr) => fr.hole(part.overhang ?? 0));
  const hidden = (p, h) => holes.some((hole) => insideRegion(hole, p)) || others.some((o) => o.shape.contains(p) && o.off + o.shape.height(p) > h + 1e-3);
  const faces = [];
  for (const face of s.faces()) {
    let pieces = [face.poly];
    for (const o of others) {
      const next = [];
      for (const poly of pieces) {
        // Bereich, in dem diese Ebene unter allen Ebenen des anderen Teils liegt
        let under = clipToConvex(poly, o.shape.ext);
        for (const g of o.shape.fns) {
          if (under.length < 3) break;
          under = clipHalf(under, face.fn.f.A - g.f.A, face.fn.f.B - g.f.B, face.fn.f.C + off - g.f.C - o.off + 1e-3);
        }
        if (under.length >= 3) next.push(...minusConvex(poly, under));
        else next.push(poly);
      }
      pieces = next;
    }
    for (const hole of holes) pieces = pieces.flatMap((poly) => minusConvex(poly, hole));
    for (const poly of pieces) faces.push({ fn: face.fn, poly });
  }
  const onLine = (p, a, c) => Math.abs((c[0] - a[0]) * (p[1] - a[1]) - (c[1] - a[1]) * (p[0] - a[0])) / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1) < 1e-4;
  const boundary = (p, q, poly) => poly.some((a, i) => {
    const c = poly[(i + 1) % poly.length];
    return onLine(p, a, c) && onLine(q, a, c);
  });

  for (const { fn, poly } of faces) {
    const y = (p) => off + fnAt(fn.f, p);
    // UV: entlang der Traufe × die Fläche hinauf (Ziegelreihen liegen waagrecht)
    const e = fn.edge >= 0 ? s.edges[fn.edge] : null;
    const kk = Math.hypot(fn.f.A, fn.f.B);
    const uv = e
      ? (p) => [p[0] * e.dir[0] + p[1] * e.dir[1], ((p[0] - e.a[0]) * e.n[0] + (p[1] - e.a[1]) * e.n[1]) * Math.sqrt(1 + kk * kk)]
      : (p) => [p[0], p[1]];
    for (let i = 1; i + 1 < poly.length; i++) {
      const [p0, p1, p2] = [poly[0], poly[i], poly[i + 1]];
      b.surf.triUV(P3(p0, y(p0)), P3(p1, y(p1)), P3(p2, y(p2)), uv(p0), uv(p1), uv(p2), idx, true);
      b.under.triUV(P3(p0, y(p0) - t), P3(p1, y(p1) - t), P3(p2, y(p2) - t), uv(p0), uv(p1), uv(p2), idx, false);
    }
    // Blende rundum (Traufe, Ortgang) und Brüstung an der Aussparung (bis auf die Dachterrasse)
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (boundary(p, q, s.ext)) {
        if (!hidden(mid, y(mid))) b.edge.skirt(p, y(p) - t, y(p), q, y(q) - t, y(q), idx);
      }
      else if (s.opening && boundary(p, q, s.opening)) {
        const bottom = part.openingFloor ?? Math.min(y(p), y(q)) - t;
        b.walls.skirt(p, bottom, y(p), q, bottom, y(q), idx);
      }
    }
  }

  // Giebelwände und Drempel: Außenwand von der Oberkante der obersten Etage bis unter die Dachfläche (Anbau über
  // einer tieferen Etage: ab der Traufe – dessen Wände reichen bis dorthin)
  if (!part.overTop) yb = off - t;
  for (const e of s.edges) {
    const prof = s.profile(e.a, e.b).map(({ t: u, h }) => ({ p: [e.a[0] + (e.b[0] - e.a[0]) * u, e.a[1] + (e.b[1] - e.a[1]) * u], y: off + h - t }));
    for (let i = 0; i + 1 < prof.length; i++) {
      let A = prof[i], B = prof[i + 1];
      if (A.y <= yb + 1e-3 && B.y <= yb + 1e-3) continue;
      if (A.y < yb || B.y < yb) {
        // nur der Teil über der Etage
        const u = (yb - A.y) / (B.y - A.y), m = { p: [A.p[0] + (B.p[0] - A.p[0]) * u, A.p[1] + (B.p[1] - A.p[1]) * u], y: yb };
        if (A.y < yb) A = m;
        else B = m;
      }
      // Giebel im anderen Dachteil (Kreuzdach): verdeckt
      const mid = [(A.p[0] + B.p[0]) / 2, (A.p[1] + B.p[1]) / 2];
      if (others.some((o) => o.shape.contains(mid) && o.off + o.shape.height(mid) > (A.y + B.y) / 2 + t)) continue;
      (b.facade || b.walls).skirt(A.p, yb, A.y, B.p, yb, B.y, 0);
    }
  }

  for (const d of part.dormers || []) dormer(d, s, off, idx, b, yb);
  for (const c of part.chimneys || []) chimney(c, s, off, idx, b);
}

/** Punkt in einem konvexen Bereich (Reihenfolge beliebig) */
function insideRegion(poly, p) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const v = (c[0] - a[0]) * (p[1] - a[1]) - (c[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(v) < 1e-9) continue;
    if (sign && Math.sign(v) !== sign) return false;
    sign = Math.sign(v);
  }
  return true;
}

/**
 * Lage einer Gaube auf ihrem Dachteil (Höhen relativ zur Traufe): Dachebene, Richtungen entlang der Traufe (u) und die
 * Fläche hinauf (n), Höhe der Front, Ende auf der Dachfläche, Unterseite des Gaubendachs. Gemeinsam für das Zeichnen,
 * die Wände darunter (ceilingFn) und die Prüfung. null, wenn die Gaube nicht auf eine geneigte Fläche passt.
 */
export function dormerFrame(d, s) {
  const P0 = d.pos;
  if (!P0 || !s.contains(P0)) return null;
  // Dachebene an der Stelle: die niedrigste (gleiche Regel wie die Fläche)
  const fn = s.fns.reduce((m, x) => (fnAt(x.f, P0) < fnAt(m.f, P0) ? x : m), s.fns[0]);
  if (fn.edge < 0) return null; // auf dem Plateau keine Gaube
  const e = s.edges[fn.edge], k = Math.hypot(fn.f.A, fn.f.B);
  const u = e.dir, n = e.n;
  const w = d.width ?? 1.6, fh = d.height ?? 1.4, type = d.type || 'shed';
  const pd = Math.tan(((d.pitch ?? (type === 'gable' ? 40 : type === 'shed' ? 10 : 0)) * Math.PI) / 180);
  if (type !== 'gable' && k <= pd + 0.05) return null; // Gaubendach flacher als das Dach nötig
  const h0 = fnAt(fn.f, P0);
  const sEnd = type === 'gable' ? fh / k : fh / (k - pd);
  const L = (x, sUp) => [P0[0] + u[0] * x + n[0] * sUp, P0[1] + u[1] * x + n[1] * sUp];
  const local = (p) => [(p[0] - P0[0]) * u[0] + (p[1] - P0[1]) * u[1], (p[0] - P0[0]) * n[0] + (p[1] - P0[1]) * n[1]];
  // Unterseite des Gaubendachs (ohne Dachstärke) über dem Punkt (x entlang, sUp hinauf)
  const roofAt = (x, sUp) => (type === 'gable' ? h0 + fh + pd * Math.max(0, w / 2 - Math.abs(x)) : h0 + fh + pd * sUp);
  const openings = d.window === 'openings';
  return {
    d, fn, e, k, u, n, w, fh, type, pd, h0, sEnd, L, local, roofAt, openings,
    /** Grundriss unter der Gaube (Front bis Ende), vorn um front Meter verlängert (Wanddicke) */
    covers(p, front = 0.35) {
      const [x, sUp] = local(p);
      return Math.abs(x) <= w / 2 + 1e-6 && sUp >= -front && sUp <= sEnd;
    },
    /**
     * Aussparung in der Dachfläche: Grundriss der Gaube (bis knapp vor ihr Ende auf der Fläche); bis zur Traufe auch
     * Traufe und Überstand davor
     */
    hole(ov) {
      const front = openings ? -(ov + 0.6) : 0, back = sEnd - 0.02;
      return ccwPoly([L(-w / 2, front), L(w / 2, front), L(w / 2, back), L(-w / 2, back)]);
    },
  };
}

/**
 * Gaube: Front mit Fensteröffnung (Brüstung, Sturz, zwei Pfeiler, Glas in der Öffnung), Seitenwangen, eigenes Dach
 * (Schlepp-, Flach- oder Satteldach) bis auf die Dachfläche. window: false = geschlossene Front; window: openings =
 * keine eigene Front – die Öffnungen der Wand darunter (Fenster, Tür) sitzen darin, die Wand reicht bis unters
 * Gaubendach; darüber (oberhalb der Etage) schließt die Gaube die Front.
 */
function dormer(d, s, off, idx, b, yb) {
  const fr = dormerFrame(d, s);
  if (!fr) return;
  const { L, w, fh, type, pd, k, sEnd } = fr;
  const ov = 0.15, h0 = off + fr.h0;
  const main = (sUp) => h0 + k * sUp;
  const yTop = (sUp) => (type === 'gable' ? h0 + fh : h0 + fh + pd * sUp);
  const yRidge = h0 + fh + (w / 2) * pd, sRidge = (fh + (w / 2) * pd) / k;
  const fac = b.facade || b.walls;
  const front = (x0, x1, y0, y1) => y1 > y0 + 1e-3 && fac.skirt(L(x0, 0), y0, y1, L(x1, 0), y0, y1, idx);

  // Front: Wand mit Fensteröffnung (bzw. geschlossen / aus den Öffnungen der Etage darunter)
  const fl = L(-w / 2, 0), fr0 = L(w / 2, 0);
  if (fr.openings) front(-w / 2, w / 2, Math.max(h0 - 0.05, yb), h0 + fh);
  else if (d.window === false) front(-w / 2, w / 2, h0 - 0.05, h0 + fh);
  else {
    const ww = Math.min(w - 0.3, d.window_width ?? w - 0.4), wy0 = h0 + 0.18, wy1 = h0 + fh - 0.15;
    front(-w / 2, w / 2, h0 - 0.05, wy0); // Brüstung
    front(-w / 2, w / 2, wy1, h0 + fh); // Sturz
    front(-w / 2, -ww / 2, wy0, wy1); // Pfeiler
    front(ww / 2, w / 2, wy0, wy1);
    // Glas in der Öffnung, Rahmen ringsum
    b.glass.quadV(L(-ww / 2, 0.03), L(ww / 2, 0.03), wy0, wy1, idx);
    const frame = (x0, x1, y0, y1) => b.pvc.skirt(L(x0, 0.01), y0, y1, L(x1, 0.01), y0, y1, idx);
    const bar = 0.06;
    frame(-ww / 2, ww / 2, wy0, wy0 + bar);
    frame(-ww / 2, ww / 2, wy1 - bar, wy1);
    frame(-ww / 2, -ww / 2 + bar, wy0, wy1);
    frame(ww / 2 - bar, ww / 2, wy0, wy1);
    if (ww > 1.1) frame(-bar / 2, bar / 2, wy0, wy1); // Mittelpfosten
  }
  if (type === 'gable') {
    fac.triUV(P3(fl, h0 + fh), P3(fr0, h0 + fh), P3(L(0, 0), yRidge), [0, 0], [w, 0], [w / 2, yRidge - h0 - fh], idx);
    fac.triUV(P3(fl, h0 + fh), P3(L(0, 0), yRidge), P3(fr0, h0 + fh), [0, 0], [w / 2, yRidge - h0 - fh], [w, 0], idx);
  }
  // Wangen: von der Front bis auf die Dachfläche
  const yLow = fr.openings ? Math.max(h0 - 0.05, yb) : h0 - 0.05;
  for (const x of [-w / 2, w / 2]) {
    const a = P3(L(x, 0), yLow), c = P3(L(x, 0), h0 + fh), z = P3(L(x, sEnd), main(sEnd));
    fac.triUV(a, c, z, [0, 0], [0, fh], [sEnd, fh], idx);
    fac.triUV(a, z, c, [0, 0], [sEnd, fh], [0, fh], idx);
  }
  // Dach der Gaube (Oberseite in Dachdeckung, Unterseite hell)
  const quadUp = (A, B, C, D) => {
    const uvq = (p) => [p[0], p[2]];
    b.surf.triUV(A, B, C, uvq(A), uvq(B), uvq(C), idx, true);
    b.surf.triUV(A, C, D, uvq(A), uvq(C), uvq(D), idx, true);
    b.under.triUV(A, B, C, uvq(A), uvq(B), uvq(C), idx, false);
    b.under.triUV(A, C, D, uvq(A), uvq(C), uvq(D), idx, false);
  };
  if (type === 'gable') {
    for (const sx of [-1, 1]) {
      const eaveF = P3(L(sx * (w / 2 + ov), -ov), h0 + fh - ov * pd), ridgeF = P3(L(0, -ov), yRidge);
      const ridgeB = P3(L(0, sRidge), yRidge), eaveB = P3(L(sx * (w / 2 + ov), sEnd), main(sEnd));
      quadUp(eaveF, ridgeF, ridgeB, eaveB);
    }
  } else {
    const yF = yTop(-ov), yB = yTop(sEnd);
    quadUp(P3(L(-w / 2 - ov, -ov), yF), P3(L(w / 2 + ov, -ov), yF), P3(L(w / 2 + ov, sEnd), yB), P3(L(-w / 2 - ov, sEnd), yB));
    b.edge.skirt(L(-w / 2 - ov, -ov), yF - 0.12, yF, L(w / 2 + ov, -ov), yF - 0.12, yF, idx);
  }
}

/** Schornstein: Quader durch die Dachfläche, Oberkante `height` über dem höchsten Punkt darunter, Abdeckplatte */
function chimney(c, s, off, idx, b) {
  if (!c.pos) return;
  const [w, dd] = c.size || [0.5, 0.5];
  const [x, y] = c.pos;
  const corners = [[x - w / 2, y - dd / 2], [x + w / 2, y - dd / 2], [x + w / 2, y + dd / 2], [x - w / 2, y + dd / 2]];
  const hs = corners.map((p) => s.height(p));
  const y0 = off + Math.min(...hs) - 0.3, y1 = off + Math.max(...hs) + (c.height ?? 0.8);
  for (let i = 0; i < 4; i++) b.chimney.skirt(corners[i], y0, y1, corners[(i + 1) % 4], y0, y1, idx);
  b.chimney.polyH(corners, y1, idx);
  const cap = corners.map(([px, py]) => [x + (px - x) * 1.25, y + (py - y) * 1.25]);
  b.edge.polyH(cap, y1 + 0.05, idx);
  b.edge.polyH(cap, y1 + 0.01, idx, true);
  for (let i = 0; i < 4; i++) b.edge.skirt(cap[i], y1 + 0.01, y1 + 0.05, cap[(i + 1) % 4], y1 + 0.01, y1 + 0.05, idx);
}

/**
 * Oberkante der Wände der obersten Etage unter Steildächern: min(Geschosshöhe, Traufe + Dachfläche) – so zeigen
 * Kniestock, Giebel und Dachschrägen ihre Neigung.
 */
export function ceilingFn(cut, H) {
  const parts = cut.map((r) => ({ r, frames: (r.dormers || []).map((d) => dormerFrame(d, r.shape)).filter(Boolean) }));
  return (p) => {
    // mehrere Dachteile durchdringen sich: der höchste zählt (Vereinigung); unter einer Gaube ihr Dach
    let c = -Infinity;
    for (const { r, frames } of parts) {
      if (!r.shape.contains(p)) continue;
      let h = r.shape.height(p);
      for (const fr of frames) if (fr.covers(p)) h = Math.max(h, fr.roofAt(...fr.local(p)));
      c = Math.max(c, r.eaves + h);
    }
    return c === -Infinity ? H : Math.min(H, c);
  };
}

/** Knickstellen der Oberkante entlang a→b: [{ t, y }] (adaptiv verfeinert, stückweise linear) */
export function ceilingProfile(cut, C, a, b) {
  const P = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const ts = new Set([0, 1]);
  for (const r of cut) for (const { t } of r.shape.profile(a, b)) ts.add(t);
  const sorted = [...ts].sort((x, y) => x - y);
  const out = [];
  const refine = (t0, c0, t1, c1, depth) => {
    const m = (t0 + t1) / 2, cm = C(P(m));
    if (depth < 7 && t1 - t0 > 1e-3 && Math.abs(cm - (c0 + c1) / 2) > 0.004) {
      refine(t0, c0, m, cm, depth + 1);
      out.push({ t: m, y: cm });
      refine(m, cm, t1, c1, depth + 1);
    }
  };
  let prev = { t: sorted[0], y: C(P(sorted[0])) };
  out.push(prev);
  for (const t of sorted.slice(1)) {
    const cur = { t, y: C(P(t)) };
    refine(prev.t, prev.y, cur.t, cur.y, 0);
    out.push(cur);
    prev = cur;
  }
  return out.map((x) => ({ ...x, p: P(x.t) }));
}

/**
 * Fenster unter einer Dachschräge: niedrigste Wandoberkante entlang der Fensterbreite (ceilingAt der obersten Etage).
 * Reicht sie nicht bis zum Sturz, wird das Fenster gekürzt (5 cm unter der Schräge); bleiben weniger als 30 cm über
 * der Brüstung, entfällt es. Liegt es unter einer Gaube (cut[].dormers), entfällt es ebenfalls – die Gaube hat ihr
 * eigenes Fenster. Liefert { top } (gekürzt), { omit: true, dormer? } oder {} (passt).
 */
export function windowUnderRoof(win, ceilingAt, cut = []) {
  if (!ceilingAt) return {};
  const [x0, y0, x1, y1] = win.rect;
  const alongX = x1 - x0 >= y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let wallTop = Infinity;
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    wallTop = Math.min(wallTop, ceilingAt(alongX ? [x0 + (x1 - x0) * t, cy] : [cx, y0 + (y1 - y0) * t]));
  }
  const sill = win.sill ?? 0.9, top = win.top ?? 2.1;
  if (wallTop >= top + 0.04) return {};
  if (cut.some((r) => underDormer([cx, cy], r))) return { omit: true, dormer: true, wallTop };
  if (wallTop - 0.05 < sill + 0.3) return { omit: true, wallTop };
  return { top: Math.round((wallTop - 0.05) * 1000) / 1000, wallTop };
}

/** Liegt der Punkt (Fenster in der Wand) vor einer Gaube dieses Dachteils? (Breite entlang der Traufe, ≤ 3 m davor) */
function underDormer(c, r) {
  for (const d of r.dormers || []) {
    if (!d.pos || d.window === 'openings') continue; // die Öffnungen der Wand sind die Fenster der Gaube
    // nächste Kante des Umrisses = Traufe, vor der die Gaube steht
    let best = null, bd = Infinity;
    for (const e of r.shape.edges) {
      const t = Math.max(0, Math.min(e.len, (d.pos[0] - e.a[0]) * e.dir[0] + (d.pos[1] - e.a[1]) * e.dir[1]));
      const dist = Math.hypot(e.a[0] + e.dir[0] * t - d.pos[0], e.a[1] + e.dir[1] * t - d.pos[1]);
      if (dist < bd) [best, bd] = [e, dist];
    }
    if (!best) continue;
    const dx = c[0] - d.pos[0], dy = c[1] - d.pos[1];
    const along = Math.abs(dx * best.dir[0] + dy * best.dir[1]), inward = dx * best.n[0] + dy * best.n[1];
    if (along <= (d.width ?? 1.6) / 2 + 0.1 && inward <= 0.2 && inward >= -3) return true;
  }
  return false;
}

/**
 * Tür unter einer Dachschräge: niedrigste Wandoberkante über die Türbreite. Reicht sie nicht bis zur Türhöhe, wird die
 * Tür auf 5 cm darunter begrenzt (mindestens 1,5 m). Liefert { top, wallTop } oder {} (passt).
 */
export function doorUnderRoof(d, top, ceilingAt) {
  if (!ceilingAt) return {};
  let wallTop = Infinity;
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    wallTop = Math.min(wallTop, ceilingAt([d.hinge[0] + (d.end[0] - d.hinge[0]) * t, d.hinge[1] + (d.end[1] - d.hinge[1]) * t]));
  }
  if (wallTop >= top + 0.02) return {};
  return { top: Math.max(1.5, Math.round((wallTop - 0.05) * 1000) / 1000), wallTop };
}
