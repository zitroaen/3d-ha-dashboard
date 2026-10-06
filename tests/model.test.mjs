// Unit-Tests für das Datenmodell (src/model/*, src/store.js): Versionen/Migration, YAML schreiben und lesen,
// Overrides, Übersetzung für die Szene, Zurückschreiben aus dem Editor, Standard-Aktionen.
//   node tests/model.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { ENGINE_ROOT } from './lib/config.mjs';
import { migrate, MODEL_VERSION, ModelVersionError } from '../src/model/migrate.js';
import { badgeSpec, badgeEntities, conditionMet, playerSpec } from '../src/model/model.js';
import { parseModel, toScene, writeBack, gestureAction, setRole, cleanHa, showsBadge, outdoorHeightAt, activityOf, terrainOf, OUTDOOR_FLOOR, OPEN_GROUND } from '../src/model/model.js';
import { terrainGrid, clipTerrain, terrainShade, aerialTransform } from '../src/terrain.js';
import { readTiff, readXyz, readWorldFile, sampleRaster, georef } from '../scripts/lib/geodata.mjs';
import { buildRailing } from '../src/railing.js';
import { vegTemplate, vegPlacement, REF } from '../src/vegetation.js';
import { LightTable, LIGHT_TABLE_MAX } from '../src/roomlight.js';
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

// Pflanzen-Vorlagen: wenige Dreiecke je Detailstufe, Variation fest aus der Position
{
  const tris = (shape, near) => vegTemplate(shape, near).attributes.position.count / 3;
  const counts = Object.keys(REF).map((s) => [s, tris(s, true), tris(s, false)]);
  check('Pflanzen: nah ≤ 300, fern ≤ 120 Dreiecke je Form', counts.every(([, n, f]) => n <= 300 && f <= 120 && f < n), JSON.stringify(counts));
  const a = vegPlacement({ kind: 'tree', pos: [3, 4], size: [4, 4, 6] }, 'round', () => null);
  const b = vegPlacement({ kind: 'tree', pos: [3, 4], size: [4, 4, 6] }, 'round', () => null);
  const c = vegPlacement({ kind: 'tree', pos: [9, 1], size: [4, 4, 6] }, 'round', () => null);
  check('Pflanzen: Variation aus der Position (gleich bleibt gleich, anders variiert)', a.local.equals(b.local) && !a.local.equals(c.local) && a.crown === 4);
}

// Lichttabelle wächst mit der Zahl der Bereiche/Lampen (in 64er-Schritten, höchstens LIGHT_TABLE_MAX)
{
  const T = new LightTable();
  const w0 = T.width, grew = T.ensure(300), w1 = T.width, same = T.ensure(200);
  T.setRoomRange(290, 5, 2);
  const o = T.data[(2 * T.width + 289) * 4];
  T.ensure(1e6);
  check('Lichttabelle: 64 -> 320 Spalten für 300 Bereiche, Raum 290 eingetragen, Obergrenze',
    w0 === 64 && grew && w1 === 320 && !same && T.width === LIGHT_TABLE_MAX && o === 5, `${w0} ${w1} ${T.width}`);
}

