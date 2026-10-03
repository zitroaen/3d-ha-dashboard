// Demo-Modus gegen das simulierte HA (nur sun.sun, die Demo-Entities gibt es dort nicht):
//   ?modus=demo         panel_custom config { demo: true }
//   ?modus=keine-daten  data_url zeigt ins Leere (404) -> Fallback mit Hinweis
//   (ohne Modus)        eigene Daten: kein Demo-Hinweis
// Geprüft: Hinweis, lokales Schalten ohne Dienstaufrufe, Editor ohne Speichern/Export/Verknüpfen,
// nichts in den HA-Benutzerdaten, keine externen Requests.   node tests/demo-mode.mjs
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { OUT, ENGINE_ROOT } from './lib/config.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, guardedPage, toScreen } from './lib/browser.mjs';

const DEMO = join(ENGINE_ROOT, 'examples', 'demo');
await mkdir(OUT, { recursive: true });
const { server, base } = await startServer({ dataDir: DEMO, entities: join(DEMO, 'entities.txt') });
const browser = await launchBrowser();
const errors = [];
const ok = (cond, msg, fail) => (cond ? console.log(`✔ ${msg}`) : errors.push(fail ?? msg));
const settle = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000, polling: 50 }).catch(() => {});

const state = (page) => page.evaluate(() => {
  const root = window.panel.shadowRoot;
  const vis = (sel) => { const b = root.querySelector(sel); return !!b && getComputedStyle(b).display !== 'none' && !b.hidden; };
  const note = root.querySelector('.demo-note');
  return {
    demo: window.panel.hasAttribute('demo'),
    note: vis('.demo-note') ? note.textContent : null,
    noteH: vis('.demo-note') ? note.getBoundingClientRect().height : 0,
    linksToggle: vis('.links-toggle'),
    error: root.querySelector('.error').classList.contains('show'),
    house: window.panel.view?.house?.name ?? window.panel.view?.activeFloor?.floor?.name,
    calls: window.mockHass.calls.map((c) => c.ws ? `ws:${c.ws.type}` : `${c.domain}.${c.service}`),
  };
});

try {
  // ---------------- eigene Daten: kein Hinweis ----------------
  {
    const page = await guardedPage(browser, base, errors, { viewport: { width: 1280, height: 800 }, label: 'eigene-daten' });
    const s = await state(page);
    ok(!s.demo && !s.note && s.linksToggle, 'eigene Daten: kein Demo-Hinweis, Link-Check sichtbar', `eigene Daten: ${JSON.stringify(s)}`);
    await page.close();
  }

  for (const modus of ['demo', 'keine-daten']) {
    for (const [vp, viewport] of Object.entries({ desktop: { width: 1600, height: 1000 }, phone: { width: 390, height: 844 } })) {
      const label = `${modus}-${vp}`;
      // der erwartete 404 beim Laden der eigenen Daten erscheint als Konsolenfehler des Browsers
      const page = await guardedPage(browser, base, errors, { viewport, label, query: `?modus=${modus}`, ignore: modus === 'keine-daten' ? /404|Failed to load resource/ : null });
      const s = await state(page);
      const want = modus === 'demo' ? 'Demo-Haus' : 'Demo-Haus – eigene Daten: siehe Anleitung';
      ok(s.demo && s.note === want && !s.error && s.house, `${label}: Demo-Haus mit Hinweis „${s.note}“`, `${label}: ${JSON.stringify(s)}`);
      ok(s.noteH >= 48, `${label}: Hinweis ist touch-tauglich (${s.noteH} px hoch)`, `${label}: Hinweis zu klein (${s.noteH} px)`);
      ok(!s.linksToggle, `${label}: Link-Check ausgeblendet`, `${label}: Link-Check sichtbar`);
      await settle(page, () => window.panel.view?.daylight != null);

      if (vp === 'desktop') {
        // Raum antippen schaltet lokal – kein Dienstaufruf an HA
        const lampId = await page.evaluate(() => [...window.panel.view.lamps.keys()].find((id) => id.includes('stehlampe')));
        const lampPos = await page.evaluate((id) => { const l = window.panel.view.lamps.get(id).lamp; return [l.pos[0], l.height, l.pos[1]]; }, lampId);
        const pt = await toScreen(page, [lampPos[0] + 1.5, 0, lampPos[2] + 1.5]);
        await page.mouse.click(pt.x, pt.y);
        await settle(page, () => window.panel.view.isRoomLit('wohnen'));
        ok(await page.evaluate(() => window.panel.view.isRoomLit('wohnen')), `${label}: Raum antippen schaltet lokal`);
        // Leuchte antippen: nur diese aus
        const lp = await toScreen(page, lampPos);
        await page.mouse.click(lp.x, lp.y);
        await settle(page, (id) => !window.panel.view.lamps.get(id).on, lampId);
        ok(await page.evaluate((id) => !window.panel.view.lamps.get(id).on, lampId), `${label}: Leuchte antippen schaltet lokal`);
        await page.evaluate(() => window.panel.view.setRoomLight('wohnen', true));
        await page.screenshot({ path: join(OUT, `demo-modus_${modus}_${vp}.png`) });

        // Editor: Speichern/Export/Verknüpfen ausgeblendet, Änderungen werden nicht geschrieben
        await page.evaluate(() => window.panel.setEditing(true));
        const tools = await page.evaluate(() => Object.fromEntries([...window.panel.shadowRoot.querySelectorAll('.tools button')].map((b) => [b.dataset.act, !b.hidden])));
        ok(tools.move && tools.undo && !tools.save && !tools.export && !tools.link, `${label}: Editor ohne Speichern/Export/Verknüpfen (${JSON.stringify(tools)})`, `${label}: Editor-Werkzeuge ${JSON.stringify(tools)}`);
        await page.evaluate(() => window.panel._editAction('save'));
        await page.evaluate(() => window.panel._editAction('export'));
        await page.screenshot({ path: join(OUT, `demo-modus_${modus}_editor.png`) });
        await page.evaluate(() => window.panel.setEditing(false));
        const after = await state(page);
        ok(after.calls.length === 0, `${label}: keine Dienstaufrufe, keine Benutzerdaten geschrieben`, `${label}: Aufrufe ${after.calls}`);
      } else {
        await page.screenshot({ path: join(OUT, `demo-modus_${modus}_${vp}.png`) });
      }

      // Hinweis wegtippen: bleibt weg
      await page.mouse.click(40, 48 + s.noteH / 2 + 2);
      ok(!(await state(page)).note, `${label}: Hinweis lässt sich wegtippen`, `${label}: Hinweis nicht wegtippbar`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error('\n✖ Fehler im Demo-Modus:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('\n✔ Alle Demo-Modus-Tests bestanden');
