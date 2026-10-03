// Gemeinsames Modell über die Integration (panel config shared, simuliert in mock-hass.js):
// Datei als Ausgangspunkt, Fertig speichert für alle Benutzer (keine Datei-Schreibzugriffe), neuere Datei gewinnt,
// Speichern eines anderen Administrators lädt nach, Konflikte halten den Editor offen, nur Administratoren bearbeiten,
// ohne Datei und Speicher das Demo-Haus.
//   node tests/shared.mjs
import { DATA_DIR, ENTITIES, IS_DEMO } from './lib/config.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, guardedPage } from './lib/browser.mjs';

if (!IS_DEMO) {
  console.log('ℹ Tests des gemeinsamen Speichers laufen nur mit dem Demo-Haus (ohne DATA_DIR) – übersprungen');
  process.exit(0);
}

const { server, base } = await startServer({ dataDir: DATA_DIR, entities: ENTITIES });
const browser = await launchBrowser();
const errors = [];
const ok = (cond, msg, fail) => (cond ? console.log(`✔ ${msg}`) : errors.push(fail ?? msg));
const settle = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000, polling: 50 }).catch(() => {});
const LAMP = 'eg_wohnen_wandleuchte';
const entityOf = (page) => page.evaluate((id) => [].concat(window.panel.view.lamps.get(id).lamp.entity).join(), LAMP);

