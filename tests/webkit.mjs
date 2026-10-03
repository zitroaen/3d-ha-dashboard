// Safari/iOS-Engine (WebKit): Startet das Panel wie in der HA-App auf dem iPhone (HA-Einbettung ab 2026.9, Demo-Haus)
// und prüft: lädt ohne JS-Fehler, reicht bis zum unteren Rand (iPhone: Panel beginnt unter der Statusleiste),
// Werkzeugleiste des Editors sichtbar, 3D-Ansicht läuft.
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
  for (const [label, viewport, top] of [['iphone', { width: 390, height: 844 }, 47], ['ipad', { width: 1024, height: 768 }, 24]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    page.setDefaultTimeout(120000);
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    await page.goto(`${base}/tests/harness.html?demo=1&ha=1&top=${top}`);
    await page.waitForFunction(() => window.panelReady === true, null, { timeout: 120000 });
    await page.evaluate(() => window.panel.setEditing(true));
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const c = window.panel.view.renderer;
      const bar = window.panel.shadowRoot.querySelector('.editbar').getBoundingClientRect();
      return { bottom: Math.round(window.panel.getBoundingClientRect().bottom), canvas: c.domElement.clientHeight,
        barBottom: Math.round(bar.bottom), gl: !!c.getContext() };
    });
    await page.screenshot({ path: join(OUT, `webkit_${label}.png`) });
    if (r.bottom !== viewport.height || r.canvas !== viewport.height - top || r.barBottom > viewport.height || !r.gl)
      errors.push(`${label}: ${JSON.stringify(r)}`);
    else console.log(`✔ WebKit (${label}): Panel ${top}–${r.bottom}px, Werkzeugleiste sichtbar, WebGL läuft`);
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
