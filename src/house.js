// Bauwerk einer Etage (aus dem Modell übersetzt, src/model/model.js): Böden, Wände, Fensterbrüstungen/-stürze, Glas,
// Türen. Auch die Außenbereiche sind eine solche Etage (ohne Wände).
// Enthält bewusst keine Einrichtung und keine Geräte (siehe furnishing.js) – das Haus ändert sich nie.
import * as THREE from 'three';
import { Builder, pointInPoly, heightAt } from './geometry.js';
import { withRoomLight, lampMaterial, lightUniforms } from './roomlight.js';
import { parquetTexture, cubeParquetTexture, tileTexture, glowTexture, groundTexture, normalFromCanvas, noiseCanvas, speckleTexture, slabTexture, stoneTexture, roofTileTexture } from './textures.js';
import { buildWindow, buildDoor, hasBoard, BOARD } from './openings.js';
import { buildPitchedRoof, ceilingFn, ceilingProfile } from './roof.js';
import { GROUND_Y } from './ground.js';
import { clipTerrain } from './terrain.js';

const DOOR_HEIGHT = 2.05;
// Jeder Raumboden liegt minimal höher als der vorige: Raumpolygone überlappen in den Türöffnungen,
// ohne Versatz flackern die Böden dort (Z-Fighting).
const FLOOR_STEP = 0.0008;
export { GROUND_Y } from './ground.js';
// Weiche Oberflächen: ihre Kante ist Erde; Beläge (Platten, Kies, Stein …) zeigen ihren Belag auch an der Kante
const SOFT = new Set(['lawn', 'soil']);

export class FloorModel {
  /**
   * @param floor          Etage aus toScene() (house.floors[])
   * @param roomIndexBase  Raum-Indizes dieser Etage beginnen hier (global über alle Etagen)
   */
  constructor(floor, roomIndexBase, shared) {
    this.floor = floor;
    this.group = new THREE.Group();
    this.group.name = `floor-${floor.id}`;
    this.group.position.y = floor.elevation || 0;
    this.rooms = new Map(); // id -> { idx, room, hitMesh }
    this.shared = shared;

    floor.rooms.forEach((room, i) => {
      this.rooms.set(room.id, { idx: roomIndexBase + i + 1, room, order: i });
    });

    this.H = floor.ceiling;
    // Oberste Etage unter einem Steildach: Wände enden unter der Dachfläche
    this.ceilingAt = floor.roofCut ? ceilingFn(floor.roofCut, this.H) : null;
    this._build();
  }

  roomAt(p) {
    for (const r of this.rooms.values()) if (pointInPoly(p, r.room.polygon)) return r.idx;
    return 0;
  }

  /** Raum neben einer Fläche: in Richtung der Normalen nachsehen. */
  roomBeside(mid, n) {
    for (const d of [0.12, 0.3, 0.5]) {
      const idx = this.roomAt([mid[0] + n[0] * d, mid[1] + n[1] * d]);
      if (idx) return idx;
    }
    return 0;
  }

  /** Grenzt an die Kante i–j des Polygons von außen ein anderer Bereich? */
  _neighborAt(poly, i, j, self) {
    const a = poly[i], b = poly[j], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    for (const s of [1, -1]) {
      const p = [mid[0] + n[0] * s * 0.05, mid[1] + n[1] * s * 0.05];
      if (pointInPoly(p, poly)) continue;
      const idx = this.roomAt(p);
      return idx !== 0 && idx !== self;
    }
    return false;
  }

