// Fenster und Türen im Detail: Rahmen, Flügel, Glas, Fensterbank, Zarge, Türblatt.
// Alles achsparallel oder als gedrehte Quader in Plan-Koordinaten; Seitenflächen bekommen (wie Wände)
// den Raum, in den sie zeigen, damit Lampen sie beleuchten.

const rad = (deg) => (deg * Math.PI) / 180;

const FRAME = 0.065;        // Blendrahmen-Breite (Ansicht)
const FRAME_DEPTH = 0.075;  // Bautiefe Kunststofffenster
const SASH = 0.055;         // Flügelrahmen
export const BOARD = 0.03;  // Fensterbank-Stärke (die Brüstung endet darunter, sonst Z-Fighting)
const GAP = 0.003;          // Abstand Rahmen <-> Laibung, damit keine Flächen aufeinanderliegen
const ZARGE = 0.035;        // Türzarge (Breite in der Öffnung)
const CASING = 0.07;        // Bekleidung auf der Wand
const LEAF = 0.04;          // Türblatt-Stärke

/**
 * Gedrehter Quader: Mittelpunkt c (Plan), Richtung u (Einheitsvektor), Länge L (entlang u), Tiefe D (quer),
 * von y0 bis y1. Seiten zeigen nach außen; die Oberseite immer, die Unterseite nur wenn bottom = true.
 */
export function orientedBox(b, fm, c, u, L, D, y0, y1, { roomIdx = null, bottom = false } = {}) {
  const n = [-u[1], u[0]];
  const hl = L / 2, hd = D / 2;
  const p = (s, t) => [c[0] + u[0] * s * hl + n[0] * t * hd, c[1] + u[1] * s * hl + n[1] * t * hd];
  const ring = [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
  for (let i = 0; i < 4; i++) {
    let a = ring[i], e = ring[(i + 1) % 4];
    const mid = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
    let nx = -(e[1] - a[1]), ny = e[0] - a[0];
    if (nx * (mid[0] - c[0]) + ny * (mid[1] - c[1]) < 0) {
      [a, e] = [e, a];
      nx = -nx; ny = -ny;
    }
    const len = Math.hypot(nx, ny) || 1;
    b.quadV(a, e, y0, y1, roomIdx ?? fm.roomBeside(mid, [nx / len, ny / len]));
  }
  b.polyH(ring, y1, roomIdx ?? fm.roomAt(c));
  if (bottom) b.polyH(ring, y0, roomIdx ?? fm.roomAt(c), true);
}

/** Standardhöhe einer Tür (Oberkante der Öffnung) */
export const DOOR_TOP = 2.05;

/**
 * Rundbogen einer Tür (doors[].arch: true oder top: arch): Radius = halbe Breite, Scheitel = height (sonst
 * Standardhöhe + Radius, der Kämpfer liegt dann auf Türhöhe). null ohne Bogen.
 */
export function doorArch(d, len) {
  if (!(d.arch === true || d.top === 'arch')) return null;
  const r = len / 2;
  const crown = d.height ? Math.max(d.height, r + 1.2) : DOOR_TOP + r;
  return { r, crown, spring: crown - r };
}

/** Dreieck mit gewünschter Normale nd (die Wicklung wird passend gedreht); UV aus der Lage */
function triN(b, A, B, C, nd, room) {
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * nd[0] + ny * nd[1] + nz * nd[2] < 0) [B, C] = [C, B];
  const uv = (p) => [p[0] + p[2], p[1]];
  b.triUV(A, B, C, uv(A), uv(B), uv(C), room);
}

/**
 * Bogenstück in einer senkrechten Ebene: Mitte c (Plan) auf Höhe y, Richtung u (Plan, Einheitsvektor), Radien
 * ri..ro (ri = 0: volle Scheibe), Dicke D quer zu u, Winkel a0..a1 (0 = Richtung u, π/2 = oben). Beide Seiten und
 * die Rundung außen (und innen bei ri > 0).
 */
