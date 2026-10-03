// Speichern von Editor-Änderungen. Gespeichert wird das Modell (docs/DATA_MODEL.md), nicht einzelne Werte.
//
// - Entwicklung (panel config `save_url`, z. B. der lokale Dev-Server): schreibt model.yaml in den Datenordner
//   (der Kopfkommentar der Datei bleibt erhalten).
// - Mit der Integration (panel config `shared`): das ganze Modell im gemeinsamen Speicher der Integration, für alle
//   Benutzer gleich (nur Administratoren speichern). "Export" liefert model.yaml.
// - Ohne Integration (panel_custom von Hand): geänderte Objekte landen als "Overrides" in den HA-Benutzerdaten
//   (frontend/set_user_data) und werden beim Laden über das Modell gelegt.
// - Demo-Haus: eigene Benutzerdaten (DEMO_USER_DATA_KEY), damit Änderungen am Demo-Haus nie die eigenen Daten berühren.
import { toYaml } from './model/yaml.js';

export const USER_DATA_KEY = 'ha_3d_dashboard_layout';
export const DEMO_USER_DATA_KEY = 'ha_3d_dashboard_layout_demo';
export const MODEL_FILE = 'model.yaml';
/** WebSocket-Befehle des gemeinsamen Speichers der Integration (…/get, …/save, …/subscribe) */
export const SHARED_WS = 'ha_3d_dashboard/model';

/** Bearbeitbare Werte eines internen Objekts (Editor: Rückgängig, Anzeige). */
export function layoutValues(type, e) {
  const v = { pos: e.pos };
  if (e.rot != null || type === 'item') v.rot = e.rot || 0;
  if (type === 'lamp') {
    v.height = e.height;
    v.entity = e.entity ?? null; // power-Entities (Liste), für das Licht
  } else if (e.elevation != null) v.elevation = e.elevation;
  v.ha = e.ha ? structuredClone(e.ha) : undefined; // HA-Verknüpfung und Gesten
  return v;
}

/** Was ein Override eines Objekts überschreibt (alles, was der Editor ändern kann) */
const OVERRIDE_KEYS = ['pos', 'rot', 'elevation', 'light', 'ha'];

/** Override eines Modell-Objekts (für die Benutzerdaten) */
export function objectOverride(o) {
  const out = {};
  for (const k of OVERRIDE_KEYS) out[k] = o[k] === undefined ? null : structuredClone(o[k]);
  return out;
}

/** Overrides auf ein Modell anwenden (null = Feld entfernen). */
export function applyOverrides(model, overrides) {
  const ov = overrides?.objects;
  if (!ov) return model;
  for (const o of model.objects || []) {
    const v = ov[o.id];
    if (!v) continue;
    for (const [k, x] of Object.entries(v)) {
      if (x === null) delete o[k];
      else o[k] = structuredClone(x);
    }
  }
  return model;
}

export class LayoutStore {
  /**
   * @param saveUrl  Dev-Server-Endpunkt (z. B. "/__save/"), sonst null
   * @param hass     HA-Objekt (callWS) für Overrides
   * @param key      Schlüssel der Benutzerdaten (Demo-Haus: DEMO_USER_DATA_KEY)
   * @param shared   gemeinsamer Speicher der Integration: { revision, fileHash } (wird beim Speichern fortgeschrieben)
   */
  constructor({ saveUrl = null, hass = null, key = USER_DATA_KEY, shared = null } = {}) {
    this.saveUrl = saveUrl;
    this.hass = hass;
    this.key = key;
    this.shared = shared;
  }

  get mode() {
    return this.saveUrl ? 'files' : this.shared ? 'shared' : 'ha';
  }

  async loadOverrides() {
    if (this.saveUrl || this.shared || !this.hass?.callWS) return null;
    try {
      const res = await this.hass.callWS({ type: 'frontend/get_user_data', key: this.key });
      return res?.value || null;
    } catch (e) {
      console.warn('ha-3d-dashboard: Layout-Overrides nicht lesbar', e);
      return null;
    }
  }

  /**
   * @param model    Modell (bereits mit den Änderungen)
   * @param ids      IDs der geänderten Objekte
   * @param header   Kopfkommentar für model.yaml
   * @returns model.yaml-Text
   */
  async save(model, ids, header = '') {
    const text = toYaml(model, header);
    if (this.saveUrl) {
      const res = await fetch(new URL(MODEL_FILE, new URL(this.saveUrl, location.href)), { method: 'POST', body: text });
      if (!res.ok) throw new Error(`${MODEL_FILE}: HTTP ${res.status}`);
    } else if (this.shared) {
      if (!this.hass?.callWS) throw new Error('Kein Home Assistant verbunden');
      const res = await this.hass.callWS({
        type: `${SHARED_WS}/save`, model, header, file_hash: this.shared.fileHash, revision: this.shared.revision,
      });
      this.shared.revision = res.revision;
    } else {
      if (!this.hass?.callWS) throw new Error('Kein Home Assistant verbunden');
      const prev = (await this.loadOverrides()) || {};
      prev.objects ??= {};
      for (const o of model.objects || []) if (ids.includes(o.id)) prev.objects[o.id] = objectOverride(o);
      await this.hass.callWS({ type: 'frontend/set_user_data', key: this.key, value: prev });
    }
    return text;
  }

  async resetOverrides() {
    if (this.hass?.callWS) await this.hass.callWS({ type: 'frontend/set_user_data', key: this.key, value: null });
  }
}

/** Datei im Browser zum Speichern anbieten. */
export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
