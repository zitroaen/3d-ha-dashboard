// Gemeinsame Konfiguration aller Werkzeuge: Welcher Datenordner, welcher HA-Export, wohin mit Ausgaben.
// Standard ist das Demo-Haus der Engine; eine Instanz (dein eigenes Haus) setzt die Umgebungsvariablen:
//   DATA_DIR   Ordner mit house.json, furniture.yaml, devices.yaml, textures/   (Standard: examples/demo)
//   ENTITIES   HA-Export (Entwicklerwerkzeuge → Template) für Link-Check und Harness (Standard: DATA_DIR/entities.txt)
//   VIEWS      optionale JSON-Datei mit zusätzlichen Screenshot-Ansichten (siehe tests/screenshots.mjs)
//   OUT        Ausgabeordner für Screenshots (Standard: tests/output der Engine)
// Relative Pfade gelten ab dem aktuellen Arbeitsverzeichnis. Alternativ: --data <ordner> als Argument.
//
// Instanzen (dein eigenes Haus, siehe templates/instance) legen statt Umgebungsvariablen eine Datei
// ha3d.config.json in ihren Ordner – das funktioniert unter Windows, macOS und Linux gleich:
//   { "data": "data", "entities": "reference/entities.txt", "views": "views.json", "out": "tests/output" }
// Pfade darin gelten relativ zu dieser Datei. Umgebungsvariablen haben Vorrang.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENGINE_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};

/** ha3d.config.json im Arbeitsverzeichnis (Instanz) – nicht in der Engine selbst */
const instanceFile = join(process.cwd(), 'ha3d.config.json');
export const INSTANCE = existsSync(instanceFile) && resolve(process.cwd()) !== ENGINE_ROOT
  ? JSON.parse(readFileSync(instanceFile, 'utf8'))
  : null;
const fromInstance = (key) => (INSTANCE?.[key] ? resolve(dirname(instanceFile), INSTANCE[key]) : null);

export const DATA_DIR = resolve(arg('data') || process.env.DATA_DIR || fromInstance('data') || join(ENGINE_ROOT, 'examples', 'demo'));
const entities = process.env.ENTITIES ? resolve(process.env.ENTITIES) : fromInstance('entities') || join(DATA_DIR, 'entities.txt');
export const ENTITIES = existsSync(entities) ? entities : null;
export const VIEWS = process.env.VIEWS ? resolve(process.env.VIEWS) : fromInstance('views');
export const OUT = resolve(process.env.OUT || fromInstance('out') || join(ENGINE_ROOT, 'tests', 'output'));
export const IS_DEMO = DATA_DIR === resolve(join(ENGINE_ROOT, 'examples', 'demo'));

/** Argumente ohne --data <ordner> (für Filter wie Szenario-Namen) */
export const restArgs = () => {
  const a = process.argv.slice(2);
  const i = a.indexOf('--data');
  if (i >= 0) a.splice(i, 2);
  return a;
};
