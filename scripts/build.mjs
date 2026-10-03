// Bündelt den Panel-Code (inkl. three.js) in eine einzige Datei: dist/ha-3d-dashboard.js
// Die Daten (data/) sind bewusst NICHT im Bundle – das Panel lädt sie zur Laufzeit. Einzige Ausnahme ist das
// erfundene Demo-Haus (examples/demo, src/demo.js) für den Demo-Modus.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  loader: { '.yaml': 'text' }, // Demo-Haus (src/demo.js) wird eingebettet
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
