// Katalog der Objekt-Modelle (Datenmodell v2, siehe docs/DATA_MODEL.md → Katalog).
// Ohne three.js, damit Werkzeuge (Validierung, Import) ihn in Node nutzen können. Die Geometrie steckt in
// src/models.js (FURNITURE bzw. LAMPS) unter demselben Namen.
//
//   category      furniture | lamp | device | plant   (Anzeige; Leuchten bauen aus LAMPS, alles andere aus FURNITURE)
//   capabilities  light = Lichtquelle (Objekt braucht `light`)
//   size          Standardmaß [B, T, H] bzw. [B, T] (nur Doku)
//   params        erlaubte Schlüssel in objects[].params
//   label         Name im Katalog des Editors
//   anim          Animation, solange das Objekt aktiv ist (Entity an bzw. `state: on`): spin = dreht sich,
//                 swing = schwenkt auf (Tor), sectional = Sektionaltor
//                 fährt hoch, flow = Energiefluss im Kabel

export const CATALOG = {
  // --- Möbel
  armchair: { label: 'Sessel', category: 'furniture', size: [0.66, 0.78], params: ['color'] },
  bookshelf: { label: 'Bücherregal', category: 'furniture', size: [2.0, 0.3, 2.0], params: [] },
  chair: { label: 'Stuhl', category: 'furniture', params: ['guitar'] },
  chest_table: { label: 'Truhentisch', category: 'furniture', size: [0.8, 0.6, 0.48], params: [] },
  curtain: { label: 'Vorhang', category: 'furniture', params: ['color'] },
  grand_piano: { label: 'Flügel', category: 'furniture', size: [1.48, 1.6], params: [] },
  hearth: { label: 'Kaminfeuer', category: 'furniture', params: [] },
  picture: { label: 'Bild', category: 'furniture', params: ['frame', 'mat', 'color', 'texture'] },
  radiator: { label: 'Heizkörper', category: 'furniture', params: [] },
  rug: { label: 'Teppich', category: 'furniture', size: [2.0, 3.0], params: ['color'] },
  sideboard: { label: 'Sideboard', category: 'furniture', size: [1.2, 0.45, 0.6], params: [] },
  sofa_u: { label: 'Wohnlandschaft', category: 'furniture', size: [3.5, 2.4, 0.82], params: ['seat_depth', 'left', 'right', 'color'] },
  speaker: { label: 'Standlautsprecher', category: 'furniture', size: [0.22, 0.3, 1.0], params: [] },
  storage_cube: { label: 'Würfelregal', category: 'furniture', params: [] },
  stove: { label: 'Kaminofen', category: 'furniture', params: [] },
  toy_storage: { label: 'Spielzeugregal', category: 'furniture', params: ['columns'] },
  // --- Garten- und Terrassenmöbel
  barrel: { label: 'Regentonne', category: 'furniture', size: [0.6, 0.6, 0.9], params: ['color'] },
  bench: { label: 'Gartenbank', category: 'furniture', size: [1.6, 0.62, 0.85], params: ['color'] },
  garden_chair: { label: 'Gartenstuhl', category: 'furniture', params: ['color'] },
  garden_table: { label: 'Gartentisch', category: 'furniture', size: [1.6, 0.9, 0.74], params: ['color'] },
  grill: { label: 'Grill', category: 'furniture', size: [1.3, 0.55, 1.15], params: [] },
  picnic_table: { label: 'Kinder-Picknicktisch', category: 'furniture', size: [0.9, 0.9, 0.5], params: ['color'] },
  // --- Pflanzen (Garten)
  flowers: { label: 'Blumen', category: 'plant', size: [1.5, 0.8, 0.35], params: ['color'] },
  grass: { label: 'Ziergras', category: 'plant', size: [0.6, 0.6, 0.7], params: ['color'] },
  shrub: { label: 'Strauch', category: 'plant', size: [1.2, 1.0, 1.0], params: ['color'] },
  tree: { label: 'Baum', category: 'plant', size: [3, 3, 5], params: ['shape', 'color', 'stakes'] },
  // --- Geräte
  box: { label: 'Gerät (Quader)', category: 'device', size: [0.6, 0.6, 0.85], params: ['color'] },
  marker: { label: 'Markierung', category: 'device', size: [0.12], params: ['color'] },
  ceiling_fan: { label: 'Deckenventilator', category: 'device', size: [1.2], params: ['color'], anim: 'spin' },
  floor_fan: { label: 'Standventilator', category: 'device', size: [0.42, 0.42, 1.15], params: ['color'], anim: 'spin' },
  garage_door: { label: 'Garagentor', category: 'device', size: [3.0, 0.2, 2.1], params: ['color', 'sections'], anim: 'sectional' },
  solar_panels: { label: 'Balkonkraftwerk', category: 'device', size: [2.29, 1.72, 0.1], params: ['panels', 'cable_to', 'drop', 'peak'], anim: 'flow' },
  tv: { label: 'Fernseher', category: 'device', size: [1.45, 0.06, 0.84], params: [] },
  // --- Leuchten
  ball: { label: 'Leuchtkugel', category: 'lamp', capabilities: ['light'], params: ['radius'] },
  bollard: { label: 'Pollerleuchte', category: 'lamp', capabilities: ['light'], params: [] },
  chandelier_candles: { label: 'Kerzenkronleuchter', category: 'lamp', capabilities: ['light'], params: ['arms'] },
  chandelier_tulip: { label: 'Tulpenkronleuchter', category: 'lamp', capabilities: ['light'], params: ['arms'] },
  disc: { label: 'Deckenleuchte', category: 'lamp', capabilities: ['light'], params: [] },
  floor_spots: { label: 'Stehleuchte (Spots)', category: 'lamp', capabilities: ['light'], params: [] },
  sconce: { label: 'Wandleuchte', category: 'lamp', capabilities: ['light'], params: [] },
  spike_spot: { label: 'Erdspießstrahler', category: 'lamp', capabilities: ['light'], params: [] },
  string_lights: { label: 'Lichterkette', category: 'lamp', capabilities: ['light'], params: ['length', 'sag', 'bulbs', 'poles'] },
  wall_box: { label: 'Wandleuchte (eckig)', category: 'lamp', capabilities: ['light'], params: [] },
};