try {
  // Administrator
  const page = await guardedPage(browser, base, errors, { viewport: { width: 1600, height: 1000 }, label: 'gemeinsam', query: '?shared=1', allowConsole: /conflict/ });
  const writes = [];
  page.on('request', (r) => r.method() !== 'GET' && writes.push(`${r.method()} ${r.url()}`));
  const start = await page.evaluate(() => ({
    demo: window.panel.hasAttribute('demo'),
    readonly: window.panel.hasAttribute('readonly'),
    subscribed: window.mockHass._subs.length,
    shared: window.panel._shared,
  }));
  ok(!start.demo && !start.readonly && start.subscribed === 1 && start.shared?.revision === 0 && start.shared.fileHash,
    'gemeinsam: leerer Speicher -> model.yaml aus dem Datenordner, Aktualisierungen abonniert', `Start ${JSON.stringify(start)}`);
  const original = await entityOf(page);

  // Fertig speichert das ganze Modell in den gemeinsamen Speicher
  await page.evaluate((id) => {
    window.panel.setEditing(true);
    window.panel.editor.select({ type: 'lamp', id });
    window.panel.editor.setEntity('light.gemeinsam');
  }, LAMP);
  const exportShown = await page.evaluate(() => !window.panel.shadowRoot.querySelector('.tools button[data-act="export"]').hidden);
  await page.evaluate(() => window.panel._editAction('done'));
  const saved = await page.evaluate((id) => {
    const s = window.mockHass._shared;
    const o = s.model?.objects.find((x) => x.id === id);
    return { revision: s.revision, entity: o?.ha?.entities?.power, header: s.header, hash: s.file_hash,
      mine: window.panel._shared.revision, editing: window.panel.hasAttribute('editing'),
      userData: window.mockHass.calls.some((c) => c.ws?.type === 'frontend/set_user_data') };
  }, LAMP);
  ok(saved.revision === 1 && saved.mine === 1 && saved.entity === 'light.gemeinsam' && saved.header.startsWith('# Erfundenes Demo-Haus')
    && saved.hash === start.shared.fileHash && !saved.editing && !saved.userData && !writes.length && exportShown,
    'gemeinsam: Fertig speichert das Modell für alle (keine Datei, keine Benutzerdaten), Export verfügbar', `Speichern ${JSON.stringify(saved)} ${writes} export=${exportShown}`);

  // neu laden: gespeichertes Modell (Datei unverändert)
  await page.evaluate(async () => { window.panel._keys = null; await window.panel.reloadData(); });
  ok((await entityOf(page)) === 'light.gemeinsam', 'gemeinsam: nach dem Neuladen gilt das gespeicherte Modell');

  // eine andere model.yaml im Datenordner (Import) gewinnt
  await page.evaluate(async () => {
    window.mockHass._shared.file_hash = 'andere-datei';
    window.panel._keys = null;
    await window.panel.reloadData();
  });
  ok((await entityOf(page)) === original, 'gemeinsam: neuere model.yaml im Datenordner ersetzt das gespeicherte Modell',
    `nach Datei-Import ${await entityOf(page)}`);

  // ein anderer Administrator speichert -> Panel lädt von selbst nach
  await page.evaluate((id) => {
    const m = structuredClone(window.mockHass._shared.model);
    m.objects.find((x) => x.id === id).ha = { entities: { power: 'light.von_anderswo' } };
    window.mockHass._sharedSave(m, '# Erfundenes Demo-Haus', window.panel._shared.fileHash);
  }, LAMP);
  await settle(page, (id) => [].concat(window.panel.view.lamps.get(id).lamp.entity).join() === 'light.von_anderswo', LAMP);
  ok((await entityOf(page)) === 'light.von_anderswo', 'gemeinsam: Speichern an anderer Stelle wird sofort übernommen');

  // Konflikt: jemand speichert, während hier bearbeitet wird -> Editor bleibt offen, nichts geht verloren
  const conflict = await page.evaluate(async (id) => {
    window.panel.setEditing(true);
    window.panel.editor.select({ type: 'lamp', id });
    window.panel.editor.setEntity(null);
    window.mockHass._sharedSave(window.mockHass._shared.model, '', window.panel._shared.fileHash);
    await new Promise((r) => setTimeout(r, 50));
    await window.panel._editAction('done');
    const r = { editing: window.panel.hasAttribute('editing'), changes: window.panel.editor.changes.size, toast: window.panel.shadowRoot.querySelector('.toast')?.textContent };
    window.panel.cancelEditing();
    return r;
  }, LAMP);
  ok(conflict.editing && conflict.changes > 0 && /anderer Stelle/.test(conflict.toast || ''),
    'gemeinsam: Konflikt beim Speichern -> Meldung, Editor bleibt offen', `Konflikt ${JSON.stringify(conflict)}`);
  await page.close();

  // Benutzer ohne Administratorrechte: sieht das Modell, kann es nicht bearbeiten
  const user = await guardedPage(browser, base, errors, { viewport: { width: 1600, height: 1000 }, label: 'benutzer', query: '?shared=1&user=1' });
  const ro = await user.evaluate(() => ({
    readonly: window.panel.hasAttribute('readonly'),
    pen: getComputedStyle(window.panel.shadowRoot.querySelector('.edit-toggle')).display,
  }));
  ok(ro.readonly && ro.pen === 'none', 'gemeinsam: ohne Administratorrechte kein Stift', `Benutzer ${JSON.stringify(ro)}`);
  await user.close();

  // weder Datei noch gespeichertes Modell -> Demo-Haus; gespeichertes Modell ohne Datei -> das Modell
  const none = await guardedPage(browser, base, errors, {
    viewport: { width: 1600, height: 1000 }, label: 'leer', query: '?shared=1&nodata=1', allowConsole: /404|Failed to load resource/,
  });
  const demo = await none.evaluate(() => window.panel.hasAttribute('demo'));
  const stored = await none.evaluate(async () => {
    const r = await fetch('/data/model.yaml');
    const { load } = await import('/node_modules/js-yaml/dist/js-yaml.mjs');
    window.mockHass._sharedSave(load(await r.text()), '# gespeichert', null);
    window.panel._keys = null;
    await window.panel.reloadData();
    return { demo: window.panel.hasAttribute('demo'), lamps: window.panel.view.lamps.size };
  });
  ok(demo && !stored.demo && stored.lamps > 0, 'gemeinsam: ohne Daten Demo-Haus, gespeichertes Modell braucht keine Datei',
    `leer: demo=${demo} danach ${JSON.stringify(stored)}`);
  await none.close();
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error(`\n✖ ${errors.length} Fehler:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('\n✔ Tests des gemeinsamen Speichers bestanden');
