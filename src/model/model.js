// Datenmodell v2 (docs/DATA_MODEL.md): lesen, Version prüfen und in die Strukturen übersetzen, mit denen die Szene
// zeichnet. Bearbeitet der Editor ein Objekt, schreibt writeBack() die Werte ins Modell-Objekt zurück; gespeichert
// wird immer das ganze Modell.
//
// Interne Darstellung (für scene.js, house.js, furnishing.js):
//   house.floors[]  eine Etage je Gebäude-Etage (id = "gebäude/etage") plus eine synthetische Außen-Etage
//                   (OUTDOOR_FLOOR, Ebene 0, ohne Wände) mit den Außenbereichen als "Räumen"
//   items[]         Objekte ohne Fähigkeit light
//   devices[]       Leuchten (type: light)
// Jedes interne Objekt trägt in `src` das Modell-Objekt und in `base` die Bodenhöhe seines Außenbereichs (Höhen wie
// `elevation` und `height` bleiben Rohwerte über dem Boden des Bereichs; die Szene addiert `base`).
import { load as parseYaml } from 'js-yaml';
import { CATALOG, DEFAULT_MOUNT, hasCapability } from './catalog.js';
import { migrate } from './migrate.js';
import { heightAt, pointInPoly } from '../geometry.js';
import { roofShape } from '../roofshape.js';
import { terrainGrid } from '../terrain.js';

export { MODEL_VERSION, ModelVersionError } from './migrate.js';

/** Schlüssel der synthetischen Außen-Etage */
export const OUTDOOR_FLOOR = '__aussen';
/** Pseudo-Raum für Objekte ohne Bereich (freies Gelände) */
export const OPEN_GROUND = 'aussen';

