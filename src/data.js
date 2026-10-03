// Lädt die Daten-Schichten zur Laufzeit (nicht ins Bundle eingebaut): Änderungen an house.json,
// furniture.yaml oder devices.yaml brauchen keinen Build – Datei austauschen, Panel neu öffnen.
// Quelle ist derselbe Server wie das Panel (z. B. /local/ha-3d-dashboard/), also keine externen Requests.
import { load as parseYaml } from 'js-yaml';

export const DATA_FILES = { house: 'house.json', furniture: 'furniture.yaml', devices: 'devices.yaml' };

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
 * @param baseUrl  Ordner mit den Daten-Dateien (mit abschließendem /)
 * @returns {{ house, devices, items, text: Record<string,string> }}
 */
export async function loadData(baseUrl) {
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, file]) => [key, await fetchText(new URL(file, baseUrl))])
  );
  return parseData(Object.fromEntries(entries));
}

/** Rohtexte (house.json, furniture.yaml, devices.yaml) in Daten umwandeln */
export function parseData(text) {
  const yaml = (t, file) => {
    try {
      return (t.trim() && parseYaml(t)) || {};
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
  };
  let house;
  try {
    house = JSON.parse(text.house);
  } catch (e) {
    throw new Error(`${DATA_FILES.house}: ${e.message}`);
  }
  const devicesDoc = yaml(text.devices, DATA_FILES.devices);
  return {
    house,
    devices: devicesDoc.devices || [],
    // Raum -> HA-Bereich, wo der Name nicht passt: { "eg/bad": "bad_eg" } (area_id)
    areaMap: devicesDoc.areas || {},
    items: yaml(text.furniture, DATA_FILES.furniture).items || [],
    text,
  };
}
