// Demo-Modus: eingebettetes Demo-Haus (panel config demo: true) und Fallback, wenn die Daten nicht erreichbar sind.
// Prüft: Hinweis, lokales Schalten ohne HA-Aufrufe, Sonne weiter aus hass, Editor ohne Speichern/Export,
// keine Schreib-Requests, keine externen Requests, data_url wird als Ordner aufgelöst.
//   node tests/demo.mjs
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, ENTITIES, OUT, IS_DEMO } from './lib/config.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, newPage, guardedPage, toScreen } from './lib/browser.mjs';

if (!IS_DEMO) {
  console.log('ℹ Demo-Tests laufen nur mit dem Demo-Haus (ohne DATA_DIR) – übersprungen');
  process.exit(0);
}

await mkdir(OUT, { recursive: true });
const { server, base } = await startServer({ dataDir: DATA_DIR, entities: ENTITIES });
const browser = await launchBrowser();
const errors = [];
const ok = (cond, msg, fail) => (cond ? console.log(`✔ ${msg}`) : errors.push(fail ?? msg));
const settle = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000, polling: 50 }).catch(() => {});

/** Prüfungen für beide Wege in den Demo-Modus */
async function checkDemo(label, query, allowConsole, noteRe) {
  const page = await guardedPage(browser, base, errors, { viewport: { width: 1600, height: 1000 }, label, query, allowConsole });
  const writes = [];
  page.on('request', (r) => r.method() !== 'GET' && writes.push(`${r.method()} ${r.url()}`));
  await page.evaluate(() => (window.mockHass.calls.length = 0));

  const note = await page.evaluate(() => {
    const el = window.panel.shadowRoot.querySelector('.demo-note');
    const b = el.getBoundingClientRect();
    return { demo: window.panel.hasAttribute('demo'), text: el.textContent, w: b.width, h: b.height };
  });
  ok(note.demo && noteRe.test(note.text) && /Demo-Haus – eigene Daten: siehe Anleitung/.test(note.text) && note.h >= 48,
    `${label}: Demo-Hinweis sichtbar und touch-tauglich (${note.h}px)`, `${label}: Hinweis ${JSON.stringify(note)}`);

  // lokal schalten: Raum und Leuchte antippen, kein einziger HA-Dienstaufruf
  const lampId = 'eg_wohnen_stehlampe';
  const lampPos = await page.evaluate((id) => {
    const l = window.panel.view.lamps.get(id).lamp;
    return [l.pos[0], l.height, l.pos[1]];
  }, lampId);
  let pt = await toScreen(page, [lampPos[0] + 1.5, 0, lampPos[2] + 1.5]);
  await page.mouse.click(pt.x, pt.y);
  await settle(page, () => window.panel.view.isRoomLit('wohnen'));
  ok(await page.evaluate(() => window.panel.view.isRoomLit('wohnen')), `${label}: Raum antippen schaltet lokal`);
  pt = await toScreen(page, lampPos);
  await page.mouse.click(pt.x, pt.y);
  await settle(page, (id) => !window.panel.view.lamps.get(id).on, lampId);
  const st = await page.evaluate((id) => ({
    lamp: window.panel.view.lamps.get(id).on,
    sconce: window.panel.view.lamps.get('eg_wohnen_wandleuchte').on,
    calls: window.mockHass.calls.filter((c) => c.domain).length,
  }), lampId);
  ok(!st.lamp && st.sconce && st.calls === 0, `${label}: Leuchte antippen schaltet nur diese, ohne HA-Dienstaufruf`, `${label}: Schalten ${JSON.stringify(st)}`);

  // Hass-Zustandsänderung an den Demo-Entities darf nichts überschreiben; Sonne kommt weiter aus hass
  const sun = await page.evaluate(async () => {
    await window.mockHass.callService('light', 'turn_off', { entity_id: 'light.demo_stehlampe_1' });
    const mh = window.mockHass;
    mh.states = { ...mh.states, 'sun.sun': { state: 'above_horizon', attributes: { azimuth: 215, elevation: 38 } } };
    window.panel.hass = mh;
    return { day: window.panel.hasAttribute('day'), sconce: window.panel.view.lamps.get('eg_wohnen_wandleuchte').on };
  });
  ok(sun.day && sun.sconce, `${label}: Sonne kommt aus hass, Lampen bleiben lokal`, `${label}: Sonne ${JSON.stringify(sun)}`);

  // Editor: Speichern/Export ausgeblendet, Änderungen werden nirgends hingeschrieben
  await page.evaluate(() => window.panel.setEditing(true));
  await page.evaluate(() => {
    const ed = window.panel.editor;
    const it = window.panel.view.furnishingData.items[0];
    ed.select({ type: 'item', id: it.id });
  });
  const bar = await page.evaluate(() => {
    const hidden = (a) => window.panel.shadowRoot.querySelector(`.tools button[data-act="${a}"]`).hidden;
    return { save: hidden('save'), exp: hidden('export'), move: hidden('move') };
  });
  ok(bar.save && bar.exp && !bar.move, `${label}: Editor ohne Speichern/Export`, `${label}: Werkzeugleiste ${JSON.stringify(bar)}`);
  await page.evaluate(() => window.panel._editAction('save'));
  await page.evaluate(() => window.panel._editAction('export'));
  const ws = await page.evaluate(() => window.mockHass.calls.filter((c) => c.ws?.type === 'frontend/set_user_data').length);
  ok(ws === 0 && !writes.length, `${label}: nichts wird gespeichert (keine Benutzerdaten, keine POSTs)`, `${label}: Schreibzugriffe ${ws} ${writes}`);
  await page.evaluate(() => window.panel.setEditing(false));

  // Hinweis lässt sich wegtippen
  await page.screenshot({ path: join(OUT, `demo_${label}.png`) });
  const r = await page.evaluate(() => {
    const b = window.panel.shadowRoot.querySelector('.demo-note').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(r.x, r.y);
  ok(await page.evaluate(() => window.panel.shadowRoot.querySelector('.demo-note').hidden), `${label}: Hinweis lässt sich ausblenden`);
  return page;
}

try {
  const p1 = await checkDemo('demo-config', '?demo=1', null, /^Demo-Haus/);
  // data_url wird als Ordner aufgelöst (auch ohne abschließenden Schrägstrich) und relativ zur Seite
  const urls = await p1.evaluate(() => {
    const u = (c) => { window.panel._panel = { config: c }; return new URL(window.panel.dataUrl).pathname; };
    return [u({ data_url: '/local/ha-3d-dashboard/' }), u({ data_url: '/local/ha-3d-dashboard' }), u({})];
  });
  ok(urls[0] === '/local/ha-3d-dashboard/' && urls[1] === '/local/ha-3d-dashboard/' && urls[2] === '/dist/',
    `data_url wird als Ordner aufgelöst (${urls.join(' · ')})`, `data_url: ${urls}`);
  await p1.close();

  const p2 = await checkDemo('fallback', '?nodata=1', /404|Failed to load resource/, /keine Daten unter \/fehlt/);
  await p2.close();

  // ohne Hass (reine Vorschau) funktioniert der Demo-Modus ebenfalls
  const p3 = await newPage(browser, { viewport: { width: 390, height: 844 } });
  p3.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await p3.goto(`${base}/tests/harness.html?demo=1`);
  await p3.waitForFunction(() => window.panelReady === true, null, { timeout: 120000 });
  await p3.evaluate(() => window.panel.view.setRoomLight('wohnen', true));
  await p3.waitForTimeout(200);
  await p3.screenshot({ path: join(OUT, 'demo_phone.png') });
  const h = await p3.evaluate(() => window.panel.shadowRoot.querySelector('.demo-note').getBoundingClientRect().height);
  ok(h >= 48, `Telefon: Demo-Hinweis (${h}px)`);
  await p3.close();
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error('\n✖ Fehler:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\n✔ Demo-Tests bestanden');
