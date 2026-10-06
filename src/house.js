// Bauwerk einer Etage (aus dem Modell übersetzt, src/model/model.js): Böden, Wände, Fensterbrüstungen/-stürze, Glas,
// Türen. Auch die Außenbereiche sind eine solche Etage (ohne Wände).
// Enthält bewusst keine Einrichtung und keine Geräte (siehe furnishing.js) – das Haus ändert sich nie.
import * as THREE from 'three';
import { Builder, pointInPoly, heightAt } from './geometry.js';
import { withRoomLight, lampMaterial, lightUniforms } from './roomlight.js';
import { glowTexture, normalFromCanvas, noiseCanvas } from './textures.js';
import { isSurface, surfaceDef, surfaceIds, surfaceMaterial } from './surfaces.js';
import { windowStyle, doorStyle } from './styles.js';
import { buildWindow, buildDoor, hasBoard, BOARD, DOOR_TOP, doorArch, buildArchOpening } from './openings.js';
import { buildPitchedRoof, ceilingFn, ceilingProfile, windowUnderRoof, doorUnderRoof } from './roof.js';
import { GROUND_Y } from './ground.js';
import { clipTerrain } from './terrain.js';
import { buildRailing, beam } from './railing.js';

// Jeder Raumboden liegt minimal höher als der vorige: Raumpolygone überlappen in den Türöffnungen,
// ohne Versatz flackern die Böden dort (Z-Fighting).
const FLOOR_STEP = 0.0008;
export { GROUND_Y } from './ground.js';
// Weiche Oberflächen: ihre Kante ist Erde; Beläge (Platten, Kies, Stein …) zeigen ihren Belag auch an der Kante

