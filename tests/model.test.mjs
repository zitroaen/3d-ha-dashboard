// Unit-Tests für das Datenmodell (src/model/*, src/store.js): Versionen/Migration, YAML schreiben und lesen,
// Overrides, Übersetzung für die Szene, Zurückschreiben aus dem Editor, Standard-Aktionen.
//   node tests/model.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { ENGINE_ROOT } from './lib/config.mjs';
import { migrate, MODEL_VERSION, ModelVersionError } from '../src/model/migrate.js';
import { parseModel, toScene, writeBack, gestureAction, setRole, cleanHa, showsBadge, outdoorHeightAt, OUTDOOR_FLOOR, OPEN_GROUND } from '../src/model/model.js';
import { toYaml, yamlHeader } from '../src/model/yaml.js';
import { applyOverrides, objectOverride } from '../src/store.js';

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

// --- Gelände: Höhe je Eckpunkt, Objekte stehen auf dem Hang
{
  const m = parseModel(demoText);
  const sc = toScene(m);
  const garten = sc.house.floors.find((f) => f.id === OUTDOOR_FLOOR).rooms.find((r) => r.id === 'garten');
  const terr = sc.house.floors.find((f) => f.id === OUTDOOR_FLOOR).rooms.find((r) => r.id === 'terrasse');
  check('Gelände: Höhen je Eckpunkt, ebene Bereiche ohne', garten.heights?.join() === '-0.05,-0.05,-1.5,-1.5' && terr.heights === null);
  const z = m.outdoor.find((o) => o.id === 'garten');
  const mid = outdoorHeightAt(z, [3, (11.3 + 18) / 2]);
  check('Gelände: Höhe dazwischen linear', Math.abs(mid - (-0.05 - 1.5) / 2) < 1e-6 && Math.abs(outdoorHeightAt(z, [0, 18]) + 1.5) < 1e-6, String(mid));
  const tree = sc.items.find((i) => i.id === 'apfelbaum');
  check('Gelände: Objekt bekommt die Hanghöhe als base', Math.abs(tree.base - outdoorHeightAt(z, tree.pos)) < 1e-9 && tree.base < -0.5, String(tree.base));
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

if (failed) {
  console.error(`\n✖ ${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
