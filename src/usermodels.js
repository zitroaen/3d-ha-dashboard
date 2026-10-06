// Eigene Modelle (Nutzer-Modelle): <data>/models/<id>.yaml, deklarativ aus Grundformen (Quader, Balken, Stab,
// Zylinder, Kugel, Rohr) oder optional aus einer glTF-Datei. Sie werden mit model.yaml geladen und wie eingebaute
// Modelle in den Katalog eingetragen (Gruppe „Eigene“, mit Vorschau). Format: docs/DATA_MODEL.md, Schema:
// schema/model-part.schema.json. Fehler im Modell ergeben eine Warnung und einen Platzhalter-Quader.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CATALOG, MODEL_LIGHT_HEIGHT, DEFAULT_MOUNT } from './model/catalog.js';
import { FURNITURE, LAMPS, PartCollector } from './models.js';

/** Ordner der eigenen Modelle im Datenordner */
export const USER_MODEL_DIR = 'models/';
const CATEGORIES = new Set(['furniture', 'device', 'lamp', 'plant']);
const PART_TYPES = ['box', 'beam', 'rod', 'cylinder', 'sphere', 'tube'];
const rad = (d) => (d * Math.PI) / 180;

/**
 * Zahl oder Ausdruck mit Parametern: 0.4, "$breite", "$breite / 2 - 0.05" (+ − × ÷, Klammern). Kein eval – eigener
 * kleiner Parser, damit Modelldateien nichts ausführen können.
 */
export function evalExpr(v, params) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') throw new Error(`Zahl erwartet: ${JSON.stringify(v)}`);
  const src = v.trim();
  let i = 0;
  const peek = () => src[i];
  const skip = () => {
    while (src[i] === ' ') i++;
  };
  const num = () => {
    skip();
    if (peek() === '(') {
      i++;
      const r = sum();
      skip();
      if (src[i++] !== ')') throw new Error(`„)“ fehlt in ${src}`);
      return r;
    }
    if (peek() === '-') {
      i++;
      return -num();
    }
    if (peek() === '$') {
      const m = /^\$([a-zA-Z_][a-zA-Z0-9_]*)/.exec(src.slice(i));
      if (!m) throw new Error(`Parametername fehlt in ${src}`);
      i += m[0].length;
      const p = params[m[1]];
      if (typeof p !== 'number') throw new Error(`Parameter $${m[1]} ist keine Zahl`);
      return p;
    }
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (!m) throw new Error(`Zahl erwartet in ${src}`);
    i += m[0].length;
    return Number(m[0]);
  };
  const prod = () => {
    let r = num();
    for (skip(); peek() === '*' || peek() === '/'; skip()) {
      const op = src[i++];
      const b = num();
      r = op === '*' ? r * b : r / b;
    }
    return r;
  };
  const sum = () => {
    let r = prod();
    for (skip(); peek() === '+' || peek() === '-'; skip()) {
      const op = src[i++];
      const b = prod();
      r = op === '+' ? r + b : r - b;
    }
    return r;
  };
  const r = sum();
  skip();
  if (i < src.length || !Number.isFinite(r)) throw new Error(`Ausdruck nicht lesbar: ${src}`);
  return r;
}

const vec = (v, params, n = 3, def = null) => {
  if (v == null) {
    if (def) return def;
    throw new Error(`${n} Zahlen erwartet`);
  }
  if (!Array.isArray(v) || v.length !== n) throw new Error(`${n} Zahlen erwartet: ${JSON.stringify(v)}`);
  return v.map((x) => evalExpr(x, params));
};

/**
 * Modell-Datei prüfen und normalisieren. Wirft bei Fehlern (Meldung auf Deutsch). glTF-Modelle (`file`) brauchen
 * keine Teile.
 */
export function checkUserModel(def, id) {
  if (!def || typeof def !== 'object') throw new Error('kein YAML-Objekt');
  if (def.id !== id) throw new Error(`id „${def.id}“ passt nicht zum Dateinamen ${id}.yaml`);
  if (!/^[a-z0-9_]+$/.test(id)) throw new Error('id: nur Kleinbuchstaben, Ziffern und _');
  if (def.category && !CATEGORIES.has(def.category)) throw new Error(`category „${def.category}“ unbekannt (furniture, device, lamp, plant)`);
  const light = (def.capabilities || []).includes('light');
  if (light && !def.light) throw new Error('capabilities: light braucht einen light-Block (at, mount, range)');
  if (!def.file && !(def.parts?.length)) throw new Error('parts (Grundformen) oder file (glTF) nötig');
  const params = { ...(def.params || {}) };
  for (const [i, part] of (def.parts || []).entries()) {
    const type = PART_TYPES.find((t) => part?.[t]);
    if (!type) throw new Error(`parts[${i}]: eine von ${PART_TYPES.join(', ')} erwartet`);
    shapeOf(type, part[type], params); // prüft die Zahlen
  }
  return def;
}

