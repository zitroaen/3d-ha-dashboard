// Erzeugt das Bauwerk des erfundenen Demo-Hauses in examples/demo/model.yaml (Datenmodell v2, docs/DATA_MODEL.md):
// Wohnhaus 10 × 8 m (Erdgeschoss: Wohnzimmer, Küche, Schlafzimmer, Bad; Obergeschoss: Studio), Garage daneben und
// Außenbereiche (Terrasse, Einfahrt, Beet). Die Objekte (objects) in model.yaml bleiben unverändert.
//   node examples/demo/build-house.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
  { id: 'kueche', name: 'Küche', polygon: rect(6 + INT / 2, EXT, 10 - EXT, 3.5 - INT / 2), surface: 'tiles' },
  { id: 'schlafen', name: 'Schlafzimmer', polygon: rect(6 + INT / 2, 3.5 + INT / 2, 8 - INT / 2, 8 - EXT), surface: 'parquet' },
  { id: 'bad', name: 'Bad', polygon: rect(8 + INT / 2, 3.5 + INT / 2, 10 - EXT, 8 - EXT), surface: 'tiles' },
];

const windows = [
  { rect: [1.2, 0, 2.4, EXT], room: 'wohnen', transom: 0.7 },
  { rect: [2.6, 0, 3.8, EXT], room: 'wohnen', transom: 0.7 },
  { rect: [7.0, 0, 8.2, EXT], room: 'kueche', sill: 1.0 },
  { rect: [6.5, 8 - EXT, 7.5, 8], room: 'schlafen' },
  { rect: [0, 2.0, EXT, 4.0], room: 'wohnen', sashes: 4 },
  { rect: [10 - EXT, 1.2, 10, 2.4], room: 'kueche' },
  { rect: [10 - EXT, 5.0, 10, 5.8], room: 'bad', sill: 1.4 },
].map((w) => ({ sill: 0.9, top: 2.1, ...w, rect: w.rect.map(r3) }));

// Türen: Scharnier/Ende auf der Wandmitte; swing = Aufschlagseite (+1/-1 entlang der Normalen n = (-uy, ux));
// jamb = Laibung relativ zur Linie Scharnier→Ende
const ej = [-EXT / 2, EXT / 2], ij = [-INT / 2, INT / 2];
const doors = [
  { hinge: [2.0, 8 - EXT / 2], end: [2.8, 8 - EXT / 2], swing: -1, jamb: ej, type: 'exterior', leaf: 'glass', rooms: ['wohnen'], height: 2.1 },
  { hinge: [3.6, 8 - EXT / 2], end: [2.8, 8 - EXT / 2], swing: 1, jamb: ej, type: 'exterior', leaf: 'glass', rooms: ['wohnen'], height: 2.1 },
  { hinge: [8.6, EXT / 2], end: [9.5, EXT / 2], swing: 1, jamb: ej, type: 'exterior', leaf: 'solid', rooms: ['kueche'], height: 2.0 },
  { hinge: [6.0, 1.4], end: [6.0, 2.3], swing: 1, jamb: ij, type: 'interior', rooms: ['wohnen', 'kueche'], height: 2.0 },
  { hinge: [6.0, 5.2], end: [6.0, 6.1], swing: 1, jamb: ij, type: 'interior', rooms: ['wohnen', 'schlafen'], height: 2.0 },
  { hinge: [8.0, 6.4], end: [8.0, 7.2], swing: 1, jamb: ij, type: 'interior', rooms: ['schlafen', 'bad'], height: 2.0 },
].map((d) => ({ ...d, hinge: d.hinge.map(r3), end: d.end.map(r3), jamb: d.jamb.map(r3) }));

// --- Obergeschoss: ein Studio über dem Wohnzimmer (Außenwände wie unten, ohne Türen)
const OG_H = 2.4, OG_EL = 2.85;
const ogWalls = [
  ...wall({ axis: 'x', from: 0, to: 6 + INT / 2, at0: 0, at1: EXT, gaps: [[2.0, 3.4]] }),
  ...wall({ axis: 'x', from: 0, to: 6 + INT / 2, at0: 8 - EXT, at1: 8, gaps: [[2.0, 3.6]] }),
  ...wall({ axis: 'y', from: EXT, to: 8 - EXT, at0: 0, at1: EXT }),
  ...wall({ axis: 'y', from: EXT, to: 8 - EXT, at0: 6 - INT / 2, at1: 6 + INT / 2 }),
];
const ogRooms = [{ id: 'studio', name: 'Studio', polygon: rect(EXT, EXT, 6 - INT / 2, 8 - EXT), surface: 'parquet' }];
const ogWindows = [
  { rect: [2.0, 0, 3.4, EXT], room: 'studio' },
  { rect: [2.0, 8 - EXT, 3.6, 8], room: 'studio', sill: 0.5 },
].map((w) => ({ sill: 0.9, top: 2.0, ...w, rect: w.rect.map(r3) }));

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
      { id: 'og', name: 'Obergeschoss', level: 1, elevation: OG_EL, height: OG_H, rooms: ogRooms, walls: ogWalls.map((polygon) => ({ polygon })), windows: ogWindows },
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
];

const outdoor = [
  { id: 'terrasse', name: 'Terrasse', polygon: rect(0, 8, 6.5, 10.5), surface: 'paving' },
  { id: 'einfahrt', name: 'Einfahrt', polygon: rect(GX, GD, GX + GW, 12), surface: 'gravel', elevation: -0.05 },
  { id: 'beet', name: 'Beet', polygon: rect(7, 9, 10.5, 10.5), surface: 'soil', elevation: -0.04 },
];

const file = fileURLToPath(new URL('./model.yaml', import.meta.url));
const prevText = existsSync(file) ? readFileSync(file, 'utf8') : '';
const prev = (prevText.trim() && yaml.load(prevText)) || {};
const model = {
  schema: 'ha3d',
  version: 2,
  site: { name: 'Demohaus', north_deg: 20, ground: { surface: 'lawn' } },
  buildings,
  outdoor,
  objects: prev.objects || [],
};
const header = yamlHeader(prevText) || '# Erfundenes Demo-Haus (Testdaten und Vorlage). Format: docs/DATA_MODEL.md\n# Bauwerk erzeugt von examples/demo/build-house.mjs, Objekte von Hand bzw. im Editor';
writeFileSync(file, toYaml(model, header));
const nRooms = buildings.reduce((n, b) => n + b.floors.reduce((m, f) => m + f.rooms.length, 0), 0);
console.log(`Demo-Haus: ${buildings.length} Gebäude, ${nRooms} Räume, ${outdoor.length} Außenbereiche, ${model.objects.length} Objekte -> ${file}`);
