// Unit-Tests für das Speichern: patchYamlText ersetzt nur Werte, mit LF- und CRLF-Dateien,
// im Flow-Stil (furniture.yaml) und im Block-Stil (devices.yaml).
//   node tests/store.test.mjs
import * as yaml from 'js-yaml';
import { patchYamlText } from '../src/store.js';

let failed = 0;
const check = (name, cond, info = '') => {
  if (cond) console.log(`✔ ${name}`);
  else {
    failed++;
    console.error(`✖ ${name} ${info}`);
  }
};

const block = ['# Kopf', 'devices:', '  - id: a', '    type: light', '    pos: [1, 2]', '    height: 1', '    entity: null', '  - id: b', '    pos: [3, 4]', ''].join('\n');
const flow = ['# Kopf', 'items:', '  # Abschnitt', '  - { id: s, kind: sofa, pos: [1, 2], rot: 75 }', '  - { id: t, kind: tv, pos: [3, 4] }', ''].join('\n');

for (const eol of ['\n', '\r\n']) {
  const tag = eol === '\n' ? 'LF' : 'CRLF';
  const b = block.replace(/\n/g, eol), f = flow.replace(/\n/g, eol);

  const ob = patchYamlText(b, 'a', { pos: [5, 6], height: 1.5, entity: ['light.x', 'light.y'], rot: 30 });
  const da = yaml.load(ob).devices.find((d) => d.id === 'a');
  check(`Block ${tag}: Werte ersetzt`, JSON.stringify(da) === JSON.stringify({ id: 'a', type: 'light', pos: [5, 6], height: 1.5, entity: ['light.x', 'light.y'], rot: 30 }), JSON.stringify(da));
  check(`Block ${tag}: Zeilenende und Kommentar bleiben`, ob.startsWith('# Kopf' + eol) && !ob.replace(/\r\n/g, '').includes(eol === '\n' ? '\r' : '\n'));
  check(`Block ${tag}: andere Einträge unverändert`, yaml.load(ob).devices.find((d) => d.id === 'b').pos.join() === '3,4');

  const ob2 = patchYamlText(ob, 'a', { entity: null });
  check(`Block ${tag}: Verknüpfung lösen`, yaml.load(ob2).devices.find((d) => d.id === 'a').entity === null);

  const of = patchYamlText(f, 's', { pos: [7, 8], rot: 315 });
  check(`Flow ${tag}: Werte ersetzt, Leerzeichen vor } bleibt`, of.includes('pos: [7, 8], rot: 315 }'), of);
  const of2 = patchYamlText(f, 't', { rot: 90 });
  check(`Flow ${tag}: fehlender Wert wird ergänzt`, of2.includes('{ id: t, kind: tv, pos: [3, 4], rot: 90 }'), of2);
  check(`Flow ${tag}: Abschnittskommentar bleibt`, of.includes('  # Abschnitt'));
}

if (failed) process.exit(1);