  _build() {
    const { floor, H } = this;
    const walls = new Builder();   // Wandseiten (innen + außen)
    const caps = new Builder();    // Schnittflächen oben auf den Wänden
    const floors = {}; // Bodenbelag -> Builder
    // Fenster und Türen
    const B = { glass: new Builder(), pvc: new Builder(), board: new Builder(), door: new Builder(), doorDark: new Builder(), metal: new Builder() };

    // --- Böden pro Raum (Hit-Meshes zum Antippen + gemeinsame Geometrie je Bodenbelag)
    for (const r of this.rooms.values()) {
      const y = (r.room.elevation || 0) + r.order * FLOOR_STEP;
      if (r.room.roof) {
        this._pitchedRoof(r, floors, walls, B);
        continue;
      }
      const kind = this.shared.surface(r.room.floor, r.room.color);
      const fb = (floors[kind] ??= new Builder());
      const uvStart = fb.uv.length;
      const hs = r.room.heights; // Gelände: Höhe je Eckpunkt
      const ground = this.shared.ground;
      // Bereich auf dem Höhenraster: dieselben Dreiecke wie der Boden, auf den Umriss beschnitten
      const frags = r.room.follow && ground?.terrain ? this._terrainFrags(r.room.polygon) : null;
      if (frags) fb.terrain(frags, r.idx);
      else if (hs) fb.polyT(r.room.polygon, hs, r.idx, r.order * FLOOR_STEP);
      else fb.polyH(r.room.polygon, y, r.idx);
      if (floor.outdoor && !frags) {
        // Kanten zum Boden bzw. Nachbarbereich daneben (Hügel, Hochbeet, Mauer, Stufe; mit Höhenraster auch zum
        // höheren Hang hin) – Erde wie beim Geländemodell oder `edge` (z. B. Naturstein)
        const ek = this.shared.mat[r.room.edge] ? r.room.edge : SOFT.has(kind) ? 'soil' : kind;
        this._outdoorEdges(r, (floors[ek] ??= new Builder()), y);
      }
      // floor_rot: Verlegerichtung des Bodens in Grad (z. B. 45 für diagonal verlegtes Würfelparkett)
      if (r.room.floor_rot) {
        const a = (r.room.floor_rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        for (let i = uvStart; i < fb.uv.length; i += 2) {
          const u = fb.uv[i], v = fb.uv[i + 1];
          fb.uv[i] = c * u - s * v;
          fb.uv[i + 1] = s * u + c * v;
        }
      }
      const hit = new Builder();
      if (frags) hit.terrain(frags, r.idx, 0.01);
      else if (r.room.heights) hit.polyT(r.room.polygon, r.room.heights, r.idx, 0.01);
      else hit.polyH(r.room.polygon, (r.room.elevation || 0) + 0.01, r.idx);
      const mesh = new THREE.Mesh(hit.geometry(), this.shared.hitMaterial); // Material unsichtbar, Mesh raycastbar
      mesh.userData.roomId = r.room.id;
      r.hitMesh = mesh;
      this.group.add(mesh);
    }

    // --- Prismen (Wände, Brüstungen, Stürze): Seitenflächen bekommen den Raum, in den sie zeigen
    const prism = (poly, y0, y1, capRoom = 0) => {
      const cut = this.ceilingAt && y1 >= H - 0.01;
      for (let i = 0; i < poly.length; i++) {
        let a = poly[i], b = poly[(i + 1) % poly.length];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-4) continue;
        let n = [-dz / len, dx / len];
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (pointInPoly([mid[0] + n[0] * 0.01, mid[1] + n[1] * 0.01], poly)) {
          [a, b] = [b, a];
          n = [-n[0], -n[1]];
        }
        if (cut) {
          // unter dem Steildach: Oberkante folgt der Dachfläche
          const prof = ceilingProfile(floor.roofCut, this.ceilingAt, a, b);
          for (let k = 0; k + 1 < prof.length; k++) {
            const A = prof[k], C = prof[k + 1];
            if (A.y > y0 + 1e-3 || C.y > y0 + 1e-3) walls.quadVT(A.p, C.p, y0, Math.max(A.y, y0), Math.max(C.y, y0), this.roomBeside(mid, n));
          }
        } else walls.quadV(a, b, y0, y1, this.roomBeside(mid, n));
      }
      // Oben auf Wandhöhe: dunkle Schnittfläche; darunter (Fensterbank): Wandmaterial
      if (cut) this._cutCap(caps, poly, y0);
      else if (y1 >= H - 0.01) caps.polyH(poly, y1, 0);
      else walls.polyH(poly, y1, capRoom);
    };

    for (const w of floor.walls) prism(w, 0, H);

    // --- Fenster: Brüstung und Sturz in voller Wanddicke, dazu Rahmen, Flügel, Glas, Fensterbank
    for (const win of floor.windows) {
      const [x0, y0, x1, y1] = win.rect;
      const rect = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const sill = win.sill ?? 0.9, top = win.top ?? 2.1;
      const roomIdx = win.room ? this.rooms.get(win.room)?.idx || 0 : 0;
      // Brüstung endet unter der Fensterbank (sonst liegen zwei Flächen aufeinander und flackern)
      if (sill > 0.01) prism(rect, 0, hasBoard(win) ? sill - BOARD : sill, roomIdx);
      if (top < H - 0.01) prism(rect, top, H);
      buildWindow(this, win, B);
    }

    // --- Türen: Sturz über der Öffnung (volle Laibungstiefe); Außentüren bekommen ein Türblatt
    for (const d of floor.doors) {
      const [hx, hy] = d.hinge, [ex, ey] = d.end;
      const len = Math.hypot(ex - hx, ey - hy);
      const nx = -(ey - hy) / len, ny = (ex - hx) / len;
      const [j0, j1] = d.jamb;
      const off = (p, t) => [p[0] + nx * t, p[1] + ny * t];
      const rect = [off(d.hinge, j0), off(d.end, j0), off(d.end, j1), off(d.hinge, j1)];
      const top = Math.max(d.height || 0, DOOR_HEIGHT);
      if (top < H - 0.01) prism(rect, top, H);
      buildDoor(this, d, B);
    }

    // --- Dach: Dachrand (Blende bis auf die Wände darunter) und niedrige Attika rundum
    if (floor.roof) {
      const edge = (floors.roof_edge ??= new Builder());
      const t = floor.roofThickness ?? 0.2;
      for (const r of this.rooms.values()) {
        if (r.room.roof) continue;
        const poly = r.room.polygon, y = r.room.elevation || 0, rt = r.room.thickness ?? t;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          edge.skirt(a, y - rt - 0.01, y + 0.12, b, y - rt - 0.01, y + 0.12, r.idx);
        }
      }
    }

