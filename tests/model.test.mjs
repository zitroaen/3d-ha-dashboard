// Unit-Tests für das Datenmodell (src/model/*, src/store.js): Versionen/Migration, YAML schreiben und lesen,
// Overrides, Übersetzung für die Szene, Zurückschreiben aus dem Editor, Standard-Aktionen.
//   node tests/model.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { ENGINE_ROOT } from './lib/config.mjs';
import { migrate, MODEL_VERSION, ModelVersionError } from '../src/model/migrate.js';
import { parseModel, toScene, writeBack, gestureAction, setRole, cleanHa, showsBadge, outdoorHeightAt, activityOf, terrainOf, OUTDOOR_FLOOR, OPEN_GROUND } from '../src/model/model.js';
import { terrainGrid, clipTerrain, terrainShade, aerialTransform } from '../src/terrain.js';
import { readTiff, readXyz, readWorldFile, sampleRaster, georef } from '../scripts/lib/geodata.mjs';
import { buildRailing } from '../src/railing.js';
import { toYaml, yamlHeader } from '../src/model/yaml.js';
import { applyOverrides, objectOverride } from '../src/store.js';
import { roofShape, minusConvex } from '../src/roofshape.js';
import { ceilingFn } from '../src/roof.js';

let failed = 0;
const check = (name, cond, info = '') => {
  if (cond) console.log(`✔ ${name}`);
  else {
    failed++;
    console.error(`✖ ${name} ${info}`);
  }
};
const throws = (fn, cls) => {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof cls;
  }
};

// --- Versionen und Migration
const base = () => ({ schema: 'ha3d', version: MODEL_VERSION, site: { name: 'T' }, buildings: [] });
check('Migration: aktuelle Version bleibt unverändert', migrate(base()).migrated === false);
check('Migration: Dokument ohne schema (z. B. alte house.json) wird abgelehnt', throws(() => migrate({ floors: [] }), ModelVersionError));
check('Migration: neuere Version als der Code wird abgelehnt', throws(() => migrate({ ...base(), version: MODEL_VERSION + 1 }), ModelVersionError));
check('Migration: Version 1 wird nicht migriert', throws(() => migrate({ ...base(), version: 1 }), ModelVersionError));
// künftige Versionen: Migrationen laufen nacheinander und setzen die Version
const fake = { [MODEL_VERSION + 1]: (d) => ({ ...d, a: 1 }), [MODEL_VERSION + 2]: (d) => ({ ...d, b: d.a + 1 }) };
const m2 = migrate(base(), fake, MODEL_VERSION + 2);
check('Migration: Kette n -> n+1 -> n+2', m2.migrated && m2.doc.version === MODEL_VERSION + 2 && m2.doc.b === 2, JSON.stringify(m2.doc));
check('Migration: fehlender Schritt wird gemeldet', throws(() => migrate(base(), {}, MODEL_VERSION + 1), ModelVersionError));

// --- YAML: Rundreise mit dem Demo-Modell, Kopfkommentar bleibt
const demoText = readFileSync(join(ENGINE_ROOT, 'examples/demo/model.yaml'), 'utf8');
const demo = parseModel(demoText);
const written = toYaml(demo, yamlHeader(demoText));
check('YAML: Demo-Modell übersteht Schreiben und Lesen unverändert', JSON.stringify(yaml.load(written)) === JSON.stringify(demo));
check('YAML: Kopfkommentar bleibt erhalten', written.startsWith(yamlHeader(demoText)) && yamlHeader(demoText).startsWith('#'));
const tricky = { s: ['yes', 'no', 'null', '1.5', '- x', 'a: b', 'a #b', '', 'Küche (EG)', '#rgb'], n: [0, -1.25, 1e-7] };
check('YAML: heikle Zeichenketten und Zahlen bleiben gleich', JSON.stringify(yaml.load(toYaml(tricky))) === JSON.stringify({ ...tricky, n: [0, -1.25, 0] }), toYaml(tricky));

