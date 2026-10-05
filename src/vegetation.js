// Bäume und Sträucher als Instanzen: je Form und Detailstufe eine Vorlage (Geometrie mit Vertex-Farben), alle
// Pflanzen dieser Form in einem THREE.InstancedMesh – wenige Zeichenaufrufe für Hunderte Bäume. Detailstufe je
// Pflanze nach ihrer Größe auf dem Bildschirm (nah: Krone aus mehreren unregelmäßigen Teilen, fern: eine
// Low-Poly-Form). Drehung, Proportionen und Laubfarbe variieren je Pflanze aus ihrer Position (ohne Daten).
//
// Vorlagen sind in Referenzgröße gebaut (REF) und werden je Pflanze auf ihre Größe skaliert. Das Attribut
// `vegCrown` (1 = Laub, 0 = Stamm) sagt, wo die Laubfarbe der Pflanze wirkt.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Ab dieser Kronengröße auf dem Bildschirm (Pixel) die nahe Detailstufe */
export const NEAR_PX = 110;

/** Fester Pseudozufall 0..1 */
const hash = (a, b = 0, c = 0) => {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

const col = (hex) => new THREE.Color(hex);
// Farben wie die Palette in models.js (leaf_green, leaf_dark, leaf_light, conifer, bark, birch_bark)
const C = {
  leaf: col(0x4f7a34), dark: col(0x2f5a2c), light: col(0x7fa046), conifer: col(0x24432c), conifer2: col(0x2d5236),
  bark: col(0x5a4330), birch: col(0xe6e1d6), band: col(0x1d1d1e), fruit: col(0x5b8a3a),
};

/** Unregelmäßige Laubwolke: Ikosaeder mit Rauschen (gleiche Ecken -> gleicher Versatz, keine Risse) */
function lump(detail, rx, ry, rz, x, y, z, seed, amp = 0.16) {
  // detail 0: 20 Flächen, 'mid': 56, 1: 80
  const g = detail === 'mid' ? new THREE.SphereGeometry(1, 7, 5).toNonIndexed() : new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const k = 1 + (hash(Math.round(vx * 97), Math.round(vy * 97) + seed, Math.round(vz * 97)) - 0.5) * 2 * amp;
    p.setXYZ(i, vx * rx * k + x, vy * ry * k + y, vz * rz * k + z);
  }
  return g;
}

function trunk(r0, r1, h, seg = 7, y = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, true);
  g.translate(0, y + h / 2, 0);
  return g;
}