/** Geometrie und Lage einer Grundform (lokal, Meter) */
function shapeOf(type, p, params) {
  const N = (v, d) => (v == null ? d : evalExpr(v, params));
  const rot = vec(p.rot, params, 3, [0, 0, 0]).map(rad);
  const place = (at, geo) => ({ geo, m: new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)) });
  // entlang einer Strecke from -> to (Y-Achse der Geometrie zeigt dorthin)
  const along = (from, to, geo) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), len = a.distanceTo(b);
    if (len < 1e-6) throw new Error('from und to gleich');
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return { geo: geo(len), m: new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)) };
  };
  if (type === 'box') {
    const [w, h, d] = vec(p.size, params), r = N(p.radius, 0);
    const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
    return place(vec(p.at, params, 3, [0, h / 2, 0]), geo);
  }
  if (type === 'beam') {
    const [w, h] = vec(p.size, params, 2);
    return along(vec(p.from, params), vec(p.to, params), (len) => new THREE.BoxGeometry(w, len, h));
  }
  if (type === 'rod') {
    const r = N(p.radius, 0.01);
    return along(vec(p.from, params), vec(p.to, params), (len) => new THREE.CylinderGeometry(r, r, len, N(p.segments, 8)));
  }
  if (type === 'cylinder') {
    const r = N(p.radius, 0.1), rb = N(p.radius_back, r), seg = N(p.segments, 20);
    // from/to: Zylinder (Kegelstumpf) zwischen zwei Punkten, radius am Anfang, radius_back am Ende;
    // sonst stehend mit at (Mitte der Unterseite) und height
    if (p.from) return along(vec(p.from, params), vec(p.to, params), (len) => new THREE.CylinderGeometry(rb, r, len, seg));
    const h = N(p.height, 0.1), at = vec(p.at, params, 3, [0, 0, 0]);
    const g = new THREE.CylinderGeometry(rb, r, h, seg).translate(0, h / 2, 0);
    return place(at, g);
  }
  if (type === 'sphere') {
    const r = N(p.radius, 0.1), s = vec(p.scale, params, 3, [1, 1, 1]);
    const g = new THREE.SphereGeometry(r, N(p.segments, 16), Math.max(6, N(p.segments, 16) / 2)).scale(...s);
    return place(vec(p.at, params, 3, [0, r, 0]), g);
  }
  // tube: weiches Rohr durch Punkte
  if (!Array.isArray(p.points) || p.points.length < 2) throw new Error('tube: mindestens zwei points');
  const pts = p.points.map((q) => new THREE.Vector3(...vec(q, params)));
  const curve = new THREE.CatmullRomCurve3(pts);
  return { geo: new THREE.TubeGeometry(curve, Math.max(8, pts.length * 8), N(p.radius, 0.02), N(p.segments, 8), !!p.closed), m: new THREE.Matrix4() };
}

/** Materialname eines Teils -> Paletten-Schlüssel (#rrggbb, Palette, surf:…) */
function materialOf(def, part, params) {
  let m = part.material ?? def.material ?? 'white';
  if (def.materials?.[m] != null) m = def.materials[m];
  if (typeof m === 'string' && m.startsWith('$')) m = params[m.slice(1)];
  return String(m ?? 'white');
}

/** Teile eines deklarativen Modells in den PartCollector (Leuchten: glow-Teile mit dem Lampen-Index) */
function drawParts(P, def, params, scale, shift, lampIdx = null) {
  const S = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(...shift));
  const roomIdx = P.idx;
  for (const part of def.parts || []) {
    const type = PART_TYPES.find((t) => part[t]);
    const p = part[type];
    const { geo, m } = shapeOf(type, p, params);
    const glow = !!(p.glow ?? part.glow);
    if (glow && lampIdx != null) P.idx = lampIdx;
    P.add(geo, materialOf(def, p.material ? p : part, params), glow ? 'glow' : 'lit', S.clone().multiply(m));
    P.idx = roomIdx;
  }
  for (const mesh of def.gltf || []) {
    const glow = (def.glow_materials || []).includes(mesh.name);
    if (glow && lampIdx != null) P.idx = lampIdx;
    const g = mesh.geometry.clone();
    const G = new THREE.Matrix4().makeTranslation(...(def.offset || [0, 0, 0])).multiply(new THREE.Matrix4().makeScale(def.scale ?? 1, def.scale ?? 1, def.scale ?? 1));
    P.add(g, glow ? 'bulb' : mesh.color, glow ? 'glow' : 'lit', S.clone().multiply(G));
    P.idx = roomIdx;
  }
}

/** Platzhalter für ein fehlerhaftes Modell: halbtransparent wirkender Quader in Signalfarbe */
function placeholder(P) {
  P.box('#d13b8e', 0.5, 0.5, 0.5, 0, 0, 0);
}

