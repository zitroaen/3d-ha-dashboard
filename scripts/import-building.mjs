// Fügt ein Gebäude (building.json, z. B. aus scripts/extract_plan.py) in model.yaml ein (docs/DATA_MODEL.md).
// Ein Gebäude mit derselben ID wird ersetzt; andere Gebäude, Außenbereiche und Objekte bleiben unverändert.
// Gibt es noch kein model.yaml, wird eines angelegt.
//   node scripts/import-building.mjs <building.json> [--name "Mein Haus"] [--north 90]
//   (Datenordner: DATA_DIR, --data oder ha3d.config.json der Instanz)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../tests/lib/config.mjs';
import { parseModel, MODEL_VERSION } from '../src/model/model.js';
import { toYaml, yamlHeader } from '../src/model/yaml.js';

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--name' && args[args.indexOf(a) - 1] !== '--north' && args[args.indexOf(a) - 1] !== '--data');
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (!src) {
  console.error('Aufruf: node scripts/import-building.mjs <building.json> [--name "Mein Haus"] [--north 90]');
  process.exit(1);
}

const building = JSON.parse(readFileSync(src, 'utf8'));
const file = join(DATA_DIR, 'model.yaml');
const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
const model = text.trim()
  ? parseModel(text)
  : { schema: 'ha3d', version: MODEL_VERSION, site: { name: opt('--name') || building.name, north_deg: 0, ground: { surface: 'lawn' } }, buildings: [], outdoor: [], objects: [] };
if (opt('--name')) model.site.name = opt('--name');
if (opt('--north') != null) model.site.north_deg = Number(opt('--north'));

const i = model.buildings.findIndex((b) => b.id === building.id);
if (i >= 0) model.buildings[i] = building;
else model.buildings.push(building);

mkdirSync(DATA_DIR, { recursive: true });
const header = yamlHeader(text) || '# Modell des Zuhauses. Format: engine/docs/DATA_MODEL.md';
writeFileSync(file, toYaml(model, header));
const rooms = building.floors.reduce((n, f) => n + f.rooms.length, 0);
console.log(`${i >= 0 ? 'Ersetzt' : 'Neu'}: Gebäude ${building.id} (${building.floors.length} Etagen, ${rooms} Räume) -> ${file}`);
console.log('Weiter: npm run validate');