/** Teile zu einer Vorlage zusammenfügen: Farbe je Teil, vegCrown je Teil, flache Normalen */
function assemble(parts) {
  const geos = parts.map(({ geo, color, crown, bands }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3), k = new Float32Array(n).fill(crown ? 1 : 0);
    for (let i = 0; i < n; i++) {
      // Birkenstamm: dunkle Ringe nach der Höhe des Dreiecks (Mitte), damit sie scharf begrenzt sind
      const t = i - (i % 3), P = g.attributes.position;
      const cy = (P.getY(t) + P.getY(t + 1) + P.getY(t + 2)) / 3;
      const cc = bands && bands.some(([a, b]) => cy >= a && cy <= b) ? C.band : color;
      c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.setAttribute('vegCrown', new THREE.Float32BufferAttribute(k, 1));
    return g;
  });
  const g = mergeGeometries(geos, false);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Referenzgröße je Form: [Kronendurchmesser bzw. Breite, Höhe, Tiefe] */
export const REF = {
  round: [3, 5, 3], fruit: [4, 3.5, 4], conifer: [2.6, 7, 2.6], column: [1.4, 6, 1.4], birch: [2.6, 7, 2.6], shrub: [1.2, 1, 1],
};
/** Grundfarbe des Laubs je Form (eigene Farben werden relativ dazu eingefärbt) */
export const CROWN = { round: C.leaf, fruit: C.fruit, conifer: C.conifer, column: C.dark, birch: C.light, shrub: C.dark };

const BUILD = {
  round(near) {
    const [D, H] = REF.round, r = D / 2, cy = H - r * 0.95;
    if (!near) return [{ geo: trunk(0.15, 0.1, cy, 5), color: C.bark }, { geo: lump(1, r * 0.95, r * 0.85, r * 0.95, 0, cy, 0, 1), color: C.leaf, crown: true }];
    const parts = [{ geo: trunk(0.16, 0.09, cy + r * 0.2, 7), color: C.bark }, { geo: lump(1, r * 0.82, r * 0.74, r * 0.82, 0, cy + r * 0.05, 0, 2), color: C.leaf, crown: true }];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.6;
      parts.push({ geo: lump('mid', r * 0.52, r * 0.46, r * 0.52, Math.cos(a) * r * 0.48, cy - r * 0.18 + i * r * 0.12, Math.sin(a) * r * 0.48, 3 + i), color: i === 1 ? C.dark : C.leaf, crown: true });
    }
    return parts;
  },
  fruit(near) {
    // Obstbaum: kurzer Stamm, niedrige, breite Krone
    const [D, H] = REF.fruit, r = D / 2, cy = H - r * 0.55;
    if (!near) return [{ geo: trunk(0.13, 0.09, cy, 5), color: C.bark }, { geo: lump(1, r * 0.95, r * 0.55, r * 0.95, 0, cy, 0, 11), color: C.fruit, crown: true }];
    const parts = [{ geo: trunk(0.14, 0.08, cy, 7), color: C.bark }];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      parts.push({ geo: lump('mid', r * 0.58, r * 0.4, r * 0.58, Math.cos(a) * r * 0.38, cy + (i - 1) * 0.12, Math.sin(a) * r * 0.38, 12 + i), color: i === 2 ? C.leaf : C.fruit, crown: true });
    }
    return parts;
  },
  conifer(near) {
    const [D, H] = REF.conifer, r = D / 2;
    const tiers = near ? 4 : 2;
    const parts = [{ geo: trunk(0.12, 0.08, H * 0.25, near ? 6 : 4), color: C.bark }];
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, rr = r * (1 - t * 0.72), h = H * (near ? 0.38 : 0.55) * (1 - t * 0.3);
      const g = new THREE.ConeGeometry(rr, h, near ? 9 : 7, 1, false);
      // Rand unregelmäßig
      const p = g.attributes.position;
      for (let v = 0; v < p.count; v++) if (p.getY(v) < 0) {
        const k = 1 + (hash(Math.round(p.getX(v) * 50), Math.round(p.getZ(v) * 50), i) - 0.5) * 0.3;
        p.setXYZ(v, p.getX(v) * k, p.getY(v) - (hash(v, i) * 0.12), p.getZ(v) * k);
      }
      g.translate(0, H * (0.14 + t * (near ? 0.62 : 0.5)) + h / 2, 0);
      parts.push({ geo: g, color: i % 2 ? C.conifer2 : C.conifer, crown: true });
    }
    return parts;
  },
  column(near) {
    const [D, H] = REF.column, r = D / 2;
    if (!near) return [{ geo: trunk(0.1, 0.07, H * 0.25, 4), color: C.bark }, { geo: lump(1, r, H * 0.42, r, 0, H * 0.56, 0, 21), color: C.dark, crown: true }];
    return [
      { geo: trunk(0.11, 0.07, H * 0.25, 6), color: C.bark },
      { geo: lump(1, r * 0.95, H * 0.36, r * 0.95, 0, H * 0.5, 0, 22), color: C.dark, crown: true },
      { geo: lump('mid', r * 0.72, H * 0.22, r * 0.72, r * 0.12, H * 0.74, -r * 0.08, 23), color: C.leaf, crown: true },
      { geo: lump('mid', r * 0.6, H * 0.16, r * 0.6, -r * 0.15, H * 0.32, r * 0.1, 24), color: C.leaf, crown: true },
    ];
  },
  birch(near) {
    // schlanker weißer Stamm mit dunklen Ringen, lockere Krone aus kleinen Teilen
    const [D, H] = REF.birch, r = D / 2;
    const bands = [0.14, 0.33, 0.52].map((f) => [H * f, H * f + 0.05]);
    // Stamm als Drehkörper mit Kanten nur an den Ringen (wenige Dreiecke)
    const top = H * 0.78, ys = [0, ...(near ? bands.flat() : []), top];
    const stem = new THREE.LatheGeometry(ys.map((y) => new THREE.Vector2(0.1 - (0.04 * y) / top, y)), near ? 6 : 5);
    const parts = [{ geo: stem, color: C.birch, bands: near ? bands : null }];
    const n = near ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = near ? 0.5 : 0.7;
      parts.push({ geo: lump(near && i % 2 === 0 ? 'mid' : 0, r * rr, r * (rr + 0.08), r * rr, Math.cos(a) * r * 0.4, H * 0.62 + (i % 3) * r * 0.25, Math.sin(a) * r * 0.4, 31 + i, 0.2), color: i % 2 ? C.leaf : C.light, crown: true });
    }
    if (near) parts.push({ geo: lump('mid', r * 0.42, r * 0.55, r * 0.42, 0, H * 0.84, 0, 37), color: C.light, crown: true });
    return parts;
  },
  shrub(near) {
    const [W, H, Dp] = REF.shrub;
    if (!near) return [{ geo: lump(1, W * 0.5, H * 0.55, Dp * 0.5, 0, H * 0.45, 0, 41), color: C.dark, crown: true }];
    return [
      { geo: lump(1, W * 0.45, H * 0.55, Dp * 0.45, 0, H * 0.45, 0, 42), color: C.dark, crown: true },
      { geo: lump('mid', W * 0.32, H * 0.4, Dp * 0.32, W * 0.18, H * 0.42, -Dp * 0.12, 43), color: C.leaf, crown: true },
    ];
  },
};

