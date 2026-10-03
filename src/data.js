// Lädt das Modell (docs/DATA_MODEL.md) zur Laufzeit – nicht ins Bundle eingebaut: Änderungen an model.yaml brauchen
// keinen Build, Panel neu öffnen genügt. Quelle ist derselbe Server wie das Panel (z. B. /local/ha-3d-dashboard/),
// also keine externen Requests.
import { parseModel } from './model/model.js';
import { MODEL_FILE } from './store.js';

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

/** Text von model.yaml -> { model (aktuelle Version), text } */
export function parseData(text) {
  return { model: parseModel(text, MODEL_FILE), text };
}
