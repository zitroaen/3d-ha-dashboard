// Anbindung an Home Assistant: Lampenzustand aus hass.states lesen, Schalten über hass.callService.
// Eine Leuchte kann mehrere Entities haben (z. B. Stehlampe mit drei Spots); sie gilt als an, wenn
// eine davon an ist, und leuchtet in deren Farbe/Helligkeit (Mittelwert).
import * as THREE from 'three';

/** entity einer Leuchte (power-Entities): String, Liste oder leer -> Liste */
export const entitiesOf = (d) => (d.entity == null ? [] : [].concat(d.entity)).filter(Boolean);

// Domains mit eigenem turn_on/turn_off; alle anderen schaltet homeassistant.turn_on/turn_off
const SWITCHABLE = new Set(['light', 'switch', 'fan', 'cover', 'input_boolean', 'media_player', 'climate', 'humidifier', 'siren', 'automation', 'script']);
// Zustände, die als „an“ gelten (Waschmaschine läuft, Fernseher spielt, Heizung heizt …)
const OFF_STATES = new Set(['off', 'unavailable', 'unknown', 'idle', 'standby', 'closed', 'locked', 'docked', 'not_home', 'none', '']);

/** Ist eine Entity „an“? */
export const isOn = (state) => !!state && !OFF_STATES.has(String(state.state).toLowerCase()) && state.state !== '0';

/** Text für die Zustandsanzeige: Wert mit Einheit (gerundet), sonst übersetzter Zustand */
export function stateText(state) {
  if (!state || state.state === 'unavailable' || state.state === 'unknown') return '–';
  const a = state.attributes || {};
  const n = Number(state.state);
  if (state.state !== '' && Number.isFinite(n)) {
    const v = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
    return `${v.toLocaleString('de-DE')}${a.unit_of_measurement ? ` ${a.unit_of_measurement}` : ''}`;
  }
  const DE = { on: 'An', off: 'Aus', open: 'Offen', closed: 'Zu', opening: 'Öffnet', closing: 'Schließt', playing: 'Spielt', paused: 'Pause', idle: 'Bereit',
    standby: 'Standby', cleaning: 'Saugt', docked: 'Station', returning: 'Zurück', heating: 'Heizt', home: 'Zuhause', not_home: 'Weg' };
  return DE[state.state] ?? state.state;
}

/** Farbtemperatur (Kelvin) -> sRGB 0..1 (Näherung nach Tanner Helland) */
export function kelvinToRgb(k) {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.min(255, Math.max(0, v)) / 255;
  return [c(r), c(g), c(b)];
}

/** Licht einer Entity: { on, color: THREE.Color | null, brightness 0..1 } oder null, wenn unbekannt */
export function entityLight(state) {
  if (!state) return null;
  const on = state.state === 'on';
  const a = state.attributes || {};
  let color = null;
  if (on) {
    if (Array.isArray(a.rgb_color)) color = new THREE.Color().setRGB(a.rgb_color[0] / 255, a.rgb_color[1] / 255, a.rgb_color[2] / 255, THREE.SRGBColorSpace);
    else if (a.color_temp_kelvin) color = new THREE.Color().setRGB(...kelvinToRgb(a.color_temp_kelvin), THREE.SRGBColorSpace);
    else if (a.color_temp) color = new THREE.Color().setRGB(...kelvinToRgb(1e6 / a.color_temp), THREE.SRGBColorSpace);
  }
  // Helligkeit: HA 0..255; nicht dimmbare Lampen/Steckdosen = voll
  const brightness = on ? (a.brightness != null ? Math.max(0.08, a.brightness / 255) : 1) : 0;
  return { on, color, brightness, unavailable: state.state === 'unavailable' };
}

/** Zusammengefasster Zustand einer Leuchte aus ihren Entities */
export function lampLight(entityIds, states) {
  const parts = entityIds.map((e) => entityLight(states[e])).filter(Boolean);
  if (!parts.length) return null;
  const lit = parts.filter((p) => p.on);
  if (!lit.length) return { on: false, brightness: 1, color: null, unavailable: parts.every((p) => p.unavailable) };
  const colored = lit.filter((p) => p.color);
  let color = null;
  if (colored.length) {
    color = new THREE.Color(0, 0, 0);
    for (const p of colored) color.add(p.color);
    color.multiplyScalar(1 / colored.length);
  }
  // mehrere Birnen: Helligkeit anteilig (2 von 3 Spots an -> 2/3)
  const brightness = lit.reduce((s, p) => s + p.brightness, 0) / parts.length;
  return { on: true, color, brightness };
}

/**
 * Dienstaufrufe nach Domain gruppieren (light.turn_on mit allen Lichtern, switch.turn_on mit allen Schaltern);
 * Domains ohne eigenes turn_on/turn_off über homeassistant.turn_on/turn_off.
 */
export async function callForEntities(hass, service, entityIds) {
  const byDomain = new Map();
  for (const e of entityIds) {
    let d = e.split('.')[0];
    if (['sensor', 'binary_sensor', 'weather', 'sun', 'zone', 'person'].includes(d)) continue; // nicht schaltbar
    if (!SWITCHABLE.has(d)) d = 'homeassistant';
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(e);
  }
  // Tore, Rollläden: öffnen/schließen statt an/aus
  const svc = (domain) => (domain === 'cover' ? { turn_on: 'open_cover', turn_off: 'close_cover' }[service] || service : service);
  await Promise.all([...byDomain].map(([domain, ids]) => hass.callService(domain, svc(domain), { entity_id: ids })));
}
