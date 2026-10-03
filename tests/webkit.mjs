// Safari/iOS-Engine (WebKit): Startet das Panel wie in der HA-App auf dem iPhone (HA-Einbettung ab 2026.9, Demo-Haus)
// und prüft: lädt ohne JS-Fehler, füllt den Bildschirm, 3D-Ansicht läuft.
//   npx playwright-core install webkit   (einmalig; Linux: --with-deps)
//   node tests/webkit.mjs                (nicht Teil von npm test, läuft in der CI als eigener Job)
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { webkit } from 'playwright-core';
import { DATA_DIR, ENTITIES, OUT } from './lib/config.mjs';
import { startServer } from './lib/server.mjs';

await mkdir(OUT, { recursive: true });
const { server, base } = await startServer({ dataDir: DATA_DIR, entities: ENTITIES });
const browser = await webkit.launch();
const errors = [];
try {
  for (const [label, viewport] of [['iphone', { width: 390, height: 844 }], ['ipad', { width: 1024, height: 768 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    page.setDefaultTimeout(120000);
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    await page.goto(`${base}/tests/harness.html?demo=1&ha=1`);
    await page.waitForFunction(() => window.panelReady === true, null, { timeout: 120000 });
    const r = await page.evaluate(() => {
      const c = window.panel.view.renderer;
      return { h: Math.round(window.panel.getBoundingClientRect().height), canvas: c.domElement.clientHeight, gl: !!c.getContext() };
    });
    await page.screenshot({ path: join(OUT, `webkit_${label}.png`) });
    if (r.h !== viewport.height || r.canvas !== viewport.height || !r.gl) errors.push(`${label}: ${JSON.stringify(r)}`);
    else console.log(`✔ WebKit (${label}): Panel ${r.h}px hoch, WebGL läuft`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error('\n✖ WebKit:\n' + errors.join('\n'));
  process.exit(1);
}
