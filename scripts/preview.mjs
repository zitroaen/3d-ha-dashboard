// Vorschau als ein Bild (Kontaktbogen): Oberflächen und Modelle – zum schnellen Prüfen neuer Einträge ohne die
// ganze Screenshot-Reihe. Ohne IDs: alle eigenen Oberflächen (model.yaml → surfaces) und eigenen Modelle (models/).
//   node scripts/preview.mjs [id …] [--all-surfaces] [--all-models] [--out datei.png] [--data <ordner>]
// Voraussetzung: npm run build (das Bundle wird wie im Panel geladen).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { load } from 'js-yaml';
import { DATA_DIR, OUT, ENGINE_ROOT, ENTITIES, restArgs } from '../tests/lib/config.mjs';
import { startServer } from '../tests/lib/server.mjs';
import { launchBrowser, guardedPage } from '../tests/lib/browser.mjs';

const args = restArgs();
const flag = (f) => args.includes(f) && args.splice(args.indexOf(f), 1);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : join(OUT, 'vorschau.png');
const allSurfaces = flag('--all-surfaces'), allModels = flag('--all-models');

const model = load(await readFile(join(DATA_DIR, 'model.yaml'), 'utf8')) || {};
let ids = args.filter((a) => !a.startsWith('--'));
if (allSurfaces) ids.push(...Object.keys(load(await readFile(join(ENGINE_ROOT, 'library/surfaces.yaml'), 'utf8'))), ...Object.keys(model.surfaces || {}));
if (!ids.length || allModels) {
  if (!ids.length) ids.push(...Object.keys(model.surfaces || {}));
  const dir = join(DATA_DIR, 'models');
  if (existsSync(dir)) ids.push(...readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => f.slice(0, -5)));
}
ids = [...new Set(ids)];
if (!ids.length) {
  console.error('Keine IDs: Oberflächen/Modelle angeben oder --all-surfaces');
  process.exit(1);
}
if (!existsSync(join(ENGINE_ROOT, 'dist/ha-3d-dashboard.js'))) {
  console.error('dist/ha-3d-dashboard.js fehlt – erst npm run build');
  process.exit(1);
}

const { server, base } = await startServer({ dataDir: DATA_DIR, entities: ENTITIES });
const browser = await launchBrowser();
const errors = [];
try {
  const page = await guardedPage(browser, base, errors, { viewport: { width: 800, height: 600 }, label: 'vorschau' });
  const url = await page.evaluate((ids) => window.panel.previewSheet(ids), ids);
  const unknown = await page.evaluate(() => window.panel.previewUnknown || []);
  if (unknown.length) {
    // häufigster Grund: aus dem Engine-Ordner aufgerufen – dann gilt das Demo-Haus, nicht die Instanz
    console.warn(`⚠ unbekannt: ${unknown.join(', ')} (Daten: ${DATA_DIR})`);
    if (DATA_DIR === join(ENGINE_ROOT, 'examples', 'demo')) console.warn('  Eigene Modelle einer Instanz: dort aufrufen – node engine/scripts/preview.mjs <id> …');
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`🖼  ${out} (${ids.length}: ${ids.join(', ')})`);
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error('✖ ' + errors.join('\n  '));
  process.exit(1);
}
