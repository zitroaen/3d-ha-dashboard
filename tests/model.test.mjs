// Unit-Tests für das Datenmodell (src/model/*, src/store.js): Versionen/Migration, YAML schreiben und lesen,
// Overrides, Übersetzung für die Szene, Zurückschreiben aus dem Editor, Standard-Aktionen.
//   node tests/model.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { ENGINE_ROOT } from './lib/config.mjs';
import { migrate, MODEL_VERSION, ModelVersionError } from '../src/model/migrate.js';
import { parseModel, toScene, writeBack, gestureAction, setRole, cleanHa, showsBadge, outdoorHeightAt, activityOf, terrainOf, OUTDOOR_FLOOR, OPEN_GROUND } from '../src/model/model.js';
import { terrainGrid, clipTerrain } from '../src/terrain.js';
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

if (failed) {
  console.error(`\n✖ ${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