export function archBand(b, c, u, ri, ro, y, D, { a0 = 0, a1 = Math.PI, room = 0, seg = 14 } = {}) {
  const n = [-u[1], u[0]];
  const at = (r, a, t) => [c[0] + u[0] * r * Math.cos(a) + n[0] * t, y + r * Math.sin(a), c[1] + u[1] * r * Math.cos(a) + n[1] * t];
  const steps = Math.max(2, Math.round((seg * (a1 - a0)) / Math.PI));
  for (let k = 0; k < steps; k++) {
    const p = a0 + ((a1 - a0) * k) / steps, q = a0 + ((a1 - a0) * (k + 1)) / steps, m = (p + q) / 2;
    for (const s of [-1, 1]) {
      const t = (s * D) / 2, nd = [n[0] * s, 0, n[1] * s];
      if (ri > 0) {
        triN(b, at(ri, p, t), at(ro, p, t), at(ro, q, t), nd, room);
        triN(b, at(ri, p, t), at(ro, q, t), at(ri, q, t), nd, room);
      } else triN(b, at(0, p, t), at(ro, p, t), at(ro, q, t), nd, room);
    }
    const rad3 = [u[0] * Math.cos(m), Math.sin(m), u[1] * Math.cos(m)];
    for (const [r, sg] of ri > 0 ? [[ro, 1], [ri, -1]] : [[ro, 1]]) {
      const nd = rad3.map((v) => v * sg);
      triN(b, at(r, p, -D / 2), at(r, q, -D / 2), at(r, q, D / 2), nd, room);
      triN(b, at(r, p, -D / 2), at(r, q, D / 2), at(r, p, D / 2), nd, room);
    }
  }
}

/**
 * Wand über einer Rundbogen-Tür zwischen Kämpfer und Scheitel (die Wand darüber baut house.js als Sturz): Zwickel auf
 * beiden Wandseiten und die gewölbte Laibung. P(s, t) = Plan-Punkt (entlang der Tür, quer), Seiten bei t = j0/j1.
 * pick(room) wählt den Builder (Fassade außen, sonst Wand).
 */
export function buildArchOpening(fm, P, u, n, len, [j0, j1], arch, pick, seg = 16) {
  const { r, crown, spring } = arch;
  const yAt = (s) => Math.min(crown, spring + Math.sqrt(Math.max(0, r * r - (s - r) * (s - r))));
  const inRoom = fm.roomAt(P(len / 2, j1 + 0.3)) || fm.roomAt(P(len / 2, j0 - 0.3));
  for (let k = 0; k < seg; k++) {
    const s0 = (len * k) / seg, s1 = (len * (k + 1)) / seg, y0 = yAt(s0), y1 = yAt(s1);
    for (const [t, sg] of [[j1, 1], [j0, -1]]) {
      const a = P(s0, t), e = P(s1, t), nd = [n[0] * sg, 0, n[1] * sg];
      const room = fm.roomBeside([(a[0] + e[0]) / 2, (a[1] + e[1]) / 2], [n[0] * sg, n[1] * sg]);
      const b = pick(room);
      if (y0 < crown - 1e-4 || y1 < crown - 1e-4) {
        triN(b, [a[0], y0, a[1]], [e[0], y1, e[1]], [e[0], crown, e[1]], nd, room);
        triN(b, [a[0], y0, a[1]], [e[0], crown, e[1]], [a[0], crown, a[1]], nd, room);
      }
    }
    // Laibung (Unterseite des Bogens), zeigt zur Bogenmitte
    const sm = (s0 + s1) / 2, ym = (y0 + y1) / 2;
    const nd = [u[0] * (r - sm), spring - ym, u[1] * (r - sm)];
    const A = P(s0, j0), B = P(s1, j0), C = P(s1, j1), D = P(s0, j1);
    const b = pick(inRoom);
    triN(b, [A[0], y0, A[1]], [B[0], y1, B[1]], [C[0], y1, C[1]], nd, inRoom);
    triN(b, [A[0], y0, A[1]], [C[0], y1, C[1]], [D[0], y0, D[1]], nd, inRoom);
  }
}