/** UV-Koordinaten ab Index start um deg Grad drehen (Verlegerichtung) */
function rotateUV(uv, start, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  for (let i = start; i < uv.length; i += 2) {
    const u = uv[i], v = uv[i + 1];
    uv[i] = c * u - s * v;
    uv[i + 1] = s * u + c * v;
  }
}

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
    // Bauteil in eigener Farbe (Fenster-/Türart): eigener Builder je Farbe, ohne Farbe das Standardmaterial
    B.tint = (base, color) => (color ? (floors[this.shared.surface(base, color)] ??= new Builder()) : B[base]);

    // --- Böden pro Raum (Hit-Meshes zum Antippen + gemeinsame Geometrie je Bodenbelag)
    for (const r of this.rooms.values()) {
      const y = (r.room.elevation || 0) + r.order * FLOOR_STEP;
      if (r.room.roof) {
        this._pitchedRoof(r, floors, walls, B);
        continue;
      }
      const kind = this.shared.surface(this._surfaceName(r.room.floor), r.room.color);
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
        const ek = isSurface(r.room.edge) ? this._surfaceName(r.room.edge) : this._surfaceName(surfaceDef(r.room.floor)?.edge || r.room.floor);
        this._outdoorEdges(r, (floors[ek] ??= new Builder()), y);
      }
      // Belag-Zonen: Teilflächen mit anderem Boden (z. B. Naturstein im Essbereich), 2 mm darüber
      for (const z of r.room.zones || []) {
        if (!z.polygon || z.polygon.length < 3) continue;
        const zb = (floors[this.shared.surface(this._surfaceName(z.surface || r.room.floor), z.color)] ??= new Builder());
        const start = zb.uv.length;
        zb.polyH(z.polygon, y + 0.002, r.idx);
        if (z.surface_rot) rotateUV(zb.uv, start, z.surface_rot);
      }
      // Deckenbalken
      if (r.room.beams) this._beams(r, (floors[this.shared.surface('board', r.room.beams.color || '#5b3e27')] ??= new Builder()));
      // Geländer an den Kanten (Terrasse, Balkon, Dachterrasse)
      if (r.room.railing) {
        const baseAt = frags ? (p) => ground.terrain.height(p) : hs ? (p) => heightAt(r.room.polygon, hs, p) : () => r.room.elevation || 0;
        buildRailing(r.room.polygon, r.room.railing, baseAt,
          (role, color) => (role === 'glass' ? B.glass : role === 'metal' ? B.metal : color ? (floors[this.shared.surface('pvc', color)] ??= new Builder()) : B.pvc), r.idx);
      }
      // floor_rot: Verlegerichtung des Bodens in Grad (z. B. 45 für diagonal verlegtes Würfelparkett)
      if (r.room.floor_rot) rotateUV(fb.uv, uvStart, r.room.floor_rot);
      const hit = new Builder();
      if (frags) hit.terrain(frags, r.idx, 0.01);
      else if (r.room.heights) hit.polyT(r.room.polygon, r.room.heights, r.idx, 0.01);
      else hit.polyH(r.room.polygon, (r.room.elevation || 0) + 0.01, r.idx);
      const mesh = new THREE.Mesh(hit.geometry(), this.shared.hitMaterial); // Material unsichtbar, Mesh raycastbar
      mesh.userData.roomId = r.room.id;
      r.hitMesh = mesh;
      this.group.add(mesh);
    }

    // --- Fassade (buildings[].facade): Außenseiten der Wände (kein Raum davor) im eigenen Material, unten der Sockel
    const S0 = this.shared, facade = floor.facade;
    const fac = facade ? (floors[S0.facadeKey(facade)] ??= new Builder()) : null;
    const plinth = facade?.plinth && floor.lowest ? { height: 0.4, ...facade.plinth } : null;
    const plinthB = plinth ? (floors[S0.surface(plinth.material || 'stone', plinth.color)] ??= new Builder()) : null;
    const extSegs = (this.extSegs = []); // Außenseiten (auch für die bündige Fassade der Etage darüber, scene.js)
    /** Außenseite a→b (n nach außen) von y0 bis zur Oberkante tops = [{ p, y }] (gerade oder unter der Dachschräge) */
    const exterior = (a, b, n, y0, tops) => {
      extSegs.push({ a, b, n, y0, top: Math.min(...tops.map((t) => t.y)) });
      const out = (p, d) => [p[0] + n[0] * d, p[1] + n[1] * d];
      for (let k = 0; k + 1 < tops.length; k++) {
        const A = tops[k], C = tops[k + 1];
        let from = y0;
        if (plinthB && y0 < plinth.height) {
          // Sockel 1,5 cm vor der Wand, auf der untersten Etage bis auf den Boden davor
          const g = (p) => (y0 <= 0.01 && S0.ground ? Math.min(y0, S0.ground.at(out(p, 0.05)) - (floor.elevation || 0) - 0.02) : y0);
          const ta = Math.min(plinth.height, A.y), tc = Math.min(plinth.height, C.y);
          plinthB.skirt(out(A.p, 0.015), g(A.p), ta, out(C.p, 0.015), g(C.p), tc, 0);
          from = plinth.height;
        }
        if (A.y > from + 1e-3 || C.y > from + 1e-3) fac.quadVT(A.p, C.p, from, Math.max(A.y, from), Math.max(C.y, from), 0);
      }
    };

    // --- Prismen (Wände, Brüstungen, Stürze): Seitenflächen bekommen den Raum, in den sie zeigen
    const prism = (poly, y0, y1, capRoom = 0) => {
      const cut = this.ceilingAt && y1 >= H - 0.01;
      let outside = false; // Außenwand (eine Seite ohne Raum davor)
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
        const room = this.roomBeside(mid, n);
        if (!room) outside = true;
        // unter dem Steildach: Oberkante folgt der Dachfläche
        const tops = cut ? ceilingProfile(floor.roofCut, this.ceilingAt, a, b) : [{ p: a, y: y1 }, { p: b, y: y1 }];
        if (fac && !room) exterior(a, b, n, y0, tops);
        else if (cut) {
          for (let k = 0; k + 1 < tops.length; k++) {
            const A = tops[k], C = tops[k + 1];
            if (A.y > y0 + 1e-3 || C.y > y0 + 1e-3) walls.quadVT(A.p, C.p, y0, Math.max(A.y, y0), Math.max(C.y, y0), room);
          }
        } else walls.quadV(a, b, y0, y1, room);
      }
      // Oben auf Wandhöhe: dunkle Schnittfläche; darunter (Fensterbank): Wandmaterial
      // unter dem Dach: Außenwände oben nicht dunkel (die Kappe liegt unter der Dachfläche, sichtbar nur in Lücken)
      if (cut) this._cutCap(outside ? fac || walls : caps, poly, y0);
      else if (y1 >= H - 0.01) caps.polyH(poly, y1, 0);
      else walls.polyH(poly, y1, capRoom);
    };

    for (const w of floor.walls) prism(w, 0, H);

    // --- Fenster: Brüstung und Sturz in voller Wanddicke, dazu Rahmen, Flügel, Glas, Fensterbank
    for (const w0 of floor.windows) {
      const [x0, y0, x1, y1] = w0.rect;
      const rect = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      // unter der Dachschräge (Kniestock): Fenster auf die verbleibende Wandhöhe kürzen, ohne Platz weglassen (die
      // Öffnung wird dann Wand) – sonst ragte der Rahmen über das Dach (npm run validate warnt)
      const fit = windowUnderRoof(w0, this.ceilingAt, floor.roofCut);
      if (fit.omit) {
        prism(rect, 0, H);
        continue;
      }
      const win = fit.top != null ? { ...w0, top: fit.top } : w0;
      const sill = win.sill ?? 0.9, top = win.top ?? 2.1;
      const roomIdx = win.room ? this.rooms.get(win.room)?.idx || 0 : 0;
      // Brüstung endet unter der Fensterbank (sonst liegen zwei Flächen aufeinander und flackern)
      const wst = windowStyle(win, floor.styles);
      if (sill > 0.01) prism(rect, 0, hasBoard(win, wst) ? sill - BOARD : sill, roomIdx);
      if (top < H - 0.01) prism(rect, top, H);
      buildWindow(this, win, B, wst);
    }

    // --- Türen: Sturz über der Öffnung (volle Laibungstiefe); Außentüren bekommen ein Türblatt
    for (let d of floor.doors) {
      const [hx, hy] = d.hinge, [ex, ey] = d.end;
      const len = Math.hypot(ex - hx, ey - hy);
      const nx = -(ey - hy) / len, ny = (ex - hx) / len;
      const [j0, j1] = d.jamb;
      const off = (p, t) => [p[0] + nx * t, p[1] + ny * t];
      const rect = [off(d.hinge, j0), off(d.end, j0), off(d.end, j1), off(d.hinge, j1)];
      let arch = doorArch(d, len);
      let top = arch ? Math.min(arch.crown, H) : Math.max(d.height || 0, DOOR_TOP);
      // unter einer Dachschräge: Tür nicht durchs Dach (auf die Wandhöhe begrenzt, die Prüfung warnt)
      const fitD = doorUnderRoof(d, top, this.ceilingAt);
      if (fitD.top != null) {
        top = fitD.top;
        d = { ...d, height: top, arch: false, top: undefined };
        arch = null;
      }
      if (top < H - 0.01) prism(rect, top, H);
      // Rundbogen: Zwickel zwischen Kämpfer und Scheitel, gewölbte Laibung
      if (arch) {
        const P = (s, t) => [d.hinge[0] + ((ex - hx) / len) * s + nx * t, d.hinge[1] + ((ey - hy) / len) * s + ny * t];
        buildArchOpening(this, P, [(ex - hx) / len, (ey - hy) / len], [nx, ny], len, d.jamb, { ...arch, crown: top },
          (room) => (!room && fac ? fac : walls));
      }
      buildDoor(this, d, B, doorStyle(d, floor.styles));
    }

    // --- Eckbretter der Holzfassade (z. B. weiß auf Schwedenrot) an Hausecken und Fensterlaibungen
    if (fac && facade.type === 'wood_siding' && facade.corners !== false) {
      this._cornerTrims(extSegs, facade.corners ? (floors[S0.surface('pvc', facade.corners)] ??= new Builder()) : B.pvc, plinth ? plinth.height : 0);
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
    for (const [kind, b] of Object.entries(floors)) add(b, S.mat[kind], { cast: !!floor.roof || kind.startsWith('roof') });
    add(walls, S.mat.wall, { cast: true });
    add(caps, S.mat.cap, { cast: true });
    add(B.pvc, S.mat.pvc, { cast: true });
    add(B.board, S.mat.board, { cast: true });
    add(B.door, S.mat.door, { cast: true });
    add(B.doorDark, S.mat.doorDark, { cast: true });
    add(B.metal, S.mat.metal);
    add(B.glass, S.mat.glass, { receive: false, order: 2 });
  }

  /** Oberfläche draußen (Außenbereiche, Dach): Variante mit Regen/Schnee, falls es eine gibt (flagstone_out) */
  _surfaceName(name) {
    return this.floor.outdoor || this.floor.roof ? this.shared.outName(name) : name;
  }

  /**
   * Deckenbalken (rooms[].beams): parallel zu `dir` (x, y oder Grad) im Abstand `spacing`, Querschnitt `size`
   * [Breite, Höhe], unter der Decke (unter einer Dachschräge an deren Höhe).
   */
  _beams(r, b) {
    const spec = r.room.beams, poly = r.room.polygon;
    const a = spec.dir === 'y' ? 90 : spec.dir === 'x' || spec.dir == null ? 0 : Number(spec.dir);
    const d = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)], n = [-d[1], d[0]];
    const [w, h] = spec.size || [0.12, 0.16], step = spec.spacing ?? 0.8;
    const ns = poly.map((p) => p[0] * n[0] + p[1] * n[1]);
    const ceil = r.room.ceiling ?? this.H;
    for (let s = Math.min(...ns) + step / 2; s < Math.max(...ns) - w / 2; s += step) {
      // Schnitt der Linie mit dem Umriss: kleinstes und größtes t entlang d
      const ts = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const sp = p[0] * n[0] + p[1] * n[1], sq = q[0] * n[0] + q[1] * n[1];
        if ((sp - s) * (sq - s) > 0 || sp === sq) continue;
        const u = (s - sp) / (sq - sp), x = p[0] + (q[0] - p[0]) * u, y = p[1] + (q[1] - p[1]) * u;
        ts.push(x * d[0] + y * d[1]);
      }
      if (ts.length < 2) continue;
      const t0 = Math.min(...ts), t1 = Math.max(...ts);
      const P = (t) => [n[0] * s + d[0] * t, n[1] * s + d[1] * t];
      const A = P(t0), B = P(t1);
      const top = (p) => Math.min(ceil, this.ceilingAt ? this.ceilingAt(p) : ceil);
      const ya = top(A), yb = top(B);
      beam(b, A, B, w, ya - h, ya, yb - h, yb, r.idx);
    }
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
      // edge_top: Stützmauer zum Hang mit gerader Oberkante statt der Rasterdreiecke (Sägezahn, wo das Raster die Kante
      // schräg schneidet): terrain_max = Gerade durch das Gelände an den Enden, so weit angehoben, dass sie überall auf
      // oder über dem Gelände liegt (am Hang entlang geneigt, quer dazu waagrecht); Zahl = feste Höhe
      const et = r.room.edgeTop;
      const hang = S.filter((x) => x.o != null && x.kind !== 'area');
      if (terrain && et != null && hang.length >= 2 && hang.some((x) => x.o > x.i + 0.01)) {
        const h0 = hang[0], h1 = hang.at(-1);
        const line = (t) => h0.o + ((h1.o - h0.o) * (t - h0.t)) / (h1.t - h0.t || 1);
        const lift = Math.max(0, ...hang.map((x) => x.o - line(x.t)));
        for (const x of hang) x.o = et === 'terrain_max' ? line(x.t) + lift : Number(et);
      }
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
    const facade = this.floor.facade;
    buildPitchedRoof(r.room, r.idx, {
      facade: facade ? (floors[this.shared.facadeKey(facade)] ??= new Builder()) : walls,
      surf,
      // Untersicht in Wandfarbe, Schornstein mit Blechverkleidung wie der Dachrand – keine eigenen Zeichenaufrufe
      under: walls,
      edge: (floors.roof_edge ??= new Builder()),
      chimney: (floors.roof_edge ??= new Builder()),
      walls,
      glass: B.glass,
      pvc: B.pvc,
    }, -(this.floor.roofThickness ?? 0.2),
    // andere Steildach-Teile des Gebäudes: Durchdringung (Kreuzdach, Anbau mit höherem First)
    [...this.rooms.values()].filter((o) => o !== r && o.room.roof?.pitched && o.room.roof.shape)
      .map((o) => ({ shape: o.room.roof.shape, off: o.room.elevation || 0 })));
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

  /**
   * Eckbretter: wo zwei Außenseiten an einer Ecke zusammentreffen, je ein 10 cm breites Brett auf beiden Seiten,
   * 1,2 cm vor der Fassade.
   */
  _cornerTrims(segs, b, bottom) {
    const W = 0.1, T = 0.012;
    const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-3 && Math.abs(p[1] - q[1]) < 1e-3;
    const dir = (s) => {
      const l = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) || 1;
      return [(s.b[0] - s.a[0]) / l, (s.b[1] - s.a[1]) / l];
    };
    const done = new Set();
    for (const s of segs) {
      for (const t of segs) {
        if (s === t) continue;
        for (const [ps, pt] of [[s.b, t.a], [s.a, t.b], [s.a, t.a], [s.b, t.b]]) {
          if (!same(ps, pt)) continue;
          const d1 = dir(s), d2 = dir(t);
          if (Math.abs(d1[0] * d2[0] + d1[1] * d2[1]) > 0.9) continue; // keine Ecke
          const key = `${ps[0].toFixed(3)},${ps[1].toFixed(3)}`;
          if (done.has(key)) continue;
          done.add(key);
          const y0 = Math.max(bottom, Math.max(s.y0, t.y0)), y1 = Math.min(s.top, t.top);
          if (y1 - y0 < 0.2) continue;
          for (const seg of [s, t]) {
            // Brett auf dieser Seite: von der Ecke ein Stück entlang, nach außen versetzt
            const d = dir(seg), from = same(seg.a, ps) ? 1 : -1;
            const nOut = this._outward(seg);
            const p0 = [ps[0] + nOut[0] * T, ps[1] + nOut[1] * T];
            const p1 = [p0[0] + d[0] * from * W, p0[1] + d[1] * from * W];
            b.skirt(p0, y0, y1, p1, y0, y1, 0);
          }
        }
      }
    }
  }

  /** Nach außen zeigende Normale einer Außenseite (kein Raum davor) */
  _outward(seg) {
    const l = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]) || 1;
    const n = [-(seg.b[1] - seg.a[1]) / l, (seg.b[0] - seg.a[0]) / l];
    const m = [(seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2];
    return this.floor.walls.some((w) => pointInPoly([m[0] + n[0] * 0.02, m[1] + n[1] * 0.02], w)) ? [-n[0], -n[1]] : n;
  }

  /** Oberseite einer Wand unter dem Steildach: Band entlang der Wand, Höhe aus der Dachfläche */
  _cutCap(caps, poly, y0) {
    const C = this.ceilingAt, cut = this.floor.roofCut;
    if (poly.length !== 4) {
      // Sonderform (L, T, Wandring): in Dreiecke zerlegen und jedes an der längsten Seite teilen, solange die
      // Dachfläche von der Ebene durch die Ecken abweicht (sonst spannte eine Ecke unter einer Gaube einen Keil auf)
      const Y = (p) => Math.max(y0, C(p));
      const tri = (a, b, c) => {
        const v = [a, b, c].map((p) => [p[0], Y(p), p[1]]);
        caps.triUV(v[0], v[1], v[2], [0, 0], [0, 0], [0, 0], 0, true);
      };
      const split = (a, b, c, depth) => {
        const e = [[a, b, c], [b, c, a], [c, a, b]].map(([p, q, r]) => ({ p, q, r, l: Math.hypot(q[0] - p[0], q[1] - p[1]) }));
        const { p, q, r, l } = e.reduce((m, x) => (x.l > m.l ? x : m));
        const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
        const off = Math.max(Math.abs(Y(m) - (Y(p) + Y(q)) / 2), Math.abs(Y(g) - (Y(a) + Y(b) + Y(c)) / 3));
        if (depth < 12 && l > 0.02 && off > 0.004) {
          split(p, m, r, depth + 1);
          split(m, q, r, depth + 1);
        } else tri(a, b, c);
      };
      const tris = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [i, j, k] of tris) split(poly[i], poly[j], poly[k], 0);
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

/**
 * Materialien, einmal pro Szene. Oberflächen (Beläge, Fassaden, Dächer) kommen aus den Daten (src/surfaces.js) und
 * werden beim ersten Zugriff angelegt: `mat[id]`, mit Farbe `mat['id:#rrggbb']`, im Freien `mat['id_out']`.
 */
export function createSharedMaterials() {
  const lit = (params, opts = {}) => withRoomLight(new THREE.MeshStandardMaterial(params), opts);
  const N = (s) => new THREE.Vector2(s, s);
  // Putz: feines Rauschen, 1,5 m kachelbar
  const plaster = normalFromCanvas(noiseCanvas(256, 21, 10, 4), 1.5, 3, 256);
  plaster.repeat.set(1 / 1.5, 1 / 1.5);

  // Bauteile der Engine (Rahmen, Zargen, Beschläge …); Farben je Bauteil über `surface('pvc', farbe)`
  const fixed = {
    roof_edge: lit({ color: 0xa9adb1, roughness: 0.5, metalness: 0.3 }, { weather: true }),
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
  // Schlüssel -> Material: Bauteil, Oberfläche (id, id_out, id:farbe, id_out:farbe) oder Bauteil mit Farbe (pvc:#…)
  const store = { ...fixed };
  const make = (key) => {
    const [name, color] = key.split(':');
    const outdoor = name.endsWith('_out') && !isSurface(name);
    const id = outdoor ? name.slice(0, -4) : name;
    if (isSurface(id)) {
      // im Freien nur eine eigene Variante, wenn der Belag nicht ohnehin für draußen ist
      if (outdoor && surfaceDef(id).outdoor) return (store[key] = make(color ? `${id}:${color}` : id));
      return (store[key] = surfaceMaterial(id, { color, outdoor, lit }));
    }
    if (color && fixed[id]) {
      const m = fixed[id].clone();
      m.color = new THREE.Color(color);
      return (store[key] = withRoomLight(m, fixed[id].userData.roomLightOpts || {}));
    }
    return undefined;
  };
  const mat = new Proxy(store, {
    get: (t, k) => (typeof k !== 'string' || k in t ? t[k] : make(k)),
    has: (t, k) => k in t || (typeof k === 'string' && isSurface(k.split(':')[0].replace(/_out$/, ''))),
  });
  // Oberfläche mit eigener Farbe (z. B. Dachziegel anthrazit): eigener Schlüssel je Farbe; unbekannt -> Standard
  const surface = (kind, color) => {
    if (!isSurface(kind.replace(/_out$/, '')) && !fixed[kind]) kind = isSurface('parquet') ? 'parquet' : surfaceIds()[0];
    return color == null ? kind : `${kind}:${color}`;
  };
  // Fassade -> Material-Schlüssel: plaster (Putz = Wandmaterial mit Farbe) oder eine Oberfläche (im Freien)
  const facadeKey = (f) => {
    const type = f.type || 'plaster';
    if (type === 'plaster' || !isSurface(type)) return surface('wall', f.color);
    return surface(`${type}_out`, f.color);
  };
  /** Oberfläche im Freien (Außenbereich, Dach): Variante mit Regen/Schnee */
  const outName = (name) => (isSurface(name) && !surfaceDef(name).outdoor ? `${name}_out` : name);
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const lampHitGeometry = new THREE.SphereGeometry(0.35, 8, 6);
  return { mat, surface, facadeKey, outName, hitMaterial, lampHitGeometry };
}