// nDOM -> Bäume: Wipfel, Kronendurchmesser, Gebäude ausgespart
{
  const { mkdtempSync, writeFileSync: wf, readFileSync: rf, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'ha3d-ndom-'));
  mkdirSync(join(dir, 'data'));
  wf(join(dir, 'data', 'model.yaml'), [
    'schema: ha3d', 'version: 2',
    'site: { name: Test, georef: { origin: [1000, 2000] } }',
    'buildings:',
    '  - id: haus', '    name: Haus', '    floors:',
    '      - { id: eg, name: EG, level: 0, height: 2.5, walls: [], rooms: [{ id: raum, name: Raum, polygon: [[18, 3], [23, 3], [23, 8], [18, 8]] }] }',
    'objects: []', '',
  ].join('\n'));
  // Kegelförmige Kronen: Baum bei (5, 5), 8 m hoch, Radius 2,5 m; „Baum“ im Haus bei (20, 5)
  const lines = [];
  for (let y = 0; y <= 12; y += 0.5) for (let x = 0; x <= 26; x += 0.5) {
    const cone = (cx, cy, H, R) => Math.max(0, H * (1 - Math.hypot(x - cx, y - cy) / R));
    const z = Math.max(cone(5, 5, 8, 2.5) > 0 ? 3 + cone(5, 5, 5, 2.5) : 0, cone(20, 5, 9, 2));
    lines.push(`${1000 + x} ${2000 - y} ${z.toFixed(3)}`);
  }
  wf(join(dir, 'ndom.xyz'), lines.join('\n'));
  execFileSync('node', [join(ENGINE_ROOT, 'scripts/trees-from-ndom.mjs'), join(dir, 'ndom.xyz'), '--data', join(dir, 'data'), '--bounds', '0,0,26,12', '--write']);
  const objs = yaml.load(rf(join(dir, 'data', 'model.yaml'), 'utf8')).objects;
  const t = objs[0];
  check('nDOM -> Bäume: ein Baum, Wipfel, Krone, Höhe; Gebäude ausgespart',
    objs.length === 1 && t.model === 'tree' && t.pos.join() === '5,5' && Math.abs(t.size[0] - 5) < 1 && Math.abs(t.size[2] - 8) < 0.1, JSON.stringify(objs));
}