    // --- Sockelleisten: entlang der Raumkanten, ausgespart an Türen und bodentiefen Fenstern
    if (!floor.outdoor && !floor.roof) this._baseboards(B.door);

    const S = this.shared;
    const add = (b, mat, opts = {}) => {
      if (b.empty) return null;
      const m = new THREE.Mesh(b.geometry(), mat);
      m.receiveShadow = opts.receive ?? true;
      m.castShadow = opts.cast ?? false;
      if (opts.order != null) m.renderOrder = opts.order;
      this.group.add(m);
      return m;
    };
    for (const [kind, b] of Object.entries(floors)) add(b, S.mat[kind], { cast: kind.startsWith('roof') || kind === 'soffit' || kind === 'chimney' });
    add(walls, S.mat.wall, { cast: true });
    add(caps, S.mat.cap, { cast: true });
    add(B.pvc, S.mat.pvc, { cast: true });
    add(B.board, S.mat.board, { cast: true });
    add(B.door, S.mat.door, { cast: true });
    add(B.doorDark, S.mat.doorDark, { cast: true });
    add(B.metal, S.mat.metal);
    add(B.glass, S.mat.glass, { receive: false, order: 2 });
  }

  /** Rasterdreiecke im Umriss eines Bereichs (follow: terrain) */
  _terrainFrags(poly) {
    const g = this.shared.ground, xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    return clipTerrain(g.terrain.triangles(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)), g.piecesOf(poly));
  }

  /** Höhe neben einem Außenbereich: Nachbarbereich, Gebäude (keine Kante) oder Boden */
  _outsideAt(p, self) {
    for (const o of this.rooms.values()) {
      if (o === self || !pointInPoly(p, o.room.polygon)) continue;
      const rm = o.room, g = this.shared.ground;
      if (rm.follow && g?.terrain) return { h: g.terrain.height(p), kind: 'follow' };
      return { h: rm.heights ? heightAt(rm.polygon, rm.heights, p) : rm.elevation || 0, kind: 'area' };
    }
    const g = this.shared.ground;
    if (g?.footprints?.some((f) => pointInPoly(p, f))) return { h: null, kind: 'building' };
    return { h: g ? g.at(p) : GROUND_Y, kind: 'ground' };
  }

  /**
   * Kanten eines Außenbereichs entlang seines Umrisses: nach unten bis auf das, was daneben liegt (Boden oder
   * Nachbarbereich). Mit Höhenraster auch nach oben, wo der Hang daneben höher ist (Stützmauer). Ohne Raster wie
   * bisher erst ab 10 cm über dem Boden; `extend` nur zu Nachbarbereichen.
   */
  _outdoorEdges(r, sk, y) {
    const poly = r.room.polygon, hs = r.room.heights, terrain = !!this.shared.ground?.terrain;
    const step = terrain ? this.shared.ground.terrain.cell / 2 : 2;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length, a = poly[i], b = poly[j];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-4) continue;
      let n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (pointInPoly([mid[0] + n[0] * 0.03, mid[1] + n[1] * 0.03], poly)) n = [-n[0], -n[1]];
      if (!terrain && r.room.extend && !this._neighborAt(poly, i, j, r.idx)) continue;
      const inner = (t) => (hs ? hs[i] + (hs[j] - hs[i]) * t : y);
      const P = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const out = (t) => this._outsideAt([P(t)[0] + n[0] * 0.03, P(t)[1] + n[1] * 0.03], r);
      const k = Math.max(1, Math.ceil(len / step));
      const S = [];
      for (let m = 0; m <= k; m++) {
        const t = m / k, o = out(t);
        S.push({ t, p: P(t), i: inner(t), o: o.h, kind: o.kind });
      }
      // ohne Raster: Kante nur, wenn der Bereich irgendwo deutlich über dem Boden liegt (wie bisher)
      if (!terrain && !S.some((x) => x.o != null && x.i > x.o + 0.1)) continue;
      for (let m = 0; m + 1 < S.length; m++) {
        const A = S[m], B = S[m + 1];
        if (A.o == null || B.o == null) continue; // Gebäude daneben: dessen Wand
        const up = terrain && A.kind !== 'area' && B.kind !== 'area'; // Stützmauer zum Hang
        const dA = A.i - A.o, dB = B.i - B.o;
        const emit = (p, q, lo0, hi0, lo1, hi1) => {
          if (hi0 - lo0 > 0.005 || hi1 - lo1 > 0.005) sk.skirt(p, lo0, hi0, q, lo1, hi1, r.idx);
        };
        if (dA >= 0 && dB >= 0) emit(A.p, B.p, A.o, A.i, B.o, B.i);
        else if (dA <= 0 && dB <= 0) { if (up) emit(A.p, B.p, A.i, A.o, B.i, B.o); }
        else {
          // Vorzeichenwechsel: am Schnittpunkt teilen
          const u = dA / (dA - dB), M = [A.p[0] + (B.p[0] - A.p[0]) * u, A.p[1] + (B.p[1] - A.p[1]) * u];
          const hm = A.i + (B.i - A.i) * u;
          if (dA > 0) {
            emit(A.p, M, A.o, A.i, hm, hm);
            if (up) emit(M, B.p, hm, hm, B.i, B.o);
          } else {
            if (up) emit(A.p, M, A.i, A.o, hm, hm);
            emit(M, B.p, hm, hm, B.o, B.i);
          }
        }
      }
    }
  }

  /** Steildach-Teil der Dach-Etage: Flächen, Untersicht, Blende, Giebel, Gauben, Schornsteine; Antippen auf der Fläche */
  _pitchedRoof(r, floors, walls, B) {
    const surf = new Builder();
    const kind = this.shared.surface(r.room.floor, r.room.color);
    buildPitchedRoof(r.room, r.idx, {
      surf,
      under: (floors.soffit ??= new Builder()),
      edge: (floors.roof_edge ??= new Builder()),
      chimney: (floors.chimney ??= new Builder()),
      walls,
      glass: B.glass,
      pvc: B.pvc,
    }, -(this.floor.roofThickness ?? 0.2));
    // Dachfläche in den gemeinsamen Builder des Belags übernehmen, eigene Kopie als Treffer-Fläche
    const fb = (floors[kind] ??= new Builder());
    fb.pos.push(...surf.pos);
    fb.uv.push(...surf.uv);
    fb.room.push(...surf.room);
    const mesh = new THREE.Mesh(surf.geometry(), this.shared.hitMaterial);
    mesh.userData.roomId = r.room.id;
    r.hitMesh = mesh;
    this.group.add(mesh);
  }

  /** Oberseite einer Wand unter dem Steildach: Band entlang der Wand, Höhe aus der Dachfläche */
  _cutCap(caps, poly, y0) {
    const C = this.ceilingAt, cut = this.floor.roofCut;
    if (poly.length !== 4) {
      // Sonderform: Ecken auf die Dachfläche (Näherung)
      caps.polyT(poly, poly.map((p) => Math.max(y0, C(p))), 0);
      return;
    }
    // Rechteck: an der längeren Seite entlang, gegenüberliegende Seite parallel
    const d = (i) => Math.hypot(poly[(i + 1) % 4][0] - poly[i][0], poly[(i + 1) % 4][1] - poly[i][1]);
    const s = d(0) >= d(1) ? 0 : 1;
    const a0 = poly[s], a1 = poly[(s + 1) % 4], b0 = poly[(s + 3) % 4], b1 = poly[(s + 2) % 4];
    const ts = new Set([...ceilingProfile(cut, C, a0, a1), ...ceilingProfile(cut, C, b0, b1)].map((x) => x.t));
    const L = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const list = [...ts].sort((x, y) => x - y);
    for (let i = 0; i + 1 < list.length; i++) {
      const [t0, t1] = [list[i], list[i + 1]];
      const q = [L(a0, a1, t0), L(a0, a1, t1), L(b0, b1, t1), L(b0, b1, t0)];
      const Y = q.map((p) => Math.max(y0, C(p)));
      const v = q.map((p, k) => [p[0], Y[k], p[1]]);
      caps.triUV(v[0], v[1], v[2], [0, 0], [0, 0], [0, 0], 0, true);
      caps.triUV(v[0], v[2], v[3], [0, 0], [0, 0], [0, 0], 0, true);
    }
  }

  /**
   * Sockelleisten (7 cm hoch, 1,2 cm stark) an allen Raumkanten. Eine Kante liegt an der Wandinnenseite; wo eine
   * Tür oder ein bodentiefes Fenster die Wand öffnet, wird die Leiste unterbrochen (plus Bekleidung).
   */
  _baseboards(b) {
    const H = 0.07, T = 0.012;
    // Öffnungen als Strecken im Plan: Türen (Scharnier–Ende) und Fenster mit Brüstung unter 10 cm
    const gaps = this.floor.doors.map((d) => [d.hinge, d.end]);
    for (const w of this.floor.windows) {
      if ((w.sill ?? 0.9) > 0.1) continue;
      const [x0, y0, x1, y1] = w.rect;
      gaps.push(x1 - x0 > y1 - y0 ? [[x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]] : [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]]);
    }
    for (const r of this.rooms.values()) {
      const poly = r.room.polygon;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], c = poly[(i + 1) % poly.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 0.05) continue;
        const u = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
        let n = [-u[1], u[0]];
        const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        if (!pointInPoly([mid[0] + n[0] * 0.05, mid[1] + n[1] * 0.05], poly)) n = [-n[0], -n[1]]; // nach innen
        // gesperrte Abschnitte entlang der Kante (Öffnung nah und parallel)
        const blocked = [];
        for (const [p, q] of gaps) {
          const s = (pt) => (pt[0] - a[0]) * u[0] + (pt[1] - a[1]) * u[1];
          const dist = (pt) => Math.abs((pt[0] - a[0]) * n[0] + (pt[1] - a[1]) * n[1]);
          if (dist(p) > 0.45 || dist(q) > 0.45) continue;
          blocked.push([Math.min(s(p), s(q)) - 0.07, Math.max(s(p), s(q)) + 0.07]);
        }
        blocked.sort((x, y) => x[0] - y[0]);
        let from = 0;
        const pieces = [];
        for (const [b0, b1] of blocked) {
          if (b0 > from) pieces.push([from, Math.min(b0, len)]);
          from = Math.max(from, b1);
        }
        if (from < len) pieces.push([from, len]);
        const y = (r.room.elevation || 0);
        for (const [s0, s1] of pieces) {
          if (s1 - s0 < 0.04) continue;
          const P = (s, t) => [a[0] + u[0] * s + n[0] * t, a[1] + u[1] * s + n[1] * t];
          // Vorderseite (zum Raum), Oberkante, Stirnseiten
          const A = P(s0, T), C = P(s1, T);
          b.quadV(n[0] * u[1] - n[1] * u[0] > 0 ? C : A, n[0] * u[1] - n[1] * u[0] > 0 ? A : C, y, y + H, r.idx);
          b.polyH([P(s0, 0), P(s1, 0), P(s1, T), P(s0, T)], y + H, r.idx);
          b.quadV(P(s0, 0), P(s0, T), y, y + H, r.idx);
          b.quadV(P(s1, T), P(s1, 0), y, y + H, r.idx);
        }
      }
    }
  }

  makeFloorAO(pxPerMeter = 48) {
    return makeFloorAO(this.floor.walls, pxPerMeter);
  }
}

