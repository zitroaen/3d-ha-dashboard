// Erzeugt das Bauwerk des erfundenen Demo-Hauses in examples/demo/model.yaml (Datenmodell v2, docs/DATA_MODEL.md):
// Wohnhaus 10 × 8 m (Erdgeschoss: Wohnzimmer, Küche, Schlafzimmer, Bad; Obergeschoss: Studio unter einem
// Krüppelwalmdach, Dachterrasse auf dem Anbau), Garage daneben, Gartenhaus mit abgesetztem Pultdach und
// Außenbereiche (Terrasse, Einfahrt, Beete, Südhang; im Norden eine in den Hang gegrabene Terrasse mit Trockenmauern). Die Objekte (objects) in model.yaml bleiben unverändert.
//   node examples/demo/build-house.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { toYaml, yamlHeader } from '../../src/model/yaml.js';

const EXT = 0.3, INT = 0.12;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Rechteck-Wand entlang einer Achse, mit ausgesparten Öffnungen [von, bis] (entlang der Wand). */
function wall({ axis, from, to, at0, at1, gaps = [] }) {
  const pieces = [];
  let cur = from;
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (a > cur) pieces.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < to) pieces.push([cur, to]);
  return pieces.map(([a, b]) =>
    axis === 'x'
      ? [[a, at0], [b, at0], [b, at1], [a, at1]]
      : [[at0, a], [at1, a], [at1, b], [at0, b]]
  ).map((p) => p.map(([x, y]) => [r3(x), r3(y)]));
}

// Öffnungen (entlang der jeweiligen Wand)
const top = { win: [[1.2, 2.4], [2.6, 3.8], [7.0, 8.2]], door: [[8.6, 9.5]] };
const bottom = { win: [[6.5, 7.5]], door: [[2.0, 3.6]] };
const left = { win: [[2.0, 4.0]] };
const right = { win: [[1.2, 2.4], [5.0, 5.8]] };
const v1 = { door: [[1.4, 2.3], [5.2, 6.1]] }; // Wohnzimmer | Küche/Schlafzimmer, x = 6.0
const v2 = { door: [[6.4, 7.2]] };             // Schlafzimmer | Bad, x = 8.0

const walls = [
  ...wall({ axis: 'x', from: 0, to: 10, at0: 0, at1: EXT, gaps: [...top.win, ...top.door] }),
  ...wall({ axis: 'x', from: 0, to: 10, at0: 8 - EXT, at1: 8, gaps: [...bottom.win, ...bottom.door] }),
  ...wall({ axis: 'y', from: EXT, to: 8 - EXT, at0: 0, at1: EXT, gaps: left.win }),
  ...wall({ axis: 'y', from: EXT, to: 8 - EXT, at0: 10 - EXT, at1: 10, gaps: right.win }),
  ...wall({ axis: 'y', from: EXT, to: 8 - EXT, at0: 6 - INT / 2, at1: 6 + INT / 2, gaps: v1.door }),
  ...wall({ axis: 'x', from: 6 + INT / 2, to: 10 - EXT, at0: 3.5 - INT / 2, at1: 3.5 + INT / 2 }),
  ...wall({ axis: 'y', from: 3.5 + INT / 2, to: 8 - EXT, at0: 8 - INT / 2, at1: 8 + INT / 2, gaps: v2.door }),
];

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [r3(x), r3(y)]);
const rooms = [
  { id: 'wohnen', name: 'Wohnzimmer', polygon: rect(EXT, EXT, 6 - INT / 2, 8 - EXT), surface: 'parquet_cube', surface_rot: 45 },
  // Küche mit Essplatz: dort Polygonalplatten aus Naturstein (Belag-Zone statt eigenem Raum)
  { id: 'kueche', name: 'Küche', polygon: rect(6 + INT / 2, EXT, 10 - EXT, 3.5 - INT / 2), surface: 'tiles', zones: [{ polygon: rect(6 + INT / 2, 1.2, 8.3, 3.5 - INT / 2), surface: 'flagstone' }] },
  { id: 'schlafen', name: 'Schlafzimmer', polygon: rect(6 + INT / 2, 3.5 + INT / 2, 8 - INT / 2, 8 - EXT), surface: 'parquet' },
  { id: 'bad', name: 'Bad', polygon: rect(8 + INT / 2, 3.5 + INT / 2, 10 - EXT, 8 - EXT), surface: 'tiles' },
];

