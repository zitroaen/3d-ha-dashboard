// Bedien-Tests gegen das simulierte HA – mit den festen IDs des Demo-Hauses (examples/demo):
// Antippen (Raum/Leuchte) über HA, Lichtfarbe aus HA, Link-Check, Einrichtung neu bauen, Daten-Reload,
// Kompass, Editiermodus (Auswahl, Drehung, Anlegen, Rückgängig, Fertig = Speichern, Abbrechen, Verknüpfen).
//   node tests/interaction.mjs
import { readFile, mkdir } from 'node:fs/promises';
import * as yaml from 'js-yaml';
import { join } from 'node:path';
import { DATA_DIR, ENTITIES, OUT, IS_DEMO, ENGINE_ROOT } from './lib/config.mjs';
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
// Auf einen Zustand warten statt fester Pausen: Software-WebGL in der CI ist deutlich langsamer als lokal.
const settle = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000, polling: 50 }).catch(() => {});
// Kamera steht still (kein Bild mehr angefordert, Lage unverändert über mehrere Abfragen) – erst dann Punkte in
// Bildschirmkoordinaten umrechnen und antippen (Nachlauf der Steuerung, Animationen, langsame CI-Grafik)
const steady = (page) => page.waitForFunction(() => {
  const v = window.panel.view;
  const key = [...v.camera.position.toArray(), v.camera.zoom, ...v.controls.target.toArray()].map((x) => x.toFixed(4)).join();
  const same = key === window.__camKey && !v._raf;
  window.__camKey = key;
  window.__camSteady = same ? (window.__camSteady || 0) + 1 : 0;
  return window.__camSteady >= 3;
}, null, { timeout: 15000, polling: 100 }).catch(() => {});
const until = async (cond, ms = 15000) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 50)); };

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
  await settle(page, () => window.panel.view.isRoomLit('wohnen'));
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
  await settle(page, (id) => !window.panel.view.lamps.get(id).on, lampId);
  const st = await page.evaluate((id) => ({
    lamp: window.panel.view.lamps.get(id).on,
    sconce: window.panel.view.lamps.get('eg_wohnen_wandleuchte').on,
    other: window.panel.view.isRoomLit('schlafen'),
    last: window.mockHass.calls.at(-1),
  }), lampId);
  ok(!st.lamp && st.sconce && st.other && st.last?.service === 'turn_off' && st.last.data.entity_id.length === 3,
    'Leuchte antippen schaltet nur diese Leuchte (alle 3 Spots) über HA', `Leuchte antippen: ${JSON.stringify(st)}`);

  // Leuchte lange drücken -> HA-Dialog (more-info) der Entity, ohne zu schalten
  const hold = await (async () => {
    await page.evaluate(() => {
      window.moreInfo = [];
      window.addEventListener('hass-more-info', (e) => window.moreInfo.push(e.detail.entityId), { once: true });
      window.callsBefore = window.mockHass.calls.length;
    });
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(100);
    return page.evaluate((id) => ({
      moreInfo: window.moreInfo,
      on: window.panel.view.lamps.get(id).on,
      calls: window.mockHass.calls.length - window.callsBefore,
    }), lampId);
  })();
  ok(hold.moreInfo[0] === 'light.demo_stehlampe_1' && !hold.on && hold.calls === 0,
    'Leuchte lange drücken öffnet den HA-Dialog der Entity, ohne zu schalten', `Lange drücken: ${JSON.stringify(hold)}`);

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
  const about = await page.evaluate(() => window.panel.shadowRoot.querySelector('.links .about').textContent);
  const { version } = JSON.parse(await readFile(join(ENGINE_ROOT, 'package.json'), 'utf8'));
  ok(about.startsWith(`Version ${version} · model.yaml`), `Link-Check zeigt Version und Datenquelle (${about})`, `Version: ${about}`);
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
  const original = await readFile(join(DATA_DIR, 'model.yaml'), 'utf8');
  await page.route('**/data/model.yaml', (route) => route.fulfill({ contentType: 'text/yaml', body: original.replace(/name: Decke Schlafzimmer/, 'name: Testlampe') }));
  const reload = await page.evaluate(async () => {
    const v = window.panel.view;
    await window.panel.reloadData();
    return { sameView: v === window.panel.view, name: window.panel.view.lamps.get('eg_schlafen_decke')?.lamp.name };
  });
  await page.unroute('**/data/model.yaml');
  ok(reload.sameView && reload.name === 'Testlampe', 'Geändertes model.yaml (nur Objekte) wird ohne Build und ohne Neuaufbau des Hauses übernommen', `Daten-Reload: ${JSON.stringify(reload)}`);

  // ---------------- Kompass ----------------
  const before = await page.evaluate(() => window.panel.view.northScreenAngle());
  await clickShadow('.compass');
  await settle(page, () => Math.abs(window.panel.view.northScreenAngle()) < 1);
  const after = await page.evaluate(() => window.panel.view.northScreenAngle());
  ok(Math.abs(after) < 1, `Kompass nordet ein (${before.toFixed(0)}° -> ${after.toFixed(1)}°)`, `Kompass: vorher ${before}, nachher ${after}`);
  await page.screenshot({ path: join(OUT, 'demo_genordet.png') });

  // ---------------- Ebenen (Stockwerke) ----------------
  await clickShadow('.levels button[data-level="1"]');
  const og = await page.evaluate(() => {
    const v = window.panel.view;
    return {
      level: v.level,
      shown: v.floors.filter((f) => f.group.visible).map((f) => f.floor.id).sort(),
      label: window.panel.shadowRoot.querySelector('.floor').textContent,
    };
  });
  ok(og.level === 1 && og.shown.join() === '__aussen,garage/eg,haus/eg,haus/og' && og.label === 'Obergeschoss',
    `Ebene 1. OG steht auf dem Erdgeschoss, Garten bleibt sichtbar (${og.shown})`, `Ebene OG: ${JSON.stringify(og)}`);
  await page.evaluate(() => (window.mockHass.calls.length = 0));
  await steady(page);
  pt = await toScreen(page, [1.5, 2.85, 2.0]);
  await page.mouse.click(pt.x, pt.y);
  await settle(page, () => window.mockHass.calls.some((c) => c.domain));
  const studio = await page.evaluate(() => window.mockHass.calls.filter((c) => c.domain).map((c) => `${c.domain}.${c.service}:${[].concat(c.data.entity_id)}`));
  ok(studio.join() === 'light.turn_on:light.demo_studio', 'Raum im Obergeschoss antippen schaltet dessen Licht über HA',
    `Studio: ${studio} (angetippt bei ${JSON.stringify(pt)}, Ebene ${await page.evaluate(() => window.panel.view.level)})`);
  await clickShadow('.levels button[data-level="0"]');
  const eg = await page.evaluate(() => window.panel.view.floors.filter((f) => f.group.visible).map((f) => f.floor.id).sort());
  ok(eg.join() === '__aussen,garage/eg,haus/eg', `Ebene EG blendet das Obergeschoss aus (${eg})`, `Ebene EG: ${eg}`);

  // ---------------- Editiermodus ----------------
  await page.reload();
  await page.waitForFunction(() => window.panelReady === true, null, { timeout: 120000 });
  await clickShadow('.edit-toggle');
  // Sideboard-Front knapp über dem Boden antippen (darüber hängt der Fernseher)
  await steady(page);
  pt = await toScreen(page, [5.46, 0.08, 3.4]);
  await page.mouse.click(pt.x, pt.y);
  await settle(page, () => !!window.panel.editor.sel);
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
  await settle(page, () => window.panel.editor.sel?.entry.rot === 0);
  const al = await page.evaluate(() => ({ pos: window.panel.editor.sel.entry.pos, rot: window.panel.editor.sel.entry.rot }));
  ok(al.rot === 0 && Math.abs(al.pos[1] - 0.527) < 0.02, `Editor: Anlegen setzt die Rückseite bündig an die Wand (${JSON.stringify(al)})`, `Anlegen: ${JSON.stringify(al)}`);
  await page.screenshot({ path: join(OUT, 'demo_editor_anlegen.png') });

  // Rückgängig
  await clickShadow('.tools button[data-act=undo]');
  const un = await page.evaluate(() => window.panel.editor._entry({ type: 'item', id: 'sideboard' }).pos);
  ok(Math.abs(un[0] - 4.4) < 0.01, 'Editor: Rückgängig stellt die vorige Lage wieder her', `Rückgängig: ${JSON.stringify(un)}`);

  // Fertig speichert das Modell: Endpunkt abfangen (der Test ändert keine Dateien), Kopfkommentar bleibt
  let saved = null;
  await page.route('**/__save/**', async (route) => { saved = { url: route.request().url(), body: route.request().postData() }; await route.fulfill({ status: 204 }); });
  await clickShadow('.tools button[data-act=done]');
  await until(() => saved);
  await page.unroute('**/__save/**');
  const savedSofa = saved && yaml.load(saved.body).objects.find((o) => o.id === 'sideboard');
  const offAfterSave = await page.evaluate(() => !window.panel.hasAttribute('editing'));
  ok(saved?.url.endsWith('model.yaml') && saved.body.startsWith('# Erfundenes Demo-Haus') && savedSofa?.pos.join() === '4.4,3.8' && offAfterSave,
    `Editor: Fertig speichert das Modell (sideboard: ${JSON.stringify(savedSofa?.pos)}) und beendet den Editiermodus`, `Fertig: ${saved?.url} ${JSON.stringify(savedSofa)} aus=${offAfterSave}`);

  // Abbrechen verwirft: verschieben, Abbrechen -> nichts gespeichert, alte Lage wieder da
  await clickShadow('.edit-toggle');
  let savedOnCancel = false;
  await page.route('**/__save/**', async (route) => { savedOnCancel = true; await route.fulfill({ status: 204 }); });
  await page.evaluate(() => {
    const ed = window.panel.editor;
    ed.select({ type: 'item', id: 'sideboard' });
    ed._pushUndo();
    ed.sel.proxy.position.set(2.0, 0, 2.0);
    ed._readProxy();
  });
  await clickShadow('.tools button[data-act=cancel]');
  await settle(page, () => window.panel.view.furnishingData.items.find((i) => i.id === 'sideboard').pos[0] > 2.5);
  const cancel = await page.evaluate(() => ({
    editing: window.panel.hasAttribute('editing'),
    pos: window.panel.view.furnishingData.items.find((i) => i.id === 'sideboard').pos,
  }));
  await page.unroute('**/__save/**');
  // Erwartet: Stand der Datei (das Speichern oben wurde abgefangen, die Datei ist unverändert)
  const filePos = yaml.load(await readFile(join(DATA_DIR, 'model.yaml'), 'utf8')).objects.find((o) => o.id === 'sideboard').pos;
  ok(!cancel.editing && !savedOnCancel && Math.abs(cancel.pos[0] - filePos[0]) < 0.01 && Math.abs(cancel.pos[1] - filePos[1]) < 0.01,
    'Editor: Abbrechen verwirft die Änderungen und speichert nichts', `Abbrechen: ${JSON.stringify(cancel)} gespeichert=${savedOnCancel}`);
  await clickShadow('.edit-toggle');

  // Verknüpfen: Leuchtkugel wählen, Entity-Auswahl (vorgefiltert auf HA-Bereich Wohnzimmer), suchen, antippen
  await page.evaluate(() => window.panel.editor.select({ type: 'lamp', id: 'eg_wohnen_kugel' }));
  // Verknüpfen öffnet die Einstellungen des Objekts (Rollen, Gesten, Zustandsanzeige), dort „+ Entity“ bei Schalten
  await clickShadow('.tools button[data-act=link]');
  const cfg = await page.evaluate(() => {
    const r = window.panel.shadowRoot.querySelector('.objcfg');
    return { open: r.classList.contains('show'), title: r.querySelector('h2')?.textContent, gestures: r.querySelectorAll('.gesture select').length,
      roles: [...r.querySelectorAll('button[data-act=pick]')].map((b) => b.dataset.role).join() };
  });
  ok(cfg.open && cfg.gestures === 3 && cfg.roles === 'power,info', `Einstellungen: ${cfg.title} mit Rollen und 3 Gesten`, `Einstellungen: ${JSON.stringify(cfg)}`);
  await page.screenshot({ path: join(OUT, 'demo_editor_einstellungen.png') });
  await clickShadow('.objcfg button[data-act=pick][data-role=power]');
  const pk = await page.evaluate(() => {
    const r = window.panel.shadowRoot.querySelector('.picker');
    return { open: r.classList.contains('show'), area: r.querySelector('.chip.sel')?.textContent, rows: [...r.querySelectorAll('.list small')].map((x) => x.textContent) };
  });
  ok(pk.open && /Wohnzimmer/.test(pk.area || '') && pk.rows.length > 3 && pk.rows.every((t) => t.includes('Wohnzimmer')),
    `Entity-Auswahl: vorgefiltert auf ${pk.area} (${pk.rows.length} Einträge)`, `Entity-Auswahl: ${JSON.stringify({ ...pk, rows: pk.rows.slice(0, 3) })}`);
  // Filter Steckdosen: nur switch.* (im Demo-Wohnzimmer die TV-Steckdose), dann zurück auf Licht
  const plugs = await page.evaluate(() => {
    const r = window.panel.shadowRoot.querySelector('.picker');
    r.querySelector('.chip[data-id="switch"]').click();
    const ids = [...r.querySelectorAll('.list button[data-id]')].map((b) => b.dataset.id);
    r.querySelector('.chip[data-id="light"]').click();
    const lights = [...r.querySelectorAll('.list button[data-id]')].map((b) => b.dataset.id);
    return { ids, lightsOnly: lights.length > 0 && lights.every((i) => i.startsWith('light.')) };
  });
  ok(plugs.ids.length > 0 && plugs.ids.every((i) => i.startsWith('switch.')) && plugs.lightsOnly,
    `Entity-Auswahl: Filter Steckdosen (${plugs.ids.join(', ')}) und Licht getrennt`, `Filter: ${JSON.stringify(plugs)}`);
  await page.evaluate(() => {
    const inp = window.panel.shadowRoot.querySelector('.picker .search');
    inp.value = 'fernseh';
    inp.dispatchEvent(new Event('input'));
  });
  await page.screenshot({ path: join(OUT, 'demo_editor_verknuepfen.png') });
  await page.evaluate(() => window.panel.shadowRoot.querySelector('.picker .list button[data-id="light.demo_fernsehkugel"]').click());
  await page.evaluate(() => window.mockHass.callService('light', 'turn_on', { entity_id: 'light.demo_fernsehkugel' }));
  await settle(page, () => window.panel.view.lamps.get('eg_wohnen_kugel').on);
  const ln = await page.evaluate(() => ({
    entity: window.panel.editor.sel.entry.entity,
    on: window.panel.view.lamps.get('eg_wohnen_kugel').on,
  }));
  ok([].concat(ln.entity).join() === 'light.demo_fernsehkugel' && ln.on, 'Entity antippen verknüpft die Leuchte, sie folgt sofort dem HA-Zustand', `Verknüpfen: ${JSON.stringify(ln)}`);
  // Fertig -> Verknüpfung gespeichert, Editiermodus aus
  let savedDev = null;
  await page.route('**/__save/**', async (route) => { if (route.request().url().endsWith('model.yaml')) savedDev = route.request().postData(); await route.fulfill({ status: 204 }); });
  await clickShadow('.tools button[data-act=done]');
  await until(() => savedDev);
  await page.unroute('**/__save/**');
  const kugel = savedDev && yaml.load(savedDev).objects.find((o) => o.id === 'eg_wohnen_kugel');
  ok(kugel?.ha?.entities?.power === 'light.demo_fernsehkugel' && savedDev.startsWith('# Erfundenes Demo-Haus'), 'Fertig speichert die Verknüpfung im Modell (ha.entities.power)', `Verknüpfung gespeichert: ${JSON.stringify(kugel?.ha)}`);
  const off = await page.evaluate(() => !window.panel.hasAttribute('editing') && !window.panel.editor.sel);
  ok(off, 'Fertig beendet den Editiermodus');

  // ---------------- Geräte: Zustandsanzeige, Gesten, Rückfrage ----------------
  // Waschmaschine (Garage): power switch.demo_waschmaschine, info Restzeit, Antippen = HA-Dialog
  const WM = { type: 'item', id: 'waschmaschine' };
  await page.evaluate(async () => {
    window.panel.setLevel(0);
    const h = window.mockHass;
    await h.callService('switch', 'turn_on', { entity_id: 'switch.demo_waschmaschine' });
    h.states = { ...h.states, 'sensor.demo_waschmaschine_restzeit': { entity_id: 'sensor.demo_waschmaschine_restzeit', state: '42', attributes: { unit_of_measurement: 'min', friendly_name: 'Restzeit' } } };
    window.panel.hass = h;
    window.panel.view.renderNow();
  });
  const badge = await page.evaluate(() => {
    const el = [...window.panel.shadowRoot.querySelectorAll('.badge')].find((b) => b.ref.id === 'waschmaschine');
    const r = el?.getBoundingClientRect();
    return el && { text: el.textContent, on: el.classList.contains('on'), hidden: el.hidden, inView: r.width > 0 && r.top > 0 && r.left > 0 && r.right < innerWidth };
  });
  ok(badge?.text === '42 min' && badge.on && !badge.hidden && badge.inView, `Zustandsanzeige über der Waschmaschine: ${badge?.text}`, `Zustandsanzeige: ${JSON.stringify(badge)}`);
  await page.screenshot({ path: join(OUT, 'demo_zustand.png') });
  await steady(page);
  const wmTop = await page.evaluate((ref) => window.panel.view.objectTop(ref).toArray(), WM);
  const wmPt = await toScreen(page, [wmTop[0], wmTop[1] - 0.4, wmTop[2]]);
  const wmTap = await (async () => {
    await page.evaluate(() => {
      window.moreInfo = [];
      window.addEventListener('hass-more-info', (e) => window.moreInfo.push(e.detail.entityId), { once: true });
      window.callsBefore = window.mockHass.calls.length;
    });
    await page.mouse.click(wmPt.x, wmPt.y);
    await settle(page, () => window.moreInfo.length);
    return page.evaluate(() => ({ moreInfo: window.moreInfo, calls: window.mockHass.calls.length - window.callsBefore }));
  })();
  ok(wmTap.moreInfo[0] === 'switch.demo_waschmaschine' && wmTap.calls === 0, 'Gerät antippen: Aktion aus dem Modell (HA-Dialog)', `Gerät antippen: ${JSON.stringify(wmTap)}`);
  // Doppeltippen mit Rückfrage: erst nach „OK“ wird geschaltet, das einzelne Antippen entfällt
  await page.evaluate((ref) => {
    const e = window.panel._objEntry(ref);
    e.ha = { ...e.ha, double_tap: { action: 'toggle', confirm: 'Waschmaschine ausschalten?' } };
    window.moreInfo = [];
    window.addEventListener('hass-more-info', (ev) => window.moreInfo.push(ev.detail.entityId), { once: true });
    window.callsBefore = window.mockHass.calls.length;
  }, WM);
  await page.mouse.click(wmPt.x, wmPt.y);
  await page.mouse.click(wmPt.x, wmPt.y);
  await settle(page, () => window.panel.shadowRoot.querySelector('.confirm.show'));
  const ask = await page.evaluate(() => ({
    text: window.panel.shadowRoot.querySelector('.confirm.show p')?.textContent,
    calls: window.mockHass.calls.length - window.callsBefore,
    h: window.panel.shadowRoot.querySelector('.confirm .yes').getBoundingClientRect().height,
  }));
  await page.screenshot({ path: join(OUT, 'demo_rueckfrage.png') });
  await clickShadow('.confirm .yes');
  await settle(page, () => window.mockHass.states['switch.demo_waschmaschine'].state === 'off');
  const dbl = await page.evaluate(() => ({
    last: window.mockHass.calls.at(-1),
    moreInfo: window.moreInfo.length,
    badge: [...window.panel.shadowRoot.querySelectorAll('.badge')].find((b) => b.ref.id === 'waschmaschine')?.classList.contains('on'),
  }));
  ok(ask.text === 'Waschmaschine ausschalten?' && ask.calls === 0 && ask.h >= 48 && dbl.last?.domain === 'switch' && dbl.last.service === 'turn_off'
    && dbl.moreInfo === 0 && dbl.badge === false, 'Doppeltippen mit Rückfrage schaltet das Gerät erst nach OK (ohne Antippen-Aktion)', `Doppeltippen: ${JSON.stringify({ ask, dbl })}`);
  // Möbel ohne Verknüpfung reagieren nicht – Antippen geht an den Raum
  const sofaRef = await page.evaluate(() => [...window.panel._gesturesOf({ type: 'item', id: 'sofa' })].join());
  ok(sofaRef === '', 'Möbel ohne Verknüpfung: keine Geste (Antippen schaltet den Raum)', `Sofa: ${sofaRef}`);
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
