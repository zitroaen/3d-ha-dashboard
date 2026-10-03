// Speichern von Editor-Änderungen (Position, Drehung, Höhe von Möbeln und Leuchten).
//
// - Entwicklung (panel config `save_url`, z. B. der lokale Dev-Server): schreibt furniture.yaml/devices.yaml
//   direkt. Nur die geänderten Werte werden im Text ersetzt – Kommentare und Formatierung bleiben.
// - In Home Assistant kann das Panel keine Dateien schreiben. Änderungen landen als "Layout-Overrides" in den
//   HA-Benutzerdaten (frontend/set_user_data) und werden beim Laden über die Dateien gelegt. Über "Export"
//   gibt es die fertigen YAML-Dateien zum Übernehmen ins Repo.
// - Demo-Haus: eigene Benutzerdaten (DEMO_USER_DATA_KEY), damit Änderungen am Demo-Haus nie die eigenen Daten berühren.

export const USER_DATA_KEY = 'ha_3d_dashboard_layout';
export const DEMO_USER_DATA_KEY = 'ha_3d_dashboard_layout_demo';

const num = (v) => String(Math.round(v * 1000) / 1000);
const arr = (a) => `[${a.map(num).join(', ')}]`;

/** Werte eines Eintrags im YAML-Text ersetzen (Flow-Zeile `- { id: x, ... }` oder Block `- id: x`). */
export function patchYamlText(text, id, values) {
  // Zeilenende der Datei beibehalten (unter Windows oft CRLF; "." passt in JS-Regex nicht auf "\r")
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const idRe = new RegExp(`(^|[{,\\s])id:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*([,}]|$)`);
  const start = lines.findIndex((l) => idRe.test(l));
  if (start < 0) throw new Error(`Eintrag ${id} nicht gefunden`);
  const set = (key, val) =>
    key === 'pos' ? arr(val)
      : key === 'entity' ? (val == null ? 'null' : Array.isArray(val) ? `[${val.join(', ')}]` : val)
      : num(val);

  if (lines[start].includes('{')) {
    // Flow-Stil: alles in einer Zeile
    let l = lines[start];
    for (const [k, v] of Object.entries(values)) {
      const re = new RegExp(`(\\b${k}:\\s*)(\\[[^\\]]*\\]|[^,}\\s]+)`); // Leerzeichen vor "}" bleibt stehen
      l = re.test(l) ? l.replace(re, `$1${set(k, v)}`) : l.replace(/\s*}\s*$/, `, ${k}: ${set(k, v)} }`);
    }
    lines[start] = l;
  } else {
    // Block-Stil: Zeilen bis zum nächsten Eintrag
    const indent = lines[start].match(/^(\s*)-/)[1] + '  ';
    let end = start + 1;
    while (end < lines.length && lines[end].startsWith(indent)) end++;
    for (const [k, v] of Object.entries(values)) {
      const i = lines.slice(start, end).findIndex((l) => new RegExp(`^\\s*-?\\s*${k}:`).test(l));
      if (i >= 0) lines[start + i] = lines[start + i].replace(new RegExp(`(${k}:\\s*).*$`), `$1${set(k, v)}`);
      else {
        lines.splice(end, 0, `${indent}${k}: ${set(k, v)}`);
        end++;
      }
    }
  }
  return lines.join(eol);
}

/** Bearbeitbare Werte eines Eintrags. */
export function layoutValues(type, e) {
  const v = { pos: e.pos };
  if (e.rot != null || type === 'item') v.rot = e.rot || 0;
  if (type === 'lamp') {
    v.height = e.height;
    v.entity = e.entity ?? null; // HA-Verknüpfung (String, Liste oder null)
  } else if (e.elevation != null) v.elevation = e.elevation;
  return v;
}

/** Overrides auf geladene Daten anwenden (HA-Betrieb). */
export function applyOverrides(data, overrides) {
  if (!overrides) return data;
  for (const it of data.items) Object.assign(it, overrides.items?.[it.id] || {});
  for (const d of data.devices) Object.assign(d, overrides.devices?.[d.id] || {});
  return data;
}

export class LayoutStore {
  /**
   * @param saveUrl  Dev-Server-Endpunkt (z. B. "/__save/"), sonst null
   * @param hass     HA-Objekt (callWS) für Overrides
   * @param key      Schlüssel der Benutzerdaten (Demo-Haus: DEMO_USER_DATA_KEY)
   */
  constructor({ saveUrl = null, hass = null, key = USER_DATA_KEY } = {}) {
    this.saveUrl = saveUrl;
    this.hass = hass;
    this.key = key;
  }

  get mode() {
    return this.saveUrl ? 'files' : 'ha';
  }

  async loadOverrides() {
    if (this.saveUrl || !this.hass?.callWS) return null;
    try {
      const res = await this.hass.callWS({ type: 'frontend/get_user_data', key: this.key });
      return res?.value || null;
    } catch (e) {
      console.warn('ha-3d-dashboard: Layout-Overrides nicht lesbar', e);
      return null;
    }
  }

  /**
   * @param changes  Map refKey -> { type, id, values }
   * @param texts    { furniture, devices } – aktuelle Dateitexte
   * @returns neue Texte
   */
  async save(changes, texts) {
    const out = { ...texts };
    for (const { type, id, values } of changes.values()) {
      const file = type === 'lamp' ? 'devices' : 'furniture';
      out[file] = patchYamlText(out[file], id, values);
    }
    if (this.saveUrl) {
      for (const [key, file] of [['furniture', 'furniture.yaml'], ['devices', 'devices.yaml']]) {
        if (out[key] === texts[key]) continue;
        const res = await fetch(new URL(file, new URL(this.saveUrl, location.href)), { method: 'POST', body: out[key] });
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
      }
    } else {
      if (!this.hass?.callWS) throw new Error('Kein Home Assistant verbunden');
      const prev = (await this.loadOverrides()) || { items: {}, devices: {} };
      for (const { type, id, values } of changes.values()) {
        const bucket = type === 'lamp' ? 'devices' : 'items';
        (prev[bucket] ??= {})[id] = values;
      }
      await this.hass.callWS({ type: 'frontend/set_user_data', key: this.key, value: prev });
    }
    return out;
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
