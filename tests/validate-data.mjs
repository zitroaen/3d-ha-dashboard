// Prüft ein Modell (docs/DATA_MODEL.md → Prüfung): Schema, eindeutige IDs, Verweise, Lage, Entity-IDs, Texturen.
// Außerdem: Katalog in docs/DATA_MODEL.md stimmt mit src/model/catalog.js überein (nur im Engine-Repo).
//   node tests/validate-data.mjs            (Datenordner: DATA_DIR bzw. --data, Standard Demo-Haus)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { DATA_DIR, ENGINE_ROOT } from './lib/config.mjs';
import { pointInPoly } from '../src/geometry.js';
import { CATALOG, hasCapability } from '../src/model/catalog.js';
import { parseModel, spacesOf, roleEntities, roofParts, toScene } from '../src/model/model.js';
import { ceilingFn, windowUnderRoof, doorUnderRoof } from '../src/roof.js';
import { LIGHT_TABLE_MAX, MAX_LAMPS_PER_ROOM } from '../src/roomlight.js';
import { FURNITURE, LAMPS } from '../src/models.js';
import { USER_MODEL_DIR, checkUserModel, registerUserModels } from '../src/usermodels.js';
import { load as parseYaml } from 'js-yaml';
import { setSurfaceDefs, checkSurface, isSurface, surfaceDef, surfaceIds } from '../src/surfaces.js';
import { setStyleDefs, WINDOW_STYLES, DOOR_STYLES } from '../src/styles.js';

const errors = [], warnings = [];
const file = join(DATA_DIR, 'model.yaml');
if (!existsSync(file)) {
  console.error(`✖ ${file} fehlt (Datenmodell v2, docs/DATA_MODEL.md)`);
  process.exit(1);
}

