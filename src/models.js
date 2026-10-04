// Prozedurale Geometrie der Katalog-Modelle (src/model/catalog.js): Möbel/Geräte (FURNITURE) und Leuchten (LAMPS).
// Lokales Koordinatensystem eines Modells: Ursprung = Mitte der Grundfläche auf dem Boden,
// x = Breite, z = Tiefe (+z = Vorderseite: Sitzfläche, Bildschirm, Regalöffnung, Tastatur), y = Höhe.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Material-Palette (Schlüssel -> MeshStandardMaterial-Parameter). Wird in furnishing.js mit Raumlicht versehen. */
export const PALETTE = {
  fabric_grey: { color: 0x55585e, roughness: 0.95 },
  fabric_dark: { color: 0x3e4045, roughness: 0.95 },
  fabric_chair: { color: 0x6f7073, roughness: 0.95 },
  cushion_green: { color: 0x2f5a52, roughness: 0.9 },
  cushion_light: { color: 0xc9c6bd, roughness: 0.9 },
  oak_light: { color: 0xc49a62, roughness: 0.6 },
  teak: { color: 0x8a5a33, roughness: 0.55 },
  wood_dark: { color: 0x3b2618, roughness: 0.6 },
  white: { color: 0xeeece6, roughness: 0.6 },
  plaster: { color: 0xf2efe9, roughness: 0.9 },
  black_gloss: { color: 0x26262a, roughness: 0.28, metalness: 0.05 }, // Klavierlack: etwas angehoben, sonst nur Silhouette
  black_matte: { color: 0x151516, roughness: 0.7 },
  slate: { color: 0x2c2f33, roughness: 0.7 },
  brass: { color: 0xb8913f, roughness: 0.35, metalness: 0.85 },
  steel_dark: { color: 0x222326, roughness: 0.4, metalness: 0.6 },
  rug_red: { color: 0x6a1d22, roughness: 1 },
  rug_navy: { color: 0x1f2740, roughness: 1 },
  curtain_green: { color: 0x163a33, roughness: 1 },
  curtain_grey: { color: 0x76787b, roughness: 1 },
  teal: { color: 0x3f8f86, roughness: 0.7 },
  book_brown: { color: 0x6b4428, roughness: 0.8 },
  book_mix: { color: 0x7b5a46, roughness: 0.8 },
  frame_dark: { color: 0x3a2a1c, roughness: 0.6 },
  canvas_art: { color: 0x9e8e7a, roughness: 0.9 },
  screen: { color: 0x050607, roughness: 0.2, metalness: 0.3 },
  glass_fire: { color: 0x120d0a, roughness: 0.1 },
  bin_clear: { color: 0xc7cfd3, roughness: 0.3 },
  toy_red: { color: 0xb8322a, roughness: 0.6 },
  toy_yellow: { color: 0xd8a72a, roughness: 0.6 },
  toy_blue: { color: 0x2f5fa8, roughness: 0.6 },
  // Garten
  bark: { color: 0x5a4330, roughness: 0.95 },
  birch_bark: { color: 0xe6e1d6, roughness: 0.8 },
  leaf_green: { color: 0x4f7a34, roughness: 0.9 },
  leaf_dark: { color: 0x2f5a2c, roughness: 0.9 },
  leaf_light: { color: 0x7fa046, roughness: 0.9 },
  conifer: { color: 0x24432c, roughness: 0.9 },
  flower_red: { color: 0xc8323a, roughness: 0.7 },
  flower_yellow: { color: 0xe6c23a, roughness: 0.7 },
  flower_violet: { color: 0x7d55b8, roughness: 0.7 },
  flower_white: { color: 0xeeeae0, roughness: 0.7 },
  flower_pink: { color: 0xe07aa6, roughness: 0.7 },
  leaf_silver: { color: 0x9aa79a, roughness: 0.9 },
  grass_straw: { color: 0xb8a467, roughness: 0.9 },
  grass_green: { color: 0x6f8a4a, roughness: 0.9 },
  // Gartenmöbel und -geräte
  alu_dark: { color: 0x3a3c3f, roughness: 0.45, metalness: 0.5 },
  sling_grey: { color: 0x6c6a66, roughness: 0.95 },
  table_top: { color: 0x2b2d30, roughness: 0.35 },
  pine: { color: 0xa67a4c, roughness: 0.75 },
  barrel_green: { color: 0x1f8a6a, roughness: 0.5 },
};

