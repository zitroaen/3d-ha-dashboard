// Leistungsbudget: Zeichenaufrufe und Dreiecke pro Bild (unabhängig von der Rechnergeschwindigkeit, also stabil in der
// CI) plus gemessene Bildzeiten als Hinweis. Steigt die Zahl der Zeichenaufrufe oder Dreiecke über das Budget,
// leidet die Leistung auf Tablets – dann Geometrie zusammenfassen statt das Budget zu erhöhen.
//   node tests/performance.mjs
import { DATA_DIR, ENTITIES, IS_DEMO } from './lib/config.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, guardedPage } from './lib/browser.mjs';

if (!IS_DEMO) {
  console.log('ℹ Leistungsbudget gilt für das Demo-Haus (ohne DATA_DIR) – übersprungen');
  process.exit(0);
}
// Budget für das Demo-Haus (Haus, Garage, Garten), ganze Ebene 0 bzw. 1 im Bild
const BUDGET = { calls: 130, triangles: 120000 };

const { server, base } = await startServer({ dataDir: DATA_DIR, entities: ENTITIES });
const browser = await launchBrowser();
const errors = [];
const ok = (cond, msg, fail) => (cond ? console.log(`✔ ${msg}`) : errors.push(fail ?? msg));

try {
  const page = await guardedPage(browser, base, errors, { viewport: { width: 1280, height: 800 }, label: 'leistung' });
  const res = await page.evaluate(() => {
    const v = window.panel.view, r = v.renderer;
    // auf die Grafik warten (ein Pixel lesen), sonst misst man nur das Absenden der Befehle
    const gl = r.getContext(), px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const out = {};
    for (const level of v.levels) {
      window.panel.setLevel(level);
      v.setQuality('low');
      r.info.reset();
      r.info.autoReset = false;
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) { v.renderNow(); sync(); }
      const fast = (performance.now() - t0) / 5;
      const calls = r.info.render.calls / 5, triangles = r.info.render.triangles / 5;
      r.info.autoReset = true;
      v.setQuality('high');
      const t1 = performance.now();
      for (let i = 0; i < 3; i++) { v.renderNow(); sync(); }
      const high = (performance.now() - t1) / 3;
      out[level] = { calls: Math.round(calls), triangles, fast: Math.round(fast), high: Math.round(high) };
    }
    return out;
  });
  for (const [level, m] of Object.entries(res)) {
    ok(m.calls <= BUDGET.calls && m.triangles <= BUDGET.triangles,
      `Ebene ${level}: ${m.calls} Zeichenaufrufe, ${Math.round(m.triangles / 1000)}k Dreiecke (Budget ${BUDGET.calls} / ${BUDGET.triangles / 1000}k); Bildzeit sparsam ${m.fast} ms, hoch ${m.high} ms (Software-Grafik)`,
      `Ebene ${level} über dem Budget: ${JSON.stringify(m)}`);
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error(`\n✖ ${errors.length} Fehler:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('\n✔ Leistungsbudget eingehalten');
