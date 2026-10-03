// Headless-Browser für die Tests (playwright-core, WebGL per SwiftShader).
// Windows: vorhandener Microsoft Edge (kein Download). Linux/macOS (z. B. Cloud-Agent, CI): Chromium, einmalig
// installiert mit `npx playwright-core install chromium` (unter Linux ggf. `--with-deps`).
// Mit PW_CHANNEL lässt sich ein Kanal erzwingen (msedge, chrome, chromium), mit PW_EXECUTABLE ein Browser-Programm.
import { chromium } from 'playwright-core';

export async function launchBrowser() {
  const channel = process.env.PW_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
  const opts = {
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  };
  if (process.env.PW_EXECUTABLE) opts.executablePath = process.env.PW_EXECUTABLE;
  else if (channel && channel !== 'chromium') opts.channel = channel;
  try {
    return await chromium.launch(opts);
  } catch (e) {
    throw new Error(`Browser nicht startbar (${channel || 'chromium'}): ${e.message.split('\n')[0]}\n` +
      'Tipp: npx playwright-core install chromium   (Linux: --with-deps)');
  }
}

/** Seite mit Fehler- und Request-Wächtern: JS-Fehler und externe Requests landen in errors */
export async function guardedPage(browser, base, errors, { viewport, label, query = '', allowConsole = null }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !allowConsole?.test(m.text()) && errors.push(`${label}: ${m.text()}`));
  // Externe Requests sind verboten – das Panel muss offline funktionieren
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) errors.push(`externer Request: ${u}`);
  });
  await page.goto(`${base}/tests/harness.html${query}`);
  await page.waitForFunction(() => window.panelReady === true, null, { timeout: 120000 });
  return page;
}

/** Plan-/Weltpunkt [x, y, z] in Bildschirmkoordinaten der Seite */
export const toScreen = (page, p) =>
  page.evaluate((p) => {
    const v = window.panel.view;
    const s = new v.camera.position.constructor(p[0], p[1], p[2]).project(v.camera);
    const rect = v.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((s.x + 1) / 2) * rect.width, y: rect.top + ((1 - s.y) / 2) * rect.height };
  }, p);
