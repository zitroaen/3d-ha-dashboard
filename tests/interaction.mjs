// Bedien-Tests gegen das simulierte HA – mit den festen IDs des Demo-Hauses (examples/demo):
// Antippen (Raum/Leuchte) über HA, Lichtfarbe aus HA, Link-Check, Einrichtung neu bauen, Daten-Reload,
// Kompass, Editiermodus (Auswahl, Drehung, Anlegen, Rückgängig, Speichern, Verknüpfen).
//   node tests/interaction.mjs
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, ENTITIES, OUT, IS_DEMO } from './lib/config.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, guardedPage, toScreen } from './lib/browser.mjs';

if (!IS_DEMO) {
  console.log('ℹ Bedien-Tests laufen nur mit dem Demo-Haus (ohne DATA_DIR) – übersprungen');
  process.exit(0);
}

await mkdir(OUT, { recursive: true });
const { server, base } = await startServer({ dataDir: DATA_DIR, entities: ENTITIES });
const browser = await launchBrowser();
const errors = [];
const ok = (cond, msg, fail) => (cond ? console.log(`✔ ${msg}`) : errors.push(fail ?? msg));

try {
  const page = await guardedPage(browser, base, errors, { viewport: { width: 1600, height: 1000 }, label: 'desktop' });
  const clickShadow = async (sel) => {
    const r = await page.evaluate((sel) => {
      const b = window.panel.shadowRoot.querySelector(sel).getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
    }, sel);
    if (Math.min(r.w, r.h) < 48) errors.push(`Touch-Ziel zu klein: ${sel} (${r.w}x${r.h})`);
    await page.mouse.click(r.x, r.y);
    await page.waitForTimeout(80);
  };

  // ---------------- Antippen über HA ----------------
  const lampId = 'eg_wohnen_stehlampe'; // drei HA-Entities (je ein Spot)
  const lampPos = await page.evaluate((id) => {
    const l = window.panel.view.lamps.get(id).lamp;
    return [l.pos[0], l.height, l.pos[1]];
  }, lampId);

  // Raum: Bodenpunkt neben der Stehlampe antippen -> ein light.turn_on mit allen verknüpften Lichtern des Raums
  let pt = await toScreen(page, [lampPos[0] + 1.5, 0, lampPos[2] + 1.5]);
  await page.evaluate(() => (window.mockHass.calls.length = 0));
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(100);
  const room = await page.evaluate(() => ({
    lit: window.panel.view.isRoomLit('wohnen'),
    calls: window.mockHass.calls.map((c) => `${c.domain}.${c.service}:${[].concat(c.data.entity_id).length}`),
    spot: window.mockHass.states['light.demo_stehlampe_2']?.state,
  }));
  ok(room.lit && room.calls.join() === 'light.turn_on:4' && room.spot === 'on',
    `Raum antippen schaltet alle verknüpften Lichter über HA (${room.calls})`, `Raum antippen über HA: ${JSON.stringify(room)}`);

  // Leuchte antippen -> nur diese (alle 3 Spots) aus; anderer Raum bleibt an
  await page.evaluate(() => window.panel.view.setRoomLight('schlafen', true));
  pt = await toScreen(page, lampPos);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(150);
  const st = await page.evaluate((id) => ({
    lamp: window.panel.view.lamps.get(id).on,
    sconce: window.panel.view.lamps.get('eg_wohnen_wandleuchte').on,
    other: window.panel.view.isRoomLit('schlafen'),
    last: window.mockHass.calls.at(-1),
  }), lampId);
  ok(!st.lamp && st.sconce && st.other && st.last?.service === 'turn_off' && st.last.data.entity_id.length === 3,
    'Leuchte antippen schaltet nur diese Leuchte (alle 3 Spots) über HA', `Leuchte antippen: ${JSON.stringify(st)}`);

  // Farbe aus HA: ein Spot rot mit halber Helligkeit -> Leuchte rot, Helligkeit 1/3 * 0.5
  const col = await page.evaluate(async (id) => {
    await window.mockHass.callService('light', 'turn_on', { entity_id: 'light.demo_stehlampe_1', rgb_color: [255, 0, 0], brightness: 128 });
    const s = window.panel.view.lamps.get(id);
    return { on: s.on, r: +s.color.r.toFixed(2), g: +s.color.g.toFixed(2), b: +s.brightness.toFixed(2) };
  }, lampId);
  ok(col.on && col.r > 0.9 && col.g < 0.1 && Math.abs(col.b - 0.17) < 0.02, `Lichtfarbe und Helligkeit kommen aus HA (${JSON.stringify(col)})`, `Lichtfarbe aus HA: ${JSON.stringify(col)}`);

  // ---------------- Link-Check ----------------
  await clickShadow('.links-toggle');
  const lc = await page.evaluate(() => window.panel.shadowRoot.querySelector('.links .summary').textContent);
  await page.screenshot({ path: join(OUT, 'demo_linkcheck.png') });
  await page.evaluate(() => window.panel.shadowRoot.querySelector('.links-close').click());
  ok(/ 0 fehlende Entities/.test(lc), `Link-Check: ${lc}`);

  // ---------------- Einrichtung neu bauen, Haus bleibt ----------------
  const moved = await page.evaluate(() => {
    const v = window.panel.view;
    const house = () => v.activeFloor.group.children.filter((c) => !c.name.startsWith('furnishing')).map((c) => c.uuid);
    const before = house();
    v.setLamp('eg_schlafen_decke', true);
    const devices = [...v.lamps.values()].map((s) => ({ ...s.lamp }));
    const l = devices.find((d) => d.id === 'eg_schlafen_decke');
    l.pos = [l.pos[0] + 0.4, l.pos[1] + 0.5];
    v.setFurnishing({ devices, items: [] });
    return {
      houseUnchanged: JSON.stringify(before) === JSON.stringify(house()),
      layers: v.activeFloor.group.children.filter((c) => c.name.startsWith('furnishing')).length,
      stillOn: v.lamps.get('eg_schlafen_decke').on,
    };
  });
  ok(moved.houseUnchanged && moved.layers === 1 && moved.stillOn, 'Leuchte umziehen baut nur die Einrichtung neu, Zustand bleibt', `Umzug: ${JSON.stringify(moved)}`);

  // ---------------- Daten zur Laufzeit ----------------
  const original = await readFile(join(DATA_DIR, 'devices.yaml'), 'utf8');
  await page.route('**/data/devices.yaml', (route) => route.fulfill({ contentType: 'text/yaml', body: original.replace(/name: Decke Schlafzimmer/, 'name: Testlampe') }));
  const reload = await page.evaluate(async () => {
    const v = window.panel.view;
    await window.panel.reloadData();
    return { sameView: v === window.panel.view, name: window.panel.view.lamps.get('eg_schlafen_decke')?.lamp.name };
  });
  await page.unroute('**/data/devices.yaml');
  ok(reload.sameView && reload.name === 'Testlampe', 'Geänderte devices.yaml wird ohne Build übernommen', `Daten-Reload: ${JSON.stringify(reload)}`);

  // ---------------- Kompass ----------------
  const before = await page.evaluate(() => window.panel.view.northScreenAngle());
  await clickShadow('.compass');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => window.panel.view.northScreenAngle());
  ok(Math.abs(after) < 1, `Kompass nordet ein (${before.toFixed(0)}° -> ${after.toFixed(1)}°)`, `Kompass: vorher ${before}, nachher ${after}`);
  await page.screenshot({ path: join(OUT, 'demo_genordet.png') });

  // ---------------- Editiermodus ----------------
  await page.reload();
  await page.waitForFunction(() => window.panelReady === true, null, { timeout: 30000 });
  await clickShadow('.edit-toggle');
  // Sideboard-Front knapp über dem Boden antippen (darüber hängt der Fernseher)
  pt = await toScreen(page, [5.46, 0.08, 3.4]);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(80);
  const sel = await page.evaluate(() => window.panel.editor.sel?.id);
  ok(sel === 'sideboard', 'Editor: Möbel antippen wählt es aus', `Editor: Antippen wählt ${sel} statt sideboard`);

  // verschieben (wie per Pfeil) und drehen (wie per Ring) – programmgesteuert über den Proxy
  await page.evaluate(() => {
    const ed = window.panel.editor;
    ed._pushUndo();
    ed.sel.proxy.position.set(4.4, 0, 3.8);
    ed.sel.proxy.rotation.y = -0.5;
    ed._readProxy();
  });
  await page.screenshot({ path: join(OUT, 'demo_editor.png') });

  // Drehungen über 90° (Quaternion vom Drehring) richtig lesen
  const rots = await page.evaluate(() => {
    const ed = window.panel.editor, s = ed.sel, out = [];
    const keep = { pos: [...s.entry.pos], rot: s.entry.rot };
    const Y = new s.proxy.up.constructor(0, 1, 0);
    for (const deg of [180, 155, 225, 270, 95, 5]) {
      s.proxy.quaternion.setFromAxisAngle(Y, (-deg * Math.PI) / 180);
      ed._readProxy(true);
      out.push([deg, s.entry.rot]);
    }
    s.proxy.quaternion.setFromAxisAngle(Y, -Math.PI);
    s.proxy.quaternion.multiply(new s.proxy.quaternion.constructor().setFromAxisAngle(Y, (-5 * Math.PI) / 180));
    ed._readProxy(true);
    out.push([185, s.entry.rot]);
    Object.assign(s.entry, keep);
    ed.select({ type: s.type, id: s.id });
    return out;
  });
  const badRot = rots.filter(([want, got]) => Math.abs(((want - got + 540) % 360) - 180) > 0.11);
  ok(!badRot.length, `Editor: Drehungen über 90° werden richtig gelesen (${rots.map((r) => r[1]).join('°, ')}°)`, `Drehung falsch gelesen: ${JSON.stringify(badRot)}`);

  // Anlegen: Rückseite an die obere Außenwand (Innenfläche y = 0.3)
  await clickShadow('.tools button[data-act=align]');
  pt = await toScreen(page, [4.6, 0.8, 0.3]);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(80);
  const al = await page.evaluate(() => ({ pos: window.panel.editor.sel.entry.pos, rot: window.panel.editor.sel.entry.rot }));
  ok(al.rot === 0 && Math.abs(al.pos[1] - 0.527) < 0.02, `Editor: Anlegen setzt die Rückseite bündig an die Wand (${JSON.stringify(al)})`, `Anlegen: ${JSON.stringify(al)}`);
  await page.screenshot({ path: join(OUT, 'demo_editor_anlegen.png') });

  // Rückgängig
  await clickShadow('.tools button[data-act=undo]');
  const un = await page.evaluate(() => window.panel.editor._entry({ type: 'item', id: 'sideboard' }).pos);
  ok(Math.abs(un[0] - 4.4) < 0.01, 'Editor: Rückgängig stellt die vorige Lage wieder her', `Rückgängig: ${JSON.stringify(un)}`);

  // Speichern: Endpunkt abfangen (der Test ändert keine Dateien), nur Werte ersetzt, Kommentare bleiben
  let saved = null;
  await page.route('**/__save/**', async (route) => { saved = { url: route.request().url(), body: route.request().postData() }; await route.fulfill({ status: 204 }); });
  await clickShadow('.tools button[data-act=save]');
  await page.waitForTimeout(200);
  await page.unroute('**/__save/**');
  const line = saved?.body.split(/\r?\n/).find((l) => l.includes('id: sideboard'));
  ok(saved?.url.endsWith('furniture.yaml') && saved.body.includes('# --- Wohnzimmer: Sitzecke') && line?.includes('pos: [4.4, 3.8]'),
    `Editor: Speichern ersetzt nur die Werte (${line?.trim()})`, `Speichern: ${saved?.url} ${line}`);

  // Verknüpfen: Leuchtkugel wählen, Entity-Auswahl (vorgefiltert auf HA-Bereich Wohnzimmer), suchen, antippen
  await page.evaluate(() => window.panel.editor.select({ type: 'lamp', id: 'eg_wohnen_kugel' }));
  await clickShadow('.tools button[data-act=link]');
  const pk = await page.evaluate(() => {
    const r = window.panel.shadowRoot.querySelector('.picker');
    return { open: r.classList.contains('show'), area: r.querySelector('.chip.sel')?.textContent, rows: [...r.querySelectorAll('.list small')].map((x) => x.textContent) };
  });
  ok(pk.open && /Wohnzimmer/.test(pk.area || '') && pk.rows.length > 3 && pk.rows.every((t) => t.includes('Wohnzimmer')),
    `Entity-Auswahl: vorgefiltert auf ${pk.area} (${pk.rows.length} Einträge)`, `Entity-Auswahl: ${JSON.stringify({ ...pk, rows: pk.rows.slice(0, 3) })}`);
  await page.evaluate(() => {
    const inp = window.panel.shadowRoot.querySelector('.picker .search');
    inp.value = 'fernseh';
    inp.dispatchEvent(new Event('input'));
  });
  await page.screenshot({ path: join(OUT, 'demo_editor_verknuepfen.png') });
  await page.evaluate(() => window.panel.shadowRoot.querySelector('.picker .list button[data-id="light.demo_fernsehkugel"]').click());
  await page.evaluate(() => window.mockHass.callService('light', 'turn_on', { entity_id: 'light.demo_fernsehkugel' }));
  await page.waitForTimeout(50);
  const ln = await page.evaluate(() => ({
    entity: window.panel.editor.sel.entry.entity,
    on: window.panel.view.lamps.get('eg_wohnen_kugel').on,
  }));
  ok(ln.entity === 'light.demo_fernsehkugel' && ln.on, 'Entity antippen verknüpft die Leuchte, sie folgt sofort dem HA-Zustand', `Verknüpfen: ${JSON.stringify(ln)}`);
  let savedDev = null;
  await page.route('**/__save/**', async (route) => { if (route.request().url().endsWith('devices.yaml')) savedDev = route.request().postData(); await route.fulfill({ status: 204 }); });
  await clickShadow('.tools button[data-act=save]');
  await page.waitForTimeout(200);
  await page.unroute('**/__save/**');
  ok(savedDev?.includes('entity: light.demo_fernsehkugel') && savedDev.includes('# Geräte im Haus'), 'Verknüpfung wird in devices.yaml gespeichert (Kommentare bleiben)');

  // Fertig -> Editiermodus aus
  await clickShadow('.tools button[data-act=done]');
  const off = await page.evaluate(() => !window.panel.hasAttribute('editing') && !window.panel.editor.sel);
  ok(off, 'Fertig beendet den Editiermodus');
  await page.close();
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error('\n✖ Fehler:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\n✔ Alle Bedien-Tests bestanden');