let model;
try {
  model = parseModel(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exit(1);
}

// 1. Schema
const ajv = new Ajv({ allErrors: true, strict: false });
const schema = JSON.parse(readFileSync(join(ENGINE_ROOT, 'schema/model.schema.json'), 'utf8'));
if (!ajv.validate(schema, model)) {
  for (const e of ajv.errors) errors.push(`Schema: ${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`);
}

// 1b. Eigene Modelle (models/<id>.yaml): Schema, ID wie Dateiname, keine ID eines eingebauten Modells; danach im
// Katalog eingetragen wie im Panel
{
  const dir = join(DATA_DIR, USER_MODEL_DIR);
  const partSchema = JSON.parse(readFileSync(join(ENGINE_ROOT, 'schema/model-part.schema.json'), 'utf8'));
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.yaml')) : [];
  const defs = [];
  for (const f of files) {
    const id = f.replace(/\.yaml$/, '');
    let def;
    try {
      def = parseYaml(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      errors.push(`Eigenes Modell ${f}: YAML nicht lesbar – ${e.message}`);
      continue;
    }
    if (!ajv.validate(partSchema, def)) {
      for (const e of ajv.errors) errors.push(`Eigenes Modell ${f}: ${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`);
      continue;
    }
    if (CATALOG[id] && !CATALOG[id].user) warnings.push(`Eigenes Modell ${f} ersetzt das Beispielmodell ${id}`);
    try {
      checkUserModel(def, id);
      if (def.file && !existsSync(join(dir, def.file))) throw new Error(`${def.file} fehlt`);
      defs.push({ id, def: def.file ? { ...def, file: undefined, parts: def.parts || [{ box: { size: [0.3, 0.3, 0.3] } }] } : def });
    } catch (e) {
      errors.push(`Eigenes Modell ${f}: ${e.message}`);
    }
  }
  for (const w of registerUserModels(defs)) errors.push(w);
  for (const id of model.models || []) if (!files.includes(`${id}.yaml`)) errors.push(`models: ${id}.yaml fehlt in ${USER_MODEL_DIR}`);
}

// 1c. Oberflächen: Bibliothek der Engine + `surfaces` der Instanz; alle Verweise müssen bekannt sein
{
  setSurfaceDefs(parseYaml(readFileSync(join(ENGINE_ROOT, 'library/surfaces.yaml'), 'utf8')), model.surfaces);
  for (const id of surfaceIds()) for (const e of checkSurface(id, surfaceDef(id))) errors.push(`Oberfläche ${e}`);
  for (const [id, d] of Object.entries(model.surfaces || {})) {
    const img = surfaceDef(id)?.image;
    if (img && !existsSync(join(DATA_DIR, img))) errors.push(`Oberfläche ${id}: Bild ${img} fehlt im Datenordner`);
    if (d && typeof d === 'object' && !d.base && !d.pattern && !d.image && !isSurface(id)) errors.push(`Oberfläche ${id}: pattern, image oder base nötig`);
  }
  const ref = (where, id) => {
    if (id != null && id !== false && !isSurface(id)) errors.push(`${where}: Oberfläche „${id}“ unbekannt (Bibliothek oder model.yaml → surfaces)`);
  };
  ref('site.ground', model.site?.ground?.surface);
  for (const b of model.buildings || []) {
    const ft = b.facade?.type;
    if (ft && ft !== 'plaster') ref(`${b.id}: facade.type`, ft);
    if (b.facade?.plinth) ref(`${b.id}: facade.plinth.material`, b.facade.plinth.material);
    for (const r of [b.roof].flat().filter((x) => x && typeof x === 'object')) ref(`${b.id}: roof.surface`, r.surface);
    for (const f of b.floors || []) {
      for (const r of f.rooms || []) {
        ref(`Raum ${r.id}`, r.surface);
        for (const z of r.zones || []) ref(`Raum ${r.id}: zones`, z.surface);
      }
    }
  }
  for (const o of model.outdoor || []) {
    ref(`Außenbereich ${o.id}`, o.surface);
    ref(`Außenbereich ${o.id}: edge`, o.edge);
  }
  // Fenster- und Türarten
  setStyleDefs(parseYaml(readFileSync(join(ENGINE_ROOT, 'library/openings.yaml'), 'utf8')), model);
  const sref = (where, S, id, kind) => {
    if (id != null && !S.has(id)) errors.push(`${where}: ${kind} „${id}“ unbekannt (library/openings.yaml oder model.yaml → ${kind === 'Fensterart' ? 'window_styles' : 'door_styles'})`);
  };
  for (const [S, kind] of [[WINDOW_STYLES, 'Fensterart'], [DOOR_STYLES, 'Türart']]) {
    for (const id of S.ids()) {
      const b = S.def(id);
      if (!/^[a-z0-9_]+$/.test(id)) errors.push(`${kind} ${id}: nur Kleinbuchstaben, Ziffern und _`);
      if (b?.base && !S.has(b.base)) errors.push(`${kind} ${id}: base „${b.base}“ unbekannt`);
    }
  }
  for (const b of model.buildings || []) {
    sref(`${b.id}: styles.window`, WINDOW_STYLES, b.styles?.window, 'Fensterart');
    for (const k of ['door', 'exterior_door', 'front_door']) sref(`${b.id}: styles.${k}`, DOOR_STYLES, b.styles?.[k], 'Türart');
    for (const f of b.floors || []) {
      for (const [i, w] of (f.windows || []).entries()) sref(`${b.id}/${f.id} Fenster ${i + 1}`, WINDOW_STYLES, w.style, 'Fensterart');
      for (const [i, d] of (f.doors || []).entries()) sref(`${b.id}/${f.id} Tür ${i + 1}`, DOOR_STYLES, d.style, 'Türart');
    }
  }
  for (const o of model.objects || []) {
    const m = o.params?.material;
    if (typeof m === 'string' && m !== 'plaster') ref(`Objekt ${o.id}: params.material`, m);
  }
}

// 2. eindeutige IDs
const dupes = (kind, ids) => {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`${kind}: ID ${id} doppelt`);
    seen.add(id);
  }
};
const buildings = model.buildings || [];
dupes('Gebäude', buildings.map((b) => b.id));
for (const b of buildings) dupes(`Etagen von ${b.id}`, (b.floors || []).map((f) => f.id));
const spaceIds = [...buildings.flatMap((b) => (b.floors || []).flatMap((f) => (f.rooms || []).map((r) => r.id))), ...(model.outdoor || []).map((z) => z.id)];
dupes('Bereiche (Räume und Außenbereiche)', spaceIds);
dupes('Objekte', (model.objects || []).map((o) => o.id));

// 3. Verweise im Bauwerk
for (const b of buildings) {
  for (const f of b.floors || []) {
    const rooms = new Set((f.rooms || []).map((r) => r.id));
    for (const w of f.windows || []) if (w.room && !rooms.has(w.room)) errors.push(`${b.id}/${f.id}: Fenster ${JSON.stringify(w.rect)} verweist auf Raum "${w.room}", den es auf dieser Etage nicht gibt`);
    for (const d of f.doors || []) for (const r of d.rooms || []) if (!rooms.has(r)) errors.push(`${b.id}/${f.id}: Tür bei ${JSON.stringify(d.hinge)} verweist auf Raum "${r}", den es auf dieser Etage nicht gibt`);
  }
}