// Einpassung an LoD2 (fit-footprint) und Dach aus LoD2 (roof-from-lod2), mit erfundenem CityGML
{
  const { mkdtempSync, writeFileSync: wf, readFileSync: rf, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'ha3d-lod2-'));
  mkdirSync(join(dir, 'data'));
  // Modell: L-förmiges Haus (asymmetrisch), oberste Etage auf 0 m
  const L = [[0, 0], [10, 0], [10, 6], [4, 6], [4, 9], [0, 9]];
  wf(join(dir, 'data', 'model.yaml'), [
    'schema: ha3d', 'version: 2', 'site: { name: Test, north_deg: 24 }', 'buildings:',
    '  - id: haus', '    name: Haus', '    floors:',
    `      - { id: eg, name: EG, level: 0, height: 2.6, walls: [], rooms: [{ id: raum, name: Raum, polygon: ${JSON.stringify(L)} }] }`,
    'objects: []', '',
  ].join('\n'));
  // „Wahre“ Lage: Nord 25,4°, Ursprung bei (500100, 5400200); daraus die LoD2-Flächen
  const truth = georef({ origin: [500100, 5400200], north_deg: 25.4, floor: 300 });
  const pos = (pts) => `<gml:Polygon><gml:exterior><gml:LinearRing><gml:posList srsDimension="3">${[...pts, pts[0]].map((p) => p.join(' ')).join(' ')}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>`;
  const g3 = (p, z) => [...truth.toGeo(p), z];
  // Satteldach über dem 10 × 6-Teil (First entlang x, 35°), Pultdach-frei: nur dieser Teil hat ein Steildach
  const k = Math.tan((35 * Math.PI) / 180) * 3, ze = 305.6;
  const roofA = [g3([0, 0], ze), g3([10, 0], ze), g3([10, 3], ze + k), g3([0, 3], ze + k)];
  const roofB = [g3([0, 3], ze + k), g3([10, 3], ze + k), g3([10, 6], ze), g3([0, 6], ze)];
  const flat = [g3([0, 6], 303), g3([4, 6], 303), g3([4, 9], 303), g3([0, 9], 303)];
  const gml = `<?xml version="1.0"?><core:CityModel xmlns:core="x" xmlns:bldg="y" xmlns:gml="z">
  <core:cityObjectMember><bldg:Building gml:id="DEXX_ANDERES"><bldg:boundedBy><bldg:GroundSurface>${pos([[400000, 5000000, 0], [400010, 5000000, 0], [400010, 5000010, 0]])}</bldg:GroundSurface></bldg:boundedBy></bldg:Building></core:cityObjectMember>
  <core:cityObjectMember><bldg:Building gml:id="DEXX_HAUS">
    <bldg:boundedBy><bldg:GroundSurface><bldg:lod2MultiSurface>${pos(L.map((p) => g3(p, 300.1)))}</bldg:lod2MultiSurface></bldg:GroundSurface></bldg:boundedBy>
    <bldg:boundedBy><bldg:RoofSurface>${pos(roofA)}</bldg:RoofSurface></bldg:boundedBy>
    <bldg:boundedBy><bldg:RoofSurface>${pos(roofB)}</bldg:RoofSurface></bldg:boundedBy>
    <bldg:boundedBy><bldg:RoofSurface>${pos(flat)}</bldg:RoofSurface></bldg:boundedBy>
  </bldg:Building></core:cityObjectMember></core:CityModel>`;
  wf(join(dir, 'lod2.gml'), gml);
  execFileSync('node', [join(ENGINE_ROOT, 'scripts/fit-footprint.mjs'), join(dir, 'lod2.gml'), '--data', join(dir, 'data'), '--near', '500105,5400195', '--floor', '300', '--crs', 'EPSG:25832', '--write']);
  const site = yaml.load(rf(join(dir, 'data', 'model.yaml'), 'utf8')).site;
  const gr = site.georef;
  check('LoD2-Einpassung: Nordrichtung und Plan-Ursprung gefunden, site.georef geschrieben',
    Math.abs(gr.north_deg - 25.4) < 0.3 && Math.hypot(gr.origin[0] - 500100, gr.origin[1] - 5400200) < 0.15 && gr.floor === 300 && gr.crs === 'EPSG:25832' && site.north_deg === 24,
    JSON.stringify(gr));
  const out = execFileSync('node', [join(ENGINE_ROOT, 'scripts/roof-from-lod2.mjs'), join(dir, 'lod2.gml'), '--data', join(dir, 'data')], { encoding: 'utf8' });
  const lines = out.split('\n').filter((l) => l.trim().startsWith('- {'));
  check('Dach aus LoD2: Satteldach 35° mit First entlang x, Traufe 5,6 m; flacher Teil auf 3 m',
    lines.length === 2 && /type: gable, pitch: 35(\.0)?, ridge: x, eaves: 5\.6/.test(lines[0]) && /type: flat, eaves: 3/.test(lines[1]), out);
}