const templates = new Map();
/** Vorlage einer Form und Detailstufe (einmal je Sitzung gebaut, geteilt) */
export function vegTemplate(shape, near) {
  const k = `${shape}:${near ? 1 : 0}`;
  if (!templates.has(k)) templates.set(k, assemble(BUILD[shape](near)));
  return templates.get(k);
}

/** Form eines Objekts: tree mit params.shape (round, fruit, conifer, column, birch) oder shrub */
export function vegShape(it) {
  if (it.kind === 'shrub') return 'shrub';
  if (it.kind !== 'tree') return null;
  return BUILD[it.shape] && it.shape !== 'shrub' ? it.shape : 'round';
}

/**
 * Lage und Farbe einer Pflanze: lokale Matrix (Variation, Skalierung auf ihre Größe; vor Drehung/Lage des Objekts),
 * Laub-Tönung (Faktor je Farbkanal) und Kronengröße (für die Detailstufe).
 * @param colorOf  (key) => THREE.Color oder null (Palette bzw. #rrggbb)
 */
export function vegPlacement(it, shape, colorOf) {
  const [rw, rh, rd] = REF[shape];
  const size = it.size || [];
  let w, h, d;
  if (shape === 'shrub') [w, d, h] = [size[0] ?? rw, size[1] ?? rd, size[2] ?? rh];
  else {
    w = d = size[0] ?? rw;
    h = size[2] ?? size[1] ?? rh;
  }
  const [px, pz] = it.pos || [0, 0];
  const h1 = hash(px * 3.1, pz * 1.7), h2 = hash(pz * 2.3, px * 4.1, 1), h3 = hash(px + pz, px - pz, 2);
  const angle = h1 * Math.PI * 2;
  const sx = (w / rw) * (0.9 + 0.2 * h2), sz = (d / rd) * (0.9 + 0.2 * h3), sy = (h / rh) * (0.94 + 0.12 * h1);
  const local = new THREE.Matrix4().makeRotationY(angle).multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
  // Laubfarbe: eigene Farbe relativ zur Grundfarbe der Form, dazu ±10 % Helligkeit und etwas Gelb/Blau je Pflanze
  const base = CROWN[shape];
  const own = it.color ? colorOf(it.color) : null;
  const tint = own ? new THREE.Color(own.r / Math.max(base.r, 1e-3), own.g / Math.max(base.g, 1e-3), own.b / Math.max(base.b, 1e-3)) : new THREE.Color(1, 1, 1);
  const light = 0.9 + 0.2 * h2, warm = (h3 - 0.5) * 0.12;
  tint.setRGB(tint.r * light * (1 + warm), tint.g * light, tint.b * light * (1 - warm));
  return { local, tint, crown: Math.max(w, d), size: [w, h, d] };
}