// --- Übersetzung für die Szene
const sc = toScene(demo);
const floorIds = sc.house.floors.map((f) => f.id);
check('Szene: eine Etage je Gebäude-Etage plus Außen-Etage', floorIds.includes('haus/eg') && floorIds.includes('haus/og') && floorIds.includes('garage/eg') && floorIds.includes(OUTDOOR_FLOOR), floorIds.join());
check('Szene: Ebenen aus dem Modell', sc.house.floors.find((f) => f.id === 'haus/og').level === 1);
check('Szene: Leuchten und übrige Objekte getrennt', sc.devices.every((d) => d.type === 'light') && sc.items.every((i) => !i.light));
const kugel = sc.devices.find((d) => d.id === 'eg_wohnen_kugel');
check('Szene: Leuchte mit Montageart aus dem Modell-Standard und Lichtwerten', kugel.kind === 'floor' && kugel.height === 0.14 && kugel.color === '#3aa0ff', JSON.stringify(kugel));
const garten = sc.devices.find((d) => d.id === 'gartenstrahler');
check('Szene: Leuchte im Außenbereich liegt auf der Außen-Etage mit dessen Höhe', garten.floor === OUTDOOR_FLOOR && garten.outdoor && garten.base === -0.04, JSON.stringify({ f: garten.floor, b: garten.base }));
const free = toScene({ ...base(), objects: [{ id: 'x', model: 'box', pos: [1, 1] }] }).items[0];
check('Szene: Objekt ohne Bereich steht auf freiem Gelände', free.floor === OUTDOOR_FLOOR && free.room === OPEN_GROUND);

// --- Gelände: Höhe je Eckpunkt (ältere Form), Objekte stehen auf dem Hang
{
  const m = parseModel(demoText);
  delete m.site.terrain;
  m.outdoor.push({ id: 'hang', name: 'Hang', surface: 'lawn', polygon: [[-4, 30, -0.05], [11.2, 30, -0.05], [11.2, 36.7, -1.5], [-4, 36.7, -1.5]] });
  m.objects.push({ id: 'hangbaum', model: 'tree', space: 'hang', pos: [3, 35] });
  const sc = toScene(m);
  const hang = sc.house.floors.find((f) => f.id === OUTDOOR_FLOOR).rooms.find((r) => r.id === 'hang');
  const terr = sc.house.floors.find((f) => f.id === OUTDOOR_FLOOR).rooms.find((r) => r.id === 'terrasse');
  check('Gelände: Höhen je Eckpunkt, ebene Bereiche ohne', hang.heights?.join() === '-0.05,-0.05,-1.5,-1.5' && terr.heights === null);
  const z = m.outdoor.find((o) => o.id === 'hang');
  const mid = outdoorHeightAt(z, [3, (30 + 36.7) / 2]);
  check('Gelände: Höhe dazwischen linear', Math.abs(mid - (-0.05 - 1.5) / 2) < 1e-6 && Math.abs(outdoorHeightAt(z, [0, 36.7]) + 1.5) < 1e-6, String(mid));
  const tree = sc.items.find((i) => i.id === 'hangbaum');
  check('Gelände: Objekt bekommt die Hanghöhe als base', Math.abs(tree.base - outdoorHeightAt(z, tree.pos)) < 1e-9 && tree.base < -0.5, String(tree.base));
}

// --- Höhenraster (site.terrain): Dreiecke mit fester Diagonale, Lücken gefüllt, Rand fortgesetzt
{
  const g = terrainGrid({ origin: [0, 0], cell: 1, heights: [[0, 1, 2], [1, 2, 3], [2, null, 4]] });
  check('Raster: Höhe an Rasterpunkten und linear dazwischen', g.height([1, 1]) === 2 && Math.abs(g.height([0.5, 0.25]) - 0.75) < 1e-9 && g.height([2, 0]) === 2);
  check('Raster: Lücke aus den Nachbarn gefüllt', Math.abs(g.H(1, 2) - (2 + 4 + 2) / 3) < 1e-9, String(g.H(1, 2)));
  check('Raster: außerhalb setzt sich der Rand fort', g.height([-5, 0]) === 0 && g.height([9, 1]) === 3);
  const tris = g.triangles();
  const frags = clipTerrain(tris, [[[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]]]);
  const area = frags.reduce((a, f) => a + Math.abs(f.reduce((s, v, i) => {
    const q = f[(i + 1) % f.length].p;
    return s + (v.p[0] * q[1] - q[0] * v.p[1]) / 2;
  }, 0)), 0);
  check('Raster: Zuschnitt auf einen Bereich deckt genau seine Fläche, Höhen auf dem Raster',
    Math.abs(area - 1) < 1e-9 && frags.every((f) => f.every((v) => Math.abs(v.h - g.height(v.p)) < 1e-9)), String(area));
  const rest = clipTerrain(tris, null, [[[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]]]);
  const restArea = rest.reduce((a, f) => a + Math.abs(f.reduce((s, v, i) => {
    const q = f[(i + 1) % f.length].p;
    return s + (v.p[0] * q[1] - q[0] * v.p[1]) / 2;
  }, 0)), 0);
  check('Raster: Aussparung lässt den Rest übrig', Math.abs(restArea - 3) < 1e-9, String(restArea));

  // Demo-Haus: Garten folgt dem Raster, Objekte (auch auf freiem Gelände) stehen darauf
  const m = parseModel(demoText);
  const sc = toScene(m);
  const terrain = terrainOf(m);
  const garten = sc.house.floors.find((f) => f.id === OUTDOOR_FLOOR).rooms.find((r) => r.id === 'garten');
  const tree = sc.items.find((i) => i.id === 'apfelbaum');
  check('Demo: Garten folgt dem Höhenraster, Baum steht auf dem Hang',
    garten.follow && !garten.heights && Math.abs(tree.base - terrain.height(tree.pos)) < 1e-9 && tree.base < -0.3, String(tree.base));
  const free = toScene({ ...m, objects: [{ id: 'x', model: 'box', pos: [-8, -12] }] }).items[0];
  check('Demo: Objekt ohne Bereich steht auf dem Raster', Math.abs(free.base - terrain.height([-8, -12])) < 1e-9 && free.base > 1, String(free.base));
}

