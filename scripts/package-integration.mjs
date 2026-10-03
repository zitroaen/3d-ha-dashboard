// Baut das Release-Paket der HA-Integration für HACS: dist/ha_3d_dashboard.zip
// Inhalt = custom_components/ha_3d_dashboard/ plus das Bundle unter frontend/ (HACS entpackt das Zip in diesen Ordner).
//   npm run package        (vorher npm run build)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const INTEGRATION = resolve('custom_components/ha_3d_dashboard');
const BUNDLE = resolve('dist/ha-3d-dashboard.js');
const ZIP = resolve('dist/ha_3d_dashboard.zip');

if (!existsSync(BUNDLE)) {
  console.error('✖ dist/ha-3d-dashboard.js fehlt – erst npm run build');
  process.exit(1);
}
mkdirSync(resolve(INTEGRATION, 'frontend'), { recursive: true });
copyFileSync(BUNDLE, resolve(INTEGRATION, 'frontend/ha-3d-dashboard.js'));
rmSync(ZIP, { force: true });
execFileSync('zip', ['-r', '-q', ZIP, '.', '-x', '*__pycache__*'], { cwd: INTEGRATION, stdio: 'inherit' });
console.log(`✔ ${ZIP}`);
