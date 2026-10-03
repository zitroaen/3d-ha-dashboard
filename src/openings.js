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

/** Geometrie einer Tür (Sturz baut house.js). */
export function buildDoor(fm, d, B) {
  const [hx, hy] = d.hinge, [ex, ey] = d.end;
  const len = Math.hypot(ex - hx, ey - hy);
  const u = [(ex - hx) / len, (ey - hy) / len];
  const n = [-u[1], u[0]];
  const [j0, j1] = d.jamb;
  const wallD = j1 - j0, jc = (j0 + j1) / 2;
  const top = Math.max(d.height || 0, 2.05);
  const P = (s, t) => [hx + u[0] * s + n[0] * t, hy + u[1] * s + n[1] * t]; // (entlang, quer)
  const exterior = d.type === 'exterior';

  if (!exterior) {
    // Zarge: zwei Seitenteile + Kopfstück in der Laibung, Bekleidung auf beiden Wandseiten
    const z = (s, L, ya, yb, t = jc, D = wallD + 0.01) => orientedBox(B.door, fm, P(s, t), u, L, D, ya, yb);
    z(ZARGE / 2, ZARGE, 0, top);
    z(len - ZARGE / 2, ZARGE, 0, top);
    z(len / 2, len, top - ZARGE, top);
    for (const t of [j0 - 0.008, j1 + 0.008]) {
      z(-CASING / 2 + ZARGE, CASING, 0, top + CASING - ZARGE, t, 0.016);
      z(len + CASING / 2 - ZARGE, CASING, 0, top + CASING - ZARGE, t, 0.016);
      z(len / 2, len + 2 * CASING - 2 * ZARGE, top - ZARGE, top + CASING - ZARGE, t, 0.016);
    }
    // Türblatt: am Scharnier gedreht (open_deg, Standard 85° = offen)
    const open = rad(d.open_deg ?? 85);
    const leafW = len - 2 * ZARGE;
    // Scharnier an der Aufschlagseite der Laibung
    const hingeT = d.swing > 0 ? j1 : j0;
    const hp = P(ZARGE, hingeT);
    // Richtung des Türblatts: von u Richtung Aufschlag (n * swing) drehen
    const dir = [u[0] * Math.cos(open) + n[0] * d.swing * Math.sin(open), u[1] * Math.cos(open) + n[1] * d.swing * Math.sin(open)];
    const perp = [-dir[1], dir[0]];
    // Blattstärke liegt geschlossen in der Laibung (von der Aufschlagseite nach innen), dreht mit
    const side = -d.swing;
    const c = [hp[0] + dir[0] * leafW / 2 + perp[0] * side * LEAF / 2, hp[1] + dir[1] * leafW / 2 + perp[1] * side * LEAF / 2];
    orientedBox(B.door, fm, c, dir, leafW, LEAF, 0.008, top - ZARGE - 0.005, { bottom: false });
    // Füllung (leicht erhaben) auf beiden Seiten
    for (const s of [-1, 1]) {
      const pc = [c[0] + perp[0] * s * (LEAF / 2 + 0.004), c[1] + perp[1] * s * (LEAF / 2 + 0.004)];
      orientedBox(B.door, fm, pc, dir, leafW - 0.24, 0.008, 0.25, top - 0.35);
    }
    // Drücker
    const hc = [c[0] + dir[0] * (leafW / 2 - 0.07), c[1] + dir[1] * (leafW / 2 - 0.07)];
    orientedBox(B.metal, fm, hc, perp, LEAF + 0.12, 0.025, 1.02, 1.05);
    return;
  }

  // Außentür: verglaste Tür (Kunststoff weiß) oder massive Haustür
  const t = jc;
  if (d.leaf === 'glass') {
    const f = (s, L, ya, yb) => orientedBox(B.pvc, fm, P(s, t), u, L, FRAME_DEPTH, ya, yb);
    f(FRAME / 2, FRAME, 0, top);
    f(len - FRAME / 2, FRAME, 0, top);
    f(len / 2, len, top - FRAME, top);
    f(len / 2, len, 0, 0.11); // Sockel
    const roomIdx = fm.rooms.get(d.rooms.find(Boolean))?.idx || 0;
    B.glass.quadV(P(FRAME, t), P(len - FRAME, t), 0.11, top - FRAME, roomIdx);
  } else {
    orientedBox(B.doorDark, fm, P(len / 2, t), u, len, 0.06, 0, top);
  }
}