/** Hat das Fenster innen eine Fensterbank? (Dann endet die Brüstung BOARD tiefer.) */
export const hasBoard = (win) => (win.sill ?? 0.9) > 0.3;

/** Geometrie eines Fensters (Brüstung und Sturz baut house.js). */
export function buildWindow(fm, win, B) {
  const [x0, y0, x1, y1] = win.rect;
  const horiz = x1 - x0 > y1 - y0;
  const u = horiz ? [1, 0] : [0, 1];
  const n = horiz ? [0, 1] : [1, 0];
  const len = horiz ? x1 - x0 : y1 - y0;
  const depthLo = horiz ? y0 : x0, depthHi = horiz ? y1 : x1;
  const along0 = horiz ? x0 : y0;
  const cMid = horiz ? (y0 + y1) / 2 : (x0 + x1) / 2;
  const at = (s, t) => (horiz ? [s, t] : [t, s]); // (entlang, quer) -> Plan
  // Innen = Seite mit Raum
  const centerAlong = along0 + len / 2;
  const roomSide = fm.roomAt(at(centerAlong, depthHi + 0.3)) ? 1 : -1;
  const inner = roomSide > 0 ? depthHi : depthLo;
  // Rahmenebene: etwas nach außen versetzt (typisch für Bestandsbauten)
  const frameC = cMid - roomSide * (depthHi - depthLo) * 0.15;
  const sill = win.sill ?? 0.9, top = win.top ?? 2.1;
  const h = top - sill;
  const roomIdx = win.room ? fm.rooms.get(win.room)?.idx || 0 : 0;

  // Blendrahmen: zwei Pfosten, Kopf, Fuß
  const box = (s, t, L, D, ya, yb, mat = B.pvc) => orientedBox(mat, fm, at(s, t), u, L, D, ya, yb, { roomIdx });
  // Rahmen minimal kleiner als die Öffnung, damit keine Fläche auf Laibung, Sturz oder Fensterbank liegt
  const fs = along0 + GAP, fl = len - 2 * GAP, fy0 = sill + GAP, fy1 = top - GAP;
  box(fs + FRAME / 2, frameC, FRAME, FRAME_DEPTH, fy0, fy1);
  box(fs + fl - FRAME / 2, frameC, FRAME, FRAME_DEPTH, fy0, fy1);
  box(centerAlong, frameC, fl - 2 * FRAME, FRAME_DEPTH, fy1 - FRAME, fy1);
  box(centerAlong, frameC, fl - 2 * FRAME, FRAME_DEPTH, fy0, fy0 + FRAME);

  // Flügel: Anzahl aus den Daten oder aus der Breite (~ 50 cm je Flügel)
  const sashes = win.sashes ?? Math.max(1, Math.min(4, Math.round(len / 0.52)));
  const inner0 = fs + FRAME, innerLen = fl - 2 * FRAME;
  const sw = innerLen / sashes;
  const iy0 = fy0 + FRAME, iy1 = fy1 - FRAME;
  // Kämpfer (Querteilung) als Anteil der Glashöhe von unten, z. B. 0.68
  const transomY = win.transom ? iy0 + (iy1 - iy0) * win.transom : null;
  for (let i = 0; i < sashes; i++) {
    const s0 = inner0 + i * sw;
    // Flügelrahmen (etwas schmaler in der Tiefe, raumseitig); Kanten 1 mm eingerückt gegen Z-Fighting
    const sc = frameC + roomSide * 0.01;
    const e = 0.001;
    box(s0 + SASH / 2 + e, sc, SASH, FRAME_DEPTH * 0.8, iy0 + e, iy1 - e);
    box(s0 + sw - SASH / 2 - e, sc, SASH, FRAME_DEPTH * 0.8, iy0 + e, iy1 - e);
    box(s0 + sw / 2, sc, sw - 2 * SASH - 4 * e, FRAME_DEPTH * 0.8, iy1 - SASH - e, iy1 - e);
    box(s0 + sw / 2, sc, sw - 2 * SASH - 4 * e, FRAME_DEPTH * 0.8, iy0 + e, iy0 + SASH + e);
    if (transomY) box(s0 + sw / 2, sc, sw - 2 * SASH - 4 * e, FRAME_DEPTH * 0.6, transomY - 0.02, transomY + 0.02);
    // Glas
    const g0 = at(s0 + SASH, frameC), g1 = at(s0 + sw - SASH, frameC);
    B.glass.quadV(g0, g1, iy0 + SASH, iy1 - SASH, roomIdx);
  }

  // Fensterbank innen (Holz): von der Rahmen-Innenseite bis 3 cm vor die Wand
  const boardFrom = frameC + roomSide * FRAME_DEPTH / 2;
  const boardTo = inner + roomSide * 0.03;
  const bd = Math.abs(boardTo - boardFrom);
  if (hasBoard(win) && bd > 0.02) {
    box(centerAlong, (boardFrom + boardTo) / 2, len + 0.06, bd, sill - BOARD, sill, B.board);
  }
}