// --- Zurückschreiben (Editor) und Rollen
const mm = parseModel(demoText);
const sc2 = toScene(mm);
const lamp = sc2.devices.find((d) => d.id === 'eg_wohnen_wandleuchte');
Object.assign(lamp, { pos: [4.0001, 0.5], height: 1.8, ha: { entities: { power: ['light.neu'], info: [] }, hold: 'none' } });
writeBack('lamp', lamp);
const src = mm.objects.find((o) => o.id === 'eg_wohnen_wandleuchte');
check('Zurückschreiben: Lage, Lichthöhe und Verknüpfung landen im Modell', src.pos[0] === 4 && src.light.height === 1.8 && src.ha.entities.power === 'light.neu' && !('info' in src.ha.entities) && src.ha.hold === 'none', JSON.stringify(src));
lamp.ha = { entities: { power: null } };
writeBack('lamp', lamp);
check('Zurückschreiben: Verknüpfung lösen entfernt ha', !src.ha, JSON.stringify(src.ha));
const o = { id: 'a' };
setRole(o, 'info', ['sensor.a', 'sensor.b']);
check('Rollen: Liste bleibt Liste', JSON.stringify(o.ha) === '{"entities":{"info":["sensor.a","sensor.b"]}}');

// --- Overrides (HA-Benutzerdaten)
const m3 = parseModel(demoText);
const ov = { objects: { sofa: { ...objectOverride({ pos: [1, 2], rot: 10 }), ha: { entities: { power: 'switch.x' } } } } };
applyOverrides(m3, ov);
const sofa = m3.objects.find((x) => x.id === 'sofa');
check('Overrides: überschreiben Lage und Verknüpfung, null entfernt Felder', sofa.pos.join() === '1,2' && sofa.rot === 10 && sofa.ha.entities.power === 'switch.x' && !('size' in ov.objects.sofa) && sofa.elevation === undefined);

// --- Standard-Aktionen (docs/DATA_MODEL.md → Standards)
const act = (ha, g) => gestureAction({ ha }, g).action;
check('Aktionen: power -> Antippen schaltet, lange drücken öffnet den Dialog', act({ entities: { power: 'light.a' } }, 'tap') === 'toggle' && act({ entities: { power: 'light.a' } }, 'hold') === 'more-info');
check('Aktionen: nur info -> Antippen öffnet den Dialog', act({ entities: { info: 'sensor.a' } }, 'tap') === 'more-info');
check('Aktionen: Leuchten schalten auch unverknüpft (Demo/Vorschau)', gestureAction({}, 'tap', true).action === 'toggle' && gestureAction({}, 'hold', true).action === 'more-info');
check('Aktionen: ausdrückliche Angabe gilt vor dem Standard', gestureAction({ ha: { tap: 'none' } }, 'tap', true).action === 'none'
  && gestureAction({ ha: { double_tap: { action: 'service', service: 'script.x', confirm: 'Sicher?' } } }, 'double_tap').confirm === 'Sicher?');
check('Zustandsanzeige: info oder geschaltetes Gerät, Leuchten nur mit info, badge überschreibt',
  showsBadge({ ha: { entities: { info: 'sensor.a' } } }) && showsBadge({ ha: { entities: { power: 'switch.a' } } })
  && !showsBadge({ ha: { entities: { power: 'light.a' } } }, true) && !showsBadge({ ha: { entities: { info: 'sensor.a' }, badge: false } }) && !showsBadge({}));
check('ha aufräumen: leere Rollen weg, nichts übrig -> undefined', cleanHa({ entities: { power: [], info: undefined } }) === undefined
  && JSON.stringify(cleanHa({ entities: { power: ['a'] }, badge: false })) === '{"entities":{"power":"a"},"badge":false}');