/**
 * Weiche Abdunklung des Bodens an Wänden (Ambient Occlusion) für alle Wände der gezeigten Ebene, einmal als
 * Canvas berechnet. Bei großen Grundstücken wird die Auflösung begrenzt.
 */
export function makeFloorAO(walls, pxPerMeter = 48) {
  if (!walls.length) return null;
  const pts = walls.flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = 1;
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x0 + pad, h = Math.max(...ys) - y0 + pad;
  pxPerMeter = Math.min(pxPerMeter, 2048 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * pxPerMeter);
  c.height = Math.ceil(h * pxPerMeter);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.filter = `blur(${Math.round(pxPerMeter * 0.22)}px)`;
  g.fillStyle = '#000';
  for (const wall of walls) {
    g.beginPath();
    wall.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo']((x - x0) * pxPerMeter, (y - y0) * pxPerMeter));
    g.closePath();
    g.fill();
  }
  g.filter = 'none';
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  lightUniforms.uFloorAO.value?.dispose?.();
  lightUniforms.uFloorAO.value = tex;
  lightUniforms.uFloorAOBox.value.set(x0, y0, w, h);
  return tex;
}

/** Materialien und Texturen, einmal pro Szene. */
export function createSharedMaterials() {
  const parquet = parquetTexture();
  parquet.repeat.set(1 / parquet.userData.metersPerRepeat, 1 / parquet.userData.metersPerRepeat);
  const tiles = tileTexture();
  tiles.repeat.set(1 / tiles.userData.metersPerRepeat, 1 / tiles.userData.metersPerRepeat);
  const cubes = cubeParquetTexture();
  cubes.repeat.set(1 / cubes.userData.metersPerRepeat, 1 / cubes.userData.metersPerRepeat);
  const lit = (params, opts = {}) => withRoomLight(new THREE.MeshStandardMaterial(params), opts);
  const lawn = groundTexture();
  lawn.repeat.set(1 / lawn.userData.metersPerRepeat, 1 / lawn.userData.metersPerRepeat);
  // Pflaster: graue Platten (Fliesen-Textur in Steingrau, größeres Raster)
  const paving = tileTexture(7, [0, 0, 58]);
  paving.repeat.set(0.5 / paving.userData.metersPerRepeat, 0.5 / paving.userData.metersPerRepeat);
  // Oberflächenstruktur: Normalen aus der Helligkeit (Fugen und Maserung liegen tiefer), gleiche Wiederholung
  const relief = (tex, strength) => {
    const n = normalFromCanvas(tex.userData.source || tex.image, tex.userData.metersPerRepeat, strength);
    n.repeat.copy(tex.repeat);
    return n;
  };
  const N = (s) => new THREE.Vector2(s, s);
  // Putz: feines Rauschen, 1,5 m kachelbar
  const plaster = normalFromCanvas(noiseCanvas(256, 21, 10, 4), 1.5, 3, 256);
  plaster.repeat.set(1 / 1.5, 1 / 1.5);
  const gravel = speckleTexture([166, 157, 140], 0.6, 5, 0.45);
  gravel.repeat.set(1 / 0.6, 1 / 0.6);
  const soil = speckleTexture([74, 54, 38], 0.8, 9, 0.35);
  soil.repeat.set(1 / 0.8, 1 / 0.8);
  const roofTex = speckleTexture([78, 80, 84], 0.7, 13, 0.25);
  roofTex.repeat.set(1 / 0.7, 1 / 0.7);
  const tilesRoof = roofTileTexture();
  tilesRoof.repeat.set(1 / 1.2, 1 / 1.2);
  const slabs = slabTexture();
  slabs.repeat.set(1 / 1.2, 1 / 1.2);
  const stone = stoneTexture();
  stone.repeat.set(1 / 1.2, 1 / 1.2);

  const mat = {
    // Bodenbeläge und Oberflächen (`surface` im Modell, docs/DATA_MODEL.md)
    parquet: withRoomLight(new THREE.MeshStandardMaterial({ map: parquet, normalMap: relief(parquet, 3), normalScale: N(0.35), roughness: 0.5, metalness: 0 }), { floorAO: true }),
    tiles: withRoomLight(new THREE.MeshStandardMaterial({ map: tiles, normalMap: relief(tiles, 6), normalScale: N(0.6), roughness: 0.3, metalness: 0 }), { floorAO: true }),
    // Würfelparkett: 35-cm-Quadrate aus je 4 Eichenstäben, Richtung wechselt
    parquet_cube: lit({ map: cubes, normalMap: relief(cubes, 3), normalScale: N(0.35), roughness: 0.4, metalness: 0 }, { floorAO: true }),
    concrete: lit({ color: 0x9a968f, normalMap: plaster, normalScale: N(0.5), roughness: 0.9 }, { floorAO: true }),
    // Flächen im Freien: nass bei Regen, weiß bei Schnee (weather)
    lawn: lit({ map: lawn, normalMap: relief(lawn, 4), normalScale: N(0.6), roughness: 1 }, { weather: true }),
    paving: lit({ map: paving, normalMap: relief(paving, 6), normalScale: N(0.8), roughness: 0.85 }, { weather: true }),
    gravel: lit({ map: gravel, normalMap: relief(gravel, 8), normalScale: N(1), roughness: 1 }, { weather: true }),
    soil: lit({ map: soil, normalMap: relief(soil, 5), normalScale: N(0.8), roughness: 1 }, { weather: true }),
    // Flachdach: dunkle Dachbahn; Dachrand/Attika in hellem Metall
    roof: lit({ map: roofTex, normalMap: relief(roofTex, 4), normalScale: N(0.6), roughness: 0.95 }, { weather: true }),
    roof_edge: lit({ color: 0xa9adb1, roughness: 0.5, metalness: 0.3 }, { weather: true }),
    // Steildach: Ziegel (Farbe je Dach über `color`, Standard Ziegelrot), Untersicht des Überstands, Schornstein
    roof_tiles: lit({ map: tilesRoof, normalMap: relief(tilesRoof, 6), normalScale: N(0.9), color: 0xa4553b, roughness: 0.8 }, { weather: true }),
    soffit: lit({ color: 0xe9e4da, roughness: 0.8 }),
    chimney: lit({ color: 0x8a5a48, normalMap: plaster, normalScale: N(0.4), roughness: 0.9 }, { weather: true }),
    slabs: lit({ map: slabs, normalMap: relief(slabs, 8), normalScale: N(0.7), roughness: 0.75 }, { weather: true }),
    stone: lit({ map: stone, normalMap: relief(stone, 10), normalScale: N(1.2), roughness: 0.95 }, { weather: true }),
    wood: lit({ color: 0x8a6440, roughness: 0.7 }, { weather: true }),
    water: lit({ color: 0x2f5468, roughness: 0.15, metalness: 0.1 }),
    pvc: lit({ color: 0xf1f0eb, roughness: 0.45 }),
    board: lit({ color: 0xb48650, roughness: 0.5 }),
    doorDark: lit({ color: 0x3a2a1e, roughness: 0.7 }),
    metal: lit({ color: 0xb9b9b6, roughness: 0.3, metalness: 0.8 }),
    wall: withRoomLight(new THREE.MeshStandardMaterial({ color: 0xd8d2c8, normalMap: plaster, normalScale: N(0.18), roughness: 0.92 }), { wallAO: 0 }),
    cap: new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.9 }),
    door: lit({ color: 0xe8e0cb, roughness: 0.55 }), // cremeweiße Füllungstüren und Zargen
    glass: withRoomLight(
      new THREE.MeshStandardMaterial({
        color: 0x90a4b4, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false,
      }),
      { glow: 0.5 }
    ),
    pool: lampMaterial({ map: glowTexture(), strength: 0.12, additive: true }),
    // Lichtschein vor erleuchteten Fenstern (schwächer als eine Außenleuchte)
    windowPool: lampMaterial({ map: glowTexture(), strength: 0.06, additive: true }),
  };
  // Oberfläche mit eigener Farbe (z. B. Dachziegel anthrazit): Kopie des Materials, einmal je Farbe
  const surface = (kind, color) => {
    if (!mat[kind]) kind = 'parquet';
    if (color == null) return kind;
    const key = `${kind}:${color}`;
    if (!mat[key]) {
      const m = mat[kind].clone();
      m.color = new THREE.Color(color);
      mat[key] = withRoomLight(m, mat[kind].userData.roomLightOpts || {});
    }
    return key;
  };
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const lampHitGeometry = new THREE.SphereGeometry(0.35, 8, 6);
  return { mat, surface, hitMaterial, lampHitGeometry };
}