const windows = [
  { rect: [1.2, 0, 2.4, EXT], room: 'wohnen', transom: 0.7 },
  { rect: [2.6, 0, 3.8, EXT], room: 'wohnen', transom: 0.7 },
  { rect: [7.0, 0, 8.2, EXT], room: 'kueche', sill: 1.0 },
  // Klappläden aus der Bibliothek (library/openings.yaml): Füllungsläden bzw. Holzfenster mit Lamellenläden
  { rect: [6.5, 8 - EXT, 7.5, 8], room: 'schlafen', style: 'shutters_panels' },
  { rect: [0, 2.0, EXT, 4.0], room: 'wohnen', sashes: 4 },
  { rect: [10 - EXT, 1.2, 10, 2.4], room: 'kueche', style: 'wood_shutters' },
  { rect: [10 - EXT, 5.0, 10, 5.8], room: 'bad', sill: 1.4 },
].map((w) => ({ sill: 0.9, top: 2.1, ...w, rect: w.rect.map(r3) }));

// Türen: Scharnier/Ende auf der Wandmitte; swing = Aufschlagseite (+1/-1 entlang der Normalen n = (-uy, ux));
// jamb = Laibung relativ zur Linie Scharnier→Ende
const ej = [-EXT / 2, EXT / 2], ij = [-INT / 2, INT / 2];
const doors = [
  { hinge: [2.0, 8 - EXT / 2], end: [2.8, 8 - EXT / 2], swing: -1, jamb: ej, type: 'exterior', leaf: 'glass', rooms: ['wohnen'], height: 2.1 },
  { hinge: [3.6, 8 - EXT / 2], end: [2.8, 8 - EXT / 2], swing: 1, jamb: ej, type: 'exterior', leaf: 'glass', rooms: ['wohnen'], height: 2.1 },
  { hinge: [8.6, EXT / 2], end: [9.5, EXT / 2], swing: 1, jamb: ej, type: 'exterior', leaf: 'solid', rooms: ['kueche'], arch: true },
  { hinge: [6.0, 1.2], end: [6.0, 2.5], swing: 1, jamb: ij, type: 'interior', rooms: ['wohnen', 'kueche'], height: 2.5, arch: true, leaves: 2 },
  { hinge: [6.0, 5.2], end: [6.0, 6.1], swing: 1, jamb: ij, type: 'interior', rooms: ['wohnen', 'schlafen'], height: 2.0, style: 'interior_panels' },
  { hinge: [8.0, 6.4], end: [8.0, 7.2], swing: 1, jamb: ij, type: 'interior', rooms: ['schlafen', 'bad'], height: 2.0, style: 'interior_glass' },
].map((d) => ({ ...d, hinge: d.hinge.map(r3), end: d.end.map(r3), jamb: d.jamb.map(r3) }));

// --- Obergeschoss: ein Studio über dem Wohnzimmer (Außenwände wie unten, ohne Türen)
const OG_H = 2.4, OG_EL = 2.85;
const ogWalls = [
  ...wall({ axis: 'x', from: 0, to: 6 + INT / 2, at0: 0, at1: EXT, gaps: [[2.0, 3.4]] }),
  ...wall({ axis: 'x', from: 0, to: 6 + INT / 2, at0: 8 - EXT, at1: 8, gaps: [[2.0, 3.6]] }),
  ...wall({ axis: 'y', from: EXT, to: 8 - EXT, at0: 0, at1: EXT, gaps: [[1.2, 2.1]] }),
  ...wall({ axis: 'y', from: EXT, to: 8 - EXT, at0: 6 - INT / 2, at1: 6 + INT / 2 }),
];
const ogRooms = [{ id: 'studio', name: 'Studio', polygon: rect(EXT, EXT, 6 - INT / 2, 8 - EXT), surface: 'parquet_chevron' }];
const ogWindows = [
  { rect: [2.0, 0, 3.4, EXT], room: 'studio' },
  { rect: [2.0, 8 - EXT, 3.6, 8], room: 'studio', sill: 0.5 },
].map((w) => ({ sill: 0.9, top: 2.0, ...w, rect: w.rect.map(r3) }));
// Glastür nach Westen in einer Gaube bis zur Traufe (französischer Balkon)
const ogDoors = [
  { hinge: [EXT / 2, 1.2], end: [EXT / 2, 2.1], swing: 1, jamb: [-EXT / 2, EXT / 2], type: 'exterior', leaf: 'glass', rooms: ['studio'], height: 2.05 },
].map((d) => ({ ...d, hinge: d.hinge.map(r3), end: d.end.map(r3), jamb: d.jamb.map(r3) }));