check('Aktionen: ohne Entities nichts, Doppeltippen standardmäßig nichts', act(undefined, 'tap') === 'none' && act({ entities: { power: 'light.a' } }, 'double_tap') === 'none');
check('Aktionen: Kurzform und ausführliche Form', act({ tap: 'more-info' }, 'tap') === 'more-info' && gestureAction({ ha: { tap: { action: 'service', service: 'script.x' } } }, 'tap').service === 'script.x');

// Animationen: Aktivität aus Entities (Tempo aus percentage) oder festem Zustand
check('Animation: Entity an -> aktiv, Stufe als Tempo; ruhende Zustände -> inaktiv',
  activityOf([{ state: 'on', attributes: { percentage: 50 } }]).speed === 0.5 && activityOf([{ state: 'on' }]).active
  && !activityOf([{ state: 'off' }, { state: 'unavailable' }]).active && activityOf([{ state: 'off' }, { state: 'playing' }]).active
  && activityOf([{ state: 'on', attributes: { percentage: 5 } }]).speed === 0.25);
check('Animation: ohne Entity gilt der feste Zustand (Standard aus)', activityOf([], 'on').active && !activityOf([], undefined).active && !activityOf([], 'off').active);

// Einlagern, fester Zustand, angelegte/gelöschte Objekte in den Benutzerdaten
{
  const m = parseModel(readFileSync(join(ENGINE_ROOT, 'examples/demo/model.yaml'), 'utf8'));
  const n = toScene(m).items.length;
  m.objects.find((o) => o.id === 'sofa').stored = true;
  const sc = toScene(m);
  check('Eingelagerte Objekte (stored) stehen nicht in der Welt', sc.items.length === n - 1 && !sc.items.some((i) => i.id === 'sofa'));
  const fan = sc.items.find((i) => i.id === 'ventilator');
  fan.state = undefined;
  writeBack('item', fan);
  check('Zurückschreiben: fester Zustand wird entfernt bzw. gesetzt', !('state' in fan.src) && (fan.state = 'on', writeBack('item', fan), fan.src.state === 'on'));
  const m2 = parseModel(readFileSync(join(ENGINE_ROOT, 'examples/demo/model.yaml'), 'utf8'));
  applyOverrides(m2, { removed: ['sofa'], added: { neu_1: { id: 'neu_1', model: 'box', pos: [1, 1] } }, objects: { tv: { stored: true } } });
  check('Overrides: gelöschte Objekte fehlen, neue sind da, stored wirkt', !m2.objects.some((o) => o.id === 'sofa')
    && m2.objects.some((o) => o.id === 'neu_1') && m2.objects.find((o) => o.id === 'tv').stored === true);
}

// Messwerte und Tore
check('Animation: Messwert (Leistung) aktiv ab 1, Tempo im Verhältnis zur Spitze; Tor beim Schließen inaktiv',
  activityOf([{ state: '400' }], undefined, { peak: 800 }).speed === 0.5 && !activityOf([{ state: '0' }]).active
  && activityOf([{ state: 'opening' }]).active && !activityOf([{ state: 'closing' }]).active && activityOf([{ state: 'open' }]).active);

// Dach: eigene Etage eine Ebene über der obersten, eigener Bereich
{
  const m = parseModel(readFileSync(join(ENGINE_ROOT, 'examples/demo/model.yaml'), 'utf8'));
  const sc = toScene(m);
  const roof = sc.house.floors.find((f) => f.id === 'garage/__dach');
  const pv = sc.items.find((i) => i.id === 'balkonkraftwerk');
  check('Dach der Garage: Etage auf Ebene 1 über den Wänden, Bereich garage_dach mit Hülle der Garage',
    roof?.roof && roof.level === 1 && Math.abs(roof.elevation - 2.6) < 1e-6 && roof.rooms[0].id === 'garage_dach'
    && roof.rooms[0].polygon.length === 4 && pv?.floor === 'garage/__dach' && pv.room === 'garage_dach', JSON.stringify(roof?.rooms[0]));
  m.buildings.find((b) => b.id === 'garage').roof = false;
  check('Dach abschaltbar (roof: false)', !toScene({ ...m, objects: [] }).house.floors.some((f) => f.id === 'garage/__dach'));
}

