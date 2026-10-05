// Datenschutz-Wächter für das öffentliche Repo: Dieses Repo enthält nur Code und das erfundene Demo-Haus.
// Echte Hausdaten (Grundriss, Fotos, HA-Exporte, Gerätelisten) gehören in eine private Instanz, nie hierher.
//   node tests/privacy-guard.mjs        (läuft in npm test und in der CI)
//
// Zusätzlich lokal: Eine Datei .privacy-terms (gitignored, eine Zeichenkette pro Zeile, # = Kommentar) mit
// privaten Begriffen – Hausname, Personennamen, eigene Entity-IDs … Jeder Treffer in einer Repo-Datei lässt
// den Check scheitern. So rutscht beim Entwickeln nichts Persönliches in einen Commit.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { ENGINE_ROOT } from './lib/config.mjs';

const files = execSync('git ls-files --cached --others --exclude-standard', { cwd: ENGINE_ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => existsSync(join(ENGINE_ROOT, f)));

const SCANS = new Set(['.obj', '.usdz', '.ply', '.glb', '.gltf', '.las', '.laz', '.e57']);
const IMAGES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.tif', '.tiff', '.bmp']);
// Erlaubte Bilder: Doku-Screenshots (Demo-Haus) und die Markenbilder der Integration (erzeugt von scripts/logo.mjs)
const BRAND = /^custom_components\/ha_3d_dashboard\/brand\/(dark_)?(icon|logo)(@2x)?\.png$/;
const errors = [];
for (const f of files) {
  const ext = extname(f).toLowerCase();
  if (ext === '.pdf') errors.push(`${f}: PDF (Grundriss-Reports gehören in die private Instanz)`);
  if (SCANS.has(ext)) errors.push(`${f}: 3D-Scan (Grundstücks-Scans gehören in die private Instanz)`);
  if (IMAGES.has(ext) && !f.startsWith('docs/') && !BRAND.test(f)) errors.push(`${f}: Bild außerhalb von docs/ (Fotos/Texturen gehören in die private Instanz)`);
  if (/^(data|reference|Fotos|photos)\//i.test(f)) errors.push(`${f}: Ordner für private Daten`);
  if (/entities\.txt$/.test(f) && f !== 'examples/demo/entities.txt') errors.push(`${f}: HA-Export außerhalb des Demo-Hauses`);
  if (/(^|\/)(model\.yaml|house\.json|furniture\.yaml|devices\.yaml)$/.test(f) && !f.startsWith('examples/demo/') && !f.startsWith('templates/'))
    errors.push(`${f}: Hausdaten außerhalb von examples/demo`);
}

// Private Begriffe (nur lokal vorhanden)
const termsFile = join(ENGINE_ROOT, '.privacy-terms');
let checkedTerms = 0;
if (existsSync(termsFile)) {
  const terms = readFileSync(termsFile, 'utf8').split(/\r?\n/).map((t) => t.trim()).filter((t) => t && !t.startsWith('#'));
  checkedTerms = terms.length;
  const res = terms.map((t) => new RegExp(`(^|[^\\p{L}\\p{N}_])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_])`, 'iu'));
  for (const f of files) {
    if (IMAGES.has(extname(f).toLowerCase()) || SCANS.has(extname(f).toLowerCase()) || f === 'package-lock.json') continue;
    const text = readFileSync(join(ENGINE_ROOT, f), 'utf8');
    terms.forEach((t, i) => {
      if (res[i].test(text)) errors.push(`${f}: enthält privaten Begriff aus .privacy-terms`);
    });
  }
}

if (errors.length) {
  console.error('✖ Datenschutz-Check fehlgeschlagen:\n  ' + [...new Set(errors)].join('\n  '));
  process.exit(1);
}
console.log(`✔ Datenschutz-Check: ${files.length} Dateien, keine privaten Daten${checkedTerms ? ` (${checkedTerms} private Begriffe geprüft)` : ''}`);