/** Geometrie einer Pflanze für den Einzelaufbau (Editor, Vorschau): Vorlage mit eingefärbtem Laub */
export function vegGeometry(shape, tint, near = true) {
  const g = vegTemplate(shape, near).clone();
  const c = g.attributes.color, k = g.attributes.vegCrown;
  for (let i = 0; i < c.count; i++) if (k.getX(i) > 0.5) c.setXYZ(i, c.getX(i) * tint.r, c.getY(i) * tint.g, c.getZ(i) * tint.b);
  g.deleteAttribute('vegCrown');
  return g;
}

/**
 * Pflanzen einer Etage als Instanzen. add() sammelt, build() legt je Form zwei InstancedMeshes an (nah/fern),
 * updateLod(pxPerMeter) verteilt die Pflanzen nach ihrer Bildschirmgröße (nur bei Änderung).
 */
export class VegetationSet {
  constructor(material) {
    this.material = material;
    this.items = new Map(); // Form -> [{ matrix, tint, crown, roomIdx }]
    this.meshes = [];
    this._ppm = null;
  }

  add(shape, world, tint, crown, roomIdx) {
    if (!this.items.has(shape)) this.items.set(shape, []);
    this.items.get(shape).push({ matrix: world, tint, crown, roomIdx });
  }

  get empty() {
    return !this.items.size;
  }

  build(group) {
    for (const [shape, list] of this.items) {
      const pair = [true, false].map((near) => {
        const t = vegTemplate(shape, near);
        const g = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(t.attributes)) g.setAttribute(name, attr);
        g.setAttribute('roomIdx', new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1));
        g.setAttribute('vegTint', new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3));
        g.boundingBox = t.boundingBox;
        g.boundingSphere = t.boundingSphere;
        const m = new THREE.InstancedMesh(g, this.material, list.length);
        m.castShadow = true;
        m.receiveShadow = true;
        m.count = 0;
        m.userData.vegetation = { shape, near };
        group.add(m);
        this.meshes.push(m);
        return m;
      });
      pair.list = list;
      (this.pairs ??= []).push(pair);
    }
    this.updateLod(0, true);
  }

  /** Detailstufen neu verteilen; true, wenn sich etwas geändert hat (dann auch die Schatten neu berechnen) */
  updateLod(ppm, force = false) {
    if (!force && this._ppm && Math.abs(ppm - this._ppm) / this._ppm < 0.08) return false;
    this._ppm = ppm;
    let changed = force;
    for (const pair of this.pairs || []) {
      const near = pair.list.map((p) => p.crown * ppm >= NEAR_PX);
      const key = near.join();
      if (!force && key === pair.key) continue;
      pair.key = key;
      changed = true;
      const counts = [0, 0];
      pair.list.forEach((p, i) => {
        const which = near[i] ? 0 : 1, m = pair[which], k = counts[which]++;
        m.setMatrixAt(k, p.matrix);
        m.geometry.attributes.roomIdx.setX(k, p.roomIdx);
        m.geometry.attributes.vegTint.setXYZ(k, p.tint.r, p.tint.g, p.tint.b);
      });
      pair.forEach((m, which) => {
        m.count = counts[which];
        m.visible = counts[which] > 0;
        m.instanceMatrix.needsUpdate = true;
        m.geometry.attributes.roomIdx.needsUpdate = true;
        m.geometry.attributes.vegTint.needsUpdate = true;
        m.computeBoundingSphere();
      });
    }
    return changed;
  }

  dispose() {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
      m.dispose();
    }
  }
}

/** Material für alle Pflanzen-Instanzen: Vertex-Farben, Laub mit der Tönung je Pflanze (vegTint, vegCrown) */
export function patchVegetation(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    prev?.(shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 vegTint;\nattribute float vegCrown;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= mix(vec3(1.0), vegTint, vegCrown);');
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `veg:${key ? key() : ''}`;
  return material;
}
