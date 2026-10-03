// Unit-Tests für das Laden der Daten: data_url (absolut/relativ, mit und ohne abschließendes /) und Demo-Daten.
//   node tests/data.test.mjs
import { resolveDataUrl, parseData } from '../src/data.js';
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (name, cond, info = '') => {
  if (cond) console.log(`✔ ${name}`);
  else {
    failed++;
    console.error(`✖ ${name} ${info}`);
  }
};

const page = 'http://ha.local:8123/haus-3d';
const mod = new URL('http://ha.local:8123/hacsfiles/3d-ha-dashboard/');
const file = (configured) => new URL('house.json', resolveDataUrl(configured, page, mod)).href;

check('ohne data_url: Ordner des Moduls (HACS)', file(undefined) === 'http://ha.local:8123/hacsfiles/3d-ha-dashboard/house.json');
check('absoluter Pfad /local/ha-3d-dashboard/', file('/local/ha-3d-dashboard/') === 'http://ha.local:8123/local/ha-3d-dashboard/house.json');
check('absoluter Pfad ohne abschließendes /', file('/local/ha-3d-dashboard') === 'http://ha.local:8123/local/ha-3d-dashboard/house.json');
check('relativer Pfad gilt ab der Seite', file('daten/') === 'http://ha.local:8123/daten/house.json');
check('Query/Hash der data_url werden verworfen', file('/local/x/?v=2#a') === 'http://ha.local:8123/local/x/house.json');
check('volle URL bleibt erhalten', file('http://nas.local/haus/') === 'http://nas.local/haus/house.json');

// Demo-Haus aus examples/demo lässt sich mit parseData lesen
const dir = new URL('../examples/demo/', import.meta.url);
const demo = parseData({
  house: readFileSync(new URL('house.json', dir), 'utf8'),
  furniture: readFileSync(new URL('furniture.yaml', dir), 'utf8'),
  devices: readFileSync(new URL('devices.yaml', dir), 'utf8'),
});
check('Demo-Daten: Etagen, Möbel und Leuchten', demo.house.floors.length > 0 && demo.items.length > 0 && demo.devices.length > 0);

process.exit(failed ? 1 : 0);