/** Text (YAML oder JSON) -> Modell in aktueller Version */
export function parseModel(text, file = 'model.yaml') {
  let doc;
  try {
    doc = (text.trim() && parseYaml(text)) || null;
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
  return migrate(doc).doc;
}

/** Modell aus einem bereits geparsten Objekt (z. B. dem gemeinsamen Speicher der Integration), migriert */
export function modelFromObject(obj) {
  return migrate(structuredClone(obj)).doc;
}

/** Alle Bereiche (Räume und Außenbereiche) mit ihrer Lage: Map id -> { kind, building, floor, room, base, height } */
export function spacesOf(model) {
  const out = new Map();
  for (const b of model.buildings || []) {
    for (const f of b.floors) {
      for (const r of f.rooms) {
        out.set(r.id, { kind: 'room', building: b, floor: f, floorKey: floorKey(b, f), room: r, base: f.elevation || 0, height: r.height ?? f.height });
      }
    }
  }
  for (const b of model.buildings || []) {
    for (const roof of roofParts(b)) {
      if (!out.has(roof.id)) out.set(roof.id, { kind: 'roof', building: b, floorKey: `${b.id}/${ROOF_FLOOR}`, room: roof, base: roof.elevation + roof.offset, height: 3 });
    }
  }
  for (const z of model.outdoor || []) {
    out.set(z.id, { kind: 'outdoor', floorKey: OUTDOOR_FLOOR, room: z, base: z.elevation || 0, height: 3 });
  }
  return out;
}

export const floorKey = (b, f) => `${b.id}/${f.id}`;

/** Oberste Etage eines Gebäudes (höchste Ebene, bei Gleichstand die höher liegende) */
function topFloor(b) {
  return [...b.floors].sort((x, y) => (x.level ?? 0) - (y.level ?? 0) || (x.elevation || 0) - (y.elevation || 0)).at(-1);
}

/** Konvexe Hülle (Plan-Punkte), gegen den Uhrzeigersinn */
function convexHull(pts) {
  const p = [...new Map(pts.map((q) => [`${q[0]},${q[1]}`, [q[0], q[1]]])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h.at(-2), h.at(-1), q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

/**
 * Dächer eines Gebäudes: sichtbar, sobald eine höhere Ebene gezeigt wird (z. B. die Garage, wenn das 1. OG des
 * Hauses gewählt ist). `roof` ist ein Dachteil oder eine Liste (Hauptdach + Anbau, Dachterrasse …); `roof: false` =
 * kein Dach. Jeder Teil ist ein eigener Bereich (Objekte darauf: `space: <ID>`). Standard-ID `<Gebäude-ID>_dach`
 * (weitere `_dach_2` …), Umriss = konvexe Hülle der obersten Etage.
 *
 * Höhen: `eaves` (Traufe/Kniestock) über dem Fußboden der obersten Etage, Standard deren Höhe (Dach auf der
 * Geschossdecke). Die Dach-Etage liegt auf Geschosshöhe + Dicke des ersten Teils; `offset` = Lage eines Teils darin
 * (Oberseite an der Traufe), `elevation` = Höhe der Dach-Etage.
 */
export function roofParts(b) {
  if (b.roof === false || !b.floors?.length) return [];
  const list = Array.isArray(b.roof) ? b.roof : [b.roof || {}];
  const top = topFloor(b);
  const H = top.height ?? 2.5;
  const hull = () => convexHull([...top.walls.flatMap((w) => w.polygon), ...top.rooms.flatMap((x) => x.polygon)]);
  const t0 = list[0]?.thickness ?? 0.2;
  return list.map((r, i) => {
    const type = r.type || 'flat';
    const t = r.thickness ?? 0.2, eaves = r.eaves ?? H;
    const part = {
      ...r,
      id: r.id || (i ? `${b.id}_dach_${i + 1}` : `${b.id}_dach`),
      name: r.name || 'Dach',
      type,
      pitched: type !== 'flat',
      surface: r.surface || (type === 'flat' ? 'roof' : 'roof_tiles'),
      polygon: r.polygon || hull(),
      level: (top.level ?? 0) + 1,
      thickness: t,
      eaves,
      elevation: (top.elevation || 0) + H + t0,
      offset: eaves - H + t - t0,
    };
    if (part.pitched) part.shape = roofShape(part);
    // Liegt der Teil über der obersten Etage (sonst Anbau über einer tieferen)? Davon hängen die Giebelwände ab.
    const c = part.polygon.reduce((m, p) => [m[0] + p[0] / part.polygon.length, m[1] + p[1] / part.polygon.length], [0, 0]);
    part.overTop = pointInPoly(c, hull());
    return part;
  });
}

/** Höhe der Dachoberseite eines Dachteils an einer Stelle, relativ zur Dach-Etage */
export function roofHeightAt(part, pos) {
  return part.offset + (part.shape && pos ? Math.max(0, part.shape.height(pos)) : 0);
}

export const ROOF_FLOOR = '__dach';

/** Gelände eines Außenbereichs: Höhe je Eckpunkt (dritte Koordinate, sonst elevation) – oder null, wenn eben */
export function terrainHeights(z) {
  if (!z.polygon.some((p) => p.length > 2)) return null;
  return z.polygon.map((p) => p[2] ?? (z.elevation || 0));
}

const grids = new WeakMap();
/** Höhenraster des Grundstücks (site.terrain) oder null; einmal je Modell-Objekt berechnet */
export function terrainOf(model) {
  const spec = model?.site?.terrain;
  if (!spec) return null;
  if (!grids.has(spec)) grids.set(spec, terrainGrid(spec));
  return grids.get(spec);
}

/** Folgt der Außenbereich dem Höhenraster (`follow: terrain`)? */
export const followsTerrain = (z, terrain) => !!terrain && z.follow === 'terrain';

/**
 * Bodenhöhe eines Außenbereichs an einer Stelle: auf dem Höhenraster (follow: terrain), Gelände je Eckpunkt
 * interpoliert, sonst elevation
 */
export function outdoorHeightAt(z, pos, terrain = null) {
  if (followsTerrain(z, terrain)) return terrain.height(pos);
  const hs = terrainHeights(z);
  return hs ? heightAt(z.polygon, hs, pos) : z.elevation || 0;
}

const list = (v) => (v == null ? [] : [].concat(v));

/** Aktion (Kurzform oder Objekt) -> Objekt { action, ... } */
export function normAction(a) {
  if (a == null) return null;
  return typeof a === 'string' ? { action: a } : a;
}

/** Entities einer Rolle als Liste */
export const roleEntities = (obj, role) => list(obj.ha?.entities?.[role]);

export const GESTURES = ['tap', 'double_tap', 'hold'];

/**
 * Aktion für eine Geste mit Standardwerten (docs/DATA_MODEL.md → Standards).
 * @param obj    Objekt mit `ha` (Modell-Objekt oder interne Kopie)
 * @param light  Objekt kann leuchten (Leuchten schalten auch unverknüpft: Demo/Vorschau lokal)
 */
export function gestureAction(obj, gesture, light = false) {
  const set = normAction(obj.ha?.[gesture]);
  if (set) return set;
  return defaultAction(obj, gesture, light);
}

/** Standardaktion einer Geste (ohne ausdrückliche Angabe) */
export function defaultAction(obj, gesture, light = false) {
  const power = roleEntities(obj, 'power'), info = roleEntities(obj, 'info');
  if (gesture === 'tap') return power.length || light ? { action: 'toggle' } : info.length ? { action: 'more-info' } : { action: 'none' };
  if (gesture === 'hold') return power.length || info.length || light ? { action: 'more-info' } : { action: 'none' };
  return { action: 'none' };
}

/** Zustandsanzeige über dem Objekt? (`ha.badge`, Standard: bei info-Entities oder geschalteten Nicht-Leuchten) */
export function showsBadge(obj, light = false) {
  if (obj.ha?.badge != null) return obj.ha.badge;
  return roleEntities(obj, 'info').length > 0 || (!light && roleEntities(obj, 'power').length > 0);
}

/** `ha` aufräumen: leere Rollen und leere Angaben entfernen; nichts übrig -> undefined */
export function cleanHa(ha) {
  if (!ha) return undefined;
  const out = {};
  const ents = {};
  for (const [role, v] of Object.entries(ha.entities || {})) {
    const l = list(v).filter(Boolean);
    if (l.length) ents[role] = l.length === 1 ? l[0] : l;
  }
  if (Object.keys(ents).length) out.entities = ents;
  for (const g of GESTURES) if (ha[g] != null) out[g] = ha[g];
  if (ha.badge != null) out.badge = ha.badge;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Modell -> interne Darstellung für die Szene.
 * @returns {{ house, items, devices, areaMap, spaces, model }}
 */
export function toScene(model) {
  const spaces = spacesOf(model);
  const terrain = terrainOf(model);
  const floors = [];
  for (const b of model.buildings || []) {
    const lowest = Math.min(...b.floors.map((f) => f.level ?? 0));
    for (const f of b.floors) {
      floors.push({
        id: floorKey(b, f),
        building: b.id,
        facade: b.facade,
        lowest: (f.level ?? 0) === lowest,
        name: f.name,
        buildingName: b.name,
        level: f.level,
        elevation: f.elevation || 0,
        ceiling: f.height,
        ha_floor: f.ha_floor,
        rooms: f.rooms.map((r) => ({
          id: r.id, name: r.name, polygon: r.polygon, floor: r.surface || 'parquet', floor_rot: r.surface_rot, ceiling: r.height, area: r.ha_area,
          zones: r.zones, beams: r.beams,
        })),
        walls: f.walls.map((w) => w.polygon),
        windows: f.windows || [],
        doors: f.doors || [],
      });
    }
    // Dach als eigene Etage eine Ebene über der obersten (ohne Wände); die Ebene selbst bekommt keinen Knopf
    const parts = roofParts(b).filter((r) => r.polygon.length >= 3);
    if (parts.length) {
      const top = topFloor(b), H = top.height ?? 2.5;
      // Steildächer schneiden die Wände der obersten Etage (Kniestock, Giebel): Unterseite = Traufe + Dachfläche
      const cut = parts.filter((r) => r.pitched && r.overTop).map((r) => ({ shape: r.shape, eaves: r.eaves, dormers: r.dormers || [] }));
      if (cut.length) floors.find((f) => f.id === floorKey(b, top)).roofCut = cut;
      // Aussparung (Dachterrasse): Brüstung bis auf den flachen Teil darin
      for (const r of parts) {
        if (!r.shape?.opening) continue;
        const c = r.shape.opening.reduce((m, p) => [m[0] + p[0] / r.shape.opening.length, m[1] + p[1] / r.shape.opening.length], [0, 0]);
        const inner = parts.find((q) => !q.pitched && pointInPoly(c, q.polygon));
        r.openingFloor = inner ? inner.offset : null;
      }
      floors.push({
        id: `${b.id}/${ROOF_FLOOR}`, building: b.id, name: parts[0].name, buildingName: b.name, roof: true, roofThickness: parts[0].thickness,
        facade: b.facade,
        level: parts[0].level, elevation: parts[0].elevation, ceiling: 2.5, topCeiling: H, buildingTop: (top.elevation || 0),
        rooms: parts.map((r) => ({
          id: r.id, name: `${r.name} ${b.name || ''}`.trim(), polygon: r.shape ? r.shape.ext : r.polygon, floor: r.surface, color: r.color,
          elevation: r.offset, thickness: r.thickness, roof: r.pitched ? r : null, railing: r.pitched ? undefined : r.railing,
        })),
        walls: [], windows: [], doors: [],
      });
    }
  }
  if (model.outdoor?.length) {
    floors.push({
      id: OUTDOOR_FLOOR,
      outdoor: true,
      name: 'Außen',
      level: 0,
      elevation: 0,
      ceiling: 3,
      rooms: model.outdoor.map((z) => ({
        id: z.id, name: z.name, polygon: z.polygon.map((p) => [p[0], p[1]]), floor: z.surface || 'lawn', edge: z.edge, extend: !!z.extend,
        elevation: z.elevation || 0, area: z.ha_area, railing: z.railing,
        follow: followsTerrain(z, terrain),
        heights: followsTerrain(z, terrain) ? null : terrainHeights(z),
      })),
      walls: [],
      windows: [],
      doors: [],
    });
  }
  const house = { name: model.site.name, north_deg: model.site.north_deg || 0, ground: model.site.ground?.surface || 'lawn', floors, terrain };

  const items = [], devices = [];
  for (const o of model.objects || []) {
    if (o.stored) continue; // eingelagert: im Modell (mit Verknüpfungen), aber nicht in der Welt
    const sp = o.space ? spaces.get(o.space) : null;
    // Ohne Bereich (oder unbekannter Bereich): freies Gelände auf Ebene 0
    const floor = sp ? sp.floorKey : OUTDOOR_FLOOR;
    const room = sp ? o.space : OPEN_GROUND;
    // Außenbereiche liegen auf der Außen-Etage (Höhe 0): ihre eigene Höhe kommt zu den Objekthöhen dazu
    // freies Gelände: auf dem Höhenraster, falls vorhanden
    const base = sp?.kind === 'outdoor' ? outdoorHeightAt(sp.room, o.pos, terrain) : sp?.kind === 'roof' ? roofHeightAt(sp.room, o.pos)
      : !sp && terrain && o.pos ? terrain.height(o.pos) : 0;
    // ha: Kopie, die der Editor bearbeitet (writeBack schreibt sie zurück)
    const common = { id: o.id, name: o.name, floor, room, pos: o.pos, rot: o.rot, ...(o.params || {}), src: o, base, ha: o.ha ? structuredClone(o.ha) : undefined, state: o.state };
    if (hasCapability(o.model, 'light')) {
      const l = o.light || {};
      devices.push({
        ...common,
        type: 'light',
        model: o.model,
        params: o.params,
        kind: l.mount || DEFAULT_MOUNT[o.model] || 'ceiling',
        height: l.height ?? 2.2,
        range: l.range ?? 3,
        color: l.color,
        facing: l.facing,
        outdoor: !sp || sp.kind === 'outdoor' || sp.kind === 'roof',
        entity: roleEntities(o, 'power'),
      });
    } else {
      items.push({ ...common, kind: o.model, size: o.size, elevation: o.elevation });
    }
  }
  // Raum -> HA-Bereich (für die Entity-Auswahl)
  const areaMap = {};
  for (const [id, s] of spaces) if (s.room.ha_area) areaMap[id] = s.room.ha_area;
  return { house, items, devices, areaMap, spaces, model };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Bearbeitete Werte eines internen Objekts ins Modell-Objekt zurückschreiben (Lage, Drehung, Höhe, Verknüpfung).
 * @param type 'item' | 'lamp'
 */
export function writeBack(type, e) {
  const o = e?.src;
  if (!o) return;
  // fester Zustand ohne Entity (Animation, z. B. Ventilator dreht sich immer)
  if (e.state) o.state = e.state;
  else delete o.state;
  o.pos = e.pos.map(r3);
  if (e.rot != null && (e.rot !== 0 || o.rot != null)) o.rot = e.rot;
  if (type === 'lamp') o.light = { ...(o.light || {}), height: r3(e.height) };
  if ('ha' in e) {
    const ha = cleanHa(e.ha);
    if (ha) o.ha = structuredClone(ha);
    else delete o.ha;
  } else if (type === 'lamp') setRole(o, 'power', e.entity);
  if (type !== 'lamp' && e.elevation != null) {
    const el = r3(e.elevation);
    if (el !== 0 || o.elevation != null) o.elevation = el;
  }
}

/** Entities einer Rolle setzen (leer -> Rolle entfernen, ha aufräumen) */
export function setRole(o, role, entities) {
  const l = list(entities);
  if (l.length) {
    o.ha ??= {};
    o.ha.entities ??= {};
    o.ha.entities[role] = l.length === 1 ? l[0] : l;
  } else if (o.ha?.entities) {
    delete o.ha.entities[role];
    if (!Object.keys(o.ha.entities).length) delete o.ha.entities;
    if (!Object.keys(o.ha).length) delete o.ha;
  }
}

/** Modell für den Katalog-Abgleich: alle Modellnamen */
export const catalogModels = () => Object.keys(CATALOG);

// Zustände, in denen ein Gerät ruht (alles andere gilt als aktiv: on, playing, cleaning, heating …)
const IDLE_STATES = new Set(['off', 'unavailable', 'unknown', 'idle', 'paused', 'standby', 'closed', 'docked', 'none', '']);

/**
 * Aktivität eines animierten Objekts: aus den Zuständen seiner Entities (aktiv, sobald eine aktiv ist; Tempo aus
 * `percentage`, z. B. Ventilatorstufe, bzw. aus einem Messwert im Verhältnis zu `peak`) oder – ohne Entity – aus dem
 * festen Zustand `state` ('on' | 'off').
 * @param stateObjs  HA-Zustände der verknüpften Entities (leer = keine Entity)
 */
export function activityOf(stateObjs, fixed, { peak = 800 } = {}) {
  if (!stateObjs.length) return { active: fixed === 'on', speed: 1 };
  // Messwerte (z. B. Leistung eines Balkonkraftwerks in W): aktiv ab 1, Tempo im Verhältnis zur Spitzenleistung
  const nums = stateObjs.map((st) => (st && st.state !== '' && Number.isFinite(Number(st.state)) ? Number(st.state) : null));
  if (nums.some((n) => n != null)) {
    const n = Math.max(...nums.filter((x) => x != null));
    return { active: n >= 1, speed: Math.max(0.25, Math.min(1, n / peak)) };
  }
  // closing: Tor geht zu (Ziel geschlossen)
  const on = stateObjs.find((st) => st && !IDLE_STATES.has(String(st.state)) && st.state !== 'closing');
  if (!on) return { active: false, speed: 1 };
  const pct = Number(on.attributes?.percentage);
  return { active: true, speed: Number.isFinite(pct) && pct > 0 ? Math.max(0.25, Math.min(1, pct / 100)) : 1 };
}
