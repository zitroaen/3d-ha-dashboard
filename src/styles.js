// Fenster- und Türarten als Daten: Beispiele in library/openings.yaml, eigene bzw. geänderte in model.yaml
// (`window_styles`, `door_styles`), Auswahl je Öffnung (`style`) oder je Gebäude (`buildings[].styles`).
// Die Engine baut daraus Rahmen, Flügel, Sprossen, Zarge und Türblatt (src/openings.js). Format: docs/LIBRARY.md.

function section() {
  let lib = {}, own = {};
  const raw = (id) => (lib[id] || own[id] ? { ...(lib[id] || {}), ...(own[id] || {}) } : null);
  const def = (id, depth = 0) => {
    const d = raw(id);
    if (!d || !d.base || depth > 8) return d;
    const { base, ...rest } = d;
    return { ...(def(base, depth + 1) || {}), ...rest };
  };
  return {
    set(l, o) {
      if (l) lib = l;
      own = o || {};
    },
    def,
    has: (id) => typeof id === 'string' && (id in lib || id in own),
    ids: () => [...new Set([...Object.keys(lib), ...Object.keys(own)])],
  };
}

export const WINDOW_STYLES = section();
export const DOOR_STYLES = section();

/** Bibliothek ({ windows, doors }) und Einträge der Instanz setzen */
export function setStyleDefs(library, model) {
  WINDOW_STYLES.set(library?.windows, model?.window_styles);
  DOOR_STYLES.set(library?.doors, model?.door_styles);
}

/** Werte, die jede Fensterart hat (Meter); Farben null = Standardmaterial (weißer Kunststoff, Holz-Fensterbank) */
const WINDOW_BASE = { frame: 0.065, depth: 0.075, sash: 0.055, offset: 0.15, color: null, sash_color: null, board: null, bars: null, bar: 0.022, fixed: false };
const DOOR_BASE = { leaf: 'panel', panels: 1, color: null, frame_color: null, handle: null, bars: null, bar: 0.022 };

/** Fensterart eines Fensters: style am Fenster, sonst Gebäude-Standard, sonst `standard` */
export function windowStyle(win, styles) {
  const id = win.style || styles?.window || 'standard';
  return { ...WINDOW_BASE, ...(WINDOW_STYLES.def('standard') || {}), ...(WINDOW_STYLES.def(id) || {}), id };
}

/** Türart: style an der Tür, sonst Gebäude-Standard je Art (innen, Terrassen-/Glastür, Haustür) */
export function doorStyle(d, styles) {
  const ext = d.type === 'exterior';
  const solid = d.leaf === 'solid';
  const fallback = ext ? (solid ? 'front' : 'patio') : 'interior';
  const id = d.style || (ext ? (solid ? styles?.front_door : styles?.exterior_door) : styles?.door) || fallback;
  const st = { ...DOOR_BASE, ...(DOOR_STYLES.def(fallback) || {}), ...(DOOR_STYLES.def(id) || {}), id };
  // Außentür bleibt Außentür (Rahmen in der Wand statt Zarge); `kind` der Art kann das ändern
  st.kind = st.kind || (ext ? 'exterior' : 'interior');
  return st;
}
