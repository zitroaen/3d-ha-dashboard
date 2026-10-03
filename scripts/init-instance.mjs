// Legt im aktuellen Ordner eine private Instanz an (Hausdaten + Konfiguration), die Engine liegt in ./engine.
// Bestehende Dateien werden nie überschrieben.
//   node engine/scripts/init-instance.mjs --name "Mein Haus" [--demo]
//     --demo   mit dem Demo-Haus starten (zum Ausprobieren, später durch den eigenen Grundriss ersetzen)
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENGINE_ROOT } from '../tests/lib/config.mjs';

const cwd = process.cwd();
if (resolve(cwd) === ENGINE_ROOT) {
  console.error('Bitte im Instanz-Ordner ausführen (der Ordner, in dem engine/ liegt), nicht in der Engine selbst.');
  process.exit(1);
}
const arg = (n) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : null);
const name = arg('name') || 'Mein Haus';
const demo = process.argv.includes('--demo');
const T = join(ENGINE_ROOT, 'templates', 'instance');
const D = join(ENGINE_ROOT, 'examples', 'demo');
const done = [];

function put(target, content) {
  const p = join(cwd, target);
  if (existsSync(p)) return;
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
  done.push(target);
}

put('CLAUDE.md', readFileSync(join(T, 'CLAUDE.md'), 'utf8').replaceAll('{{HAUS}}', name));
put('package.json', readFileSync(join(T, 'package.json'), 'utf8'));
put('ha3d.config.json', readFileSync(join(T, 'ha3d.config.json'), 'utf8'));
put('plan.json', readFileSync(join(T, 'plan.json'), 'utf8').replace('"Mein Haus"', JSON.stringify(name)));
put('views.json', readFileSync(join(T, 'views.json'), 'utf8'));
put('.gitignore', readFileSync(join(T, 'gitignore'), 'utf8'));
mkdirSync(join(cwd, 'reference', 'photos'), { recursive: true });

// Datenordner: Kopf (Feldbeschreibung) aus dem Demo-Haus, Listen leer – oder komplett das Demo-Haus
const header = (file) => readFileSync(join(D, file), 'utf8').split(/\n(?=items:|devices:)/)[0].replace('des Demo-Hauses', '');
if (demo) {
  for (const f of ['house.json', 'furniture.yaml', 'devices.yaml']) {
    if (!existsSync(join(cwd, 'data', f))) {
      mkdirSync(join(cwd, 'data'), { recursive: true });
      copyFileSync(join(D, f), join(cwd, 'data', f));
      done.push(`data/${f}`);
    }
  }
  put('reference/entities.txt', readFileSync(join(D, 'entities.txt'), 'utf8'));
} else {
  put('data/furniture.yaml', `${header('furniture.yaml')}\nitems: []\n`);
  put('data/devices.yaml', `${header('devices.yaml')}\ndevices: []\n`);
}
mkdirSync(join(cwd, 'data', 'textures'), { recursive: true });

console.log(done.length ? `Angelegt: ${done.join(', ')}` : 'Nichts zu tun – alles schon vorhanden.');
console.log(demo
  ? 'Weiter: npm run setup && npm run serve'
  : 'Weiter: Grundriss nach reference/plan.pdf legen, plan.json anpassen, dann npm run setup && npm run import-plan');
