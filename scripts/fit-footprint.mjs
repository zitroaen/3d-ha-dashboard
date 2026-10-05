// Grundriss an amtliche Gebäudedaten einpassen: Der Umriss eines Gebäudes im Modell (Wände und Räume aller Etagen)
// wird gegen den Umriss desselben Gebäudes aus CityGML-LoD2 gedreht und verschoben, bis beide am besten übereinander
// liegen (Überdeckung, IoU). Ergebnis: Nordrichtung und Lage des Plans in Landeskoordinaten – site.georef, damit
// die Geodaten-Werkzeuge (Gelände, Luftbild, Bäume, Dach) wissen, wo der Plan liegt.
//
//   node scripts/fit-footprint.mjs lod2.gml [--id DEBY_…] [--building haus] [--near E,N] [--floor 312.4]
//        [--crs EPSG:25832] [--write]
//
//   --id        Gebäude-ID in der CityGML-Datei (sonst das nächste zu --near bzw. zu site.georef, oder das einzige)
//   --building  Gebäude im Modell (Standard: das erste)
//   --floor     Höhe des EG-Fußbodens (NHN), wird mit gespeichert; ohne Angabe nennt das Werkzeug die Geländehöhe
//               am Gebäude aus den LoD2-Bodenflächen als Anhalt
//   --write     site.georef in model.yaml schreiben (site.north_deg bleibt – Sonnenstand nach geografisch Nord)
// Gleichwertige Lösungen (symmetrische Häuser, z. B. 180° gedreht) werden mit ihrer IoU genannt; liegt site.north_deg
// schon ungefähr richtig, gewinnt die Lösung in seiner Nähe.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cli, georef } from './lib/geodata.mjs';
import { parseCityGML, footprintOf, centroid, rasterize, pickBuilding } from './lib/citygml.mjs';

const VALUE_OPTS = ['--id', '--building', '--near', '--floor', '--crs', '--data', '--res'];
const { opt, free, flag } = cli(process.argv, VALUE_OPTS);
if (!free.length) {
  console.error('Aufruf: node scripts/fit-footprint.mjs <lod2.gml> [--id …] [--building haus] [--near E,N] [--floor m] [--crs EPSG:25832] [--write]');
  process.exit(1);
}
const { DATA_DIR } = await import('../tests/lib/config.mjs');
const { parseModel } = await import('../src/model/model.js');
const file = join(DATA_DIR, 'model.yaml');
if (!existsSync(file)) {
  console.error(`${file} fehlt – erst den Grundriss importieren`);
  process.exit(1);
}
const text = readFileSync(file, 'utf8');
const model = parseModel(text);
const bModel = opt('--building') ? model.buildings.find((b) => b.id === opt('--building')) : model.buildings[0];
if (!bModel) {
  console.error(`Gebäude ${opt('--building')} gibt es im Modell nicht`);
  process.exit(1);
}

const buildings = free.flatMap((f) => parseCityGML(readFileSync(f, 'utf8')));
const near = opt('--near')?.split(',').map(Number) || model.site.georef?.origin;
const bGeo = pickBuilding(buildings, { id: opt('--id'), near });
if (!bGeo) {
  console.error(`Welches Gebäude? ${buildings.length} in der Datei – --id oder --near E,N angeben:`);
  for (const b of buildings.slice(0, 30)) console.error(`  ${b.id}  Schwerpunkt ${centroid(footprintOf(b)).map((v) => v.toFixed(1)).join(', ')}`);
  process.exit(1);
}

// Umriss des Modell-Gebäudes: Wände und Räume aller Etagen
const planPolys = bModel.floors.flatMap((f) => [...(f.walls || []), ...(f.rooms || []).map((r) => r.polygon)]).filter((p) => p?.length >= 3);
const geoPolys = footprintOf(bGeo);
const res = Number(opt('--res', 0.2));
const P = rasterize(planPolys, res), G = rasterize(geoPolys, res);
const cP = centroid(planPolys), cG = centroid(geoPolys);

/** Überdeckung (IoU) für Nordrichtung und Verschiebung (zusätzlich zum Schwerpunkt-Abgleich) */
function iou(north, dx = 0, dy = 0) {
  const g0 = georef({ origin: [0, 0], north_deg: north });
  const c0 = g0.toGeo(cP);
  const origin = [cG[0] - c0[0] + dx, cG[1] - c0[1] + dy];
  const g = georef({ origin, north_deg: north });
  let inter = 0;
  for (const p of P.cells) {
    const [E, N] = g.toGeo(p);
    const i = Math.floor((E - G.x0) / res), j = Math.floor((N - G.y0) / res);
    if (i >= 0 && j >= 0 && i < G.nx && j < G.ny && G.mask[j * G.nx + i]) inter++;
  }
  return { iou: inter / (P.cells.length + G.cells.length - inter), origin, north };
}

