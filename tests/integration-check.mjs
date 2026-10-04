// Prüft die HA-Integration ohne Python: Versionen, HACS-Angaben, Markenbilder, Übersetzungen.
//   node tests/integration-check.mjs   (Teil von npm test; die eigentlichen Integrationstests: tests/ha, pytest)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_ROOT } from './lib/config.mjs';

const read = (f) => JSON.parse(readFileSync(join(ENGINE_ROOT, f), 'utf8'));
const errors = [];
const pkg = read('package.json');
const manifest = read('custom_components/ha_3d_dashboard/manifest.json');
const hacs = read('hacs.json');

if (manifest.version !== pkg.version) errors.push(`manifest.json-Version ${manifest.version} ≠ package.json ${pkg.version}`);
if (manifest.domain !== 'ha_3d_dashboard') errors.push(`manifest.json: domain ${manifest.domain}`);
for (const k of ['name', 'documentation', 'issue_tracker', 'codeowners', 'version']) if (!manifest[k]) errors.push(`manifest.json: ${k} fehlt`);
if (!hacs.zip_release || hacs.filename !== `${manifest.domain}.zip`) errors.push('hacs.json: zip_release/filename passen nicht zum Release-Paket');

// Markenbilder (ab HA 2026.3 aus dem Ordner brand/ der Integration)
for (const img of ['icon.png', 'icon@2x.png', 'logo.png', 'logo@2x.png'])
  if (!existsSync(join(ENGINE_ROOT, 'custom_components/ha_3d_dashboard/brand', img))) errors.push(`brand/${img} fehlt (node scripts/logo.mjs)`);

// alle Übersetzungen mit denselben Schlüsseln
const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
const de = keys(read('custom_components/ha_3d_dashboard/translations/de.json'));
const en = keys(read('custom_components/ha_3d_dashboard/translations/en.json'));
if (de.join() !== en.join()) errors.push('Übersetzungen de/en haben unterschiedliche Schlüssel');

if (errors.length) {
  console.error('✖ Integration:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log(`✔ Integration ${manifest.domain} ${manifest.version}: Versionen, HACS-Angaben, Markenbilder und Übersetzungen stimmen`);