/**
 * Eigene Modelle eintragen: Katalog (Gruppe „Eigene“), Zeichenfunktion für Möbel bzw. Leuchten. Doppelte IDs eines
 * eingebauten Modells werden abgelehnt. Liefert die Warnungen.
 * @param defs  [{ id, def?, error? }] – def = geprüfte Modelldatei, error = Meldung (dann Platzhalter)
 */
export function registerUserModels(defs) {
  const warnings = [];
  for (const { id, def, error } of defs) {
    if (CATALOG[id] && !CATALOG[id].user) {
      warnings.push(`Eigenes Modell ${id}: gleiche ID wie ein eingebautes Modell – nicht geladen`);
      continue;
    }
    if (error || !def) {
      warnings.push(`Eigenes Modell ${id}: ${error}`);
      CATALOG[id] = { label: id, category: 'furniture', size: [0.5, 0.5, 0.5], params: [], user: true, broken: true };
      FURNITURE[id] = placeholder;
      continue;
    }
    const light = (def.capabilities || []).includes('light');
    const defaults = def.params || {};
    // natürliche Größe (für Katalog und gleichmäßige Skalierung über size)
    const box = new THREE.Box3();
    try {
      const P = new PartCollector();
      P.begin(0, 0, 0, 0);
      drawParts(P, def, { ...defaults }, 1, [0, 0, 0]);
      for (const m of P.build(() => new THREE.MeshBasicMaterial())) {
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox);
      }
    } catch (e) {
      warnings.push(`Eigenes Modell ${id}: ${e.message}`);
      CATALOG[id] = { label: def.name || id, category: 'furniture', size: [0.5, 0.5, 0.5], params: [], user: true, broken: true };
      FURNITURE[id] = placeholder;
      continue;
    }
    const sz = box.isEmpty() ? new THREE.Vector3(0.5, 0.5, 0.5) : box.getSize(new THREE.Vector3());
    const natural = [sz.x, sz.z, sz.y].map((v) => Math.round(v * 100) / 100);
    const at = light ? vec(def.light.at, defaults, 3, [0, 1, 0]) : null;
    CATALOG[id] = {
      label: def.name || id, category: light ? 'lamp' : def.category || 'furniture', size: light ? undefined : natural,
      params: Object.keys(defaults), capabilities: def.capabilities, user: true, lightRange: def.light?.range,
    };
    // gleichmäßig skalieren: Faktor aus der Breite (size[0]) gegenüber der natürlichen Breite
    const scaleOf = (it) => (Array.isArray(it.size) && it.size[0] > 0 && natural[0] > 0 ? it.size[0] / natural[0] : 1);
    const paramsOf = (it) => {
      const p = { ...defaults };
      for (const k of Object.keys(defaults)) if (it[k] != null) p[k] = it[k];
      for (const k of Object.keys(defaults)) if (it.params?.[k] != null) p[k] = it.params[k];
      return p;
    };
    const draw = (P, it, lampIdx = null) => {
      try {
        // Leuchte: die Lichtquelle (light.at) sitzt über dem Ankerpunkt des Objekts
        drawParts(P, def, paramsOf(it), scaleOf(it), at ? [-at[0], 0, -at[2]] : [0, 0, 0], lampIdx);
      } catch (e) {
        placeholder(P);
      }
    };
    if (light) {
      MODEL_LIGHT_HEIGHT[id] = at[1];
      DEFAULT_MOUNT[id] = def.light.mount || 'table';
      LAMPS[id] = (P, l, { lampIdx }) => draw(P, l, lampIdx);
    } else FURNITURE[id] = (P, it) => draw(P, it);
  }
  return warnings;
}

/** IDs der eigenen Modelle eines Modells: Liste `models` plus alle Objekte mit unbekanntem Modell */
export function userModelIds(model) {
  const ids = new Set(model.models || []);
  for (const o of model.objects || []) if (o.model && (!CATALOG[o.model] || CATALOG[o.model].user)) ids.add(o.model);
  return [...ids].filter((id) => typeof id === 'string' && /^[a-z0-9_]+$/.test(id));
}

/**
 * glTF-Datei (Binär .glb oder .gltf) -> Meshes [{ name, color, geometry }] in Modellkoordinaten. Texturen entfallen
 * (die Farbe des Materials bleibt) – so passen die Teile in die zusammengefassten Meshes der Einrichtung.
 */
export async function gltfMeshes(buffer, baseUrl) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(buffer, baseUrl);
  gltf.scene.updateMatrixWorld(true);
  const out = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    out.push({ name: mats[0]?.name || '', color: `#${(mats[0]?.color || new THREE.Color(0xcccccc)).getHexString()}`, geometry: g });
  });
  return out;
}