// grob: alle 1°, dann fein um die besten Kandidaten (Drehung 0,1°, Verschiebung ±1 m in 0,1 m)
const coarse = Array.from({ length: 360 }, (_, a) => iou(a)).sort((a, b) => b.iou - a.iou);
const seeds = [];
for (const c of coarse) {
  if (seeds.length >= 4) break;
  if (seeds.every((s) => Math.abs(((c.north - s.north + 540) % 360) - 180) > 8)) seeds.push(c);
}
const search = (s, aR, aS, tR, tS) => {
  let best = s;
  const base = { north: s.north, dx: s.dx || 0, dy: s.dy || 0 };
  for (let da = -aR; da <= aR + 1e-9; da += aS) {
    for (let dx = -tR; dx <= tR + 1e-9; dx += tS) {
      for (let dy = -tR; dy <= tR + 1e-9; dy += tS) {
        const r = iou(base.north + da, base.dx + dx, base.dy + dy);
        if (r.iou > best.iou) best = Object.assign(r, { dx: base.dx + dx, dy: base.dy + dy });
      }
    }
  }
  return best;
};
// zweistufig: grob (±1,5°, ±1 m), dann fein um das Beste (±0,3°, ±0,25 m in 5-cm-Schritten)
const refined = seeds.map((s) => search(search(s, 1.5, 0.25, 1, 0.25), 0.3, 0.05, 0.25, 0.05)).sort((a, b) => b.iou - a.iou);

// Vorhandene Nordrichtung als Schiedsrichter zwischen gleich guten Lösungen
let pick = refined[0];
const known = model.site.north_deg;
if (known != null) {
  const diff = (r) => Math.abs(((r.north - known + 540) % 360) - 180);
  const close = refined.filter((r) => r.iou >= pick.iou * 0.97).sort((a, b) => diff(a) - diff(b))[0];
  if (close && close !== pick) pick = close;
}
const r3 = (v) => Math.round(v * 1000) / 1000;
const north = r3(((pick.north % 360) + 360) % 360);
console.log(`Gebäude ${bGeo.id} (${geoPolys.length} Flächen) <-> Modell ${bModel.id}`);
console.log(`Beste Einpassung: Norden ${north}° im Plan, Plan-Ursprung bei [${pick.origin.map((v) => v.toFixed(2)).join(', ')}], Überdeckung (IoU) ${(pick.iou * 100).toFixed(1)} %`);
for (const r of refined) if (r !== pick) console.log(`  andere Lösung: Norden ${r3(((r.north % 360) + 360) % 360)}°, IoU ${(r.iou * 100).toFixed(1)} %`);
if (pick.iou < 0.8) console.warn('Hinweis: IoU unter 80 % – Gebäude-ID, Etagenlage (offset) oder den Grundriss prüfen.');
if (known != null) console.log(`site.north_deg ist ${known}° (Abweichung ${(Math.abs(((north - known + 540) % 360) - 180)).toFixed(1)}° – UTM-Gitternord weicht um die Meridiankonvergenz von geografisch Nord ab)`);
const groundZ = bGeo.ground.flat().map((p) => p[2]).filter(Number.isFinite);
if (groundZ.length && opt('--floor') == null) console.log(`Gelände am Gebäude laut LoD2: ${Math.min(...groundZ).toFixed(2)} … ${Math.max(...groundZ).toFixed(2)} m – EG-Fußboden meist etwas darüber (--floor)`);

if (flag('--write')) {
  const { toYaml, yamlHeader } = await import('../src/model/yaml.js');
  const prev = model.site.georef || {};
  model.site.georef = {
    ...(opt('--crs') || prev.crs ? { crs: opt('--crs') || prev.crs } : {}),
    origin: pick.origin.map((v) => Math.round(v * 100) / 100),
    north_deg: north,
    ...(opt('--floor') != null ? { floor: Number(opt('--floor')) } : prev.floor != null ? { floor: prev.floor } : {}),
  };
  writeFileSync(file, toYaml(model, yamlHeader(text)));
  console.log(`site.georef -> ${file}`);
}