// Steildächer: Form als untere Hülle der Dachebenen
{
  const rect = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const gable = roofShape({ type: 'gable', polygon: rect, pitch: 45 });
  check('Satteldach: First entlang der langen Seite, Giebel ohne Ebene, Höhe = Abstand zur Traufe',
    gable.fns.length === 2 && near(gable.height([5, 4]), 4) && near(gable.height([5, 1]), 1) && near(gable.height([0.5, 4]), 4)
    && gable.faces().length === 2);
  const prof = gable.profile([0, 8], [0, 0]);
  check('Satteldach: Giebelprofil mit Knick am First', prof.length === 3 && near(prof[1].t, 0.5) && near(prof[1].h, 4), JSON.stringify(prof));
  const hip = roofShape({ type: 'hip', polygon: rect, pitch: 45 });
  check('Walmdach: vier Flächen, an der Schmalseite steigt es auch', hip.faces().length === 4 && near(hip.height([0.5, 4]), 0.5));
  const half = roofShape({ type: 'half_hip', polygon: rect, pitch: 45 });
  check('Krüppelwalm: Giebel bis 60 % der Firsthöhe, darüber Walm', near(half.height([0, 4]), 2.4) && half.height([0.5, 4]) > 2.4 && half.height([0.5, 4]) < 4);
  const shed = roofShape({ type: 'shed', polygon: rect, pitch: 45, slope: '+y' });
  check('Pultdach: fällt in Fallrichtung (Traufe im Süden = +y)', near(shed.height([5, 8]), 0) && near(shed.height([5, 0]), 8));
  const over = roofShape({ type: 'gable', polygon: rect, pitch: 45, overhang: 0.5 });
  check('Dachüberstand: Umriss größer, Traufe darunter', near(over.ext[0][0], -0.5) && near(over.height([5, 8.5]), -0.5));
  const terrace = roofShape({ type: 'hip', polygon: rect, pitch: 30, opening: [[3, 3], [7, 3], [7, 5], [3, 5]] });
  const covered = terrace.faces().reduce((a, f) => a + f.poly.reduce((s, p, i) => {
    const q = f.poly[(i + 1) % f.poly.length];
    return s + (p[0] * q[1] - q[0] * p[1]) / 2;
  }, 0), 0);
  check('Aussparung: Dachfläche = Umriss minus Dachterrasse', near(Math.abs(covered), 80 - 8), covered);
  check('Konvex minus Loch: disjunkte Stücke', minusConvex(rect, [[3, 3], [7, 3], [7, 5], [3, 5]]).length === 4);
  const C = ceilingFn([{ shape: gable, eaves: 1 }], 2.4);
  check('Oberste Etage: Wand unter der Schräge = Kniestock + Dachfläche, höchstens Geschosshöhe',
    near(C([5, 0.5]), 1.5) && near(C([5, 4]), 2.4) && near(C([20, 20]), 2.4));
}

// Demo-Haus: mehrere Dachteile, Dachterrasse als flacher Bereich, Steildach schneidet das Obergeschoss
{
  const m = parseModel(readFileSync(join(ENGINE_ROOT, 'examples/demo/model.yaml'), 'utf8'));
  const sc = toScene(m);
  const roof = sc.house.floors.find((f) => f.id === 'haus/__dach');
  const og = sc.house.floors.find((f) => f.id === 'haus/og');
  const ids = roof?.rooms.map((r) => r.id).join();
  check('Haus: Hauptdach, Anbau und Dachterrasse als Bereiche', ids === 'haus_dach,haus_anbau,dachterrasse' && sc.spaces.get('dachterrasse')?.kind === 'roof', ids);
  check('Haus: Hauptdach (nicht der Anbau) schneidet die Wände des Obergeschosses (Kniestock)', og?.roofCut?.length === 1 && roof.rooms[0].roof.shape.type === 'half_hip');
  check('Gartenhaus: abgesetztes Pultdach (zwei Pultflächen, nördliche höher)',
    sc.house.floors.find((f) => f.id === 'gartenhaus/__dach')?.rooms.map((r) => r.roof?.eaves).join() === '2,2.9');
}

// Fassaden und Geländer
{
  const sc = toScene(parseModel(demoText));
  const f = (id) => sc.house.floors.find((x) => x.id === id);
  check('Fassade: je Gebäude an allen Etagen und am Dach, Sockel nur auf der untersten Etage',
    f('haus/eg').facade?.type === 'plaster' && f('haus/eg').lowest && !f('haus/og').lowest && f('haus/__dach').facade?.plinth
    && f('gartenhaus/eg').facade.type === 'wood_siding' && !f('garage/eg').facade);
  const out = f(OUTDOOR_FLOOR).rooms.find((r) => r.id === 'veranda');
  const terr = f('haus/__dach').rooms.find((r) => r.id === 'dachterrasse');
  check('Geländer: an Außenbereichen und flachen Dachteilen', out.railing?.style === 'balusters' && terr.railing?.style === 'glass');
  const calls = { frame: 0, glass: 0 };
  const mk = (role) => ({ skirt: () => calls[role]++, triUV: () => {} });
  buildRailing([[0, 0], [2, 0], [2, 2], [0, 2]], { style: 'glass', edges: [0] }, () => 0, (role) => mk(role === 'glass' ? 'glass' : 'frame'), 1);
  check('Geländer: zwei Pfosten, Handlauf und eine Glasscheibe an der gewählten Kante', calls.glass === 1 && calls.frame === 12, JSON.stringify(calls));
}

