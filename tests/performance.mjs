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
// Budget für das Demo-Haus (Haus, Garage, Garten), ganze Ebene 0 bzw. 1 im Bild. Ebene 1 zeigt alles auf einmal
// (beide Hausetagen, Garage samt Dach mit Balkonkraftwerk, Garten): 145 Zeichenaufrufe sind für Tablets unkritisch
// (sie schaffen mehrere hundert je Bild); das Budget soll schleichendes Wachstum sichtbar machen.
const BUDGET = { calls: 145, triangles: 120000 };

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
  // 200 Bäume und Sträucher (Instanzen, Detailstufen): Ebene 0 bleibt im Budget – in der Übersicht und nah heran
  const trees = await page.evaluate(() => {
    const v = window.panel.view, r = v.renderer;
    window.panel.setLevel(0);
    const { devices, items } = v.furnishingData;
    const proto = items.find((i) => i.kind === 'tree' && i.room === 'aussen') || items.find((i) => i.kind === 'tree');
    const shapes = ['round', 'fruit', 'conifer', 'column', 'birch', 'shrub'];
    const extra = [];
    for (let k = 0; k < 200; k++) {
      // Ring um das Grundstück (Waldrand, Obstwiese), 20 × 10 Plätze
      const a = (k / 200) * Math.PI * 2, d = 26 + (k % 10) * 2.2;
      const shape = shapes[k % shapes.length];
      extra.push({ ...proto, id: `perf_${k}`, src: null, kind: shape === 'shrub' ? 'shrub' : 'tree', shape, pos: [8 + Math.cos(a) * d, 5 + Math.sin(a) * d],
        size: shape === 'shrub' ? [1.4, 1.2, 1.1] : [3 + (k % 3), 3, 5 + (k % 4)], stakes: false });
    }
    v.setFurnishing({ devices, items: [...items, ...extra] });
    const measure = () => {
      v.renderNow(); // erstes Bild mit Schatten-Neuberechnung (nur bei Änderungen) – gemessen wird das zweite
      r.info.reset();
      r.info.autoReset = false;
      v.renderNow();
      const m = { calls: r.info.render.calls, triangles: r.info.render.triangles };
      r.info.autoReset = true;
      return m;
    };
    v.setQuality('low');
    const overview = measure();
    const zoom0 = v.camera.zoom;
    v.camera.zoom = zoom0 * 4;
    v.camera.updateProjectionMatrix();
    const near = measure();
    v.camera.zoom = zoom0;
    v.camera.updateProjectionMatrix();
    v.setFurnishing({ devices, items });
    v.setQuality('high');
    return { overview, near };
  });
  for (const [name, m] of Object.entries(trees)) {
    ok(m.calls <= BUDGET.calls && m.triangles <= BUDGET.triangles,
      `200 Bäume (${name === 'near' ? 'nah' : 'Übersicht'}): ${m.calls} Zeichenaufrufe, ${Math.round(m.triangles / 1000)}k Dreiecke`,
      `200 Bäume (${name}) über dem Budget: ${JSON.stringify(m)}`);
  }

  // Rendern bei Bedarf: in Ruhe kein Bild; laufende Animation höchstens im gedrosselten Takt (30 Bilder/s)
  const idle = await page.evaluate(async () => {
    const v = window.panel.view;
    window.panel.setLevel(0);
    window.panel._applyPrefs({ ...window.panel.prefs, animations: 'on' });
    await new Promise((r) => setTimeout(r, 1500));
    const f0 = v.frames;
    await new Promise((r) => setTimeout(r, 1000));
    const idleFrames = v.frames - f0;
    v.setActivity('ventilator', { active: true, speed: 1 });
    return { idleFrames, interval: v._animInterval(), running: v._runningAnims().length };
  });
  ok(idle.idleFrames === 0 && idle.running === 1 && idle.interval >= 1000 / 30,
    `Ruhe: kein Bild ohne Anlass; Animation gedrosselt auf ${Math.round(1000 / idle.interval)} Bilder/s`, `Ruhe/Animation: ${JSON.stringify(idle)}`);
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error(`\n✖ ${errors.length} Fehler:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('\n✔ Leistungsbudget eingehalten');
