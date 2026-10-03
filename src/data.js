// Lädt das Modell (docs/DATA_MODEL.md) zur Laufzeit – nicht ins Bundle eingebaut: Änderungen an model.yaml brauchen
// keinen Build, Panel neu öffnen genügt. Quelle ist derselbe Server wie das Panel (z. B. /local/ha-3d-dashboard/),
// also keine externen Requests.
import { parseModel, modelFromObject } from './model/model.js';
import { MODEL_FILE, SHARED_WS } from './store.js';

/** Daten nicht abrufbar (HTTP-Fehler wie 404, Netzwerk) – im Gegensatz zu kaputtem Inhalt */
export class DataUnavailableError extends Error {}

async function fetchText(url) {
  // no-cache: der Browser fragt jedes Mal nach, ob sich die Datei geändert hat (ETag), lädt sie aber nur dann neu
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
  } catch (e) {
    throw new DataUnavailableError(`${url}: ${e.message}`);
  }
  if (!res.ok) throw new DataUnavailableError(`${url}: HTTP ${res.status}`);
  return res.text();
}

/**
 * @param baseUrl  Ordner mit model.yaml (mit abschließendem /)
 * @returns {{ model, text }}
 */
export async function loadData(baseUrl) {
  return parseData(await fetchText(new URL(MODEL_FILE, baseUrl)));
}

/** Prüfwert eines Dateiinhalts (FNV-1a, 32 Bit, plus Länge) – erkennt eine ersetzte model.yaml */
export function textHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16).padStart(8, '0')}-${text.length}`;
}

/**
 * Gemeinsames Modell der Integration (für alle Benutzer gleich, custom_components/ha_3d_dashboard/storage.py).
 * Quelle ist das gespeicherte Modell – außer im Datenordner liegt eine andere model.yaml als die, aus der es
 * hervorging (Import: neuere Datei gewinnt). Ohne beides: DataUnavailableError (-> Demo-Haus).
 * @returns {{ model, text, source: 'shared'|'file', revision, fileHash }}
 */
export async function loadShared(hass, baseUrl) {
  const stored = await hass.callWS({ type: `${SHARED_WS}/get` });
  let text = null;
  try {
    text = await fetchText(new URL(MODEL_FILE, baseUrl));
  } catch (e) {
    if (!(e instanceof DataUnavailableError)) throw e;
    if (!stored?.model) throw e;
  }
  const fileHash = text == null ? null : textHash(text);
  const meta = { revision: stored?.revision ?? 0, fileHash };
  if (stored?.model && (text == null || fileHash === stored.file_hash)) {
    return { model: modelFromObject(stored.model), text: stored.header || '', source: 'shared', ...meta };
  }
  return { ...parseData(text), source: 'file', ...meta };
}

/** Text von model.yaml -> { model (aktuelle Version), text } */
export function parseData(text) {
  return { model: parseModel(text, MODEL_FILE), text };
}