// --- Garage östlich des Hauses: 4 × 6 m, Tor nach Süden (Öffnung in der Südwand)
const GX = 11.5, GW = 4, GD = 6, GE = 0.2;
const garageWalls = [
  ...wall({ axis: 'x', from: GX, to: GX + GW, at0: 0, at1: GE }),
  ...wall({ axis: 'x', from: GX, to: GX + GW, at0: GD - GE, at1: GD, gaps: [[GX + 0.5, GX + GW - 0.5]] }),
  ...wall({ axis: 'y', from: GE, to: GD - GE, at0: GX, at1: GX + GE, gaps: [[2.0, 2.9]] }),
  ...wall({ axis: 'y', from: GE, to: GD - GE, at0: GX + GW - GE, at1: GX + GW }),
];
const garageDoors = [
  { hinge: [GX + GE / 2, 2.0], end: [GX + GE / 2, 2.9], swing: 1, jamb: [-GE / 2, GE / 2], type: 'exterior', leaf: 'solid', rooms: ['garage'], height: 2.0 },
].map((d) => ({ ...d, hinge: d.hinge.map(r3), end: d.end.map(r3), jamb: d.jamb.map(r3) }));

const buildings = [
  {
    id: 'haus',
    name: 'Wohnhaus',
    kind: 'house',
    floors: [
      { id: 'eg', name: 'Erdgeschoss', level: 0, elevation: 0, height: 2.6, rooms, walls: walls.map((polygon) => ({ polygon })), windows, doors },
      { id: 'og', name: 'Obergeschoss', level: 1, elevation: OG_EL, height: OG_H, rooms: ogRooms, walls: ogWalls.map((polygon) => ({ polygon })), windows: ogWindows, doors: ogDoors },
    ],
    // Putzfassade in warmem Weiß mit Natursteinsockel
    facade: { type: 'plaster', color: '#ece5d8', flush: true, plinth: { height: 0.45, material: 'stone' } },
    // Krüppelwalmdach über dem Obergeschoss (Kniestock 1 m, First Nord–Süd) mit Schleppgaube und Schornstein;
    // über dem eingeschossigen Ostteil ein Walmdach rund um eine Dachterrasse
    roof: [
      {
        type: 'half_hip', ridge: 'y', pitch: 40, eaves: 1.0, overhang: 0.4,
        dormers: [
          { pos: [0.9, 4.0], width: 1.8, height: 1.3, type: 'shed' },
          { pos: [0.9, 6.3], width: 1.2, height: 1.1, type: 'flat' },
          // bis zur Traufe: die Glastür der Wand darunter ist die Front
          { pos: [0.02, 1.65], width: 1.4, height: 1.5, type: 'shed', window: 'openings' },
        ],
        chimneys: [{ pos: [4.3, 1.6], size: [0.5, 0.5], height: 0.7 }],
      },
      // Zwerchhaus nach Osten: Satteldach quer zum Hauptdach, durchdringt es (Kehlen)
      { id: 'haus_zwerch', name: 'Zwerchdach', type: 'gable', ridge: 'x', polygon: rect(2.8, 2.6, 6.0, 5.4), pitch: 40, eaves: 1.0, overhang: 0.3 },
      { id: 'haus_anbau', name: 'Dach Anbau', type: 'hip', polygon: rect(6 + INT / 2, 0, 10, 8), pitch: 30, eaves: -0.25, overhang: 0.3, opening: rect(6.7, 1.2, 9.4, 6.8) },
      { id: 'dachterrasse', name: 'Dachterrasse', polygon: rect(6.7, 1.2, 9.4, 6.8), eaves: -0.25, surface: 'slabs', railing: { style: 'glass', height: 1.0 } },
    ],
  },
  {
    id: 'garage',
    name: 'Garage',
    kind: 'garage',
    floors: [{
      id: 'eg', name: 'Garage', level: 0, elevation: 0, height: 2.4,
      rooms: [{ id: 'garage', name: 'Garage', polygon: rect(GX + GE, GE, GX + GW - GE, GD - GE), surface: 'concrete' }],
      walls: garageWalls.map((polygon) => ({ polygon })),
      doors: garageDoors,
    }],
  },
  gardenHouse(),
];

