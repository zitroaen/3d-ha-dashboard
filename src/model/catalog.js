// Katalog der Objekt-Modelle (Datenmodell v2, siehe docs/DATA_MODEL.md → Katalog).
// Ohne three.js, damit Werkzeuge (Validierung, Import) ihn in Node nutzen können. Die Geometrie steckt in
// src/models.js (FURNITURE bzw. LAMPS) unter demselben Namen.
//
//   category      furniture | lamp | device   (Anzeige; Leuchten bauen aus LAMPS, alles andere aus FURNITURE)
//   capabilities  light = Lichtquelle (Objekt braucht `light`)
//   size          Standardmaß [B, T, H] bzw. [B, T] (nur Doku)
//   params        erlaubte Schlüssel in objects[].params

export const CATALOG = {
  // --- Möbel
  armchair: { category: 'furniture', size: [0.66, 0.78], params: ['color'] },
  bookshelf: { category: 'furniture', size: [2.0, 0.3, 2.0], params: [] },
  chair: { category: 'furniture', params: ['guitar'] },
  chest_table: { category: 'furniture', size: [0.8, 0.6, 0.48], params: [] },
  curtain: { category: 'furniture', params: ['color'] },
  grand_piano: { category: 'furniture', size: [1.48, 1.6], params: [] },
  hearth: { category: 'furniture', params: [] },
  picture: { category: 'furniture', params: ['frame', 'mat', 'color', 'texture'] },
  radiator: { category: 'furniture', params: [] },
  rug: { category: 'furniture', size: [2.0, 3.0], params: ['color'] },
  sideboard: { category: 'furniture', size: [1.2, 0.45, 0.6], params: [] },
  sofa_u: { category: 'furniture', size: [3.5, 2.4, 0.82], params: ['seat_depth', 'left', 'right', 'color'] },
  speaker: { category: 'furniture', size: [0.22, 0.3, 1.0], params: [] },
  storage_cube: { category: 'furniture', params: [] },
  stove: { category: 'furniture', params: [] },
  toy_storage: { category: 'furniture', params: ['columns'] },
  // --- Geräte
  box: { category: 'device', size: [0.6, 0.6, 0.85], params: ['color'] },
  marker: { category: 'device', size: [0.12], params: ['color'] },
  tv: { category: 'device', size: [1.45, 0.06, 0.84], params: [] },
  // --- Leuchten
  ball: { category: 'lamp', capabilities: ['light'], params: ['radius'] },
  chandelier_candles: { category: 'lamp', capabilities: ['light'], params: ['arms'] },
  chandelier_tulip: { category: 'lamp', capabilities: ['light'], params: ['arms'] },
  disc: { category: 'lamp', capabilities: ['light'], params: [] },
  floor_spots: { category: 'lamp', capabilities: ['light'], params: [] },
  sconce: { category: 'lamp', capabilities: ['light'], params: [] },
  wall_box: { category: 'lamp', capabilities: ['light'], params: [] },
};

export const CATEGORY_LABEL = { furniture: 'Möbel', device: 'Gerät', lamp: 'Leuchte' };

/** Hat das Modell die Fähigkeit (z. B. 'light')? */
export const hasCapability = (model, cap) => !!CATALOG[model]?.capabilities?.includes(cap);

/** Bodenbeläge und Oberflächen (`surface`) */
export const SURFACES = ['parquet', 'parquet_cube', 'tiles', 'concrete', 'lawn', 'paving', 'gravel', 'soil', 'wood', 'water'];

/** Montagearten von Leuchten (`light.mount`) */
export const LIGHT_MOUNTS = ['ceiling', 'pendant', 'floor', 'table', 'wall', 'spot'];

/** Rollen in `ha.entities` */
export const ROLES = ['power', 'info'];

/** Aktionen für tap/double_tap/hold */
export const ACTIONS = ['toggle', 'more-info', 'service', 'navigate', 'none'];

/** Standard-Montage je Leuchtenmodell (wenn `light.mount` fehlt) */
export const DEFAULT_MOUNT = { ball: 'floor', chandelier_candles: 'pendant', chandelier_tulip: 'pendant', disc: 'ceiling', floor_spots: 'floor', sconce: 'wall', wall_box: 'wall' };
