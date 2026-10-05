// Prozedurale Geometrie der Katalog-Modelle (src/model/catalog.js): Möbel/Geräte (FURNITURE) und Leuchten (LAMPS).
// Lokales Koordinatensystem eines Modells: Ursprung = Mitte der Grundfläche auf dem Boden,
// x = Breite, z = Tiefe (+z = Vorderseite: Sitzfläche, Bildschirm, Regalöffnung, Tastatur), y = Höhe.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { vegShape, vegPlacement, vegGeometry, vegTemplate } from './vegetation.js';

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
  // Garage, Solar
  door_grey: { color: 0x8c9095, roughness: 0.45, metalness: 0.2 },
  pv_cell: { color: 0x1b2a44, roughness: 0.18, metalness: 0.35 },
  alu: { color: 0xc4c7ca, roughness: 0.35, metalness: 0.7 },
  // Innenausstattung
  glass_cab: { color: 0xc9dde4, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false },
  // Bäume und Sträucher (src/vegetation.js): Farben stecken in der Geometrie
  veg: { color: 0xffffff, roughness: 0.9, vertexColors: true },
};

/** Farbe als Material-Schlüssel: Palette-Name oder '#rrggbb' (eigene Farbe, z. B. aus params.color) */
export const paletteParams = (key) => (PALETTE[key] ? { ...PALETTE[key] } : /^#[0-9a-f]{6}$/i.test(key) ? { color: key, roughness: 0.6 } : null);

// Geteilte Geometrie/Materialien der Energiefluss-Lichtpunkte
const PULSE = {};

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
    this._anim = null;
    return this;
  }

  /**
   * Bewegliche Teile (Animation): Alles bis endAnim() kommt in eine eigene kleine Gruppe, die sich um `pivot`
   * (lokale Koordinaten des Modells) dreht – der Rest bleibt zusammengefasst. spec: { type: 'spin', axis: 'y',
   * speed: Umdrehungen/s bei voller Stufe }. Ohne Animationen (Szene) werden die Teile wie alle anderen gebaut.
   */
  beginAnim(spec, pivot = [0, 0, 0]) {
    if (this.static) return this;
    const node = this.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(...pivot));
    this._anim = { spec, node, groups: new Map(), saved: this.matrix.clone(), id: this.objId };
    this.matrix.makeTranslation(-pivot[0], -pivot[1], -pivot[2]);
    (this.anims ??= []).push(this._anim);
    return this;
  }

  endAnim() {
    if (!this._anim) return this;
    this.matrix.copy(this._anim.saved);
    this._anim = null;
    return this;
  }

  add(geo, key, kind = 'lit', local = null) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (local) g.applyMatrix4(local);
    g.computeBoundingBox();
    this.bounds?.union(g.boundingBox); // Modellkoordinaten (vor Lage und Drehpunkt)
    g.applyMatrix4(this.matrix);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.deleteAttribute('uv1');
    const attr = kind === 'glow' ? 'lampIdx' : 'roomIdx';
    g.setAttribute(attr, new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(this.idx), 1));
    const k = `${kind}:${key}`;
    const groups = this._anim ? this._anim.groups : this.groups;
    if (!groups.has(k)) groups.set(k, { kind, key, geos: [] });
    groups.get(k).geos.push(g);
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

  /**
   * Bewegliche Teile als Gruppen: [{ node: Object3D am Drehpunkt (Welt), spec, id }]. Pro Teil und Material ein
   * Mesh – nur diese wenigen Meshes werden je Bild bewegt.
   */
  buildAnims(materialFor) {
    return (this.anims || []).map((a) => {
      const node = new THREE.Group();
      a.node.decompose(node.position, node.quaternion, node.scale);
      node.userData.baseQuaternion = node.quaternion.clone();
      for (const m of this._meshes(a.groups.values(), materialFor)) node.add(m);
      if (a.spec.type === 'flow') {
        // Lichtpunkte entlang des Pfads (Energiefluss); unsichtbar, solange nichts fließt
        PULSE.geo ??= new THREE.SphereGeometry(0.035, 8, 6);
        const mat = (PULSE[a.spec.color] ??= new THREE.MeshBasicMaterial({ color: a.spec.color ?? 0xffd34d, toneMapped: false }));
        for (let i = 0; i < a.spec.count; i++) node.add(new THREE.Mesh(PULSE.geo, mat));
        node.visible = false;
      }
      return { node, spec: a.spec, id: a.id };
    });
  }

  /** Pro Material ein Mesh. */
  build(materialFor) {
    return this._meshes(this.groups.values(), materialFor);
  }

  _meshes(groups, materialFor) {
    const meshes = [];
    for (const { kind, key, geos } of groups) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeVertexNormals();
      for (const g of geos) g.dispose();
      const mesh = new THREE.Mesh(merged, materialFor(key, kind));
      mesh.castShadow = kind === 'lit' && !mesh.material.transparent; // Glas wirft keinen Schatten
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

/** Baum oder Strauch im Einzelaufbau: Vorlage der nahen Detailstufe mit Variation und Farbe wie im Haus */
function plant(P, it) {
  const shape = vegShape(it);
  const { local, tint, crown } = vegPlacement(it, shape, (k) => {
    const p = paletteParams(k);
    return p ? new THREE.Color(p.color) : null;
  });
  if (P.plants) {
    // im Haus: als Instanz (furnishing.js), hier nur die Ausdehnung
    P.plants(shape, P.matrix.clone().multiply(local), tint, crown);
    P.bounds?.union(vegTemplate(shape, true).boundingBox.clone().applyMatrix4(local));
    return;
  }
  P.add(vegGeometry(shape, tint), 'veg', 'lit', local);
}

export const FURNITURE = {
  /** Allgemeiner Quader für Geräte ohne eigenes Modell (Waschmaschine, Wärmepumpe …): size, params.color. */
  box(P, it) {
    const [W, D, H] = it.size || [0.6, 0.6, 0.85];
    const c = it.color || 'white', y = it.elevation ?? 0; // elevation: z. B. Gerät auf einem Möbel
    P.rbox(c, W, H, D, Math.min(0.03, W / 6, D / 6), 0, y, 0);
    if (it.panel !== false) P.box('black_matte', W * 0.6, 0.02, 0.005, 0, y + H * 0.82, D / 2 + 0.002); // Bedienblende
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
   * Baum: size = [Kronendurchmesser, –, Höhe]; params.shape round (Laubbaum, Standard), fruit (Obstbaum: niedrig,
   * breit), conifer (Nadelbaum), column (Säulenbaum, schmal und hoch) oder birch (Birke: weißer Stamm, lockere
   * Krone); params.color = Laubfarbe, params.stakes = Dreibock (junger Baum). Im Haus als Instanzen gezeichnet
   * (src/vegetation.js); hier der Einzelaufbau (Editor, Vorschau) mit derselben Form.
   */
  tree(P, it) {
    plant(P, it);
    if (it.stakes) {
      // Dreibock aus Pfählen mit Querlatten (junger Baum)
      const ps = [0, 2.094, 4.189].map((a) => [Math.cos(a) * 0.32, Math.sin(a) * 0.32]);
      for (const [x, z] of ps) P.cyl('oak_light', 0.035, 0.035, 1.9, x, 0, z, { seg: 6 });
      for (let i = 0; i < 3; i++) {
        const [a, b] = [ps[i], ps[(i + 1) % 3]];
        P.rod('oak_light', [a[0], 1.75, a[1]], [b[0], 1.75, b[1]], 0.025, { seg: 4 });
      }
    }
  },

  /** Strauch/Busch: size = [Breite, Tiefe, Höhe], params.color = Laubfarbe */
  shrub(P, it) {
    plant(P, it);
  },

  /**
   * Hecke entlang einer Linie: size = [Länge, Breite, Höhe] entlang der lokalen x-Achse (rot dreht sie), oder
   * params.path = Punkte [[x, z], …] relativ zur Position (Ecken, Bögen); params.color = Laubfarbe. Am Hang folgt
   * sie dem Gelände (groundAt).
   */
  hedge(P, it, { groundAt = () => 0 } = {}) {
    const [L, W, H] = [it.size?.[0] ?? 4, it.size?.[1] ?? 0.7, it.size?.[2] ?? 1.6];
    const path = Array.isArray(it.path) && it.path.length >= 2 ? it.path : [[-L / 2, 0], [L / 2, 0]];
    const c = it.color || 'leaf_dark';
    for (let s = 0; s + 1 < path.length; s++) {
      const [ax, az] = path[s], [bx, bz] = path[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      // Quader mit Unterteilung, Oberfläche verrauscht (geschnittene, aber nicht glatte Hecke); Enden überlappen
      const n = Math.max(2, Math.round(len / 0.5));
      const g = new THREE.BoxGeometry(len + W * 0.6, H, W, n, 3, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = (jitter(Math.round((x + ax * 7) * 13), Math.round((y + az * 5) * 13) + Math.round(z * 13)) - 0.5) * 0.12;
        const foot = y < -H / 2 + 1e-6; // unten etwas schmaler (Stämme), oben verrauscht
        p.setXYZ(i, x, y > H / 2 - 1e-6 ? y + k * 1.5 : y, z * (foot ? 0.85 : 1 + k));
      }
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.atan2(bz - az, bx - ax)).setPosition((ax + bx) / 2, H / 2, (az + bz) / 2));
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + groundAt(p.getX(i), p.getZ(i)));
      P.add(g, s % 2 ? 'leaf_green' : c);
    }
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

  /**
   * Deckenventilator: hängt an der Decke des Raums; size = [Durchmesser]; params.color = Flügel (Standard Holz).
   * Animation: Flügel drehen sich, solange das Gerät an ist (Tempo aus `percentage`).
   */
  ceiling_fan(P, it, { ceiling = 2.5 } = {}) {
    const Dm = it.size?.[0] ?? 1.2, r = Dm / 2;
    const yb = ceiling - 0.42; // Flügelebene
    P.cyl('white', 0.07, 0.07, 0.03, 0, ceiling - 0.03, 0, { seg: 16 });
    P.cyl('white', 0.012, 0.012, 0.3, 0, ceiling - 0.33, 0, { seg: 8 });
    P.cyl('white', 0.11, 0.09, 0.12, 0, yb - 0.03, 0, { seg: 16 });
    P.beginAnim({ type: 'spin', axis: 'y', speed: 1.4 }, [0, yb, 0]);
    const c = it.color || 'teak';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      // Flügel leicht angestellt, Ansatz am Motor
      P.add(new THREE.BoxGeometry(r - 0.1, 0.012, 0.13), c, 'lit',
        new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(0.12)).setPosition(Math.cos(a) * (r / 2 + 0.05), yb, -Math.sin(a) * (r / 2 + 0.05)));
      P.add(new THREE.BoxGeometry(0.12, 0.02, 0.03), 'white', 'lit',
        new THREE.Matrix4().makeRotationY(a).setPosition(Math.cos(a) * 0.1, yb, -Math.sin(a) * 0.1));
    }
    P.endAnim();
  },

  /**
   * Standventilator: size = [–, –, Höhe]. Animation: Rotor dreht sich um die Blasrichtung (+z), solange er an ist.
   */
  floor_fan(P, it) {
    const H = it.size?.[2] ?? 1.15, y = H - 0.2;
    P.cyl('white', 0.16, 0.18, 0.04, 0, 0, 0, { seg: 20 });
    P.cyl('white', 0.015, 0.015, y - 0.04, 0, 0.04, 0, { seg: 8 });
    P.cyl('white', 0.06, 0.07, 0.14, 0, y, -0.1, { seg: 12, rot: new THREE.Euler(Math.PI / 2, 0, 0) });
    // Schutzgitter: zwei Ringe
    for (const z of [-0.01, 0.07]) P.add(new THREE.TorusGeometry(0.2, 0.006, 4, 32), 'steel_dark', 'lit', new THREE.Matrix4().setPosition(0, y, z));
    P.beginAnim({ type: 'spin', axis: 'z', speed: 3 }, [0, y, 0.03]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      P.add(new THREE.BoxGeometry(0.15, 0.08, 0.006), it.color || 'bin_clear', 'lit',
        new THREE.Matrix4().makeRotationZ(a).multiply(new THREE.Matrix4().makeRotationX(0.35)).setPosition(Math.cos(a) * 0.1, y + Math.sin(a) * 0.1, 0.03));
    }
    P.cyl('white', 0.03, 0.03, 0.04, 0, y, 0.03, { seg: 10, rot: new THREE.Euler(Math.PI / 2, 0, 0) });
    P.endAnim();
  },

  /**
   * Garagentor (Sektionaltor) für eine Toröffnung in der Wand: size = [Breite, Wanddicke, Höhe]; Sturz bis zur Decke.
   * Ursprung an der Innenkante der Wand (Mitte der Öffnung), +z = nach außen. Das Torblatt aus waagrechten Lamellen
   * sitzt innen hinter der Öffnung und läuft in seitlichen Schienen: senkrecht hoch, im Bogen unter die Decke und
   * waagrecht nach hinten, solange das Tor offen ist (cover: open/opening). Antrieb an der Decke.
   */
  garage_door(P, it, { ceiling = 2.4 } = {}) {
    const [W, D, H] = it.size || [3.0, 0.2, 2.1];
    const c = it.color || 'door_grey';
    const n = it.sections ?? 5, z = -0.04; // Torblatt knapp hinter der Innenkante
    const BW = W + 0.1, BH = H + 0.05, h = BH / n, T = 0.04; // Blatt überdeckt die Laibung etwas
    const R = Math.max(0.08, Math.min(0.3, ceiling - BH - 0.08)); // Bogenradius der Schienen (bis unter die Decke)
    if (ceiling - H > 0.02) P.box('plaster', W, ceiling - H, D, 0, H, D / 2); // Sturz
    // Schienen: senkrecht, Bogen, waagrecht (feststehend, zusammengefasst mit dem Rest)
    const back = BH - (Math.PI / 2) * R + 0.1; // waagrechter Teil: so lang, dass das offene Tor ganz hineinpasst
    const track = (sx) => {
      const x = sx * (BW / 2 + 0.03), pts = [[x, 0, z]];
      for (let k = 0; k <= 6; k++) {
        const a = (k / 6) * (Math.PI / 2);
        pts.push([x, BH + R * Math.sin(a), z - R * (1 - Math.cos(a))]);
      }
      pts.push([x, BH + R, z - R - back]);
      for (let i = 1; i < pts.length; i++) P.rod('alu', pts[i - 1], pts[i], 0.018, { seg: 4 });
    };
    track(-1);
    track(1);
    // Antrieb: Schiene in der Mitte unter der Decke, Motor hinten
    const yr = Math.min(ceiling - 0.04, BH + R + 0.04), zm = z - R - back;
    P.box('alu', 0.04, 0.03, back + R, 0, yr, z - (back + R) / 2);
    P.box('white', 0.3, 0.12, 0.38, 0, yr - 0.06, zm);
    // Torblatt: Lamellen mit Fuge und Sicke – ein Material (ein Zeichenaufruf). Die Szene führt jede Lamelle einzeln
    // die Schiene entlang (Animation 'sectional'); zugeordnet wird über die Höhe der Dreiecke im geschlossenen Tor.
    P.beginAnim({ type: 'sectional', sections: n, height: BH, radius: R, duration: 8 }, [0, 0, z]);
    for (let i = 0; i < n; i++) {
      const y0 = i * h;
      P.box(c, BW, h - 0.012, T, 0, y0 + 0.006, z - T / 2);
      P.box(c, BW - 0.1, 0.012, 0.01, 0, y0 + h * 0.5, z + 0.004); // Sicke außen
      P.box(c, BW - 0.1, 0.012, 0.01, 0, y0 + h * 0.5, z - T - 0.004); // Sicke innen
    }
    P.box(c, 0.25, 0.035, 0.03, 0, h * 0.5 + 0.03, z - T - 0.02); // Griff innen
    P.endAnim();
  },

  /**
   * Balkonkraftwerk: zwei (params.panels) Solarmodule flach auf niedrigen Füßen, Wechselrichter und Kabel zum
   * Dachrand (params.cable_to = [x, z] in Objektkoordinaten) und daran hinunter (params.drop Meter).
   * Animation: Energiefluss im Kabel (Lichtpunkte), solange Strom erzeugt wird – Tempo aus der Leistung
   * (params.peak Watt = volles Tempo).
   */
  solar_panels(P, it) {
    const n = it.panels ?? 2, pw = 1.134, pd = 1.722, gap = 0.02;
    const W = n * pw + (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + pw / 2 + i * (pw + gap);
      P.box('alu', pw, 0.035, pd, x, 0.06, 0);
      P.box('pv_cell', pw - 0.03, 0.006, pd - 0.03, x, 0.095, 0);
      // Zellraster: ein paar feine Linien genügen aus der Entfernung
      for (let k = 1; k < 6; k++) P.box('alu', 0.004, 0.002, pd - 0.04, x - pw / 2 + (pw * k) / 6, 0.1, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box('alu', 0.04, 0.06, 0.04, x + sx * (pw / 2 - 0.08), 0, sz * (pd / 2 - 0.1));
    }
    // Wechselrichter am Rand, Kabel zum Dachrand und hinunter
    const ix = W / 2 + 0.15;
    P.box('black_matte', 0.18, 0.05, 0.25, ix, 0.02, 0);
    const [tx, tz] = it.cable_to || [ix + 0.6, 0];
    const drop = it.drop ?? 0;
    const path = [[ix, 0.04, 0], [ix, 0.04, tz], [tx, 0.04, tz]];
    if (drop > 0) path.push([tx, 0.04 - drop, tz]);
    for (let i = 1; i < path.length; i++) P.rod('black_matte', path[i - 1], path[i], 0.012, { seg: 4 });
    P.beginAnim({ type: 'flow', path, count: Math.max(4, Math.round(path.length * 3)), speed: 0.6, color: 0xffd34d, peak: it.peak ?? 800 });
    P.endAnim();
  },

  /** Esstisch: Platte mit Zarge, Beine aus Holz (params.legs = wood) oder schwarzem Metall (metal). */
  dining_table(P, it) {
    const [W, D, H] = it.size || [1.8, 0.9, 0.75];
    const c = it.color || 'oak_light';
    P.box(c, W, 0.04, D, 0, H - 0.04, 0);
    P.box(c, W - 0.16, 0.08, D - 0.16, 0, H - 0.12, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      if (it.legs === 'metal') P.box('black_matte', 0.05, H - 0.04, 0.05, sx * (W / 2 - 0.1), 0, sz * (D / 2 - 0.08));
      else P.box(c, 0.07, H - 0.04, 0.07, sx * (W / 2 - 0.09), 0, sz * (D / 2 - 0.09));
    }
  },

  /**
   * Schrank/Vitrine: style modern (glatter weißer Korpus) oder antique (Füße, geschwungene Front unten, Aufsatz mit
   * Gesims); params.glass = Glastüren mit Geschirr dahinter; params.color.
   */
  cabinet(P, it) {
    const [W, D, H] = it.size || [1.0, 0.45, 1.9];
    const antique = it.style === 'antique', c = it.color || (antique ? 'wood_dark' : 'white');
    const shelves = (y0, y1, d, z) => {
      for (let k = 1; k < 4; k++) {
        const y = y0 + ((y1 - y0) * k) / 4;
        P.box(c, W - 0.08, 0.02, d - 0.04, 0, y, z);
        if (it.glass) for (let i = 0; i < 4; i++) P.cyl('white', 0.07, 0.06, 0.05, -W / 2 + 0.16 + i * ((W - 0.32) / 3), y + 0.02, z, { seg: 10 });
      }
    };
    if (!antique) {
      P.box(c, W, H, D, 0, 0, 0);
      if (it.glass) {
        P.box('black_matte', W - 0.06, H - 0.12, 0.005, 0, 0.08, D / 2 - 0.004); // dunkler Innenraum
        shelves(0.08, H - 0.04, D, 0.02);
        P.box('glass_cab', W - 0.06, H - 0.12, 0.006, 0, 0.08, D / 2 + 0.004);
      }
      P.box('black_matte', 0.004, H - 0.12, 0.006, 0, 0.08, D / 2 + 0.005); // Türfuge
      for (const sx of [-1, 1]) P.box('alu', 0.015, 0.18, 0.02, sx * 0.05, H * 0.5, D / 2 + 0.012);
      return;
    }
    // antik: Unterschrank mit geschwungener Front auf Füßen, Aufsatz mit Gesims
    const foot = 0.1, base = H * 0.42;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.cyl(c, 0.035, 0.05, foot, sx * (W / 2 - 0.06), 0, sz * (D / 2 - 0.06), { seg: 10 });
    const arc = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12, x = -W / 2 + W * t;
      arc.push([x, D / 2 + 0.05 * Math.sin(Math.PI * t)]); // Front leicht gebaucht
    }
    P.slab(c, [[-W / 2, -D / 2], [W / 2, -D / 2], ...arc.reverse()], base - foot, foot);
    P.slab(c, [[-W / 2 - 0.03, -D / 2], [W / 2 + 0.03, -D / 2], ...arc.map(([x, z]) => [x * 1.03, z + 0.03])], 0.03, base);
    const d2 = D * 0.75, z2 = -D / 2 + d2 / 2;
    P.box(c, W - 0.06, H - base - 0.12, d2, 0, base + 0.03, z2);
    if (it.glass) {
      P.box('black_matte', W - 0.14, H - base - 0.24, 0.005, 0, base + 0.09, z2 + d2 / 2 - 0.003);
      shelves(base + 0.09, H - 0.15, d2, z2);
      P.box('glass_cab', W - 0.14, H - base - 0.24, 0.006, 0, base + 0.09, z2 + d2 / 2 + 0.004);
    }
    P.box(c, W + 0.06, 0.06, d2 + 0.08, 0, H - 0.09, z2 + 0.02); // Gesims
    P.box(c, W + 0.1, 0.03, d2 + 0.11, 0, H - 0.03, z2 + 0.03);
    for (const sx of [-1, 1]) P.sphere('brass', 0.015, sx * 0.06, base * 0.6, D / 2 + 0.06, { seg: 8 });
  },

  /** Eckschrank: Rückwände an zwei Wänden (−x und −z), gerundete Front zur Raummitte; params.glass, params.color. */
  corner_cabinet(P, it) {
    const [W, D, H] = it.size || [0.7, 0.7, 1.9];
    const c = it.color || 'white';
    const arc = [];
    for (let k = 0; k <= 12; k++) {
      const a = (k / 12) * (Math.PI / 2);
      arc.push([-W / 2 + W * Math.cos(a), -D / 2 + D * Math.sin(a)]);
    }
    const front = arc.map(([x, z]) => [x, z]);
    P.slab(c, [[-W / 2, -D / 2], ...front], 0.08, 0);
    P.slab(c, [[-W / 2, -D / 2], ...front], 0.04, H - 0.04);
    // Rückwände
    P.box(c, W, H, 0.02, 0, 0, -D / 2 + 0.01);
    P.box(c, 0.02, H, D, -W / 2 + 0.01, 0, 0);
    for (let k = 1; k < 4; k++) {
      const y = 0.08 + ((H - 0.12) * k) / 4;
      P.slab(c, [[-W / 2, -D / 2], ...front.map(([x, z]) => [-W / 2 + (x + W / 2) * 0.96, -D / 2 + (z + D / 2) * 0.96])], 0.02, y);
      if (it.glass) P.cyl('white', 0.06, 0.05, 0.05, -W / 2 + W * 0.3, y + 0.02, -D / 2 + D * 0.3, { seg: 10 });
    }
    // Front: gebogene Tür (Glas oder Holz) aus schmalen Streifen
    for (let k = 0; k < 12; k++) {
      const [x0, z0] = front[k], [x1, z1] = front[k + 1];
      const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0);
      P.box(it.glass ? 'glass_cab' : c, len + 0.002, H - 0.12, 0.02, (x0 + x1) / 2, 0.08, (z0 + z1) / 2, { rotY: -a });
    }
  },

  /** Konsolentisch (weiß): Platte, Fächer mit Trennwänden, unten Körbe. */
  console(P, it) {
    const [W, D, H] = it.size || [1.2, 0.35, 0.8];
    const c = it.color || 'white';
    P.box(c, W, 0.03, D, 0, H - 0.03, 0);
    for (const sx of [-1, 1]) P.box(c, 0.03, H - 0.03, D, sx * (W / 2 - 0.015), 0, 0);
    P.box(c, W - 0.06, 0.02, D, 0, H - 0.22, 0); // Fächer oben
    P.box(c, W - 0.06, 0.02, D, 0, 0.08, 0); // Boden
    const n = Math.max(2, Math.round(W / 0.4));
    for (let i = 1; i < n; i++) P.box(c, 0.02, 0.17, D, -W / 2 + (W * i) / n, H - 0.2, 0);
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (W * (i + 0.5)) / n;
      P.rbox('pine', W / n - 0.07, 0.22, D - 0.06, 0.02, x, 0.1, 0);
    }
  },

  /** Kühlschrank: params.glass = Getränkekühlschrank mit Glastür und Flaschen; params.color (weiß/steel). */
  fridge(P, it) {
    const [W, D, H] = it.size || [0.6, 0.65, 1.85];
    const c = it.color || (it.glass ? 'black_matte' : 'white');
    P.rbox(c, W, H, D, 0.02, 0, 0, 0);
    if (it.glass) {
      P.box('slate', W - 0.08, H - 0.2, 0.005, 0, 0.12, D / 2 - 0.004);
      for (let r = 0; r < 5; r++) {
        const y = 0.16 + r * ((H - 0.3) / 5);
        P.box('alu', W - 0.1, 0.01, D - 0.1, 0, y, 0);
        for (let i = 0; i < 5; i++) P.cyl(i % 2 ? 'barrel_green' : 'teak', 0.032, 0.032, 0.24, -W / 2 + 0.1 + i * ((W - 0.2) / 4), y + 0.01, D / 2 - 0.12, { seg: 8 });
      }
      P.box('glass_cab', W - 0.08, H - 0.2, 0.006, 0, 0.12, D / 2 + 0.004);
    } else {
      P.box('black_matte', W - 0.02, 0.006, 0.004, 0, H * 0.62, D / 2 + 0.003); // Fuge zwischen Kühl- und Gefrierteil
    }
    P.box('alu', 0.02, 0.4, 0.03, W / 2 - 0.06, H * 0.62 + 0.08, D / 2 + 0.02); // Griff
  },

  /**
   * Saugroboter mit Absaugstation (Gerät, Zustand aus vacuum.*): Station hinter dem Roboter (−z, an der Wand). Animation:
   * fährt Runden vor der Station, solange er saugt; danach steht er wieder in der Station.
   */
  robot_vacuum(P, it) {
    const c = it.color || 'white';
    P.rbox(c, 0.36, 0.42, 0.22, 0.04, 0, 0, -0.33); // Station
    P.box('black_matte', 0.3, 0.02, 0.2, 0, 0, -0.18); // Rampe
    P.box('black_matte', 0.1, 0.02, 0.005, 0, 0.32, -0.219);
    P.beginAnim({ type: 'spin', axis: 'y', speed: 0.12, home: true }, [0, 0, 0.55]);
    P.cyl(c, 0.17, 0.17, 0.08, 0, 0.01, 0, { seg: 24 });
    P.cyl('black_matte', 0.05, 0.05, 0.02, 0, 0.09, -0.04, { seg: 12 }); // Laserturm
    P.box('black_matte', 0.2, 0.03, 0.02, 0, 0.03, 0.165); // Stoßfänger
    P.endAnim();
  },

  /** Kindertisch mit zwei Stühlchen; params.color (Platte), Rest Buche. */
  kids_table(P, it) {
    const [W, D, H] = it.size || [0.8, 0.55, 0.5];
    const c = it.color || 'white';
    P.box(c, W, 0.025, D, 0, H - 0.025, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box('oak_light', 0.04, H - 0.025, 0.04, sx * (W / 2 - 0.05), 0, sz * (D / 2 - 0.05));
    for (const sz of [-1, 1]) {
      const z = sz * (D / 2 + 0.2), sh = H * 0.56;
      P.box('oak_light', 0.3, 0.02, 0.28, 0, sh, z);
      for (const sx of [-1, 1]) for (const k of [-1, 1]) P.box('oak_light', 0.03, sh, 0.03, sx * 0.12, 0, z + k * 0.11);
      P.box('oak_light', 0.3, 0.22, 0.02, 0, sh + 0.04, z + sz * 0.13);
    }
  },

  /** Mitwachsender Hochstuhl (Buche): schräge Seitenwangen, Sitz- und Fußbrett, Rückenlehne. */
  high_chair(P, it) {
    const [W, D, H] = it.size || [0.46, 0.55, 0.8];
    const c = it.color || 'oak_light';
    for (const sx of [-1, 1]) {
      P.rod(c, [sx * W / 2, 0, D / 2], [sx * W / 2, H, -D / 2 + 0.1], 0.025, { seg: 4 });
      P.box(c, 0.03, 0.03, D, sx * W / 2, 0, 0);
    }
    P.box(c, W - 0.02, 0.02, 0.3, 0, H * 0.55, -0.02);
    P.box(c, W - 0.02, 0.02, 0.24, 0, H * 0.2, 0.08);
    P.box(c, W - 0.02, 0.12, 0.02, 0, H * 0.75, -D / 2 + 0.16);
    P.box(c, W - 0.02, 0.06, 0.02, 0, H * 0.92, -D / 2 + 0.12);
  },

  /** Wanduhr: rundes Zifferblatt mit Rahmen und Zeigern; elevation = Mitte der Uhr (Standard 1,9 m). */
  wall_clock(P, it) {
    const r = (it.size?.[0] ?? 0.35) / 2, y = (it.elevation ?? 1.9) - r;
    const rot = new THREE.Euler(Math.PI / 2, 0, 0);
    P.cyl(it.color || 'black_matte', r, r, 0.04, 0, y + r, 0.02, { rot, seg: 32 });
    P.cyl('white', r * 0.9, r * 0.9, 0.005, 0, y + r, 0.042, { rot, seg: 32 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      P.box('black_matte', 0.008, i % 3 ? 0.02 : 0.04, 0.004, Math.sin(a) * r * 0.75, y + r + Math.cos(a) * r * 0.75 - 0.01, 0.046);
    }
    P.box('black_matte', 0.012, r * 0.5, 0.004, 0, y + r, 0.048);
    P.box('black_matte', 0.008, r * 0.75, 0.004, r * 0.25, y + r - r * 0.2, 0.05, { rotY: 0 });
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

  /** Kristall-Kronleuchter: Korb aus Kristallsträngen an einer Kette; die Kristalle funkeln, wenn er leuchtet. */
  chandelier_crystal(P, l, { ceiling, roomIdx, lampIdx }) {
    const h = l.height, r = l.radius ?? 0.28, rings = 5, per = 14;
    P.idx = roomIdx;
    // Kette aus Gliedern (abwechselnd gedreht)
    for (let y = h + 0.22, k = 0; y < ceiling - 0.04; y += 0.06, k++) {
      P.add(new THREE.TorusGeometry(0.018, 0.004, 4, 8), 'brass', 'lit', new THREE.Matrix4().makeRotationY(k % 2 ? Math.PI / 2 : 0).setPosition(0, y, 0));
    }
    P.cyl('brass', 0.05, 0.05, 0.04, 0, ceiling - 0.04, 0, { seg: 12 });
    for (const [y, rr] of [[h + 0.18, r * 0.75], [h - 0.12, r]]) P.add(new THREE.TorusGeometry(rr, 0.008, 4, 28), 'brass', 'lit', new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, y, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      P.rod('brass', [Math.cos(a) * r * 0.75, h + 0.18, Math.sin(a) * r * 0.75], [0, h + 0.3, 0], 0.005, { seg: 4 });
    }
    P.idx = lampIdx;
    for (let k = 0; k < rings; k++) {
      // Korbform: oben schmaler, unten in einer Spitze zusammenlaufend
      const t = k / (rings - 1), y = h + 0.16 - t * 0.42, rr = r * (0.8 + 0.25 * Math.sin(Math.PI * t * 0.8)) * (1 - t * t * 0.7);
      for (let i = 0; i < per; i++) {
        const a = ((i + (k % 2) * 0.5) / per) * Math.PI * 2;
        P.add(new THREE.OctahedronGeometry(0.018), 'shade', 'glow', new THREE.Matrix4().makeScale(1, 1.6, 1).setPosition(Math.cos(a) * rr, y, Math.sin(a) * rr));
      }
    }
    P.add(new THREE.OctahedronGeometry(0.04), 'shade', 'glow', new THREE.Matrix4().makeScale(1, 2, 1).setPosition(0, h - 0.34, 0));
    P.sphere('bulb', 0.05, 0, h, 0, { kind: 'glow', seg: 10 });
  },

  /** Pendelleuchte mit Stoffschirm als Zylinder (Trommel); params.color = Stofffarbe. */
  pendant_drum(P, l, { ceiling, roomIdx, lampIdx }) {
    const h = l.height, r = l.radius ?? 0.25, sh = r * 0.8;
    P.idx = roomIdx;
    P.rod('black_matte', [0, h + sh / 2, 0], [0, ceiling, 0], 0.004, { seg: 4 });
    P.cyl('white', 0.05, 0.05, 0.02, 0, ceiling - 0.02, 0, { seg: 12 });
    P.idx = lampIdx;
    // Stofffarbe aus params.color (light.color ist die Lichtfarbe)
    const fabric = l.params?.color;
    P.add(new THREE.CylinderGeometry(r, r, sh, 32, 1, true), fabric ? `shade${fabric}` : 'shade', 'glow', new THREE.Matrix4().setPosition(0, h, 0));
    P.cyl('bulb', r * 0.95, r * 0.95, 0.004, 0, h - sh / 2 + 0.01, 0, { kind: 'glow', seg: 24 });
  },

  /** Stehleuchte: hohe Plissee-Säule auf drei schlanken Beinen; h = Mitte der Säule. */
  floor_column(P, l, { roomIdx, lampIdx }) {
    const h = l.height, r = l.radius ?? 0.16, ch = l.column ?? 1.1, y0 = h - ch / 2;
    P.idx = roomIdx;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      P.rod('black_matte', [Math.cos(a) * r * 1.4, 0, Math.sin(a) * r * 1.4], [Math.cos(a) * r * 0.6, y0 + 0.02, Math.sin(a) * r * 0.6], 0.008, { seg: 4 });
    }
    // Plissee: Mantel mit abwechselnd vor- und zurückspringenden Falten
    const g = new THREE.CylinderGeometry(r, r, ch, 48, 1, true);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k), a = Math.atan2(z, x);
      const f = 1 + 0.05 * Math.cos(a * 24);
      pos.setXYZ(k, x * f, pos.getY(k), z * f);
    }
    P.idx = lampIdx;
    P.add(g, 'shade', 'glow', new THREE.Matrix4().setPosition(0, h, 0));
    P.cyl('shade', r, r, 0.004, 0, h + ch / 2 - 0.004, 0, { kind: 'glow', seg: 24 });
  },

  /**
   * Papierlampe (Kugel aus Reispapier mit Ringen): pendant an der Decke, floor auf einem kleinen Fuß, table mit Sockel;
   * h = Mitte der Kugel, params.radius.
   */
  paper_lantern(P, l, { ceiling, roomIdx, lampIdx }) {
    const h = l.height, mount = l.kind, r = l.radius ?? (mount === 'floor' ? 0.3 : mount === 'table' ? 0.16 : 0.25);
    P.idx = roomIdx;
    if (mount === 'floor' || mount === 'table') {
      P.cyl('white', r * 0.35, r * 0.4, 0.02, 0, 0, 0, { seg: 16 });
      if (h - r > 0.02) P.rod('white', [0, 0, 0], [0, h - r, 0], 0.008, { seg: 4 });
    } else {
      P.rod('white', [0, h + r, 0], [0, ceiling, 0], 0.004, { seg: 4 });
    }
    P.idx = lampIdx;
    P.add(new THREE.SphereGeometry(r, 20, 14), 'shade', 'glow', new THREE.Matrix4().makeScale(1, 0.92, 1).setPosition(0, h, 0));
    for (let k = 1; k < 6; k++) {
      const y = -r * 0.9 + (k / 6) * r * 1.8, rr = Math.sqrt(Math.max(0, r * r - y * y));
      P.add(new THREE.TorusGeometry(rr * 1.005, 0.0025, 3, 28), 'shade', 'glow', new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, h + y * 0.92, 0));
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