/** Fester Pseudozufall (gleiche Daten -> gleiches Bild) */
const jitter = (i, k) => {
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Sammelt Teile eines oder mehrerer Modelle, transformiert sie in Weltkoordinaten und fasst sie pro
 * Material zusammen. `lit` = Körper (Raumlicht, Attribut roomIdx), `glow` = leuchtende Teile (lampIdx).
 */
export class PartCollector {
  constructor() {
    this.groups = new Map(); // key -> { kind: 'lit'|'glow', geos: [] }
    this.matrix = new THREE.Matrix4();
    this.idx = 0;
  }

  /**
   * Transformation und Index für die folgenden Teile setzen. `box` sammelt die Ausdehnung des Objekts in
   * seinen lokalen Koordinaten (vor Drehung/Verschiebung) – `bounds`, für Trefferboxen und das Anlege-Werkzeug.
   */
  begin(x, z, rotDeg, idx, y = 0) {
    // rot: Grad im Uhrzeigersinn auf dem Plan (von oben gesehen) = negative Drehung um die y-Achse
    this.matrix.makeRotationY(-THREE.MathUtils.degToRad(rotDeg || 0)).setPosition(x, y, z);
    this.idx = idx;
    this.bounds = new THREE.Box3();
    return this;
  }

  add(geo, key, kind = 'lit', local = null) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (local) g.applyMatrix4(local);
    g.computeBoundingBox();
    this.bounds?.union(g.boundingBox);
    g.applyMatrix4(this.matrix);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.deleteAttribute('uv1');
    const attr = kind === 'glow' ? 'lampIdx' : 'roomIdx';
    g.setAttribute(attr, new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(this.idx), 1));
    const k = `${kind}:${key}`;
    if (!this.groups.has(k)) this.groups.set(k, { kind, key, geos: [] });
    this.groups.get(k).geos.push(g);
    return this;
  }

  // --- Grundformen in lokalen Koordinaten (Mittelpunkt x, Unterkante y, Mittelpunkt z) ---
  box(key, w, h, d, x = 0, y = 0, z = 0, { rotY = 0, kind = 'lit' } = {}) {
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y + h / 2, z);
    return this.add(new THREE.BoxGeometry(w, h, d), key, kind, m);
  }

  rbox(key, w, h, d, r, x = 0, y = 0, z = 0, { rotY = 0, rotX = 0, kind = 'lit' } = {}) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotX, rotY, 0)).setPosition(x, y + h / 2, z);
    return this.add(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), key, kind, m);
  }

  cyl(key, rTop, rBot, h, x = 0, y = 0, z = 0, { seg = 12, kind = 'lit', rot = null } = {}) {
    const m = new THREE.Matrix4();
    if (rot) m.makeRotationFromEuler(rot);
    m.setPosition(x, y + h / 2, z);
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), key, kind, m);
  }

  sphere(key, r, x = 0, y = 0, z = 0, { kind = 'lit', seg = 12 } = {}) {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2)), key, kind, new THREE.Matrix4().setPosition(x, y, z));
  }

  /** Ellipsoid mit Halbachsen rx, ry, rz um den Mittelpunkt (x, y, z) – Baumkronen, Büsche */
  blob(key, rx, ry, rz, x = 0, y = 0, z = 0, { kind = 'lit', seg = 10 } = {}) {
    const m = new THREE.Matrix4().makeScale(rx, ry, rz).setPosition(x, y, z);
    return this.add(new THREE.SphereGeometry(1, seg, Math.max(5, Math.round(seg * 0.6))), key, kind, m);
  }

  /** Zylinder zwischen zwei Punkten (für Arme, Stangen, Beine). */
  rod(key, a, b, r, { kind = 'lit', seg = 6 } = {}) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const m = new THREE.Matrix4().compose(
      va.clone().add(vb).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()),
      new THREE.Vector3(1, 1, 1)
    );
    return this.add(new THREE.CylinderGeometry(r, r, len, seg), key, kind, m);
  }

  /** Waagrecht extrudierte Kontur (x/z-Punkte), von y bis y + h. */
  slab(key, pts, h, y = 0, { kind = 'lit' } = {}) {
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 16 });
    return this.add(g, key, kind, new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, y, 0));
  }

  /** Pro Material ein Mesh. */
  build(materialFor) {
    const meshes = [];
    for (const { kind, key, geos } of this.groups.values()) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeVertexNormals();
      for (const g of geos) g.dispose();
      const mesh = new THREE.Mesh(merged, materialFor(key, kind));
      mesh.castShadow = kind === 'lit';
      mesh.receiveShadow = kind === 'lit';
      meshes.push(mesh);
    }
    return meshes;
  }
}

// ---------------------------------------------------------------------------------------------
// Möbel. Signatur: (P, item) — P ist bereits auf Position/Drehung/Raum des Möbels gesetzt.
// item.size = [Breite, Tiefe, Höhe] überschreibt die Standardmaße, soweit das Modell es nutzt.
// ---------------------------------------------------------------------------------------------

