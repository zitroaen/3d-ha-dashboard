// Bauwerk einer Etage (aus dem Modell übersetzt, src/model/model.js): Böden, Wände, Fensterbrüstungen/-stürze, Glas,
// Türen. Auch die Außenbereiche sind eine solche Etage (ohne Wände).
// Enthält bewusst keine Einrichtung und keine Geräte (siehe furnishing.js) – das Haus ändert sich nie.
import * as THREE from 'three';
import { Builder, pointInPoly } from './geometry.js';
import { withRoomLight, lampMaterial, lightUniforms } from './roomlight.js';
import { parquetTexture, cubeParquetTexture, tileTexture, glowTexture, groundTexture, normalFromCanvas, noiseCanvas, speckleTexture } from './textures.js';
import { buildWindow, buildDoor, hasBoard, BOARD } from './openings.js';

const DOOR_HEIGHT = 2.05;
// Jeder Raumboden liegt minimal höher als der vorige: Raumpolygone überlappen in den Türöffnungen,
// ohne Versatz flackern die Böden dort (Z-Fighting).
const FLOOR_STEP = 0.0008;
/** Höhe der Bodenfläche außerhalb aller Außenbereiche (site.ground), etwas unter den Flächen */
export const GROUND_Y = -0.12;

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
      const kind = this.shared.mat[r.room.floor] ? r.room.floor : 'parquet';
      const fb = (floors[kind] ??= new Builder());
      const uvStart = fb.uv.length;
      const hs = r.room.heights; // Gelände: Höhe je Eckpunkt
      if (hs) {
        fb.polyT(r.room.polygon, hs, r.idx, r.order * FLOOR_STEP);
        // Liegt das Gelände über dem Boden (Hügel, Böschung nach oben): Erdkante bis zum Boden wie beim
        // Geländemodell. Tiefer liegendes Gelände setzt der Boden selbst fort (scene._groundGeometry).
        const sk = (floors.soil ??= new Builder());
        const poly = r.room.polygon;
        for (let i = 0; i < poly.length; i++) {
          const j = (i + 1) % poly.length;
          if (hs[i] > GROUND_Y + 0.1 || hs[j] > GROUND_Y + 0.1) sk.skirt(poly[i], GROUND_Y, Math.max(hs[i], GROUND_Y), poly[j], GROUND_Y, Math.max(hs[j], GROUND_Y), r.idx);
        }
      } else fb.polyH(r.room.polygon, y, r.idx);
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
      if (r.room.heights) hit.polyT(r.room.polygon, r.room.heights, r.idx, 0.01);
      else hit.polyH(r.room.polygon, (r.room.elevation || 0) + 0.01, r.idx);
      const mesh = new THREE.Mesh(hit.geometry(), this.shared.hitMaterial); // Material unsichtbar, Mesh raycastbar
      mesh.userData.roomId = r.room.id;
      r.hitMesh = mesh;
      this.group.add(mesh);
    }

    // --- Prismen (Wände, Brüstungen, Stürze): Seitenflächen bekommen den Raum, in den sie zeigen
    const prism = (poly, y0, y1, capRoom = 0) => {
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
        walls.quadV(a, b, y0, y1, this.roomBeside(mid, n));
      }
      // Oben auf Wandhöhe: dunkle Schnittfläche; darunter (Fensterbank): Wandmaterial
      if (y1 >= H - 0.01) caps.polyH(poly, y1, 0);
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

    // --- Sockelleisten: entlang der Raumkanten, ausgespart an Türen und bodentiefen Fenstern
    if (!floor.outdoor) this._baseboards(B.door);

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
    for (const [kind, b] of Object.entries(floors)) add(b, S.mat[kind]);
    add(walls, S.mat.wall, { cast: true });
    add(caps, S.mat.cap, { cast: true });
    add(B.pvc, S.mat.pvc, { cast: true });
    add(B.board, S.mat.board, { cast: true });
    add(B.door, S.mat.door, { cast: true });
    add(B.doorDark, S.mat.doorDark, { cast: true });
    add(B.metal, S.mat.metal);
    add(B.glass, S.mat.glass, { receive: false, order: 2 });
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
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const lampHitGeometry = new THREE.SphereGeometry(0.35, 8, 6);
  return { mat, hitMaterial, lampHitGeometry };
}
