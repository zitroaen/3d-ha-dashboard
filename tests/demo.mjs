// Demo-Modus: eingebettetes Demo-Haus (panel config demo: true) und Fallback, wenn die Daten nicht erreichbar sind.
// Prüft: Hinweis, lokales Schalten ohne HA-Aufrufe, Sonne weiter aus hass, Editor speichert nur in eigene
// Demo-Benutzerdaten (nie Dateien, nie die Daten des eigenen Hauses), kein Export,
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

  // Das Demo-Haus ist unverknüpft; eine (im Editor) mit einer echten Entity verknüpfte Leuchte schaltet über HA
  const real = await page.evaluate(async () => {
    const v = window.panel.view;
    const unlinked = [...v.lamps.values()].every((s) => s.lamp.entity == null);
    const s = v.lamps.get('eg_wohnen_wandleuchte');
    s.lamp.entity = 'light.demo_wandleuchte'; // existiert im simulierten HA wie eine echte Lampe
    window.mockHass.calls.length = 0;
    await window.panel._onLampTap('eg_wohnen_wandleuchte');
    const call = window.mockHass.calls.find((c) => c.domain);
    s.lamp.entity = null;
    return { unlinked, call: call && `${call.domain}.${call.service}:${call.data.entity_id}` };
  });
  ok(real.unlinked && real.call === 'light.turn_off:light.demo_wandleuchte',
    `${label}: Demo-Leuchten unverknüpft, echte Verknüpfung schaltet über HA`, `${label}: echte Entity ${JSON.stringify(real)}`);

  // Editor: Fertig speichert (nur in eigene Demo-Benutzerdaten), kein Export; Leuchte verknüpfen, Fertig
  await page.evaluate(() => window.panel.setEditing(true));
  await page.evaluate(() => {
    const ed = window.panel.editor;
    ed.select({ type: 'lamp', id: 'eg_wohnen_wandleuchte' });
    ed.setEntity('light.demo_wandleuchte');
  });
  const bar = await page.evaluate(() => {
    const hidden = (a) => window.panel.shadowRoot.querySelector(`.tools button[data-act="${a}"]`).hidden;
    return { cancel: hidden('cancel'), done: hidden('done'), exp: hidden('export'), save: !!window.panel.shadowRoot.querySelector('.tools button[data-act="save"]') };
  });
  ok(!bar.cancel && !bar.done && bar.exp && !bar.save, `${label}: Editor mit Abbrechen/Fertig, ohne Speichern-Knopf und Export`, `${label}: Werkzeugleiste ${JSON.stringify(bar)}`);
  await page.evaluate(() => window.panel._editAction('export'));
  await page.evaluate(() => window.panel._editAction('done'));
  const saved = await page.evaluate(() => {
    const keys = window.mockHass.calls.filter((c) => c.ws?.type === 'frontend/set_user_data').map((c) => c.ws.key);
    return { keys, entity: window.mockHass._userData?.ha_3d_dashboard_layout_demo?.devices?.eg_wohnen_wandleuchte?.entity };
  });
  ok(saved.keys.length === 1 && saved.keys[0] === 'ha_3d_dashboard_layout_demo' && saved.entity === 'light.demo_wandleuchte' && !writes.length,
    `${label}: Fertig speichert nur in Demo-Benutzerdaten (keine Dateien, eigene Daten unberührt)`, `${label}: Speichern ${JSON.stringify(saved)} ${writes}`);
  // nach dem Neuladen ist die Verknüpfung wieder da
  const after = await page.evaluate(async () => {
    window.panel._dataText = null;
    await window.panel.reloadData();
    return window.panel.view.lamps.get('eg_wohnen_wandleuchte').lamp.entity;
  });
  ok(after === 'light.demo_wandleuchte', `${label}: gespeicherte Demo-Verknüpfung bleibt nach dem Neuladen`, `${label}: nach Neuladen ${after}`);
  // Speichern scheitert -> Editiermodus bleibt offen, Änderungen bleiben erhalten
  const failed = await page.evaluate(async () => {
    const mh = window.mockHass, orig = mh.callWS;
    mh.callWS = async (msg) => { if (msg.type === 'frontend/set_user_data') throw new Error('offline'); return orig(msg); };
    window.panel.setEditing(true);
    window.panel.editor.select({ type: 'lamp', id: 'eg_wohnen_wandleuchte' });
    window.panel.editor.setEntity(null);
    await window.panel._editAction('done');
    const r = { editing: window.panel.hasAttribute('editing'), changes: window.panel.editor.changes.size };
    mh.callWS = orig;
    window.panel.cancelEditing();
    return r;
  });
  ok(failed.editing && failed.changes > 0, `${label}: Speichern scheitert -> Editor bleibt offen, nichts geht verloren`, `${label}: Fehlschlag ${JSON.stringify(failed)}`);
  await page.evaluate(async () => { window.mockHass._userData = {}; window.panel._dataText = null; await window.panel.reloadData(); });
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
  const p1 = await checkDemo('demo-config', '?demo=1', /Error: offline/, /^Demo-Haus/);
  // data_url wird als Ordner aufgelöst (auch ohne abschließenden Schrägstrich) und relativ zur Seite
  const urls = await p1.evaluate(() => {
    const u = (c) => { window.panel._panel = { config: c }; return new URL(window.panel.dataUrl).pathname; };
    return [u({ data_url: '/local/ha-3d-dashboard/' }), u({ data_url: '/local/ha-3d-dashboard' }), u({})];
  });
  ok(urls[0] === '/local/ha-3d-dashboard/' && urls[1] === '/local/ha-3d-dashboard/' && urls[2] === '/dist/',
    `data_url wird als Ordner aufgelöst (${urls.join(' · ')})`, `data_url: ${urls}`);
  await p1.close();

  const p2 = await checkDemo('fallback', '?nodata=1', /404|Failed to load resource|Error: offline/, /keine Daten unter \/fehlt/);
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

  // Einbettung wie in HA ab 2026.9: Container ohne Höhe – das Panel muss trotzdem bis zum unteren Rand reichen.
  // iphone: Panel beginnt 47 px tiefer (iOS-App, unter der Statusleiste) – die Werkzeugleiste darf nicht abgeschnitten sein
  for (const [label, viewport, top] of [['desktop', { width: 1400, height: 900 }, 0], ['phone', { width: 390, height: 844 }, 0],
    ['iphone', { width: 390, height: 844 }, 47]]) {
    const p4 = await newPage(browser, { viewport });
    p4.on('pageerror', (e) => errors.push(`ha-${label}: ${e.message}`));
    await p4.goto(`${base}/tests/harness.html?demo=1&ha=1${top ? `&top=${top}` : ''}`);
    await p4.waitForFunction(() => window.panelReady === true, null, { timeout: 120000 });
    // Leuchte gewählt: alle Knöpfe (auch Verknüpfen, Speichern) in der Leiste
    await p4.evaluate(() => { window.panel.setEditing(true); window.panel.editor.select({ type: 'lamp', id: 'eg_wohnen_wandleuchte' }); });
    await p4.waitForTimeout(300);
    const size = await p4.evaluate(([w, h]) => {
      const r = window.panel.getBoundingClientRect();
      const bar = window.panel.shadowRoot.querySelector('.editbar').getBoundingClientRect();
      const buttons = [...window.panel.shadowRoot.querySelectorAll('.tools button')].filter((b) => !b.hidden);
      const outside = buttons.filter((b) => { const q = b.getBoundingClientRect(); return q.left < 0 || q.right > w || q.bottom > h || q.width < 48; })
        .map((b) => b.dataset.act);
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), canvas: window.panel.view.renderer.domElement.clientHeight,
        barBottom: Math.round(bar.bottom), barH: Math.round(bar.height), buttons: buttons.length, outside };
    }, [viewport.width, viewport.height]);
    await p4.screenshot({ path: join(OUT, `demo_ha-einbettung_${label}.png`) });
    ok(size.top === top && size.bottom === viewport.height && size.canvas === viewport.height - top &&
      size.barH > 0 && size.barBottom <= viewport.height && size.buttons >= 6 && !size.outside.length,
      `HA-Einbettung (${label}): Panel reicht bis zum unteren Rand, alle ${size.buttons} Knöpfe sichtbar (${size.top}–${size.bottom}px)`,
      `HA-Einbettung ${label}: ${JSON.stringify(size)}`);
    await p4.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error('\n✖ Fehler:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\n✔ Demo-Tests bestanden');