// Fenster unter Steildächern: kürzen/weglassen, Prüfung warnt; Wände ohne Dach darüber
{
  const { mkdtempSync, writeFileSync: wf } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'ha3d-kniestock-'));
  // 10 × 8, Satteldach First entlang x, Traufe 1 m (Kniestock): Fenster an der Traufseite (y = 0) passt nicht,
  // am Giebel (x = 0) in der Mitte passt es; Anbau-Wand bei x 10 … 12 hat kein Dach
  wf(join(dir, 'model.yaml'), [
    'schema: ha3d', 'version: 2', 'site: { name: Test }', 'buildings:',
    '  - id: haus', '    name: Haus',
    '    roof: { type: gable, ridge: x, pitch: 40, eaves: 1, polygon: [[0, 0], [10, 0], [10, 8], [0, 8]] }',
    '    floors:',
    '      - id: dg', '        name: DG', '        level: 0', '        height: 2.5',
    '        rooms: [{ id: raum, name: Raum, polygon: [[0.3, 0.3], [9.7, 0.3], [9.7, 7.7], [0.3, 7.7]] }]',
    '        walls: [{ polygon: [[0, 0], [10, 0], [10, 0.3], [0, 0.3]] }, { polygon: [[10, 2], [12, 2], [12, 2.3], [10, 2.3]] }]',
    '        windows:',
    '          - { rect: [4, 0, 5, 0.3], sill: 0.9, top: 2.1, room: raum }',
    '          - { rect: [0, 3.5, 0.3, 4.5], sill: 0.9, top: 2.1, room: raum }',
    'objects: []', '',
  ].join('\n'));
  const r = spawnSync('node', [join(ENGINE_ROOT, 'tests/validate-data.mjs'), '--data', dir], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  check('Prüfung: Fenster über der Dachfläche (Gaube anlegen?) und Wand ohne Dach mit Lage',
    /Fenster \[4, 0, 5, 0\.3\] liegt über der Dachfläche.*weggelassen; Gaube anlegen\?/.test(out) && !/Fenster \[0, 3\.5/.test(out)
      && /Wand bei \[10(\.\d+)?, 2\]–\[12, 2\.3\] liegt unter keinem Dachteil/.test(out), out);
  const { windowUnderRoof, ceilingFn: cf } = await import('../src/roof.js');
  const C = (p) => 1 + p[0] * 0.5; // Schräge: 1 m bei x = 0, 2 m bei x = 2
  const shortWin = windowUnderRoof({ rect: [1.6, 0, 2.4, 0.3], sill: 0.9, top: 2.1 }, C);
  check('Fenster unter der Schräge: gekürzt auf die niedrigste Stelle minus 5 cm, ohne Dach unverändert',
    shortWin.top === 1.75 && !windowUnderRoof({ rect: [0, 0, 1, 0.3] }, null).top && typeof cf === 'function', JSON.stringify(shortWin));
}

// Zustandsanzeige: Werte auswählen, Bedingungen; Medienplayer
{
  const states = {
    'sensor.t': { state: '26.5', attributes: {} }, 'sensor.h': { state: '55', attributes: {} },
    'vacuum.v': { state: 'docked', attributes: {} }, 'media_player.m': { state: 'playing', attributes: { volume_level: 0.3 } },
  };
  const o = { ha: { entities: { info: ['sensor.t', 'sensor.h'] }, badge: { entities: ['sensor.t'], when: { above: 25 } } } };
  check('Anzeige: nur ausgewählte Werte, Bedingung „größer als“ auf der ersten angezeigten Entity',
    badgeEntities(o).join() === 'sensor.t' && showsBadge(o) && conditionMet(o.ha.badge.when, states, 'sensor.t') && !conditionMet({ above: 30 }, states, 'sensor.t'));
  check('Bedingung: state/not_state (auch Liste), attribute, fehlende Entity = nicht erfüllt',
    conditionMet({ not_state: 'docked' }, states, 'vacuum.v') === false && conditionMet({ state: ['cleaning', 'docked'] }, states, 'vacuum.v')
      && conditionMet({ entity: 'media_player.m', attribute: 'volume_level', below: 0.5 }, states) && !conditionMet({ state: 'on' }, states, 'sensor.x'));
  const empty = { ha: { entities: { power: 'vacuum.v', info: 'sensor.h' }, badge: { entities: [] } } };
  check('Anzeige: leere Auswahl = keine Werte (nur An/Aus), Kurzform true/false bleibt', badgeEntities(empty).length === 0
    && badgeSpec({ ha: { badge: false } }).show === false && badgeSpec({}).entities === null);
  check('Medienplayer: automatisch bei media_player (Standard „spielt“), abschaltbar, eigene Bedingung',
    playerSpec({ ha: { entities: { power: 'media_player.m' } } })?.when.state === 'playing' && playerSpec({ ha: { entities: { power: 'media_player.m' }, player: false } }) === null
      && playerSpec({ ha: { entities: { power: 'switch.x' } } }) === null && playerSpec({ ha: { entities: { power: 'media_player.m' }, player: { when: { state: ['playing', 'paused'] } } } }).when.state.length === 2);
  check('cleanHa behält player', cleanHa({ entities: {}, player: false }).player === false);
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