/**
 * Gartenhaus im Schwedenstil östlich der Einfahrt, 3 × 2,4 m: abgesetztes Pultdach – zwei Pultflächen nach Süden,
 * die nördliche höher, dazwischen ein schmales Wandband.
 */
function gardenHouse() {
  const X0 = 16.5, X1 = 19.5, Y0 = 7.0, Y1 = 9.4, T = 0.12, MID = 8.2;
  const ws = [
    ...wall({ axis: 'x', from: X0, to: X1, at0: Y0, at1: Y0 + T }),
    ...wall({ axis: 'x', from: X0, to: X1, at0: Y1 - T, at1: Y1, gaps: [[17.6, 18.6]] }),
    ...wall({ axis: 'y', from: Y0 + T, to: Y1 - T, at0: X0, at1: X0 + T, gaps: [[7.8, 8.7]] }),
    ...wall({ axis: 'y', from: Y0 + T, to: Y1 - T, at0: X1 - T, at1: X1 }),
  ];
  return {
    id: 'gartenhaus',
    name: 'Gartenhaus',
    kind: 'garden_house',
    // Schwedenrote Holzschalung mit weißen Eckbrettern, Sockel aus Naturstein
    facade: { type: 'wood_siding', plinth: { height: 0.25, material: 'stone' } },
    // Fenster- und Türarten aus der Bibliothek (library/openings.yaml): weiße Sprossenfenster
    styles: { window: 'bars' },
    floors: [{
      id: 'eg', name: 'Gartenhaus', level: 0, elevation: 0, height: 2.2,
      rooms: [{ id: 'gartenhaus', name: 'Gartenhaus', polygon: rect(X0 + T, Y0 + T, X1 - T, Y1 - T), surface: 'dielen_gartenhaus', beams: { dir: 'y', spacing: 0.7, size: [0.1, 0.14] } }],
      walls: ws.map((polygon) => ({ polygon })),
      windows: [{ rect: [17.6, Y1 - T, 18.6, Y1].map(r3), room: 'gartenhaus', sill: 0.9, top: 1.8 }],
      doors: [{ hinge: [r3(X0 + T / 2), 7.8], end: [r3(X0 + T / 2), 8.7], swing: -1, jamb: [-T / 2, T / 2].map(r3), type: 'exterior', leaf: 'solid', rooms: ['gartenhaus'], height: 1.95 }],
    }],
    roof: [
      { type: 'shed', slope: '+y', polygon: rect(X0, MID, X1, Y1), pitch: 18, eaves: 2.0, overhang: 0.3, thickness: 0.15, surface: 'roof' },
      { type: 'shed', slope: '+y', polygon: rect(X0, Y0, X1, MID), pitch: 18, eaves: 2.9, overhang: 0.3, thickness: 0.15, surface: 'roof' },
    ],
  };
}

const outdoor = [
  { id: 'terrasse', name: 'Terrasse', polygon: rect(0, 8, 6.5, 10.5), surface: 'paving' },
  { id: 'einfahrt', name: 'Einfahrt', polygon: rect(GX, GD, GX + GW, 12), surface: 'gravel', elevation: -0.05 },
  { id: 'beet', name: 'Beet', polygon: rect(7, 9, 10.5, 10.5), surface: 'soil', elevation: -0.04 },
  // Blumenbeete rund um die Terrasse, dazwischen der Weg in den Garten
  { id: 'beet_west', name: 'Beet West', polygon: rect(-1, 8, 0, 11.3), surface: 'soil', elevation: -0.04 },
  { id: 'beet_sued_1', name: 'Beet Süd links', polygon: rect(0, 10.5, 2.7, 11.3), surface: 'soil', elevation: -0.04 },
  { id: 'beet_sued_2', name: 'Beet Süd rechts', polygon: rect(3.8, 10.5, 6.5, 11.3), surface: 'soil', elevation: -0.04 },
  { id: 'weg', name: 'Gartenweg', polygon: rect(2.7, 10.5, 3.8, 11.3), surface: 'paving' },
  ...northTerrace(),
  // Veranda vor dem Gartenhaus: Holzdeck mit weißer Balustrade an den Schmalseiten (Westseite offen als Zugang)
  { id: 'veranda', name: 'Veranda', polygon: rect(15.6, 7.0, 16.5, 9.4), surface: 'wood', railing: { style: 'balusters', height: 0.9, edges: [0, 2] } },
  // Garten am Südhang (Süden = +y), folgt dem Höhenraster
  { id: 'garten', name: 'Garten', surface: 'lawn', follow: 'terrain', polygon: rect(-4, 11.3, 11.2, 18) },
];