// 3./4. Objekte: Modell, Leuchten, Bereich, Lage, Entities, Texturen
const spaces = spacesOf(model);
for (const o of model.objects || []) {
  const cat = CATALOG[o.model];
  if (!cat) {
    errors.push(`Objekt ${o.id}: Modell "${o.model}" gibt es nicht im Katalog`);
    continue;
  }
  const isLight = hasCapability(o.model, 'light');
  if (isLight && !o.light) errors.push(`Objekt ${o.id}: Leuchte (${o.model}) braucht light: { height, range }`);
  if (!isLight && o.light) errors.push(`Objekt ${o.id}: ${o.model} ist keine Leuchte, light ist nicht erlaubt`);
  for (const k of Object.keys(o.params || {})) if (!cat.params.includes(k)) errors.push(`Objekt ${o.id}: Parameter "${k}" gibt es bei ${o.model} nicht (${cat.params.join(', ') || 'keine'})`);
  if (o.space) {
    const sp = spaces.get(o.space);
    if (!sp) errors.push(`Objekt ${o.id}: Bereich "${o.space}" gibt es nicht`);
    else {
      if (!pointInPoly(o.pos, sp.room.polygon)) errors.push(`Objekt ${o.id}: pos ${JSON.stringify(o.pos)} liegt nicht in ${o.space}`);
      if (isLight && sp.kind === 'room' && o.light?.height > sp.height) errors.push(`Objekt ${o.id}: light.height ${o.light.height} über der Raumhöhe (${sp.height})`);
    }
  }
  const tex = o.params?.texture;
  if (tex && !existsSync(join(DATA_DIR, tex))) errors.push(`Objekt ${o.id}: Textur ${tex} fehlt im Datenordner`);
}

// Steildächer: Fenster über der Dachfläche (Kniestock) und Wände der obersten Etage ohne Dach darüber
{
  const scene = toScene(model);
  const fmt = (p) => `[${p.map((v) => Math.round(v * 100) / 100).join(', ')}]`;
  for (const f of scene.house.floors) {
    if (!f.roofCut) continue;
    const H = f.ceiling ?? 2.5, C = ceilingFn(f.roofCut, H);
    for (const w of f.windows) {
      const fit = windowUnderRoof(w, C, f.roofCut);
      if (fit.dormer) continue; // unter einer Gaube: deren Fenster ersetzt es
      if (fit.omit) warnings.push(`${f.id}: Fenster ${fmt(w.rect)} liegt über der Dachfläche (Wand dort ${fit.wallTop.toFixed(2)} m hoch) – wird weggelassen; Gaube anlegen?`);
      else if (fit.top != null) warnings.push(`${f.id}: Fenster ${fmt(w.rect)} liegt über der Dachfläche (Wand dort ${fit.wallTop.toFixed(2)} m hoch) – wird auf ${fit.top} m gekürzt; Gaube anlegen?`);
    }
    for (const d of f.doors) {
      const fit = doorUnderRoof(d, Math.max(d.height || 0, 2.05), C);
      if (fit.top != null) warnings.push(`${f.id}: Tür ${fmt(d.hinge)}–${fmt(d.end)} ragt über die Dachfläche (Wand dort ${fit.wallTop.toFixed(2)} m hoch) – wird auf ${fit.top} m begrenzt; Gaube bis zur Traufe (window: openings)?`);
    }
    // Wände unter keinem Dachteil (weder Steildach noch flach): ragen bis zur Etagenhöhe aus dem Dach
    const b = model.buildings.find((x) => f.id.startsWith(`${x.id}/`));
    const flat = roofParts(b).filter((r) => !r.pitched).map((r) => r.polygon);
    const covered = (p) => f.roofCut.some((r) => r.shape.contains(p)) || flat.some((poly) => pointInPoly(p, poly));
    for (const wall of f.walls) {
      const out = [];
      for (let i = 0; i < wall.length; i++) {
        const a = wall[i], c = wall[(i + 1) % wall.length], n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 0.25));
        for (let k = 0; k <= n; k++) {
          const p = [a[0] + ((c[0] - a[0]) * k) / n, a[1] + ((c[1] - a[1]) * k) / n];
          if (!covered(p)) out.push(p);
        }
      }
      if (out.length) {
        const xs = out.map((p) => p[0]), ys = out.map((p) => p[1]);
        warnings.push(`${f.id}: Wand bei ${fmt([Math.min(...xs), Math.min(...ys)])}–${fmt([Math.max(...xs), Math.max(...ys)])} liegt unter keinem Dachteil und ragt bis zur Etagenhöhe (${H} m) – Dachteil ergänzen oder polygon erweitern`);
      }
    }
  }
}