export const FURNITURE = {
  /** Allgemeiner Quader für Geräte ohne eigenes Modell (Waschmaschine, Wärmepumpe …): size, params.color. */
  box(P, it) {
    const [W, D, H] = it.size || [0.6, 0.6, 0.85];
    const c = it.color || 'white';
    P.rbox(c, W, H, D, Math.min(0.03, W / 6, D / 6), 0, 0, 0);
    P.box('black_matte', W * 0.6, 0.02, 0.005, 0, H * 0.82, D / 2 + 0.002); // Bedienblende
  },

  /** Kleiner Punkt für Sensoren, Taster und Anzeigen: Kugel mit Durchmesser size[0]. */
  marker(P, it) {
    const d = it.size?.[0] ?? 0.12;
    P.sphere(it.color || 'teal', d / 2, 0, d / 2, 0, { seg: 12 });
  },

  /** U-Sofa: Rücken entlang der Breite (hinten), links/rechts je ein Schenkel nach vorn. */
  sofa_u(P, it) {
    const [W, D, H] = it.size || [3.5, 2.4, 0.82];
    const sd = it.seat_depth ?? 1.0, left = it.left ?? D, right = it.right ?? D;
    const seatH = 0.42, baseH = 0.2, f = it.color || 'fabric_grey';
    const x0 = -W / 2, z0 = -D / 2;
    // Sockel (dunkles Kunstleder) + Polster
    const seg = (x, z, w, d) => {
      P.box('black_matte', w - 0.02, baseH, d - 0.02, x + w / 2, 0.02, z + d / 2);
      P.rbox(f, w, seatH - baseH, d, 0.06, x + w / 2, baseH, z + d / 2);
    };
    seg(x0, z0, W, sd);                                 // Rückenteil
    seg(x0, z0 + sd, sd, left - sd);                    // linker Schenkel
    seg(x0 + W - sd, z0 + sd, sd, right - sd);          // rechter Schenkel
    // Rückenlehne hinten + niedrige Seitenlehnen an den Schenkeln
    P.rbox(f, W, H - seatH, 0.22, 0.07, 0, seatH, z0 + 0.11);
    P.rbox(f, 0.2, 0.2, left - 0.22, 0.06, x0 + 0.1, seatH, z0 + 0.22 + (left - 0.22) / 2);
    P.rbox(f, 0.2, 0.2, right - 0.22, 0.06, x0 + W - 0.1, seatH, z0 + 0.22 + (right - 0.22) / 2);
    // Kopfstützen
    for (const t of [-0.32, 0, 0.32]) P.rbox(f, 0.75, 0.16, 0.18, 0.07, t * W, H - 0.06, z0 + 0.12);
    // Kissen
    P.rbox('cushion_light', 0.45, 0.4, 0.14, 0.06, x0 + 0.55, seatH, z0 + 0.32, { rotX: -0.25 });
    P.rbox('cushion_green', 0.48, 0.42, 0.15, 0.07, x0 + W - 0.62, seatH, z0 + 0.32, { rotX: -0.25 });
    P.rbox('fabric_dark', 0.5, 0.35, 0.14, 0.06, x0 + 1.25, seatH, z0 + 0.32, { rotX: -0.3 });
  },

  /** Sessel mit Holzgestell und gepolsterter, hoher Lehne (50er-Jahre). */
  armchair(P, it) {
    const [W, D] = it.size || [0.66, 0.78];
    const f = it.color || 'fabric_chair';
    const w = 'oak_light';
    // Beine (schräg) und Armlehnen
    for (const sx of [-1, 1]) {
      P.rod(w, [sx * (W / 2 - 0.05), 0, D / 2 - 0.08], [sx * (W / 2 - 0.05), 0.42, D / 2 - 0.2], 0.018);
      P.rod(w, [sx * (W / 2 - 0.05), 0, -D / 2 + 0.05], [sx * (W / 2 - 0.05), 0.45, -D / 2 + 0.22], 0.018);
      P.box(w, 0.05, 0.03, D - 0.15, sx * (W / 2 - 0.03), 0.58, 0.03);
      P.rod(w, [sx * (W / 2 - 0.03), 0.38, D / 2 - 0.12], [sx * (W / 2 - 0.03), 0.58, D / 2 - 0.12], 0.016);
    }
    P.rbox(f, W - 0.12, 0.12, D - 0.2, 0.05, 0, 0.36, 0.05);
    P.rbox(f, W - 0.14, 0.62, 0.12, 0.05, 0, 0.42, -D / 2 + 0.16, { rotX: -0.22 });
  },

  /** Truhe mit Glasplatte (Couchtisch). */
  chest_table(P, it) {
    const [W, D, H] = it.size || [0.8, 0.6, 0.48];
    P.box('wood_dark', W, H - 0.02, D, 0, 0, 0);
    P.box('frame_dark', W + 0.02, 0.03, D + 0.02, 0, H * 0.45, 0);
    P.box('glass_fire', W, 0.015, D, 0, H - 0.02, 0);
  },

  /** Perserteppich: rote Fläche, dunkelblaue Bordüre. */
  rug(P, it) {
    const [W, D] = it.size || [2, 3];
    P.box('rug_navy', W, 0.008, D, 0, 0.001, 0);
    P.box(it.color || 'rug_red', W - 0.3, 0.008, D - 0.3, 0, 0.003, 0);
    P.box('rug_navy', W * 0.3, 0.008, D * 0.25, 0, 0.005, 0);
  },

  /** Sideboard (50er-Jahre): Teak-Korpus, weiße Front und Platte, schlanke Beine. */
  sideboard(P, it) {
    const [W, D, H] = it.size || [1.2, 0.45, 0.6];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.rod('black_matte', [sx * (W / 2 - 0.06), 0, sz * (D / 2 - 0.06)], [sx * (W / 2 - 0.06), 0.16, sz * (D / 2 - 0.06)], 0.012);
    P.box('teak', W, H - 0.18, D, 0, 0.16, 0);
    P.box('white', W + 0.01, 0.02, D + 0.01, 0, H - 0.02, 0);
    P.box('white', W * 0.38, H - 0.24, 0.01, -W * 0.27, 0.19, D / 2 + 0.002);
  },

  /** Flachbildfernseher (an der Wand oder auf dem Möbel), Höhe = Unterkante über Boden (elevation). */
  tv(P, it) {
    const [W, , H] = it.size || [1.45, 0.06, 0.84];
    const y = it.elevation ?? 0.95;
    P.box('black_matte', W, H, 0.05, 0, y, 0);
    P.box('screen', W - 0.02, H - 0.02, 0.005, 0, y + 0.01, 0.027);
  },

  speaker(P, it) {
    const [W, D, H] = it.size || [0.22, 0.3, 1.0];
    P.box('black_matte', W, H, D, 0, 0, 0);
    P.cyl('steel_dark', 0.06, 0.06, 0.01, 0, H - 0.25, D / 2, { rot: new THREE.Euler(Math.PI / 2, 0, 0), seg: 14 });
    P.cyl('steel_dark', 0.08, 0.08, 0.01, 0, H - 0.6, D / 2, { rot: new THREE.Euler(Math.PI / 2, 0, 0), seg: 14 });
  },

  /** Kaminofen: weiß verputzter Block mit schwarz gerahmtem Sichtfenster. */
  stove(P, it) {
    const [W, D, H] = it.size || [0.79, 0.64, 1.65];
    P.box('plaster', W, H, D, 0, 0, 0);
    P.box('black_matte', 0.42, 0.48, 0.02, 0, 0.68, D / 2 + 0.005);
    P.box('glass_fire', 0.34, 0.4, 0.01, 0, 0.72, D / 2 + 0.017);
  },

  /** Bodenplatte vor dem Ofen (Schiefer). */
  hearth(P, it) {
    const [W, D] = it.size || [1.6, 1.1];
    P.box('slate', W, 0.012, D, 0, 0, 0);
  },

  /** Regalwand mit Türen unten, Büchern und einer Bücherreihe obenauf. */
  bookshelf(P, it) {
    const [W, D, H] = it.size || [3.3, 0.3, 2.02];
    const units = Math.max(1, Math.round(W / 0.8));
    const uw = W / units;
    P.box('white', W, 0.02, D, 0, H - 0.02, 0);
    for (let i = 0; i <= units; i++) P.box('white', 0.02, H, D, -W / 2 + i * uw, 0, 0);
    P.box('white', W, H, 0.01, 0, 0, -D / 2 + 0.005);
    for (let i = 0; i < units; i++) {
      const cx = -W / 2 + (i + 0.5) * uw;
      const doors = i % 2 === 1;
      if (doors) P.box('white', uw - 0.03, 0.78, 0.02, cx, 0.02, D / 2 - 0.01);
      for (let k = doors ? 2 : 0; k < 6; k++) {
        const y = k * 0.38;
        P.box('white', uw - 0.02, 0.018, D - 0.02, cx, y, 0);
        if (k >= 1 && k <= 4 && (i + k) % 3 !== 0) {
          // Buchreihe
          P.box(k % 2 ? 'book_brown' : 'book_mix', uw - 0.08, 0.24, D - 0.08, cx, y + 0.02, -0.02);
        }
      }
    }
    // Bücher obenauf
    P.box('book_brown', W * 0.75, 0.26, D - 0.06, -W * 0.08, H, 0);
  },

  /** Konzertflügel (Stutzflügel): Gehäuse als Kontur, Deckel offen, drei Beine, Tastatur vorn (+z). */
  grand_piano(P, it) {
    const [W, D] = it.size || [1.48, 1.6];
    const caseY = 0.62, caseH = 0.3;
    // Kontur: vorn gerade (Tastatur), links gerade, rechts geschwungen zum Schwanz
    const pts = [];
    pts.push([-W / 2, D / 2], [W / 2, D / 2], [W / 2, D / 2 - 0.35]);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const x = W / 2 - (W * 0.55) * Math.sin(t * Math.PI / 2) ** 1.4;
      const z = D / 2 - 0.35 - t * (D - 0.55);
      pts.push([x, z]);
    }
    pts.push([-W / 2 + 0.28, -D / 2], [-W / 2, -D / 2 + 0.12]);
    P.slab('black_gloss', pts, caseH, caseY);
    // Tastatur
    P.box('black_gloss', W, 0.1, 0.32, 0, caseY - 0.04, D / 2 + 0.12);
    P.box('white', W - 0.16, 0.025, 0.15, 0, caseY + 0.06, D / 2 + 0.16);
    P.box('black_gloss', W - 0.2, 0.018, 0.09, 0, caseY + 0.085, D / 2 + 0.12);
    // Beine
    for (const [x, z] of [[-W / 2 + 0.12, D / 2 - 0.05], [W / 2 - 0.12, D / 2 - 0.05], [-W / 2 + 0.3, -D / 2 + 0.25]]) {
      P.cyl('black_gloss', 0.045, 0.035, caseY, x, 0, z, { seg: 10 });
    }
    // Pedale (Lyra)
    P.box('black_gloss', 0.12, 0.5, 0.05, 0, 0.08, D / 2 - 0.2);
    P.box('brass', 0.2, 0.02, 0.08, 0, 0.06, D / 2 - 0.15);
    // Deckel: an der linken Seite (x = -W/2) angeschlagen, nach rechts aufgestellt
    const lid = pts.map(([x, z]) => [x + W / 2, z]);
    const shape = new THREE.Shape(lid.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false, curveSegments: 12 });
    const m = new THREE.Matrix4()
      .makeTranslation(-W / 2, caseY + caseH, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(0.62))
      .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    P.add(g, 'black_gloss', 'lit', m);
    P.rod('black_gloss', [W * 0.25, caseY + caseH, -0.1], [W * 0.18, caseY + caseH + 0.68, -0.1], 0.01);
    // Bank
    P.box('black_gloss', 0.75, 0.06, 0.36, 0, 0.47, D / 2 + 0.62);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box('black_gloss', 0.04, 0.47, 0.04, sx * 0.33, 0, D / 2 + 0.62 + sz * 0.14);
  },

  /** Kallax-Würfel 2×2 mit Holzplatte und Aufbewahrungsboxen. */
  storage_cube(P, it) {
    const [W, D, H] = it.size || [0.78, 0.78, 0.8];
    P.box('white', W, H - 0.03, D, 0, 0, 0);
    P.box('oak_light', W + 0.04, 0.03, D + 0.04, 0, H - 0.03, 0);
    for (const sx of [-1, 1]) for (const sy of [0, 1]) P.box('teal', W / 2 - 0.06, H / 2 - 0.08, 0.02, sx * W / 4, 0.04 + sy * (H / 2 - 0.02), D / 2 + 0.005);
  },

  /** Spielzeugregal (Trofast-Art): weißes Gestell, Massivholzplatte, vorn Spalten mit schrägen Boxen –
   *  unten türkis, oben durchsichtig mit buntem Spielzeug. */
  toy_storage(P, it) {
    const [W, D, H] = it.size || [1.0, 0.9, 0.75];
    const cols = it.columns ?? 3, t = 0.018, top = 0.035;
    const body = H - top;
    // Seiten, Rückwand, Boden, Zwischenwände
    for (const sx of [-1, 1]) P.box('white', t, body, D, sx * (W / 2 - t / 2), 0, 0);
    P.box('white', W, body, t, 0, 0, -D / 2 + t / 2);
    P.box('white', W, 0.05, D, 0, 0, 0);
    const cw = (W - 2 * t) / cols;
    for (let i = 1; i < cols; i++) P.box('white', t, body, D - t, -W / 2 + t + i * cw, 0, 0.005);
    // Massivholzplatte mit Überstand
    P.box('oak_light', W + 0.04, top, D + 0.04, 0, body, 0);
    // Boxen: zwei Reihen, leicht nach vorn geneigt
    const rows = [
      { y: 0.06, h: body * 0.5, mat: 'teal' },
      { y: 0.06 + body * 0.52, h: body * 0.38, mat: 'bin_clear' },
    ];
    const toys = ['toy_red', 'toy_yellow', 'toy_blue'];
    for (let i = 0; i < cols; i++) {
      const cx = -W / 2 + t + (i + 0.5) * cw;
      for (const [r, row] of rows.entries()) {
        P.rbox(row.mat, cw - 0.03, row.h - 0.02, D - 0.06, 0.02, cx, row.y, 0.02, { rotX: -0.05 });
        if (r === 1) P.rbox(toys[(i + r) % 3], cw * 0.5, 0.08, 0.18, 0.03, cx, row.y + row.h - 0.06, D / 2 - 0.2);
      }
    }
  },

  /** Holzstuhl (Biedermeier) – optional mit angelehnter Gitarre. */
  chair(P, it) {
    const w = 'oak_light';
    for (const sx of [-1, 1]) {
      P.rod(w, [sx * 0.2, 0, 0.2], [sx * 0.2, 0.45, 0.2], 0.018);
      P.rod(w, [sx * 0.19, 0, -0.2], [sx * 0.19, 0.9, -0.23], 0.018);
    }
    P.rbox('cushion_light', 0.46, 0.06, 0.44, 0.02, 0, 0.42, 0);
    P.box(w, 0.4, 0.1, 0.03, 0, 0.75, -0.22);
    if (it.guitar) {
      P.rbox('teak', 0.36, 0.42, 0.1, 0.12, 0.5, 0.0, -0.12, { rotX: -0.25 });
      P.rbox('teak', 0.28, 0.3, 0.1, 0.1, 0.5, 0.38, -0.2, { rotX: -0.25 });
      P.box('wood_dark', 0.05, 0.5, 0.03, 0.5, 0.62, -0.3, {});
    }
  },

  /** Bild/Gemälde an der Wand; elevation = Unterkante. */
  picture(P, it) {
    const [W, , H] = it.size || [0.6, 0.03, 0.45];
    const y = it.elevation ?? 1.3;
    P.box(it.frame || 'frame_dark', W, H, 0.03, 0, y, 0);
    // texture: Bilddatei relativ zum Datenordner (z. B. textures/gemaelde.jpg), sonst einfarbig
    const canvas = it.texture ? `tex:${it.texture}` : it.color || 'canvas_art';
    const m = it.mat ?? 0.04; // Rahmenbreite
    P.box(canvas, W - 2 * m, H - 2 * m, 0.005, 0, y + m, 0.016);
  },

  /** Vorhang in Falten; size = [Breite, Tiefe, Höhe], elevation = Unterkante. */
  curtain(P, it) {
    const [W, , H] = it.size || [0.4, 0.1, 2.4];
    const y = it.elevation ?? 0.05;
    const folds = Math.max(2, Math.round(W / 0.1));
    for (let i = 0; i < folds; i++) {
      const x = -W / 2 + (i + 0.5) * (W / folds);
      P.cyl(it.color || 'curtain_green', 0.05, 0.05, H, x, y, (i % 2) * 0.03, { seg: 8 });
    }
  },

  /**
   * Baum: size = [Kronendurchmesser, –, Höhe]; params.shape round (Laubbaum, Standard), conifer (Nadelbaum),
   * column (Säulenbaum, schmal und hoch) oder birch (Birke: weißer Stamm, lockere Krone); params.color = Laubfarbe.
   */
  tree(P, it) {
    const [Dm, , H] = [it.size?.[0] ?? 3, 0, it.size?.[2] ?? it.size?.[1] ?? 5];
    const r = Dm / 2;
    if (it.shape === 'conifer') {
      P.cyl('bark', 0.08, 0.12, H * 0.25, 0, 0, 0, { seg: 8 });
      const c = it.color || 'conifer';
      for (let i = 0; i < 3; i++) {
        const y0 = H * (0.15 + i * 0.25), h = H * (0.45 - i * 0.07), rr = r * (1 - i * 0.28);
        P.cyl(c, 0, rr, h, 0, y0, 0, { seg: 10 });
      }
      return;
    }
    if (it.shape === 'column') {
      P.cyl('bark', 0.07, 0.11, H * 0.2, 0, 0, 0, { seg: 8 });
      P.blob(it.color || 'leaf_dark', r * 0.5, H * 0.42, r * 0.5, 0, H * 0.55, 0);
      P.blob(it.color || 'leaf_green', r * 0.38, H * 0.3, r * 0.38, r * 0.12, H * 0.62, 0);
      return;
    }
    if (it.shape === 'birch') {
      // schlanker weißer Stamm mit dunklen Ringen, mehrere kleine, lockere Kronenteile
      P.cyl('birch_bark', 0.06, 0.1, H * 0.75, 0, 0, 0, { seg: 8 });
      for (let i = 0; i < 4; i++) P.cyl('black_matte', 0.101 - i * 0.008, 0.101 - i * 0.008, 0.03, 0, H * (0.12 + i * 0.15), 0, { seg: 8 });
      const c = it.color || 'leaf_light';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        P.blob(i % 2 ? 'leaf_green' : c, r * 0.42, r * 0.5, r * 0.42, Math.cos(a) * r * 0.42, H * 0.62 + (i % 3) * r * 0.25, Math.sin(a) * r * 0.42);
      }
      P.blob(c, r * 0.4, r * 0.55, r * 0.4, 0, H * 0.82, 0);
      return;
    }
    const c = it.color || 'leaf_green';
    const trunk = Math.max(0.6, H - Dm * 0.9);
    if (it.stakes) {
      // Dreibock aus Pfählen mit Querlatten (junger Baum)
      const ps = [0, 2.094, 4.189].map((a) => [Math.cos(a) * 0.32, Math.sin(a) * 0.32]);
      for (const [x, z] of ps) P.cyl('oak_light', 0.035, 0.035, 1.9, x, 0, z, { seg: 6 });
      for (let i = 0; i < 3; i++) {
        const [a, b] = [ps[i], ps[(i + 1) % 3]];
        P.rod('oak_light', [a[0], 1.75, a[1]], [b[0], 1.75, b[1]], 0.025, { seg: 4 });
      }
    }
    P.cyl('bark', 0.1, 0.16, trunk + r * 0.3, 0, 0, 0, { seg: 8 });
    const cy = H - r * 0.95;
    P.blob(c, r * 0.85, r * 0.8, r * 0.85, 0, cy, 0);
    // drei Nebenkronen, damit die Krone nicht wie eine Kugel aussieht
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.6;
      P.blob(i === 1 ? 'leaf_dark' : c, r * 0.55, r * 0.5, r * 0.55, Math.cos(a) * r * 0.45, cy - r * 0.15 + i * r * 0.12, Math.sin(a) * r * 0.45);
    }
  },

  /** Strauch/Busch: size = [Breite, Tiefe, Höhe], params.color = Laubfarbe */
  shrub(P, it) {
    const [W, D, H] = it.size || [1.2, 1.0, 1.0];
    const c = it.color || 'leaf_dark';
    P.blob(c, W * 0.45, H * 0.55, D * 0.45, 0, H * 0.45, 0);
    P.blob('leaf_green', W * 0.3, H * 0.4, D * 0.3, W * 0.18, H * 0.4, -D * 0.1);
  },

  /**
   * Blumen auf einer Fläche (Blumenbeet): size = [Breite, Tiefe, Höhe]; params.color = eine Blütenfarbe
   * (flower_red …), ohne Angabe gemischt.
   */
  flowers(P, it) {
    const [W, D, H] = it.size || [1.5, 0.8, 0.35];
    P.blob('leaf_green', W / 2, H * 0.35, D / 2, 0, 0, 0, { seg: 12 });
    const mix = ['flower_red', 'flower_yellow', 'flower_violet', 'flower_white', 'flower_pink'];
    const step = 0.2;
    const nx = Math.max(1, Math.round(W / step)), nz = Math.max(1, Math.round(D / step));
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const x = -W / 2 + (i + 0.2 + jitter(i, k) * 0.6) * (W / nx);
        const z = -D / 2 + (k + 0.2 + jitter(k + 7, i) * 0.6) * (D / nz);
        // innen höher als am Rand (Hügelform des Laubs)
        const e = 1 - Math.max(Math.abs(x) / (W / 2), Math.abs(z) / (D / 2)) ** 2;
        const c = it.color || mix[Math.floor(jitter(i * 3 + 1, k * 5 + 2) * mix.length)];
        P.sphere(c, 0.045, x, H * (0.45 + 0.5 * e), z, { seg: 8 });
      }
    }
  },

  /**
   * Ziergras (Horst): size = [Durchmesser, –, Höhe]; params.color = Halmfarbe (grass_straw, grass_green …).
   * Halme als schmale Prismen, außen flacher – wenige Dreiecke.
   */
  grass(P, it) {
    const [Dm, , H] = [it.size?.[0] ?? 0.6, 0, it.size?.[2] ?? 0.7];
    const c = it.color || 'grass_straw';
    P.blob('grass_green', Dm * 0.3, H * 0.18, Dm * 0.3, 0, H * 0.08, 0, { seg: 8 });
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = i * 2.399, t = jitter(i, 3); // goldener Winkel: gleichmäßig verteilt
      const lean = 0.15 + t * 0.6; // innen steil, außen flach
      const len = H * (1.05 - lean * 0.45);
      const tip = [Math.cos(a) * Dm * 0.55 * lean, len * Math.cos(lean * 0.9), Math.sin(a) * Dm * 0.55 * lean];
      P.rod(i % 3 ? c : 'grass_green', [0, 0.05, 0], tip, 0.012, { seg: 3 });
    }
  },

  /** Gartentisch: size = [Länge, Breite, Höhe]; dunkle Platte auf Aluminiumgestell */
  garden_table(P, it) {
    const [W, D, H] = it.size || [1.6, 0.9, 0.74];
    P.box(it.color || 'table_top', W, 0.03, D, 0, H - 0.03, 0);
    P.box('alu_dark', W - 0.04, 0.06, D - 0.04, 0, H - 0.09, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box('alu_dark', 0.05, H - 0.09, 0.05, sx * (W / 2 - 0.06), 0, sz * (D / 2 - 0.06));
  },

  /** Gartenstuhl (Stapelsessel mit Armlehnen und Bespannung, optional Auflage); +z = Sitzseite */
  garden_chair(P, it) {
    const f = 'alu_dark', c = it.color || 'sling_grey';
    for (const sx of [-1, 1]) {
      P.rod(f, [sx * 0.27, 0, 0.26], [sx * 0.27, 0.66, 0.24], 0.014);
      P.rod(f, [sx * 0.27, 0, -0.24], [sx * 0.27, 1.02, -0.34], 0.014);
      P.rod(f, [sx * 0.27, 0.66, 0.24], [sx * 0.27, 0.66, -0.3], 0.014); // Armlehne
    }
    P.rbox(c, 0.5, 0.05, 0.48, 0.02, 0, 0.42, 0.01, { rotX: 0.06 });
    P.rbox(c, 0.5, 0.56, 0.05, 0.02, 0, 0.46, -0.29, { rotX: -0.18 });
  },

  /** Gartenbank mit Auflage: size = [Breite, Tiefe, Höhe Lehne]; +z = Sitzseite */
  bench(P, it) {
    const [W, D, H] = it.size || [1.6, 0.62, 0.85];
    const f = 'alu_dark', c = it.color || 'sling_grey';
    for (const sx of [-1, 1]) {
      P.box(f, 0.05, 0.62, D, sx * (W / 2 - 0.03), 0, 0);
      P.box(f, 0.05, H - 0.62, 0.05, sx * (W / 2 - 0.03), 0.62, -D / 2 + 0.03);
    }
    P.box(f, W - 0.1, 0.04, D - 0.06, 0, 0.36, 0);
    P.rbox(c, W - 0.12, 0.08, D - 0.1, 0.03, 0, 0.4, 0.02);
    P.rbox(c, W - 0.12, H - 0.5, 0.08, 0.03, 0, 0.47, -D / 2 + 0.08, { rotX: -0.12 });
  },

  /** Kinder-Picknicktisch (Holz, Tisch mit zwei Bänken): size = [Länge, Tiefe, Höhe] */
  picnic_table(P, it) {
    const [W, D, H] = it.size || [0.9, 0.9, 0.5];
    const w = it.color || 'pine';
    P.box(w, W, 0.03, D * 0.5, 0, H - 0.03, 0);
    for (const sz of [-1, 1]) P.box(w, W, 0.03, D * 0.2, 0, H * 0.52, sz * D * 0.4);
    for (const sx of [-1, 1]) {
      // gekreuzte Beine (A-Form) und Querträger
      P.rod(w, [sx * (W / 2 - 0.1), 0, -D * 0.45], [sx * (W / 2 - 0.1), H - 0.03, D * 0.12], 0.018, { seg: 4 });
      P.rod(w, [sx * (W / 2 - 0.1), 0, D * 0.45], [sx * (W / 2 - 0.1), H - 0.03, -D * 0.12], 0.018, { seg: 4 });
      P.box(w, 0.04, 0.03, D * 0.95, sx * (W / 2 - 0.1), H * 0.48, 0);
    }
  },

  /** Gasgrill mit Deckel und Seitenablagen: size = [Breite, Tiefe, Höhe]; +z = Vorderseite */
  grill(P, it) {
    const [W, D, H] = it.size || [1.3, 0.55, 1.15];
    const body = W * 0.55;
    P.box('black_matte', body, H * 0.7, D, 0, 0.05, 0);
    P.rbox('black_matte', body, H * 0.25, D * 0.9, 0.08, 0, H * 0.75, -0.02);
    P.box('steel_dark', body * 0.8, 0.03, 0.03, 0, H * 0.9, D / 2 + 0.03); // Griff
    for (const sx of [-1, 1]) P.box('steel_dark', (W - body) / 2, 0.03, D * 0.8, sx * (body / 2 + (W - body) / 4), H * 0.72, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.cyl('black_matte', 0.04, 0.04, 0.05, sx * (body / 2 - 0.05), 0, sz * (D / 2 - 0.05), { seg: 8 });
  },

  /** Regentonne: size = [Durchmesser, –, Höhe]; params.color */
  barrel(P, it) {
    const [Dm, , H] = [it.size?.[0] ?? 0.6, 0, it.size?.[2] ?? 0.9];
    const c = it.color || 'barrel_green';
    P.cyl(c, Dm * 0.46, Dm * 0.44, H * 0.5, 0, 0, 0, { seg: 16 });
    P.cyl(c, Dm * 0.44, Dm * 0.5, H * 0.5, 0, H * 0.5, 0, { seg: 16 });
    P.cyl('black_matte', Dm * 0.48, Dm * 0.48, 0.03, 0, H, 0, { seg: 16 });
  },

  /** Plattenheizkörper (Rippen). Später ein Gerät, das beim Heizen glüht. */
  radiator(P, it) {
    const [W, D, H] = it.size || [1.2, 0.1, 0.55];
    const y = it.elevation ?? 0.15;
    P.box('white', W, H, D * 0.6, 0, y, 0);
    const ribs = Math.round(W / 0.05);
    for (let i = 0; i < ribs; i++) P.box('white', 0.02, H, D, -W / 2 + (i + 0.5) * (W / ribs), y, 0);
  },
};

// ---------------------------------------------------------------------------------------------
// Leuchten (Katalog-Modelle mit Fähigkeit light). Lokaler Ursprung = Boden unter der Lampe;
// h = Höhe der Lichtquelle (lamp.height). Leuchtende Teile mit kind 'glow'.
// ---------------------------------------------------------------------------------------------

export const LAMPS = {
  /** Kronleuchter mit Tulpen-Glasschirmen. */
  chandelier_tulip(P, l, { ceiling, roomIdx, lampIdx }) {
    const h = l.height, arms = l.arms ?? 8, r = 0.36;
    P.idx = roomIdx;
    P.rod('brass', [0, h + 0.1, 0], [0, ceiling, 0], 0.008);
    P.sphere('brass', 0.06, 0, h + 0.02, 0);
    P.cyl('brass', 0.02, 0.05, 0.3, 0, h - 0.15, 0, { seg: 10 });
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      P.rod('brass', [0, h - 0.08, 0], [x * 0.6, h - 0.16, z * 0.6], 0.008);
      P.rod('brass', [x * 0.6, h - 0.16, z * 0.6], [x, h, z], 0.008);
      P.idx = lampIdx;
      P.cyl('shade', 0.06, 0.035, 0.14, x, h, z, { kind: 'glow', seg: 10 });
      P.idx = roomIdx;
    }
  },

  /** Kerzenkronleuchter (Messing). */
  chandelier_candles(P, l, { ceiling, roomIdx, lampIdx }) {
    const h = l.height, arms = l.arms ?? 8, r = 0.32;
    P.idx = roomIdx;
    P.rod('steel_dark', [0, h + 0.15, 0], [0, ceiling, 0], 0.006);
    P.sphere('brass', 0.08, 0, h - 0.12, 0);
    P.cyl('brass', 0.015, 0.03, 0.3, 0, h - 0.05, 0, { seg: 8 });
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      P.rod('brass', [0, h - 0.12, 0], [x, h - 0.08, z], 0.007);
      P.cyl('brass', 0.03, 0.02, 0.04, x, h - 0.1, z, { seg: 8 });
      P.cyl('white', 0.012, 0.012, 0.09, x, h - 0.06, z, { seg: 6 });
      P.idx = lampIdx;
      P.sphere('bulb', 0.018, x, h + 0.05, z, { kind: 'glow', seg: 8 });
      P.idx = roomIdx;
    }
  },

  /** Stehleuchte mit drei Spots (schwarz). */
  floor_spots(P, l, { roomIdx, lampIdx }) {
    const h = l.height;
    P.idx = roomIdx;
    P.cyl('black_matte', 0.14, 0.15, 0.03, 0, 0, 0, { seg: 16 });
    P.rod('black_matte', [0, 0, 0], [0, h + 0.15, 0], 0.012);
    for (const [y, a] of [[h + 0.15, 0.4], [h - 0.25, 2.4], [h - 0.6, 4.2]]) {
      const x = Math.cos(a) * 0.16, z = Math.sin(a) * 0.16;
      P.rod('black_matte', [0, y, 0], [x, y + 0.05, z], 0.01);
      P.cyl('black_matte', 0.06, 0.035, 0.14, x, y, z, { seg: 10, rot: new THREE.Euler(0.5, a, 0) });
      P.idx = lampIdx;
      P.sphere('bulb', 0.035, x * 1.15, y + 0.02, z * 1.15, { kind: 'glow', seg: 8 });
      P.idx = roomIdx;
    }
  },

  /** Wandleuchte: Messingarm mit Glaskelch. Ursprung an der Wand, +z = in den Raum. */
  sconce(P, l, { roomIdx, lampIdx }) {
    const h = l.height;
    P.idx = roomIdx;
    P.box('brass', 0.07, 0.14, 0.02, 0, h - 0.12, 0.01);
    P.rod('brass', [0, h - 0.05, 0.02], [0, h - 0.05, 0.14], 0.008);
    P.idx = lampIdx;
    P.cyl('shade', 0.05, 0.03, 0.13, 0, h - 0.06, 0.14, { kind: 'glow', seg: 10 });
  },

  /** Standard ohne Modell: flache Scheibe (Decke). */
  disc(P, l, { lampIdx }) {
    P.idx = lampIdx;
    P.cyl('disc', 0.17, 0.17, 0.05, 0, l.height - 0.05, 0, { kind: 'glow', seg: 16 });
  },

  /** Standard ohne Modell an der Wand: kleine Leuchtenbox. */
  wall_box(P, l, { lampIdx }) {
    P.idx = lampIdx;
    P.box('disc', 0.14, 0.24, 0.14, 0, l.height - 0.12, 0, { kind: 'glow' });
  },

  /** Erdspießstrahler (Beet): kleiner Strahler, nach oben geneigt; h = Höhe der Linse */
  spike_spot(P, l, { roomIdx, lampIdx }) {
    const h = l.height ?? 0.15;
    P.idx = roomIdx;
    P.rod('black_matte', [0, 0, 0], [0, h - 0.04, 0], 0.01);
    P.cyl('black_matte', 0.04, 0.035, 0.1, 0, h - 0.05, -0.02, { seg: 10, rot: new THREE.Euler(-0.5, 0, 0) });
    P.idx = lampIdx;
    P.sphere('bulb', 0.032, 0, h + 0.03, 0.02, { kind: 'glow', seg: 8 });
  },

  /** Pollerleuchte (Weg, Rasen): Mast mit Schirm, Licht strahlt darunter; h = Höhe des Leuchtkörpers */
  bollard(P, l, { roomIdx, lampIdx }) {
    const h = l.height ?? 0.55;
    P.idx = roomIdx;
    P.cyl('steel_dark', 0.05, 0.05, h - 0.02, 0, 0, 0, { seg: 10 });
    P.cyl('steel_dark', 0.14, 0.12, 0.03, 0, h + 0.03, 0, { seg: 16 });
    P.idx = lampIdx;
    P.cyl('shade', 0.07, 0.07, 0.05, 0, h - 0.02, 0, { kind: 'glow', seg: 12 });
  },

  /**
   * Lichterkette (Partylichter) zwischen zwei Punkten: entlang der lokalen x-Achse, params.length (Spannweite, 8 m),
   * params.sag (Durchhang, 0,4 m), params.bulbs (Anzahl, 12), params.poles (Masten an beiden Enden, true).
   * h = Aufhängehöhe der Enden; die Lichtquelle sitzt in der Mitte.
   */
  string_lights(P, l, { roomIdx, lampIdx }) {
    const L = l.length ?? 8, sag = l.sag ?? 0.4, n = l.bulbs ?? 12, h = l.height;
    const y = (x) => h - sag * (1 - (2 * x / L) ** 2); // Parabel als Kettenlinie
    P.idx = roomIdx;
    if (l.poles !== false) for (const sx of [-1, 1]) P.cyl('wood_dark', 0.04, 0.05, h + 0.1, sx * L / 2, 0, 0, { seg: 8 });
    const seg = 12;
    for (let i = 0; i < seg; i++) {
      const x0 = -L / 2 + (i / seg) * L, x1 = -L / 2 + ((i + 1) / seg) * L;
      P.rod('black_matte', [x0, y(x0), 0], [x1, y(x1), 0], 0.006, { seg: 3 });
    }
    P.idx = lampIdx;
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + ((i + 0.5) / n) * L;
      P.sphere('bulb', 0.045, x, y(x) - 0.08, 0, { kind: 'glow', seg: 8 });
    }
  },

  /** Leuchtkugel auf dem Boden. */
  ball(P, l, { lampIdx }) {
    P.idx = lampIdx;
    P.sphere('shade', l.radius ?? 0.14, 0, l.radius ?? 0.14, 0, { kind: 'glow', seg: 16 });
  },
};

/** Fallback für unbekannte Modelle: Glühkörper an der Lampenposition. */
export function defaultLamp(P, l, { lampIdx }) {
  P.idx = lampIdx;
  P.sphere('bulb', 0.06, 0, l.height, 0, { kind: 'glow' });
}

