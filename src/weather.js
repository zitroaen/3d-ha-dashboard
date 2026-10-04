// Wetter aus Home Assistant (weather.*): Zustand -> Stärke von Bewölkung, Regen, Schnee und Nebel für die Szene,
// dazu Symbol und Text für die Anzeige oben. Kein Rendern pro Bild – nur bei Wetterwechsel.

/** Wetterlagen: Darstellung in der Szene (0..1) */
export const WEATHER_PRESETS = {
  clear: { cloud: 0.05, rain: 0, snow: 0, fog: 0 },
  partly: { cloud: 0.45, rain: 0, snow: 0, fog: 0 },
  cloudy: { cloud: 0.9, rain: 0, snow: 0, fog: 0 },
  rain: { cloud: 0.9, rain: 0.7, snow: 0, fog: 0.15 },
  storm: { cloud: 1, rain: 1, snow: 0, fog: 0.25 },
  snow: { cloud: 0.85, rain: 0, snow: 1, fog: 0.2 },
  fog: { cloud: 0.7, rain: 0, snow: 0, fog: 1 },
};

const LABEL = { clear: 'Klar', partly: 'Teils bewölkt', cloudy: 'Bewölkt', rain: 'Regen', storm: 'Gewitter', snow: 'Schnee', fog: 'Nebel' };

// HA-Zustände (weather-Entity) -> Wetterlage
const KIND = {
  sunny: 'clear', 'clear-night': 'clear', windy: 'partly', 'windy-variant': 'cloudy', partlycloudy: 'partly',
  cloudy: 'cloudy', exceptional: 'cloudy', fog: 'fog', rainy: 'rain', pouring: 'storm', 'lightning-rainy': 'storm',
  lightning: 'storm', hail: 'storm', snowy: 'snow', 'snowy-rainy': 'snow',
};

export const weatherKind = (state) => KIND[state?.state] || null;
export const weatherLabel = (kind) => LABEL[kind] || '';

/** Szenen-Wetter aus einem weather-Zustand (Bewölkungsgrad aus cloud_coverage, wenn vorhanden) */
export function weatherParams(state) {
  const kind = weatherKind(state);
  if (!kind) return null;
  const p = { ...WEATHER_PRESETS[kind] };
  const cc = Number(state.attributes?.cloud_coverage);
  if (Number.isFinite(cc)) p.cloud = Math.max(p.rain || p.snow ? 0.8 : 0, Math.min(1, cc / 100));
  // Schneeregen: halb Schnee, halb nass
  if (state.state === 'snowy-rainy') Object.assign(p, { snow: 0.5, rain: 0.4 });
  return p;
}

/**
 * Wetter-Entity: im Modell festgelegt (site.weather) oder die übliche der Wetter-Integration, sonst die erste.
 */
export function pickWeatherEntity(states = {}, preferred) {
  if (preferred && states[preferred]) return preferred;
  const ids = Object.keys(states).filter((e) => e.startsWith('weather.')).sort();
  return ['weather.home', 'weather.forecast_home'].find((e) => ids.includes(e)) || ids[0] || null;
}

/** Temperatur als Text (mit Einheit der Entity) */
export function temperatureText(state) {
  const t = Number(state?.attributes?.temperature);
  if (!Number.isFinite(t)) return '';
  const unit = state.attributes.temperature_unit || '°C';
  return `${Math.round(t)} ${unit}`;
}

// Einfache Symbole (24×24), passend zur Wetterlage
const SUN = '<circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g>';
const CLOUD = (y = 0) => `<path transform="translate(0 ${y})" fill="currentColor" d="M7 18h10.5a3.8 3.8 0 0 0 .4-7.6A5.6 5.6 0 0 0 7.3 9.3 4.4 4.4 0 0 0 7 18z"/>`;
const MOON = '<path fill="currentColor" d="M14.5 3.2a8.6 8.6 0 1 0 6.3 13.6A7.3 7.3 0 0 1 14.5 3.2z"/>';
const ICONS = {
  clear: SUN,
  'clear-night': MOON,
  partly: `<g transform="translate(-3 -3) scale(.8)">${SUN}</g>${CLOUD(2)}`,
  cloudy: CLOUD(0),
  rain: `${CLOUD(-3)}<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></g>`,
  storm: `${CLOUD(-3)}<path fill="currentColor" d="M12.5 15.5h-2.6l-1.4 4h2l-.9 3.5 4-5h-2.2z"/>`,
  snow: `${CLOUD(-3)}<g fill="currentColor"><circle cx="8" cy="19" r="1.1"/><circle cx="12" cy="21" r="1.1"/><circle cx="16" cy="19" r="1.1"/></g>`,
  fog: '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8h16M3 12h18M5 16h14M7 20h10"/></g>',
};

/** Symbol; nachts bei klarem Himmel der Mond */
export const weatherIcon = (kind, night = false) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${ICONS[kind === 'clear' && night ? 'clear-night' : kind] || ICONS.cloudy}</svg>`;
