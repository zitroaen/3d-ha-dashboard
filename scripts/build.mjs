// Bündelt den Panel-Code (inkl. three.js) in eine einzige Datei: dist/ha-3d-dashboard.js
// Die Daten (data/) sind bewusst NICHT im Bundle – das Panel lädt sie zur Laufzeit.
// Einzige Ausnahme: das erfundene Demo-Haus (examples/demo/model.yaml) steckt als Text im Bundle (src/demo.js).
import * as esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const watch = process.argv.includes('--watch');

const DEMO_MODEL = resolve('examples/demo/model.yaml');
const demoPlugin = {
  name: 'demo-data',
  setup(b) {
    b.onResolve({ filter: /^demo-data$/ }, () => ({ path: 'demo-data', namespace: 'demo-data' }));
    b.onLoad({ filter: /.*/, namespace: 'demo-data' }, async () => ({
      contents: `export default ${JSON.stringify(await readFile(DEMO_MODEL, 'utf8'))};`,
      loader: 'js',
      watchFiles: [DEMO_MODEL],
    }));
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
