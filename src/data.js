// Lädt die Daten-Schichten zur Laufzeit (nicht ins Bundle eingebaut): Änderungen an house.json,
// furniture.yaml oder devices.yaml brauchen keinen Build – Datei austauschen, Panel neu öffnen.
// Quelle ist derselbe Server wie das Panel (z. B. /local/ha-3d-dashboard/), also keine externen Requests.
import { load as parseYaml } from 'js-yaml';

export const DATA_FILES = { house: 'house.json', furniture: 'furniture.yaml', devices: 'devices.yaml' };

async function fetchText(url) {
  // no-cache: der Browser fragt jedes Mal nach, ob sich die Datei geändert hat (ETag), lädt sie aber nur dann neu
  const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/**
 * Daten-Ordner auflösen: data_url aus panel_custom (absolut wie /local/ha-3d-dashboard/ oder relativ zur Seite),
 * sonst der Ordner des Moduls. Ein fehlender abschließender / wird ergänzt, sonst ginge der letzte Ordnername
 * beim Auflösen der Dateinamen verloren.
 */
export function resolveDataUrl(configured, pageUrl, moduleBase) {
  if (!configured) return new URL(moduleBase);
  const url = new URL(configured, pageUrl);
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

/** Texte der drei Dateien -> Daten (wie sie das Panel braucht) */
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

/**
 * @param baseUrl  Ordner mit den Daten-Dateien (mit abschließendem /)
 * @returns {{ house, devices, items, text: Record<string,string> }}
 * Ist die Datei house.json nicht ladbar (404, Netzwerk), trägt der Fehler `unavailable = true`:
 * Dort zeigt das Panel das eingebaute Demo-Haus. Defekte Daten (Parse-Fehler) bleiben dagegen echte Fehler.
 */
export async function loadData(baseUrl) {
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, file]) => {
      try {
        return [key, await fetchText(new URL(file, baseUrl))];
      } catch (e) {
        if (key === 'house') e.unavailable = true;
        throw e;
      }
    })
  );
  return parseData(Object.fromEntries(entries));
}