// Grenzen der Lichttabelle: Bereiche (Räume, Dachteile, Außenbereiche) + Außenlicht, Lampen, Lampen je Bereich
{
  const scene = toScene(model);
  const areas = scene.house.floors.reduce((n, f) => n + f.rooms.length, 0);
  if (areas + 1 > LIGHT_TABLE_MAX) errors.push(`${areas} Bereiche (Räume, Dachteile, Außenbereiche) – höchstens ${LIGHT_TABLE_MAX - 1} bekommen Raumlicht; Außenbereiche zusammenfassen (mit Höhenraster reichen wenige)`);
  const lamps = scene.devices.filter((d) => d.type === 'light');
  if (lamps.length > LIGHT_TABLE_MAX) errors.push(`${lamps.length} Leuchten – höchstens ${LIGHT_TABLE_MAX} werden dargestellt`);
  const per = new Map();
  for (const l of lamps) per.set(`${l.floor}/${l.room}`, (per.get(`${l.floor}/${l.room}`) || 0) + 1);
  for (const [k, n] of per) if (n > MAX_LAMPS_PER_ROOM) warnings.push(`${k.replace(/^__aussen\//, '')}: ${n} Leuchten – nur ${MAX_LAMPS_PER_ROOM} je Bereich leuchten (Bereich teilen oder Leuchten zusammenfassen)`);
}

// Luftbild: Datei vorhanden, nur mit Höhenraster wirksam
const aerial = model.site?.terrain?.texture;
const aerialFile = typeof aerial === 'string' ? aerial : aerial?.file;
if (aerialFile && !existsSync(join(DATA_DIR, aerialFile))) errors.push(`site.terrain.texture: ${aerialFile} fehlt im Datenordner`);

// Entities mehrfach zugeordnet (Hinweis, kein Fehler: z. B. eine Steckdose für zwei Lampen)
const ents = (model.objects || []).flatMap((o) => roleEntities(o, 'power'));
for (const e of ents.filter((e, i) => ents.indexOf(e) !== i)) warnings.push(`Entity ${e} mehrfach als power zugeordnet`);

// Katalog in der Doku = Katalog im Code (nur im Engine-Repo, wo die Doku liegt)
const doc = join(ENGINE_ROOT, 'docs/DATA_MODEL.md');
if (existsSync(doc)) {
  const text = readFileSync(doc, 'utf8');
  const table = text.slice(text.indexOf('<!-- katalog:start -->'), text.indexOf('<!-- katalog:end -->'));
  const documented = new Set([...table.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]));
  for (const m of Object.keys(CATALOG)) if (!CATALOG[m].user && !documented.has(m)) errors.push(`Katalog: Modell ${m} fehlt in docs/DATA_MODEL.md`);
  for (const m of documented) if (!CATALOG[m]) errors.push(`Katalog: docs/DATA_MODEL.md nennt ${m}, das es nicht gibt`);
  for (const [m, c] of Object.entries(CATALOG)) {
    const geo = c.capabilities?.includes('light') ? LAMPS : FURNITURE;
    if (!geo[m]) errors.push(`Katalog: Modell ${m} hat keine Geometrie in src/models.js`);
  }
}

// Bibliothek in der Doku = Bibliothek der Engine (Oberflächen, nur im Engine-Repo)
const libDoc = join(ENGINE_ROOT, 'docs/LIBRARY.md');
if (existsSync(libDoc)) {
  const text = readFileSync(libDoc, 'utf8');
  const table = text.slice(text.indexOf('<!-- oberflaechen:start -->'), text.indexOf('<!-- oberflaechen:end -->'));
  const documented = new Set([...table.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map((m) => m[1]));
  const lib = Object.keys(parseYaml(readFileSync(join(ENGINE_ROOT, 'library/surfaces.yaml'), 'utf8')));
  for (const id of lib) if (!documented.has(id)) errors.push(`Bibliothek: Oberfläche ${id} fehlt in docs/LIBRARY.md`);
  for (const id of documented) if (!lib.includes(id)) errors.push(`Bibliothek: docs/LIBRARY.md nennt ${id}, das es nicht gibt`);
}

const nRooms = buildings.reduce((n, b) => n + (b.floors || []).reduce((m, f) => m + (f.rooms || []).length, 0), 0);
console.log(`Modell (${file}): ${buildings.length} Gebäude, ${nRooms} Räume, ${(model.outdoor || []).length} Außenbereiche, ${(model.objects || []).length} Objekte`);
if (warnings.length) console.log(`ℹ ${warnings.join('; ')}`);
if (errors.length) {
  console.error('✖ Datenfehler:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('✔ Daten konsistent');
