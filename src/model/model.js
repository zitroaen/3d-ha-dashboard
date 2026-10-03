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
  for (const z of model.outdoor || []) {
    out.set(z.id, { kind: 'outdoor', floorKey: OUTDOOR_FLOOR, room: z, base: z.elevation || 0, height: 3 });
  }
  return out;
}

export const floorKey = (b, f) => `${b.id}/${f.id}`;

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
  const floors = [];
  for (const b of model.buildings || []) {
    for (const f of b.floors) {
      floors.push({
        id: floorKey(b, f),
        building: b.id,
        name: f.name,
        buildingName: b.name,
        level: f.level,
        elevation: f.elevation || 0,
        ceiling: f.height,
        ha_floor: f.ha_floor,
        rooms: f.rooms.map((r) => ({
          id: r.id, name: r.name, polygon: r.polygon, floor: r.surface || 'parquet', floor_rot: r.surface_rot, ceiling: r.height, area: r.ha_area,
        })),
        walls: f.walls.map((w) => w.polygon),
        windows: f.windows || [],
        doors: f.doors || [],
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
      rooms: model.outdoor.map((z) => ({ id: z.id, name: z.name, polygon: z.polygon, floor: z.surface || 'lawn', elevation: z.elevation || 0, area: z.ha_area })),
      walls: [],
      windows: [],
      doors: [],
    });
  }
  const house = { name: model.site.name, north_deg: model.site.north_deg || 0, ground: model.site.ground?.surface || 'lawn', floors };

  const items = [], devices = [];
  for (const o of model.objects || []) {
    const sp = o.space ? spaces.get(o.space) : null;
    // Ohne Bereich (oder unbekannter Bereich): freies Gelände auf Ebene 0
    const floor = sp ? sp.floorKey : OUTDOOR_FLOOR;
    const room = sp ? o.space : OPEN_GROUND;
    // Außenbereiche liegen auf der Außen-Etage (Höhe 0): ihre eigene Höhe kommt zu den Objekthöhen dazu
    const base = sp?.kind === 'outdoor' ? sp.base : 0;
    // ha: Kopie, die der Editor bearbeitet (writeBack schreibt sie zurück)
    const common = { id: o.id, name: o.name, floor, room, pos: o.pos, rot: o.rot, ...(o.params || {}), src: o, base, ha: o.ha ? structuredClone(o.ha) : undefined };
    if (hasCapability(o.model, 'light')) {
      const l = o.light || {};
      devices.push({
        ...common,
        type: 'light',
        model: o.model,
        kind: l.mount || DEFAULT_MOUNT[o.model] || 'ceiling',
        height: l.height ?? 2.2,
        range: l.range ?? 3,
        color: l.color,
        facing: l.facing,
        outdoor: !sp || sp.kind === 'outdoor',
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
  const o = e.src;
  if (!o) return;
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