/**
 * Gelände als Höhenraster (1-m-Raster, site.terrain): Nordhang hinter dem Haus (14 cm pro Meter), ebenes Grundstück
 * um das Haus knapp unter dem Fußboden, Südhang im Garten (1,4 m auf 6,7 m) und leichte Wellen an den Rändern.
 */
function terrain() {
  const X0 = -10, Y0 = -14, NX = 37, NY = 39;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const T = (x, y) => {
    const base = y < 0 ? -y * 0.14 : y > 11.3 ? -0.12 - (y - 11.3) * 0.206 : -0.12;
    const amp = 0.3 * clamp((x - 17) / 6) + 0.3 * clamp((-5 - x) / 5);
    return r3(base + amp * Math.sin(x * 0.9 + 0.5) * Math.cos(y * 0.6));
  };
  return {
    origin: [X0, Y0], cell: 1,
    heights: Array.from({ length: NY }, (_, j) => Array.from({ length: NX }, (_, i) => T(X0 + i, Y0 + j))),
  };
}

/**
 * Terrasse nördlich des Hauses, in den Hang gegraben: Großformatplatten auf Fußbodenhöhe, dahinter steigt der Rasen
 * nach Norden an (14 cm pro Meter). Trockenmauern aus Naturstein halten den Hang – im Norden mit Hochbeet dahinter,
 * an den Seiten in Stufen dem Gelände folgend; im Nordwesten führen Blockstufen hinauf.
 */
function northTerrace() {
  const T = 0.4; // Mauerstärke
  const N = -4.4, BED = -6.0; // Terrasse bis y = N, Hochbeet bis y = BED
  const STEPS = 1.4; // Treppe x 0 … 1.4
  const wallSegs = (x0, x1, segs) => segs.map(([y0, y1, z], i) => ({
    id: `${x0 < 1 ? 'mauer_west' : 'mauer_ost'}_${i + 1}`, name: 'Trockenmauer', polygon: rect(x0, y0, x1, y1),
    surface: 'stone', edge: 'stone', elevation: z,
  }));
  const rise = 0.17;
  return [
    { id: 'terrasse_nord', name: 'Terrasse Nord', polygon: rect(0, N, 10, 0), surface: 'slabs' },
    { id: 'mauer_nord', name: 'Trockenmauer', polygon: rect(STEPS, N - T, 10 + T, N), surface: 'stone', edge: 'stone', elevation: 0.9 },
    { id: 'hochbeet', name: 'Hochbeet', polygon: rect(STEPS, BED, 10 + T, N - T), surface: 'soil', edge: 'stone', elevation: 0.8 },
    // Blockstufen von der Terrasse hinauf zum Rasen
    ...[1, 2, 3, 4].map((k) => ({
      id: `stufe_${k}`, name: 'Stufe', polygon: rect(0, N - k * 0.4, STEPS, N - (k - 1) * 0.4),
      surface: 'stone', edge: 'stone', elevation: r3(k * rise),
    })),
    // Seitenmauern, abgetreppt (oben im Norden am höchsten)
    ...wallSegs(-T, 0, [[BED, -3.6, 0.95], [-3.6, -1.8, 0.62], [-1.8, 0, 0.36]]),
    ...wallSegs(10, 10 + T, [[N, -2.9, 0.9], [-2.9, -1.4, 0.62], [-1.4, 0, 0.36]]),
    // Rasen am Nordhang rund um die Terrasse (U-Form), folgt dem Höhenraster (steigt nach Norden an)
    {
      id: 'garten_nord', name: 'Garten Nord', surface: 'lawn', follow: 'terrain',
      polygon: [[-4, 0], [-T, 0], [-T, BED], [10 + T, BED], [10 + T, 0], [15.5, 0], [15.5, -11], [-4, -11]],
    },
  ];
}

/**
 * Erfundenes „Luftbild“ als SVG (keine echten Geodaten): deckt den Rasterbereich ab (x −10 … 26, y −14 … 24, 20 px je
 * Meter). Rasen mit Mähstreifen und Flecken, im Westen ein Feldweg, im Süden ein Acker, im Osten eine Wiese.
 */
