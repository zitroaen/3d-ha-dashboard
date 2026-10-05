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
export function buildPitchedRoof(room, idx, b, yb) {
  const part = room.roof, s = part.shape, off = room.elevation || 0, t = part.thickness ?? 0.2;
  const faces = s.faces();
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
      if (boundary(p, q, s.ext)) b.edge.skirt(p, y(p) - t, y(p), q, y(q) - t, y(q), idx);
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
      (b.facade || b.walls).skirt(A.p, yb, A.y, B.p, yb, B.y, 0);
    }
  }

  for (const d of part.dormers || []) dormer(d, part, s, off, idx, b);
  for (const c of part.chimneys || []) chimney(c, s, off, idx, b);
}

/** Gaube: Front mit Fenster, Seitenwangen, eigenes Dach (Schlepp-, Flach- oder Satteldach) bis auf die Dachfläche */
function dormer(d, part, s, off, idx, b) {
  const P0 = d.pos;
  if (!P0 || !s.contains(P0)) return;
  // Dachebene an der Stelle: die niedrigste (gleiche Regel wie die Fläche)
  const fn = s.fns.reduce((m, x) => (fnAt(x.f, P0) < fnAt(m.f, P0) ? x : m), s.fns[0]);
  if (fn.edge < 0) return; // auf dem Plateau keine Gaube
  const e = s.edges[fn.edge], k = Math.hypot(fn.f.A, fn.f.B);
  const u = e.dir, n = e.n; // entlang der Traufe, die Fläche hinauf
  const w = d.width ?? 1.6, fh = d.height ?? 1.4, ov = 0.15, type = d.type || 'shed';
  const h0 = off + fnAt(fn.f, P0);
  const L = (x, sUp) => [P0[0] + u[0] * x + n[0] * sUp, P0[1] + u[1] * x + n[1] * sUp];
  const main = (sUp) => h0 + k * sUp;
  const pd = Math.tan(((d.pitch ?? (type === 'gable' ? 40 : type === 'shed' ? 10 : 0)) * Math.PI) / 180);
  if (type !== 'gable' && k <= pd + 0.05) return; // Gaubendach flacher als das Dach nötig
  // wo das Gaubendach auf die Dachfläche trifft
  const sEnd = type === 'gable' ? fh / k : fh / (k - pd);
  const yTop = (sUp) => (type === 'gable' ? h0 + fh : h0 + fh + pd * sUp);
  const yRidge = h0 + fh + (w / 2) * pd, sRidge = (fh + (w / 2) * pd) / k;

  // Front (mit Giebeldreieck) und Wangen
  const fl = L(-w / 2, 0), fr = L(w / 2, 0);
  (b.facade || b.walls).skirt(fl, h0 - 0.05, h0 + fh, fr, h0 - 0.05, h0 + fh, idx);
  if (type === 'gable') (b.facade || b.walls).triUV(P3(fl, h0 + fh), P3(fr, h0 + fh), P3(L(0, 0), yRidge), [0, 0], [w, 0], [w / 2, yRidge - h0 - fh], idx);
  if (type === 'gable') (b.facade || b.walls).triUV(P3(fl, h0 + fh), P3(L(0, 0), yRidge), P3(fr, h0 + fh), [0, 0], [w / 2, yRidge - h0 - fh], [w, 0], idx);
  for (const x of [-w / 2, w / 2]) {
    const a = P3(L(x, 0), h0 - 0.05), c = P3(L(x, 0), h0 + fh), z = P3(L(x, sEnd), main(sEnd));
    (b.facade || b.walls).triUV(a, c, z, [0, 0], [0, fh], [sEnd, fh], idx);
    (b.facade || b.walls).triUV(a, z, c, [0, 0], [sEnd, fh], [0, fh], idx);
  }
  // Fenster
  if (d.window !== false) {
    const ww = Math.min(w - 0.3, d.window_width ?? w - 0.4), wy0 = h0 + 0.18, wy1 = h0 + fh - 0.15, sIn = 0.03;
    const gl = L(-ww / 2, sIn), gr = L(ww / 2, sIn);
    b.glass.quadV(gl, gr, wy0, wy1, idx);
    const fr0 = (x0, x1, y0, y1) => b.pvc.skirt(L(x0, -0.01), y0, y1, L(x1, -0.01), y0, y1, idx);
    const bar = 0.06;
    fr0(-ww / 2 - bar, ww / 2 + bar, wy0 - bar, wy0);
    fr0(-ww / 2 - bar, ww / 2 + bar, wy1, wy1 + bar);
    fr0(-ww / 2 - bar, -ww / 2, wy0, wy1);
    fr0(ww / 2, ww / 2 + bar, wy0, wy1);
    if (ww > 1.1) fr0(-bar / 2, bar / 2, wy0, wy1); // Mittelpfosten
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
  return (p) => {
    let c = H;
    for (const r of cut) if (r.shape.contains(p)) c = Math.min(c, r.eaves + r.shape.height(p));
    return c;
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
