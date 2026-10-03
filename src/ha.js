// Anbindung an Home Assistant: Lampenzustand aus hass.states lesen, Schalten über hass.callService.
// Eine Leuchte kann mehrere Entities haben (z. B. Stehlampe mit drei Spots); sie gilt als an, wenn
// eine davon an ist, und leuchtet in deren Farbe/Helligkeit (Mittelwert).
import * as THREE from 'three';

/** entity einer Leuchte (power-Entities): String, Liste oder leer -> Liste */
export const entitiesOf = (d) => (d.entity == null ? [] : [].concat(d.entity)).filter(Boolean);

const SWITCHABLE = new Set(['light', 'switch']);

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

/** Dienstaufrufe nach Domain gruppieren (light.turn_on mit allen Lichtern, switch.turn_on mit allen Schaltern) */
export async function callForEntities(hass, service, entityIds) {
  const byDomain = new Map();
  for (const e of entityIds) {
    const d = e.split('.')[0];
    if (!SWITCHABLE.has(d)) continue;
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(e);
  }
  await Promise.all([...byDomain].map(([domain, ids]) => hass.callService(domain, service, { entity_id: ids })));
}