// Innenausstattung: Belag-Zonen, Deckenbalken, eigene Farben
{
  const sc = toScene(parseModel(demoText));
  const room = (f, id) => sc.house.floors.find((x) => x.id === f).rooms.find((r) => r.id === id);
  check('Raum: Belag-Zone (Naturstein im Essbereich) und Deckenbalken kommen in der Szene an',
    room('haus/eg', 'kueche').zones?.[0]?.surface === 'flagstone' && room('gartenhaus/eg', 'gartenhaus').beams?.dir === 'y');
  const { paletteParams } = await import('../src/models.js');
  check('Farben: Palettenname oder #rrggbb', paletteParams('#8fc1d6')?.color === '#8fc1d6' && paletteParams('white')?.color === 0xeeece6 && paletteParams('quatsch') === null);
  const lamp = sc.devices.find((d) => d.id === 'studio_pendel');
  check('Leuchte: params bleiben neben der Lichtfarbe erhalten (Stoffschirm)', lamp.params?.color === '#3f5f73');
}

// Werkzeug: Höhenraster aus einem Scan (OBJ, Y nach oben), eingepasst mit Drehung, Versatz und Fußbodenhöhe
{
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync: wf, readFileSync: rf } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'ha3d-scan-'));
  const lines = [];
  for (let z = 0; z < 4; z++) for (let x = 0; x < 5; x++) lines.push(`v ${x} ${1 + 0.1 * z} ${z}`);
  for (let z = 0; z < 3; z++) for (let x = 0; x < 4; x++) {
    const a = z * 5 + x + 1;
    lines.push(`f ${a}/1 ${a + 1}/1 ${a + 6}/1 ${a + 5}/1`);
  }
  wf(join(dir, 'scan.obj'), lines.join('\n'));
  execFileSync('node', [join(ENGINE_ROOT, 'scripts/terrain-from-scan.mjs'), join(dir, 'scan.obj'), '--cell', '1', '--floor', '1', '--rotate', '90', '--offset', '10,0', '--out', join(dir, 't.json')]);
  const t = JSON.parse(rf(join(dir, 't.json'), 'utf8'));
  check('Scan -> Höhenraster: gedreht, verschoben, Fußboden = 0',
    t.origin.join() === '7,0' && t.heights.length === 5 && t.heights.every((r) => r.join() === '0.3,0.2,0.1,0'), JSON.stringify(t));
}

// Hangschattierung: Mulde dunkler als ebene Fläche, Kuppe/Ebene fast ohne
{
  const heights = Array.from({ length: 21 }, (_, j) => Array.from({ length: 21 }, (_, i) => {
    const r = Math.hypot(i - 10, j - 10);
    return r < 6 ? -1.5 * Math.cos((r / 6) * Math.PI / 2) : 0; // Mulde in der Mitte
  }));
  const g = terrainGrid({ origin: [0, 0], cell: 1, heights });
  const sh = terrainShade(g);
  const at = (i, j) => sh[j * g.nx + i];
  check('Hangschattierung: Mulde dunkler, ebener Rand fast unverändert', at(10, 10) > 0.1 && at(0, 0) < 0.02 && at(10, 10) <= 0.55, `${at(10, 10)} ${at(0, 0)}`);
  check('Hangschattierung: shading 0 schaltet ab', terrainShade(g, { strength: 0 }).every((v) => v === 0));
}

// Luftbild-Lage: origin/size/rot und World-Datei-Matrix
{
  const t = aerialTransform({ origin: [10, 20], size: [40, 30], rot: 90 });
  const uv = (p) => [t.U[0] * p[0] + t.U[1] * p[1] + t.U[2], t.V[0] * p[0] + t.V[1] * p[1] + t.V[2]];
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  // rot 90: Bildzeilen laufen in +y, Bild-unten zeigt nach −x
  check('Luftbild: Ecken bei rot 90', near(uv([10, 20]), [0, 0]) && near(uv([10, 60]), [1, 0]) && near(uv([-20, 20]), [0, 1]) && near(t.toPlan(1, 1), [-20, 60]));
  const a = aerialTransform({ affine: [0.2, 0, 5, 0, 0.2, -3] }, 100, 50);
  check('Luftbild: affine (Pixel) -> u, v', near([a.U[0] * 25 + a.U[1] * 7 + a.U[2], a.V[0] * 25 + a.V[1] * 7 + a.V[2]], [1, 1]));
  check('Luftbild: unbrauchbare Lage -> null', aerialTransform({ size: 0 }) === null);
}

