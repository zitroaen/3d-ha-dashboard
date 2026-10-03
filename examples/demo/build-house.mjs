// Erzeugt das erfundene Demo-Haus (examples/demo/house.json): ein Bungalow 10 × 8 m mit Wohnzimmer, Küche,
// Schlafzimmer und Bad. Dient als Testdaten und als Vorlage für das Datenformat (siehe docs/DATA_FORMAT.md).
//   node examples/demo/build-house.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  { id: 'wohnen', name: 'Wohnzimmer', polygon: rect(EXT, EXT, 6 - INT / 2, 8 - EXT), floor: 'parkett_wuerfel', floor_rot: 45, ceiling: null },
  { id: 'kueche', name: 'Küche', polygon: rect(6 + INT / 2, EXT, 10 - EXT, 3.5 - INT / 2), floor: 'fliesen', ceiling: null },
  { id: 'schlafen', name: 'Schlafzimmer', polygon: rect(6 + INT / 2, 3.5 + INT / 2, 8 - INT / 2, 8 - EXT), floor: 'parkett', ceiling: null },
  { id: 'bad', name: 'Bad', polygon: rect(8 + INT / 2, 3.5 + INT / 2, 10 - EXT, 8 - EXT), floor: 'fliesen', ceiling: null },
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
  { hinge: [2.0, 8 - EXT / 2], end: [2.8, 8 - EXT / 2], swing: -1, jamb: ej, type: 'exterior', leaf: 'glass', rooms: ['wohnen', null], height: 2.1 },
  { hinge: [3.6, 8 - EXT / 2], end: [2.8, 8 - EXT / 2], swing: 1, jamb: ej, type: 'exterior', leaf: 'glass', rooms: ['wohnen', null], height: 2.1 },
  { hinge: [8.6, EXT / 2], end: [9.5, EXT / 2], swing: 1, jamb: ej, type: 'exterior', leaf: 'solid', rooms: ['kueche', null], height: 2.0 },
  { hinge: [6.0, 1.4], end: [6.0, 2.3], swing: 1, jamb: ij, type: 'interior', rooms: ['wohnen', 'kueche'], height: 2.0 },
  { hinge: [6.0, 5.2], end: [6.0, 6.1], swing: 1, jamb: ij, type: 'interior', rooms: ['wohnen', 'schlafen'], height: 2.0 },
  { hinge: [8.0, 6.4], end: [8.0, 7.2], swing: 1, jamb: ij, type: 'interior', rooms: ['schlafen', 'bad'], height: 2.0 },
].map((d) => ({ ...d, hinge: d.hinge.map(r3), end: d.end.map(r3), jamb: d.jamb.map(r3) }));

const house = {
  name: 'Demohaus',
  units: 'm',
  coordinates: 'x nach rechts, y nach unten (Plan); three.js: x -> x, y -> z. Ursprung: linke obere Außenecke.',
  source: 'examples/demo/build-house.mjs (erfunden)',
  north_deg: 20,
  floors: [{ id: 'eg', name: 'Erdgeschoss', level: 0, elevation: 0, ceiling: 2.6, rooms, walls, windows, doors }],
};

const out = fileURLToPath(new URL('./house.json', import.meta.url));
writeFileSync(out, JSON.stringify(house, null, 1) + '\n');
console.log(`Demo-Haus: ${rooms.length} Räume, ${walls.length} Wände, ${windows.length} Fenster, ${doors.length} Türen -> ${out}`);