/**
 * Geometrie einer Tür (Sturz und Rundbogen in der Wand baut house.js). leaves: 2 = zweiflügelig; Rundbogen: Zarge,
 * Rahmen und Türblatt enden am Kämpfer, darüber ein Bogenfeld (Türblatt, Glas mit Rahmen bzw. massiv).
 */
export function buildDoor(fm, d, B) {
  const [hx, hy] = d.hinge, [ex, ey] = d.end;
  const len = Math.hypot(ex - hx, ey - hy);
  const u = [(ex - hx) / len, (ey - hy) / len];
  const n = [-u[1], u[0]];
  const [j0, j1] = d.jamb;
  const wallD = j1 - j0, jc = (j0 + j1) / 2;
  const arch = doorArch(d, len);
  const top = arch ? arch.spring : Math.max(d.height || 0, DOOR_TOP);
  const P = (s, t) => [hx + u[0] * s + n[0] * t, hy + u[1] * s + n[1] * t]; // (entlang, quer)
  const exterior = d.type === 'exterior';
  const two = d.leaves === 2;

  if (!exterior) {
    // Zarge: zwei Seitenteile + Kopfstück in der Laibung, Bekleidung auf beiden Wandseiten (Rundbogen: ohne Kopf,
    // der Bogen bleibt verputzt)
    const z = (s, L, ya, yb, t = jc, D = wallD + 0.01) => orientedBox(B.door, fm, P(s, t), u, L, D, ya, yb);
    z(ZARGE / 2, ZARGE, 0, top);
    z(len - ZARGE / 2, ZARGE, 0, top);
    if (!arch) z(len / 2, len, top - ZARGE, top);
    const ctop = arch ? top : top + CASING - ZARGE;
    for (const t of [j0 - 0.008, j1 + 0.008]) {
      z(-CASING / 2 + ZARGE, CASING, 0, ctop, t, 0.016);
      z(len + CASING / 2 - ZARGE, CASING, 0, ctop, t, 0.016);
      if (!arch) z(len / 2, len + 2 * CASING - 2 * ZARGE, top - ZARGE, top + CASING - ZARGE, t, 0.016);
    }
    // Türblatt: am Scharnier gedreht (open_deg, Standard 85° = offen); zweiflügelig je ein Blatt von jeder Seite
    const open = rad(d.open_deg ?? 85);
    const full = len - 2 * ZARGE, leafW = two ? full / 2 : full;
    // Scharnier an der Aufschlagseite der Laibung
    const hingeT = d.swing > 0 ? j1 : j0;
    const leafTop = arch ? top - 0.005 : top - ZARGE - 0.005;
    for (let i = 0; i < (two ? 2 : 1); i++) {
      const ub = i ? [-u[0], -u[1]] : u;
      const hp = P(i ? len - ZARGE : ZARGE, hingeT);
      // Richtung des Türblatts: von der Laibung Richtung Aufschlag (n * swing) drehen
      const dir = [ub[0] * Math.cos(open) + n[0] * d.swing * Math.sin(open), ub[1] * Math.cos(open) + n[1] * d.swing * Math.sin(open)];
      const perp = [-dir[1], dir[0]];
      // Blattstärke liegt geschlossen in der Laibung (von der Aufschlagseite nach innen), dreht mit
      const side = i ? d.swing : -d.swing;
      const off = (p, k) => [p[0] + perp[0] * side * k, p[1] + perp[1] * side * k];
      const c = off([hp[0] + dir[0] * leafW / 2, hp[1] + dir[1] * leafW / 2], LEAF / 2);
      orientedBox(B.door, fm, c, dir, leafW, LEAF, 0.008, leafTop, { bottom: false });
      // Bogenfeld auf dem Blatt: einflügelig ein Halbkreis, zweiflügelig je ein Viertel (Mitte an der freien Kante)
      if (arch) {
        const ac = two ? off([hp[0] + dir[0] * leafW, hp[1] + dir[1] * leafW], LEAF / 2) : c;
        archBand(B.door, ac, dir, 0, two ? leafW : leafW / 2, leafTop, LEAF, { a0: two ? Math.PI / 2 : 0, room: fm.roomAt(ac) });
      }
      // Füllung (leicht erhaben) auf beiden Seiten
      for (const s of [-1, 1]) {
        const pc = [c[0] + perp[0] * s * (LEAF / 2 + 0.004), c[1] + perp[1] * s * (LEAF / 2 + 0.004)];
        orientedBox(B.door, fm, pc, dir, leafW - (two ? 0.16 : 0.24), 0.008, 0.25, arch ? top - 0.15 : top - 0.35);
      }
      // Drücker
      const hc = [c[0] + dir[0] * (leafW / 2 - 0.07), c[1] + dir[1] * (leafW / 2 - 0.07)];
      orientedBox(B.metal, fm, hc, perp, LEAF + 0.12, 0.025, 1.02, 1.05);
    }
    return;
  }

  // Außentür: verglaste Tür (Kunststoff weiß) oder massive Haustür; zweiflügelig mit Mittelpfosten bzw. Fuge
  const t = jc;
  const roomIdx = fm.rooms.get((d.rooms || []).find(Boolean))?.idx || 0;
  if (d.leaf === 'glass') {
    const f = (s, L, ya, yb) => orientedBox(B.pvc, fm, P(s, t), u, L, FRAME_DEPTH, ya, yb);
    f(FRAME / 2, FRAME, 0, top);
    f(len - FRAME / 2, FRAME, 0, top);
    f(len / 2, len, top - FRAME, top);
    f(len / 2, len, 0, 0.11); // Sockel
    if (two) f(len / 2, FRAME * 1.4, 0.11, top - FRAME);
    B.glass.quadV(P(FRAME, t), P(len - FRAME, t), 0.11, top - FRAME, roomIdx);
    if (arch) {
      // Oberlicht im Bogen: Glas mit Rahmen entlang der Rundung
      const c = P(len / 2, t);
      archBand(B.pvc, c, u, arch.r - FRAME, arch.r - GAP, top, FRAME_DEPTH, { room: roomIdx });
      archBand(B.glass, c, u, 0, arch.r - FRAME, top, 0.002, { room: roomIdx });
    }
  } else {
    orientedBox(B.doorDark, fm, P(len / 2, t), u, len, 0.06, 0, top);
    if (arch) archBand(B.doorDark, P(len / 2, t), u, 0, arch.r - GAP, top, 0.06, { room: roomIdx });
    // Fuge zwischen den Flügeln (beidseitig knapp vor dem Blatt)
    if (two) orientedBox(B.metal, fm, P(len / 2, t), u, 0.012, 0.066, 0.02, top + (arch ? arch.r - 0.02 : -0.02));
  }
}