// Geodaten: GeoTIFF (unkomprimiert, Deflate + Gleitkomma-Prädiktor, LZW + Prädiktor 2), XYZ, World-Datei, Einpassung
{
  const { deflateSync } = await import('node:zlib');
  const W = 5, H = 4;
  const val = (x, y) => 300 + x * 2 + y * 0.5; // Höhe in m (NHN)
  /** Kleines GeoTIFF schreiben (ein Streifen, little endian) */
  const tiff = ({ fmt = 3, bits = 32, comp = 1, pred = 1 }) => {
    const bytes = bits / 8;
    const raw = Buffer.alloc(W * H * bytes);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * bytes, v = val(x, y);
      if (fmt === 3) raw.writeFloatLE(v, o);
      else raw.writeUInt16LE(Math.round(v * 10), o);
    }
    let data = raw;
    if (pred === 3) {
      // Gleitkomma-Prädiktor: Bytes nach Ebenen (höchstwertige zuerst), dann Differenzen
      data = Buffer.alloc(raw.length);
      for (let y = 0; y < H; y++) {
        const row = Buffer.alloc(W * bytes);
        for (let x = 0; x < W; x++) for (let b = 0; b < bytes; b++) row[b * W + x] = raw[(y * W + x) * bytes + (bytes - 1 - b)];
        for (let i = row.length - 1; i > 0; i--) row[i] = (row[i] - row[i - 1]) & 255;
        row.copy(data, y * W * bytes);
      }
    }
    if (pred === 2) {
      data = Buffer.from(raw);
      for (let y = 0; y < H; y++) for (let x = W - 1; x > 0; x--) {
        const o = (y * W + x) * 2;
        data.writeUInt16LE((raw.readUInt16LE(o) - raw.readUInt16LE(o - 2)) & 0xffff, o);
      }
    }
    if (comp === 8) data = deflateSync(data);
    if (comp === 5) data = lzwEncode(data);
    const entries = [
      [256, 3, [W]], [257, 3, [H]], [258, 3, [bits]], [259, 3, [comp]], [262, 3, [1]], [273, 4, [0]], [277, 3, [1]],
      [278, 3, [H]], [279, 4, [data.length]], [317, 3, [pred]], [339, 3, [fmt === 3 ? 3 : 1]],
      [33550, 12, [1, 1, 0]], [33922, 12, [0, 0, 0, 1000, 2000, 0]],
    ];
    const ifdOff = 8, ifdSize = 2 + entries.length * 12 + 4;
    let extra = ifdOff + ifdSize;
    const ext = [];
    const ifd = Buffer.alloc(ifdSize);
    ifd.writeUInt16LE(entries.length, 0);
    entries.forEach(([tag, type, vals], k) => {
      const e = 2 + k * 12, size = { 3: 2, 4: 4, 12: 8 }[type];
      ifd.writeUInt16LE(tag, e); ifd.writeUInt16LE(type, e + 2); ifd.writeUInt32LE(vals.length, e + 4);
      const buf = Buffer.alloc(vals.length * size);
      vals.forEach((v, i) => (type === 3 ? buf.writeUInt16LE(v, i * 2) : type === 4 ? buf.writeUInt32LE(v, i * 4) : buf.writeDoubleLE(v, i * 8)));
      if (buf.length <= 4) buf.copy(ifd, e + 8);
      else { ifd.writeUInt32LE(extra, e + 8); ext.push(buf); extra += buf.length; }
    });
    const head = Buffer.from([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
    const out = Buffer.concat([head, ifd, ...ext, data]);
    out.writeUInt32LE(extra, ifdOff + 2 + 5 * 12 + 8); // StripOffsets
    return out;
  };
  /** LZW-Kodierer (TIFF, MSB zuerst, frühe Breitenumschaltung) */
  function lzwEncode(src) {
    const out = [];
    let acc = 0, nb = 0, width = 9;
    const put = (code) => {
      acc = (acc << width) | code; nb += width;
      while (nb >= 8) { out.push((acc >> (nb - 8)) & 255); nb -= 8; }
      acc &= (1 << nb) - 1;
    };
    let dict = new Map(), next = 258;
    const reset = () => { dict = new Map(); for (let i = 0; i < 256; i++) dict.set(String(i), i); next = 258; width = 9; };
    reset();
    put(256);
    let w = '';
    for (const b of src) {
      const wc = w ? `${w},${b}` : String(b);
      if (dict.has(wc)) { w = wc; continue; }
      put(dict.get(w));
      dict.set(wc, next++);
      if (next + 1 >= 1 << width && width < 12) width++;
      w = String(b);
    }
    if (w) put(dict.get(w));
    put(257);
    if (nb) out.push((acc << (8 - nb)) & 255);
    return Buffer.from(out);
  }
  const probe = (r) => [sampleRaster(r, 1002.5, 1998.5), sampleRaster(r, 1000.5, 1999.5)];
  const ok = (r, k = 1) => {
    const [a, b] = probe(r);
    return Math.abs(a - val(2, 1) * k) < 1e-3 && Math.abs(b - val(0, 0) * k) < 1e-3;
  };
  check('GeoTIFF unkomprimiert: Werte und Lage (Pixelmitte)', ok(readTiff(tiff({}))), JSON.stringify(probe(readTiff(tiff({})))));
  check('GeoTIFF Deflate + Gleitkomma-Prädiktor', ok(readTiff(tiff({ comp: 8, pred: 3 }))), JSON.stringify(probe(readTiff(tiff({ comp: 8, pred: 3 })))));
  check('GeoTIFF LZW + Prädiktor 2 (16 Bit)', ok(readTiff(tiff({ fmt: 1, bits: 16, comp: 5, pred: 2 })), 10), JSON.stringify(probe(readTiff(tiff({ fmt: 1, bits: 16, comp: 5, pred: 2 })))));
  const xyz = readXyz('1000.5 1999.5 300\n1001.5 1999.5 302\n1000.5 1998.5 300.5\n1001.5 1998.5 302.5\n');
  check('XYZ: Gitter aus Punkten', Math.abs(sampleRaster(xyz, 1001, 1999) - 301.25) < 1e-9 && xyz.width === 2 && xyz.height === 2);
  const wf = readWorldFile('0.2\n0\n0\n-0.2\n500000.1\n5600000.1\n');
  check('World-Datei: Bezug Pixelmitte -> Ecke', Math.abs(wf[2] - 500000) < 1e-9 && Math.abs(wf[5] - 5600000.2) < 1e-9);
  const g = georef({ origin: [1000, 2000], north_deg: 90, floor: 300 });
  // Norden zeigt im Plan nach rechts: Plan (5, 0) liegt 5 m nördlich, Plan (0, 5) 5 m östlich
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  check('Einpassung: Nordrichtung und Rückweg', near(g.toGeo([5, 0]), [1000, 2005]) && near(g.toGeo([0, 5]), [1005, 2000]) && near(g.toPlan(g.toGeo([3, -7])), [3, -7]));
  // Werkzeug: DGM -> site.terrain
  const { mkdtempSync, writeFileSync: wf2, readFileSync: rf2 } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'ha3d-'));
  wf2(join(dir, 'dgm.tif'), tiff({ comp: 8, pred: 3 }));
  execFileSync('node', [join(ENGINE_ROOT, 'scripts/terrain-from-geotiff.mjs'), join(dir, 'dgm.tif'), '--origin', '1000.5,1999.5', '--north', '0', '--floor', '300', '--cell', '1', '--bounds', '0,0,2,1', '--out', join(dir, 't.json')]);
  const t = JSON.parse(rf2(join(dir, 't.json'), 'utf8'));
  // Plan (0,0) = Pixel (0,0); Plan-y nach unten = Süden = nächste Bildzeile
  check('DGM -> Höhenraster: Lage, Nordrichtung, Fußboden', t.heights.length === 2 && t.heights[0].join() === '0,2,4' && t.heights[1].join() === '0.5,2.5,4.5', JSON.stringify(t));
}

// Magicplan-Import: Etagen drehen, Raum-IDs eindeutig, Räume teilen (Python, ohne PDF)
{
  const { spawnSync } = await import('node:child_process');
  const py = ['python3', 'python'].find((c) => spawnSync(c, ['--version']).status === 0);
  const r = py ? spawnSync(py, [join(ENGINE_ROOT, 'tests/plan_transform_test.py')], { encoding: 'utf8' }) : null;
  check('Magicplan-Import: Umformungen (tests/plan_transform_test.py)', r?.status === 0, py ? r.stdout + r.stderr : 'kein Python gefunden');
}

if (failed) {
  console.error(`\n✖ ${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
