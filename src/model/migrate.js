// Versionen des Datenmodells (siehe docs/DATA_MODEL.md → Versionen und Migration).
// Jede inkompatible Formatänderung erhöht MODEL_VERSION und bekommt hier eine Migration MIGRATIONS[n]: Dokument der
// Version n-1 -> Version n. Beim Laden werden alle nötigen Migrationen nacheinander angewendet.

export const MODEL_VERSION = 2;

/** Ältere Versionen, die nicht mehr migriert werden (Format zu verschieden). */
const UNSUPPORTED_BELOW = 2;

/**
 * MIGRATIONS[n] = (doc) => doc in Version n. Darf das übergebene Dokument verändern.
 * Beispiel für eine künftige Version 3:
 *   3: (doc) => { for (const o of doc.objects) { o.foo = o.bar; delete o.bar; } return doc; },
 */
export const MIGRATIONS = {};

export class ModelVersionError extends Error {}

/**
 * Dokument auf die aktuelle Version bringen.
 * @returns {{ doc, from: number, migrated: boolean }}
 */
export function migrate(doc, migrations = MIGRATIONS, target = MODEL_VERSION) {
  if (!doc || typeof doc !== 'object') throw new ModelVersionError('Modell ist leer oder kein Objekt');
  if (doc.schema !== 'ha3d') {
    // Version 1 bestand aus house.json/furniture.yaml/devices.yaml und hatte keinen Kopf
    throw new ModelVersionError('Kein 3D-Dashboard-Modell (schema: ha3d fehlt) – Format siehe docs/DATA_MODEL.md');
  }
  const from = doc.version;
  if (!Number.isInteger(from)) throw new ModelVersionError('version fehlt oder ist keine ganze Zahl');
  if (from > target) throw new ModelVersionError(`Modell hat Version ${from}, diese Engine kennt nur bis ${target} – Engine aktualisieren`);
  if (from < UNSUPPORTED_BELOW) throw new ModelVersionError(`Version ${from} wird nicht mehr unterstützt – Modell neu erstellen (docs/DATA_MODEL.md)`);
  let out = doc;
  for (let v = from + 1; v <= target; v++) {
    const step = migrations[v];
    if (!step) throw new ModelVersionError(`Migration auf Version ${v} fehlt`);
    out = step(out);
    out.version = v;
  }
  return { doc: out, from, migrated: from !== target };
}