export const CATEGORY_LABEL = { furniture: 'Möbel', device: 'Gerät', lamp: 'Leuchte', plant: 'Pflanze' };

/** Hat das Modell die Fähigkeit (z. B. 'light')? */
export const hasCapability = (model, cap) => !!CATALOG[model]?.capabilities?.includes(cap);

/** Standard-Lichthöhe neu angelegter Leuchten je Montage (Meter über dem Boden; Decke: knapp darunter) */
export const DEFAULT_LIGHT_HEIGHT = { ceiling: 2.35, pendant: 2.0, floor: 0.15, table: 0.6, wall: 1.8, spot: 0.15 };

/** Standard-Lichthöhe je Leuchtenmodell (überschreibt die Montage) */
export const MODEL_LIGHT_HEIGHT = { floor_spots: 1.5, string_lights: 2.4, bollard: 0.55, ball: 0.15, spike_spot: 0.15 };

/** Bodenbeläge und Oberflächen (`surface`) */
export const SURFACES = ['parquet', 'parquet_cube', 'tiles', 'concrete', 'lawn', 'paving', 'gravel', 'soil', 'wood', 'water', 'slabs', 'stone', 'roof', 'roof_tiles'];

/** Montagearten von Leuchten (`light.mount`) */
export const LIGHT_MOUNTS = ['ceiling', 'pendant', 'floor', 'table', 'wall', 'spot'];

/** Rollen in `ha.entities` */
export const ROLES = ['power', 'info'];

/** Aktionen für tap/double_tap/hold */
export const ACTIONS = ['toggle', 'more-info', 'service', 'navigate', 'none'];

/** Standard-Montage je Leuchtenmodell (wenn `light.mount` fehlt) */
export const DEFAULT_MOUNT = { bollard: 'floor', spike_spot: 'floor', string_lights: 'pendant', ball: 'floor', chandelier_candles: 'pendant', chandelier_tulip: 'pendant', disc: 'ceiling', floor_spots: 'floor', sconce: 'wall', wall_box: 'wall' };