function aerialSvg() {
  const X0 = -10, Y0 = -14, W = 36, H = 38, S = 20;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const px = (x) => r3((x - X0) * S), py = (y) => r3((y - Y0) * S);
  const blobs = Array.from({ length: 70 }, () => {
    const x = X0 + rnd() * W, y = Y0 + rnd() * H, r = 0.6 + rnd() * 2.2;
    const c = rnd() < 0.5 ? '#3f6a2a' : '#7d8f3c';
    return `<ellipse cx="${px(x)}" cy="${py(y)}" rx="${r3(r * S)}" ry="${r3(r * S * (0.6 + rnd() * 0.6))}" fill="${c}" opacity="${r3(0.18 + rnd() * 0.2)}"/>`;
  });
  const stripes = Array.from({ length: Math.ceil(W / 1.6) }, (_, i) =>
    `<rect x="${px(X0 + i * 1.6)}" y="0" width="${0.8 * S}" height="${H * S}" fill="#fff" opacity="0.05"/>`);
  const furrows = Array.from({ length: 12 }, (_, i) =>
    `<rect x="0" y="${py(18.6 + i * 0.45)}" width="${W * S}" height="${0.2 * S}" fill="#5b4430" opacity="0.35"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * S}" height="${H * S}" viewBox="0 0 ${W * S} ${H * S}">
<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed="4"/><feColorMatrix values="0 0 0 0 0.2  0 0 0 0 0.3  0 0 0 0 0.1  0 0 0 0.35 0"/></filter>
<rect width="100%" height="100%" fill="#5f8a37"/>
${blobs.join('\n')}
${stripes.join('\n')}
<rect x="0" y="${py(18.2)}" width="${W * S}" height="${(Y0 + H - 18.2) * S}" fill="#8a6c48"/>
${furrows.join('\n')}
<path d="M ${px(-8.6)} 0 C ${px(-7.4)} ${py(0)}, ${px(-9.2)} ${py(10)}, ${px(-8)} ${H * S}" stroke="#b9ab8c" stroke-width="${2.6 * S}" fill="none"/>
<path d="M ${px(-8.6)} 0 C ${px(-7.4)} ${py(0)}, ${px(-9.2)} ${py(10)}, ${px(-8)} ${H * S}" stroke="#7f8f4e" stroke-width="${0.5 * S}" fill="none" opacity="0.7"/>
<rect x="${px(17)}" y="0" width="${(X0 + W - 17) * S}" height="${py(18.2)}" fill="#7a9a45" opacity="0.45"/>
<rect width="100%" height="100%" filter="url(#n)"/>
</svg>
`;
}

const file = fileURLToPath(new URL('./model.yaml', import.meta.url));
mkdirSync(fileURLToPath(new URL('./textures/', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL('./textures/luftbild.svg', import.meta.url)), aerialSvg());
const prevText = existsSync(file) ? readFileSync(file, 'utf8') : '';
const prev = (prevText.trim() && yaml.load(prevText)) || {};
const model = {
  schema: 'ha3d',
  version: 2,
  site: {
    name: 'Demohaus', north_deg: 20, ground: { surface: 'lawn' },
    attribution: 'Luftbild und Gelände: erfunden (Demo-Haus, keine echten Geodaten)',
    terrain: { ...terrain(), texture: { file: 'textures/luftbild.svg', strength: 0.8 } },
  },
  // eigene Oberfläche: aus der Bibliothek abgeleitet (docs/LIBRARY.md)
  surfaces: { dielen_gartenhaus: { label: 'Dielen Gartenhaus', base: 'planks_wide', color: '#8a6a48' } },
  buildings,
  outdoor,
  objects: prev.objects || [],
  // eigene Modelle aus models/ (Katalog „Eigene“)
  models: prev.models || ['bogenleuchte', 'wandregal', 'gartentor'],
};
const header = yamlHeader(prevText) || '# Erfundenes Demo-Haus (Testdaten und Vorlage). Format: docs/DATA_MODEL.md\n# Bauwerk erzeugt von examples/demo/build-house.mjs, Objekte von Hand bzw. im Editor';
writeFileSync(file, toYaml(model, header));
const nRooms = buildings.reduce((n, b) => n + b.floors.reduce((m, f) => m + f.rooms.length, 0), 0);
console.log(`Demo-Haus: ${buildings.length} Gebäude, ${nRooms} Räume, ${outdoor.length} Außenbereiche, ${model.objects.length} Objekte -> ${file}`);
