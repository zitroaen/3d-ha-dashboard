// Bündelt den Panel-Code (inkl. three.js) in eine einzige Datei: dist/ha-3d-dashboard.js
// Die Daten (data/) sind bewusst NICHT im Bundle – das Panel lädt sie zur Laufzeit.
// Einzige Ausnahme: das erfundene Demo-Haus (examples/demo) steckt als Text im Bundle (Demo-Modus, siehe src/demo.js).
import * as esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const watch = process.argv.includes('--watch');

const DEMO_DIR = resolve('examples/demo');
const demoPlugin = {
  name: 'demo-data',
  setup(b) {
    b.onResolve({ filter: /^demo-data$/ }, () => ({ path: 'demo-data', namespace: 'demo-data' }));
    b.onLoad({ filter: /.*/, namespace: 'demo-data' }, async () => {
      const [house, furniture, devices] = await Promise.all(
        ['house.json', 'furniture.yaml', 'devices.yaml'].map((f) => readFile(resolve(DEMO_DIR, f), 'utf8')));
      return {
        contents: `export default ${JSON.stringify({ house, furniture, devices })};`,
        loader: 'js',
        watchFiles: ['house.json', 'furniture.yaml', 'devices.yaml'].map((f) => resolve(DEMO_DIR, f)),
      };
    });
  },
};

const options = {
  plugins: [demoPlugin],
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  outfile: 'dist/ha-3d-dashboard.js',
  legalComments: 'none',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
