// three.js-Szene: Kamera, Licht, Umgebung, Render-on-demand, Antippen von Räumen und Lampen.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FloorModel, createSharedMaterials } from './house.js';
import { FurnishingLayer } from './furnishing.js';
import { LightTable, lightUniforms, withRoomLight, OUTDOOR_IDX, MAX_LAMPS, MAX_LAMPS_PER_ROOM } from './roomlight.js';
import { pointInPoly, heightAt, nearestTerrain } from './geometry.js';
import { makeFloorAO, GROUND_Y } from './house.js';
import { SkyEnvironment } from './environment.js';

const NO_WEATHER = { cloud: 0, rain: 0, snow: 0, fog: 0 };

/** Qualitätsstufen: Schattenauflösung und -weichheit, Bildauflösung */
const _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1), _q = new THREE.Quaternion();

/** Polylinie mit Länge und Punkt nach Weglänge (Energiefluss) */
function pathOf(pts) {
  const seg = [];
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = new THREE.Vector3(...pts[i - 1]), b = new THREE.Vector3(...pts[i]);
    seg.push({ a, b, from: length, len: a.distanceTo(b) });
    length += seg.at(-1).len;
  }
  return {
    length,
    at(d, out) {
      const s = seg.find((x) => d <= x.from + x.len) || seg.at(-1);
      return out.copy(s.a).lerp(s.b, s.len ? (d - s.from) / s.len : 0);
    },
  };
}

/** Animationen mit Fortschritt 0..1 (Tore): laufen bis in die Endlage, auch beim Schließen */
const PROGRESS = new Set(['swing', 'sectional']);

/** Punkt der Torschiene nach Weglänge s (y, z in der Ebene des Tors): senkrecht bis H, Viertelbogen, waagrecht nach innen */
function trackAt(s, H, R) {
  if (s <= H) return [s, 0];
  const arc = (Math.PI / 2) * R;
  if (s <= H + arc) {
    const a = (s - H) / R;
    return [H + R * Math.sin(a), -R * (1 - Math.cos(a))];
  }
  return [H + R, -R - (s - H - arc)];
}

/**
 * Sektionaltor: Jede Lamelle i (im geschlossenen Tor zwischen i·h und (i+1)·h) liegt als Sehne auf der Schiene, ihre
 * Unterkante bei Weglänge i·h + e·H. Die Ecken werden direkt in der Geometrie verschoben (wenige hundert Punkte, ein
 * Mesh, ein Zeichenaufruf). Die Ausgangslage merkt sich das Mesh beim ersten Mal.
 */
function poseSections(node, { sections: n, height: H, radius: R }, e) {
  const h = H / n;
  const pose = [];
  for (let i = 0; i < n; i++) {
    const s0 = i * h + e * H;
    const [y0, z0] = trackAt(s0, H, R), [y1, z1] = trackAt(s0 + h, H, R);
    const l = Math.hypot(y1 - y0, z1 - z0) || 1;
    const uy = (y1 - y0) / l, uz = (z1 - z0) / l; // „oben“ der Lamelle; außen = (−uz, uy)
    pose.push([y0, z0, uy, uz]);
  }
  for (const m of node.children) {
    if (!m.isMesh) continue;
    const pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal;
    const base = (m.userData.base ??= { pos: pos.array.slice(), nor: nor.array.slice(), sec: sectionsOf(pos.array, h, n) });
    m.frustumCulled = false; // Begrenzung ändert sich mit der Lage
    for (let v = 0; v < pos.count; v++) {
      const [y0, z0, uy, uz] = pose[base.sec[(v / 3) | 0]];
      const k = v * 3, yl = base.pos[k + 1] - (base.sec[(v / 3) | 0]) * h, zl = base.pos[k + 2];
      pos.array[k + 1] = y0 + yl * uy - zl * uz;
      pos.array[k + 2] = z0 + yl * uz + zl * uy;
      const ny = base.nor[k + 1], nz = base.nor[k + 2];
      nor.array[k + 1] = ny * uy - nz * uz;
      nor.array[k + 2] = ny * uz + nz * uy;
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }
}

/** Lamelle je Dreieck (Geometrie ohne Index): aus der Höhe seines Mittelpunkts im geschlossenen Tor */
function sectionsOf(p, h, n) {
  const sec = new Uint8Array(p.length / 9);
  for (let t = 0; t < sec.length; t++) {
    const cy = (p[t * 9 + 1] + p[t * 9 + 4] + p[t * 9 + 7]) / 3;
    sec[t] = Math.max(0, Math.min(n - 1, Math.floor(cy / h)));
  }
  return sec;
}

const QUALITY = {
  high: { shadowMap: 2048, shadowRadius: 5, maxPixelRatio: 2 },
  low: { shadowMap: 1024, shadowRadius: 3, maxPixelRatio: 1.25 },
};

// Warmweiß ~2700 K
const DEFAULT_LIGHT = new THREE.Color().setRGB(1.0, 0.8, 0.6, THREE.SRGBColorSpace);
const LAMP_INTENSITY = { ceiling: 1.7, pendant: 1.6, floor: 1.2, table: 0.9, wall: 1.1, spot: 1.0 };

export class HouseScene {
  /**
   * @param house        Bauwerk (aus dem Modell übersetzt, src/model/model.js toScene): Etagen aller Gebäude
   *                     plus Außen-Etage; jede Etage hat eine Ebene (level), gezeigt wird jeweils eine Ebene
   * @param furnishing   { devices, items } (Leuchten und übrige Objekte)
   */
  /** assetBase: Ordner der Daten (für Texturen wie textures/…), wie data_url */
  /**
   * @param onObjectGesture  (ref {type, id}, 'tap'|'double_tap'|'hold') – Objekt angetippt usw.
   * @param objectGestures   ref -> Set der Gesten, auf die das Objekt reagiert (sonst geht das Antippen zum Raum)
   * @param onRender         nach jedem Bild (Zustandsanzeigen nachführen)
   */
  constructor(container, house, furnishing, { onRoomTap, onObjectGesture, objectGestures, onViewChange, onRender, onQualityChange, assetBase = null } = {}) {
    this.container = container;
    this.house = house;
    this.onRoomTap = onRoomTap;
    this.onObjectGesture = onObjectGesture;
    this.objectGestures = objectGestures;
    this.onRender = onRender;
    this.onQualityChange = onQualityChange;
    this.onViewChange = onViewChange;
    this.lamps = new Map(); // lampId -> { idx, lamp, room, roomIdx, floor, on, color, brightness }
    this.furnishing = [];
    this.lightTable = new LightTable();
    lightUniforms.uLights.value = this.lightTable.texture;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.15;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.domElement.style.display = 'block';
    r.domElement.style.touchAction = 'none';
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.skyEnv = new SkyEnvironment(r); // Spiegelungen und Himmelslicht (scene.environment)
    this.scene.background = new THREE.Color(0x0a0d13);
    this.scene.fog = new THREE.Fog(0x0a0d13, 45, 95);

    this.shared = createSharedMaterials();
    // scharfe Böden auch bei flachem Blickwinkel (anisotrope Filterung, kostet kaum etwas)
    const aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
    for (const m of Object.values(this.shared.mat)) for (const t of [m.map, m.normalMap]) if (t) t.anisotropy = aniso;
    // Texturen aus dem Datenordner (z. B. Gemälde), einmal geladen und geteilt; nach dem Laden neu rendern
    const texCache = new Map();
    this.shared.loadTexture = (path) => {
      if (!texCache.has(path)) {
        const tex = new THREE.TextureLoader().load(
          new URL(path, assetBase || location.href).href,
          () => this.requestRender(),
          undefined,
          () => console.warn(`ha-3d-dashboard: Textur ${path} nicht gefunden`)
        );
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        texCache.set(path, tex);
      }
      return texCache.get(path);
    };
    this._buildFloors();
    this.setFurnishing(furnishing);
    this._buildEnvironment();
    this._buildCamera();
    this._bindPointer();

    this._resizeObs = new ResizeObserver(() => this.resize());
    this._resizeObs.observe(container);
    this.resize();
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  /** Bauwerk: einmal pro Sitzung. */
  _buildFloors() {
    this.floors = [];
    let base = 0;
    for (const f of this.house.floors) {
      const fm = new FloorModel(f, base, this.shared);
      base += f.rooms.length;
      this.scene.add(fm.group);
      this.floors.push(fm);
    }
    // Dächer liegen eine Ebene über ihrem Gebäude, bekommen aber keinen eigenen Ebenen-Knopf
    this.levels = [...new Set(this.floors.filter((f) => !f.floor.roof).map((f) => f.floor.level ?? 0))].sort((a, b) => a - b);
    this.setLevel(this.levels.includes(0) ? 0 : this.levels[0], { silent: true });
  }

  /**
   * Ebene zeigen (0 = Erdgeschoss mit Außenbereichen, 1 = 1. OG, -1 = Keller …): Die Etagen dieser Ebene stehen auf
   * allen darunter (samt Garten), die Ebenen darüber sind ausgeblendet – wie ein Haus, dem man die oberen Geschosse
   * abnimmt. Sichtbare Etagen (activeFloors) lassen sich antippen; die oberste trifft der Strahl zuerst.
   */
  setLevel(level, { silent = false } = {}) {
    if (!this.levels.includes(level)) return false;
    this._anim?.finish();
    this.level = level;
    this._tops = null;
    this.activeFloors = this.floors.filter((f) => (f.floor.level ?? 0) <= level);
    // Etagen genau dieser Ebene; "Haupt"-Etage (Titel, Editor-Standard): die erste echte Gebäude-Etage
    this.levelFloors = this.floors.filter((f) => (f.floor.level ?? 0) === level);
    this.activeFloor = this.levelFloors.find((f) => !f.floor.outdoor && !f.floor.roof) || this.levelFloors[0];
    for (const f of this.floors) f.group.visible = this.activeFloors.includes(f);
    if (this.furnishing?.length) this._syncAnims();
    for (const slab of this.slabs || []) slab.visible = slab.userData.level <= level;
    makeFloorAO(this.activeFloors.flatMap((f) => f.floor.walls));
    if (!silent) {
      this.renderer.shadowMap.needsUpdate = true;
      this.resize(); // Bildausschnitt auf die Etagen dieser Ebene einpassen (rendert und meldet die Änderung)
    }
    return true;
  }

  /** Name einer Ebene: Namen der Gebäude-Etagen (ohne Doppelungen) */
  levelName(level = this.level) {
    const names = this.floors.filter((f) => (f.floor.level ?? 0) === level && !f.floor.outdoor && !f.floor.roof).map((f) => f.floor.name);
    return [...new Set(names)].join(' · ') || 'Außen';
  }

  /** Etage (FloorModel) zu einem Etagen-Schlüssel */
  floorModel(key) {
    return this.floors.find((f) => f.floor.id === key);
  }

  /** Bodenhöhe eines Objekts in einem Außenbereich (Gelände) relativ zur Etage; in Räumen 0 */
  baseAt(floorKey, roomId, pos) {
    const fm = this.floorModel(floorKey);
    const r = fm?.floor.outdoor && fm.rooms.get(roomId)?.room;
    if (!r) return 0;
    return r.heights ? heightAt(r.polygon, r.heights, pos) : r.elevation || 0;
  }

  /**
   * Bodenfläche: eben auf GROUND_Y – oder, wenn es Gelände gibt, ein Gitter, das dem Gelände folgt (ein Hang setzt
   * sich seitlich und darunter fort), knapp unter den Geländeflächen und nie höher als GROUND_Y. Fein (0,5 m) um
   * das Grundstück, grob nach außen.
   */
  _groundGeometry(cx, cz) {
    const R = 80;
    const areas = this.floors.flatMap((f) => f.floor.rooms.filter((r) => r.heights).map((r) => ({ polygon: r.polygon, heights: r.heights, extend: r.extend })));
    // Flächen ohne Gelände (Gebäude, ebene Außenbereiche): darunter bleibt der Boden unten, auch neben ansteigendem Hang
    const flat = this.floors.flatMap((f) => f.floor.rooms.filter((r) => !r.heights).map((r) => r.polygon));
    const axis = (c, lo, hi) => {
      const out = [c - R];
      for (let v = Math.floor(lo - 14); v <= hi + 14; v += 0.5) out.push(v);
      out.push(c + R);
      for (const v of [c - R / 2, c - R / 4, c + R / 4, c + R / 2]) if (v < lo - 14 || v > hi + 14) out.push(v);
      return [...new Set(out)].sort((a, b) => a - b);
    };
    const b = this.bounds;
    const xs = areas.length ? axis(cx, b.x0, b.x1) : [cx - R, cx + R];
    const zs = areas.length ? axis(cz, b.z0, b.z1) : [cz - R, cz + R];
    const pos = [], uv = [], idx = [];
    for (const z of zs) {
      for (const x of xs) {
        // Tiefer liegendes Gelände setzt sich nach außen fort, höheres nur mit `extend` (sonst Erdkante)
        const t = areas.length ? nearestTerrain(areas, [x, z]) : null;
        let y = t == null ? GROUND_Y : t.area.extend && !t.inside ? t.h - 0.012 : Math.min(GROUND_Y, t.h - 0.012);
        if (y > GROUND_Y && flat.some((poly) => pointInPoly([x, z], poly))) y = GROUND_Y;
        pos.push(x, y, z);
        uv.push(x, z);
      }
    }
    const n = xs.length;
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b2 = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b2, b2, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('roomIdx', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** Raum bzw. Außenbereich nach ID (über alle Etagen) */
  roomById(id) {
    for (const f of this.floors) if (f.rooms.has(id)) return f.rooms.get(id).room;
    return null;
  }

  /** Globaler Raum-Index (1-basiert) für Lampen-Zuordnung; "aussen" ist ein Pseudo-Raum. */
  _roomIdx(floorId, roomId) {
    if (roomId === 'aussen') return OUTDOOR_IDX;
    const fm = this.floors.find((f) => f.floor.id === floorId);
    return fm?.rooms.get(roomId)?.idx || 0;
  }

  /**
   * Einrichtung und Geräte (neu) setzen. Kann jederzeit erneut aufgerufen werden, z. B. wenn Lampen
   * umziehen – das Haus bleibt dabei unangetastet. Schaltzustände bekannter Lampen bleiben erhalten.
   */
  setFurnishing({ devices = [], items = [] } = {}, { exclude } = {}) {
    for (const layer of this.furnishing || []) layer.dispose();
    this._tops = null;
    this.furnishingData = { devices, items }; // dieselben Objekte bearbeitet der Editor
    const prev = this.lamps || new Map();
    this.lamps = new Map();
    this.lightTable.clear();

    // Lampen nach Raum sortiert durchnummerieren, damit jeder Raum einen zusammenhängenden Bereich hat
    const lamps = devices
      .filter((d) => d.type === 'light')
      .map((d) => ({ ...d, roomIdx: this._roomIdx(d.floor, d.room) }))
      .filter((d) => {
        if (!d.roomIdx) console.warn(`ha-3d-dashboard: Lampe ${d.id}: Raum ${d.floor}/${d.room} gibt es nicht`);
        return d.roomIdx;
      })
      .sort((a, b) => a.roomIdx - b.roomIdx);
    if (lamps.length > MAX_LAMPS) console.warn(`ha-3d-dashboard: nur ${MAX_LAMPS} Lampen werden dargestellt`);
    lamps.length = Math.min(lamps.length, MAX_LAMPS);
    const ranges = new Map();
    lamps.forEach((l, i) => {
      l.idx = i + 1;
      const r = ranges.get(l.roomIdx) || { start: i, count: 0 };
      r.count++;
      ranges.set(l.roomIdx, r);
    });
    for (const [ri, r] of ranges) {
      if (r.count > MAX_LAMPS_PER_ROOM) console.warn(`ha-3d-dashboard: Raum ${ri} hat mehr als ${MAX_LAMPS_PER_ROOM} Lampen`);
      this.lightTable.setRoomRange(ri, r.start, Math.min(r.count, MAX_LAMPS_PER_ROOM));
    }

    this.furnishing = this.floors.map((fm) => {
      const floorLamps = lamps.filter((l) => l.floor === fm.floor.id);
      const layer = new FurnishingLayer(fm, floorLamps, items.filter((i) => i.floor === fm.floor.id), this.shared, { exclude });
      fm.group.add(layer.group);
      for (const l of floorLamps) {
        this.lightTable.setLampPosition(l.idx - 1, [l.pos[0], l.height + (l.base || 0) + fm.group.position.y, l.pos[1]], l.range);
        const old = prev.get(l.id);
        this.lamps.set(l.id, {
          idx: l.idx, lamp: l, roomIdx: l.roomIdx, room: l.room, floor: fm,
          on: old?.on ?? false, color: old?.color ?? (l.color ? new THREE.Color(l.color) : DEFAULT_LIGHT.clone()), brightness: old?.brightness ?? 1,
          // Grundfarbe, wenn HA keine Farbe meldet (nicht farbfähige Lampen, Steckdosen)
          baseColor: l.color ? new THREE.Color(l.color) : DEFAULT_LIGHT.clone(),
        });
      }
      return layer;
    });
    this._updateLights();
    this._syncAnims();
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  _buildEnvironment() {
    // Ausdehnung des ganzen Grundstücks: Wände aller Etagen und alle Außenbereiche
    const pts = this.floors.flatMap((f) => [...f.floor.walls.flat(), ...f.floor.rooms.flatMap((r) => r.polygon)]);
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    this.bounds = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    const cx = (this.bounds.x0 + this.bounds.x1) / 2, cz = (this.bounds.z0 + this.bounds.z1) / 2;
    this.center = new THREE.Vector3(cx, 0, cz);

    // Boden außerhalb aller Außenbereiche (site.ground), etwas unter den Flächen (kein Flackern)
    const groundMat = this.shared.mat[this.house.ground] || this.shared.mat.lawn;
    const ground = new THREE.Mesh(this._groundGeometry(cx, cz), groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Bodenplatte unter jeder Gebäude-Etage (sichtbare Kante); über einer anderen Etage desselben Gebäudes reicht
    // sie bis auf deren Wände (Geschossdecke); sichtbar mit ihrer Etage
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.95 });
    this.slabs = [];
    for (const fm of this.floors) {
      if (fm.floor.outdoor || !fm.floor.walls.length) continue;
      const outline = this._houseOutline(fm);
      if (outline.length < 3) continue;
      const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
      const y0 = fm.group.position.y;
      const below = this.floors.filter((o) => o !== fm && !o.floor.outdoor && o.floor.building === fm.floor.building && o.group.position.y < y0);
      const top = below.length ? Math.max(...below.map((o) => o.group.position.y + o.H)) : null;
      const depth = top != null && y0 - top > 0.01 ? y0 - top : 0.14;
      const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), slabMat);
      slab.rotation.x = -Math.PI / 2;
      slab.position.y = y0 - depth - 0.001;
      slab.castShadow = top != null; // Geschossdecke wirft Schatten in den Garten
      slab.receiveShadow = true;
      slab.userData.level = fm.floor.level ?? 0;
      slab.visible = slab.userData.level <= this.level;
      this.slabs.push(slab);
      this.scene.add(slab);
    }

    // Himmel: Halbkugel-Licht (Himmel/Boden) + ein Gestirn mit Schatten – tagsüber die Sonne, nachts der Mond.
    this.hemi = new THREE.HemisphereLight();
    this.scene.add(this.hemi);
    const sky = (this.skyLight = new THREE.DirectionalLight());
    sky.target.position.copy(this.center);
    sky.castShadow = true;
    sky.shadow.mapSize.set(2048, 2048);
    const ext = Math.max(this.bounds.x1 - this.bounds.x0, this.bounds.z1 - this.bounds.z0) * 0.8;
    Object.assign(sky.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 80 });
    sky.shadow.bias = -0.0005;
    sky.shadow.normalBias = 0.02;
    sky.shadow.radius = 4;
    this.scene.add(sky, sky.target);
    this.setSky(null);
  }

  /**
   * Sonnenstand setzen (aus HA sun.sun: azimuth = Grad von Norden im Uhrzeigersinn, elevation = Grad über dem
   * Horizont). null = kein Sonnen-Sensor -> Nacht. Zwischen -6° (bürgerliche Dämmerung) und +8° wird übergeblendet.
   */
  setSky(sun) {
    this._sun = sun;
    const elev = sun?.elevation ?? -20;
    const azim = sun?.azimuth ?? 20; // ohne Sensor: Mond im Süden (Sonne gegenüber)
    const w = this.weather || NO_WEATHER;
    const key = `${azim.toFixed(1)}/${elev.toFixed(1)}/${JSON.stringify(w)}`;
    if (key === this._skyKey) return;
    this._skyKey = key;

    const day = THREE.MathUtils.smoothstep(elev, -6, 8);
    this.daylight = day;
    const L = (a, b) => a + (b - a) * day;
    const mix = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), day);

    // Halbkugel: Nacht kühl und gedämpft, Tag hell mit warmem Bodenreflex. Einen Teil des Himmelslichts liefert die
    // Umgebung (scene.environment, unten) – sie bringt dazu die Spiegelungen auf Glas, Böden und Lack.
    this.hemi.color.copy(mix(0x525a6c, 0xc9d8ec));
    this.hemi.groundColor.copy(mix(0x1e1d1c, 0x6e6250));
    this.hemi.intensity = L(0.95, 1.05) * (1 + 0.3 * w.cloud);
    // Wolken: diffuses, graues Himmelslicht; Schnee hellt den Bodenreflex auf
    this.hemi.color.lerp(mix(0x3e4247, 0xb9bec4), w.cloud * 0.7);
    this.hemi.groundColor.lerp(mix(0x2a2c30, 0xc9ced6), w.snow * 0.8);
    // Hintergrund und Nebel: Richtung Horizont geht der Boden in die Himmelsfarbe über (Farbe aus der Umgebung unten)
    this.scene.background.copy(mix(0x0a0d13, 0x8d9aa8));

    // Gestirn: über dem Horizont die Sonne (bei tiefem Stand wärmer), sonst der Mond gegenüber
    const isSun = elev > -2;
    const az = isSun ? azim : azim + 180;
    const el = isSun ? Math.max(elev, 4) : 40;
    const sunWarm = THREE.MathUtils.smoothstep(elev, 0, 25);
    const light = this.skyLight;
    if (isSun) {
      light.color.copy(new THREE.Color(0xffb46b).lerp(new THREE.Color(0xfff3e2), sunWarm));
      light.intensity = 2.8 * THREE.MathUtils.smoothstep(elev, -2, 10);
    } else {
      light.color.set(0xb4c2e0);
      light.intensity = 0.4;
    }
    const a = THREE.MathUtils.degToRad((this.house.north_deg || 0) + az), e = THREE.MathUtils.degToRad(el);
    const d = 35;
    // Plan: "oben" = -z, im Uhrzeigersinn = +x
    light.position.set(this.center.x + Math.sin(a) * Math.cos(e) * d, Math.sin(e) * d, this.center.z - Math.cos(a) * Math.cos(e) * d);
    // Bewölkung: Gestirn schwächer, Schatten blasser
    light.intensity *= 1 - 0.8 * w.cloud;
    light.shadow.intensity = 1 - 0.75 * w.cloud;
    const dir = light.position.clone().sub(this.center).normalize();
    this.scene.environment = this.skyEnv.update(day, dir, isSun, sunWarm, w.cloud);
    this.scene.background.lerp(this.skyEnv.horizon, 0.35 * day);
    // Nebel: kürzere Sicht, Farbe hellgrau (tags) bzw. dunkelgrau (nachts)
    // Abstand Kamera–Drehpunkt (orthografisch, fest): vorne bleibt klar, nach hinten verschwindet der Garten im Dunst
    this.scene.background.lerp(mix(0x1d2024, 0xb4b9be), w.fog * 0.7);
    this.scene.fog.color.copy(this.scene.background);
    const dist = this.camera ? this.camera.position.distanceTo(this.controls.target) : 40;
    this.scene.fog.near = THREE.MathUtils.lerp(45, dist * 0.85, w.fog);
    this.scene.fog.far = THREE.MathUtils.lerp(95, dist * 1.45, w.fog);
    // Regen: nasse Flächen draußen; Schnee: weiße Oberseiten (roomlight.js)
    lightUniforms.uWet.value = w.snow > 0.6 ? 0 : w.rain > 0 ? Math.max(0.6, w.rain) : 0;
    lightUniforms.uSnow.value = w.snow;
    this.scene.environmentIntensity = L(0.35, 0.75);
    this.renderer.shadowMap.needsUpdate = true;
    this.onSkyChange?.(day);
    this.requestRender();
  }

  /**
   * Wetter setzen: { cloud, rain, snow, fog } je 0..1 (src/weather.js), null = klar. Rechnet nur Himmel, Licht und
   * Materialparameter neu – kein Rendern pro Bild.
   */
  setWeather(w) {
    const next = w ? { cloud: w.cloud || 0, rain: w.rain || 0, snow: w.snow || 0, fog: w.fog || 0 } : NO_WEATHER;
    if (JSON.stringify(next) === JSON.stringify(this.weather || NO_WEATHER)) return;
    this.weather = next;
    this.setSky(this._sun ?? null);
  }

  /** Außenkontur für die Bodenplatte: zeilenweise abgetastetes Treppenpolygon aus Räumen und Wänden. */
  _houseOutline(fm) {
    const cell = 0.25;
    const pts = [...fm.floor.walls.flat(), ...fm.floor.rooms.flatMap((r) => r.polygon)];
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
    const inside = (x, z) =>
      fm.roomAt([x, z]) > 0 || fm.floor.walls.some((w) => pointInPoly([x, z], w));
    const left = [], right = [];
    for (let j = 0; j < nz; j++) {
      const z = z0 + (j + 0.5) * cell;
      let a = null, b = null;
      for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * cell;
        if (inside(x, z)) { if (a === null) a = x0 + i * cell; b = x0 + (i + 1) * cell; }
      }
      if (a !== null) { left.push([a, z0 + j * cell], [a, z0 + (j + 1) * cell]); right.push([b, z0 + j * cell], [b, z0 + (j + 1) * cell]); }
    }
    return [...right, ...left.reverse()];
  }

  _buildCamera() {
    const cam = (this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200));
    // Hochformat: flacher drehen, damit das (längliche) Haus die Höhe nutzt
    const portrait = this.container.clientHeight > this.container.clientWidth * 1.2;
    const az = THREE.MathUtils.degToRad(portrait ? 12 : 28), el = THREE.MathUtils.degToRad(57);
    const dist = 40;
    cam.position.set(
      this.center.x + dist * Math.cos(el) * Math.sin(az),
      dist * Math.sin(el),
      this.center.z + dist * Math.cos(el) * Math.cos(az)
    );
    cam.lookAt(this.center);
    const c = (this.controls = new OrbitControls(cam, this.renderer.domElement));
    c.target.copy(this.center);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.minPolarAngle = THREE.MathUtils.degToRad(15);
    c.maxPolarAngle = THREE.MathUtils.degToRad(68);
    c.minZoom = 0.6;
    c.maxZoom = 5;
    c.screenSpacePanning = true;
    // Touch: ein Finger dreht, zwei Finger zoomen und verschieben
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.rotateSpeed = 0.7;
    c.addEventListener('change', () => {
      this.requestRender();
      this.onViewChange?.();
    });
    // während des Ziehens schnell rendern, danach (Stillstand) verfeinern
    c.addEventListener('start', () => (this._dragging = true));
    c.addEventListener('end', () => {
      this._dragging = false;
      this.requestRender();
    });
    c.update();
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this._fitFrustum(w / h);
    this.camera.updateProjectionMatrix();
    this.requestRender();
    this.onViewChange?.();
  }

  /** Frustum so wählen, dass das ganze Haus (inkl. Wandhöhe) mit etwas Rand ins Bild passt. */
  _fitFrustum(aspect) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const v = new THREE.Vector3();
    // alle sichtbaren Etagen samt Außenbereichen (inkl. Wandhöhe)
    const pts = this.activeFloors.flatMap((f) => {
      const y0 = f.group.position.y;
      return [...f.floor.walls.flat(), ...f.floor.rooms.flatMap((r) => r.polygon)].flatMap(([x, z]) => [[x, y0, z], [x, y0 + f.H, z]]);
    });
    for (const [x, y, z] of pts) {
      v.set(x, y, z).applyMatrix4(inv);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    const margin = 1.08;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    let halfW = ((maxX - minX) / 2) * margin, halfH = ((maxY - minY) / 2) * margin;
    if (halfW / halfH > aspect) halfH = halfW / aspect; else halfW = halfH * aspect;
    // Haus in die Bildmitte schieben (Kamera und Drehpunkt gemeinsam), Frustum symmetrisch halten
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const shift = right.multiplyScalar(cx).add(up.multiplyScalar(cy - halfH * 0.04)); // etwas Platz für die Titelleiste
    cam.position.add(shift);
    this.controls.target.add(shift);
    Object.assign(cam, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
  }

  /** Richtung Norden in Weltkoordinaten (Plan-oben = -z, im Uhrzeigersinn = +x). */
  get northVector() {
    const a = THREE.MathUtils.degToRad(this.house.north_deg || 0);
    return new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
  }

  /** Winkel, in dem Norden auf dem Bildschirm liegt (Grad, im Uhrzeigersinn von oben). */
  northScreenAngle() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const t = this.controls.target;
    const a = t.clone().project(this.camera);
    const b = t.clone().add(this.northVector).project(this.camera);
    return THREE.MathUtils.radToDeg(Math.atan2(((b.x - a.x) * w) / 2, ((b.y - a.y) * h) / 2));
  }

  /** Ansicht einnorden: Kamera um den Drehpunkt schwenken, bis Norden oben ist. */
  faceNorth(duration = 600) {
    const c = this.controls;
    const n = this.northVector;
    const target = Math.atan2(-n.x, -n.z); // Kamera steht südlich des Drehpunkts
    const start = c.getAzimuthalAngle();
    let delta = target - start;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // kürzester Weg
    const offset = new THREE.Vector3().subVectors(this.camera.position, c.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    const t0 = performance.now();
    // eine laufende Animation lässt sich sofort beenden (Ebenenwechsel: sonst dreht sie danach weiter)
    const anim = { finish: () => step(Infinity) };
    this._anim = anim;
    const step = (now) => {
      if (this._anim !== anim) return;
      const k = duration ? Math.min(1, (now - t0) / duration) : 1;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease-in-out
      sph.theta = start + delta * e;
      this.camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
      this.camera.lookAt(c.target);
      c.update();
      this.renderer.render(this.scene, this.camera);
      this.onViewChange?.();
      if (k < 1) return requestAnimationFrame(step);
      this._anim = null;
      this.resize(); // Bildausschnitt für die neue Blickrichtung neu einpassen
    };
    if (duration) requestAnimationFrame(step);
    else step(t0);
  }

  requestRender() {
    if (this._raf || this.paused) return;
    this._raf = requestAnimationFrame((t) => {
      this._raf = 0;
      const moving = this.controls.update() || this._dragging || !!this._anim;
      // Laufende Animationen (Ventilator …): Bild nur im eigenen, gedrosselten Takt – nicht mit 60 Bildern/s
      const anims = this._runningAnims();
      if (anims.length) {
        if (!moving && this._animT && t - this._animT < this._animInterval()) return this.requestRender();
        this._stepAnims(anims, this._animT ? Math.min(0.25, (t - this._animT) / 1000) : 0); // langsame Geräte: größere Schritte
        this._animT = t;
      } else this._animT = 0;
      this._draw();
      if (moving) this._measure(t);
      else this._lastT = 0;
      if (moving || anims.length) this.requestRender();
    });
  }

  // ---------- Animationen ----------
  // Bewegliche Teile (FurnishingLayer.animated) drehen sich, solange ihr Objekt aktiv ist (Entity an oder fester
  // Zustand). Nur dann läuft ein Bildtakt, gedrosselt auf 30 Bilder/s (Sparsam: 20); sonst bleibt es beim
  // Rendern bei Bedarf. Schatten werden dafür nicht neu berechnet.

  /** Aktivität eines Objekts: { active, speed } (speed 0..1, Standard 1) */
  setActivity(id, act) {
    (this.activity ??= new Map()).set(id, act);
    this._syncAnims();
    this.requestRender();
  }

  /** Animationen global an/aus (Einstellungen) */
  setAnimations(on) {
    this.animationsOn = on;
    this._syncAnims();
    this.requestRender();
  }

  /** Alle beweglichen Teile der gezeigten Ebenen */
  get _anims() {
    return this.activeLayers.flatMap((l) => l.animated || []);
  }

  /**
   * Zustände ohne Bildtakt nachführen: Tore stehen nach dem Laden sofort richtig (ohne Aufschwenken), ohne
   * Animationen springen sie in die Endlage; Energiefluss nur sichtbar, solange er läuft.
   */
  _syncAnims() {
    const on = this.animationsOn !== false;
    for (const a of this._anims) {
      const act = this.activity?.get(a.id)?.active ?? false;
      if (PROGRESS.has(a.spec.type) && (a.progress == null || !on)) {
        a.progress = act ? 1 : 0;
        this._pose(a);
      }
      if (a.spec.type === 'flow') a.node.visible = on && act;
    }
  }

  /** Läuft die Animation gerade (braucht sie Bilder)? */
  _runningAnims() {
    if (this.animationsOn === false || !this.activity?.size) return [];
    return this._anims.filter((a) => {
      const act = this.activity.get(a.id)?.active;
      if (PROGRESS.has(a.spec.type)) return a.progress != null && (act ? a.progress < 1 : a.progress > 0);
      return act;
    });
  }

  _animInterval() {
    return this.quality === 'low' ? 1000 / 20 : 1000 / 30;
  }

  _stepAnims(anims, dt) {
    for (const a of anims) {
      const { node, spec } = a;
      const act = this.activity.get(a.id);
      const speed = act?.speed ?? 1;
      if (spec.type === 'spin') {
        a.angle = ((a.angle || 0) + dt * spec.speed * speed * Math.PI * 2) % (Math.PI * 2);
        const axis = spec.axis === 'x' ? _X : spec.axis === 'z' ? _Z : _Y;
        node.quaternion.copy(node.userData.baseQuaternion).multiply(_q.setFromAxisAngle(axis, a.angle));
      } else if (PROGRESS.has(spec.type)) {
        const step = dt / (spec.duration || 5);
        a.progress = act?.active ? Math.min(1, a.progress + step) : Math.max(0, a.progress - step);
        this._pose(a);
      } else if (spec.type === 'flow') {
        // Lichtpunkte gleichmäßig verteilt den Pfad entlang, Tempo aus der Leistung
        a.phase = ((a.phase || 0) + dt * spec.speed * speed) % 1;
        const path = (a.path ??= pathOf(spec.path));
        node.children.forEach((m, i) => {
          if (!m.isMesh || m.geometry.type !== 'SphereGeometry') return;
          path.at(((a.phase + i / spec.count) % 1) * path.length, m.position);
        });
      }
    }
  }

  /** Tor nach Fortschritt (sanft beschleunigen/bremsen): Schwingtor dreht, Sektionaltor fährt die Schienen entlang */
  _pose(a) {
    const { node, spec } = a;
    if (!PROGRESS.has(spec.type)) return;
    const e = a.progress * a.progress * (3 - 2 * a.progress);
    if (spec.type === 'sectional') return poseSections(node, spec, e);
    const axis = spec.axis === 'y' ? _Y : spec.axis === 'z' ? _Z : _X;
    node.quaternion.copy(node.userData.baseQuaternion).multiply(_q.setFromAxisAngle(axis, spec.angle * e));
  }

  /** Sofort rendern (für Tests). */
  renderNow() {
    this.controls.update();
    this._draw();
  }

  /** Ein Bild (immer dasselbe, ob in Bewegung oder im Stillstand – kein Nachschärfen nach dem Anhalten) */
  _draw() {
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    // für die Leistungsanzeige: Bilder und Rechenzeit (CPU-Seite)
    this.frames = (this.frames || 0) + 1;
    this.frameMs = performance.now() - t0;
    this.onRender?.();
  }

  /**
   * Qualität „Automatisch“: Bildabstände beim Drehen/Zoomen messen. Liegen sie über 20 Bilder im Mittel über 45 ms
   * (unter ~22 Bildern/s), schaltet die Ansicht auf „Sparsam“ (bis zum Neuladen).
   */
  _measure(t) {
    if (this.qualityPref !== 'auto' || this.quality === 'low') return;
    if (this._lastT) {
      const dt = t - this._lastT;
      if (dt < 500) (this._dts ??= []).push(dt); // längere Pausen sind kein Ruckeln
      if (this._dts?.length >= 20) {
        const avg = this._dts.reduce((a, b) => a + b, 0) / this._dts.length;
        this._dts = [];
        if (avg > 45) {
          this._autoLow = true;
          this.setQuality('auto');
          this.onQualityChange?.(this.quality);
        }
      }
    }
    this._lastT = t;
  }

  /**
   * Qualität setzen: 'auto' | 'high' | 'low'. „Automatisch“ beginnt mit „Hoch“, außer das Gerät ist offensichtlich
   * schwach oder das Messen beim Drehen hat schon zu „Sparsam“ geführt.
   */
  setQuality(pref = 'auto') {
    this.qualityPref = pref;
    const weak = (navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2;
    const q = pref === 'auto' ? (this._autoLow || weak ? 'low' : 'high') : pref;
    if (q === this.quality) return;
    this.quality = q;
    const Q = QUALITY[q];
    const sky = this.skyLight;
    if (sky && sky.shadow.mapSize.x !== Q.shadowMap) {
      sky.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
      sky.shadow.map?.dispose();
      sky.shadow.map = null;
    }
    if (sky) sky.shadow.radius = Q.shadowRadius;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.maxPixelRatio));
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  /**
   * Punkt über einem Objekt (Weltkoordinaten) für die Zustandsanzeige, oder null, wenn es nicht auf der gezeigten
   * Ebene liegt.
   */
  objectTop(ref) {
    const key = `${ref.type}:${ref.id}`;
    // Zwischenspeicher je Einrichtung und Ebene (wird bei setFurnishing/setLevel geleert)
    this._tops ??= new Map();
    if (this._tops.has(key)) return this._tops.get(key);
    const top = this._objectTop(ref);
    this._tops.set(key, top);
    return top;
  }

  _objectTop(ref) {
    for (const layer of this.activeLayers) {
      const hit = [...layer.lampHits, ...layer.itemHits].find((h) => h.userData.ref.type === ref.type && h.userData.ref.id === ref.id);
      if (!hit) continue;
      hit.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(hit);
      return new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 0.1, (box.min.z + box.max.z) / 2);
    }
    return null;
  }

  /** Weltpunkt -> Bildschirmkoordinaten im Panel (px), null hinter der Kamera */
  toScreen(p) {
    const s = p.clone().project(this.camera);
    if (s.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: ((s.x + 1) / 2) * rect.width, y: ((1 - s.y) / 2) * rect.height };
  }

  // ---------- Licht-Zustand ----------

  /** Eine Lampe schalten; color: THREE.Color, brightness 0..1 */
  setLamp(lampId, on, { color, brightness } = {}) {
    const s = this.lamps.get(lampId);
    if (!s) return false;
    s.on = on;
    if (color) s.color.copy(color);
    if (brightness != null) s.brightness = brightness;
    this._updateLights();
    this.requestRender();
    return true;
  }

  lampsInRoom(roomId) {
    return [...this.lamps.entries()].filter(([, s]) => s.room === roomId).map(([id]) => id);
  }

  isRoomLit(roomId) {
    return this.lampsInRoom(roomId).some((id) => this.lamps.get(id).on);
  }

  /** Alle Lampen eines Raums schalten ("aussen" = Außenbeleuchtung). */
  setRoomLight(roomId, on, opts = {}) {
    const ids = this.lampsInRoom(roomId);
    for (const id of ids) {
      const s = this.lamps.get(id);
      s.on = on;
      if (opts.color) s.color.copy(opts.color);
      if (opts.brightness != null) s.brightness = opts.brightness;
    }
    this._updateLights();
    this.requestRender();
    return ids.length > 0;
  }

  /** Alle Außenleuchten (in Außenbereichen oder auf freiem Gelände) schalten. */
  setOutdoorLight(on) {
    const ids = [...this.lamps.entries()].filter(([, s]) => s.lamp.outdoor).map(([id]) => id);
    for (const id of ids) this.lamps.get(id).on = on;
    this._updateLights();
    this.requestRender();
    return ids.length > 0;
  }

  _updateLights() {
    const T = this.lightTable;
    const sums = new Map();
    const c = new THREE.Color();
    for (const s of this.lamps.values()) {
      if (s.on) c.copy(s.color).multiplyScalar((LAMP_INTENSITY[s.lamp.kind] ?? 1.5) * s.brightness);
      else c.setRGB(0, 0, 0);
      T.setLampColor(s.idx - 1, c);
      const sum = sums.get(s.roomIdx) || new THREE.Color(0, 0, 0);
      sums.set(s.roomIdx, sum.add(c));
    }
    for (const [ri, sum] of sums) T.setRoomSum(ri, sum);
    T.commit();
  }

  // ---------- Antippen ----------

  /** Einrichtungs-Schichten der gezeigten Ebene */
  get activeLayers() {
    return this.activeFloors.map((f) => this.furnishing[this.floors.indexOf(f)]).filter(Boolean);
  }

  /** Lampen-Position live setzen (Editor: Leuchte wird verschoben, Licht wandert mit). */
  moveLampLight(lampId, [x, y, z]) {
    const s = this.lamps.get(lampId);
    if (!s) return;
    this.lightTable.setLampPosition(s.idx - 1, [x, y + (s.lamp.base || 0) + s.floor.group.position.y, z], s.lamp.range);
    this.lightTable.commit();
    this.requestRender();
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const HOLD_MS = 500; // so lange ruhig drücken = langes Drücken (z. B. HA-Dialog)
    const DOUBLE_MS = 300; // zweites Antippen innerhalb dieser Zeit = Doppeltippen
    let down = null;
    let pointers = 0;
    let holdTimer = 0;
    let pendingTap = null; // { ref, timer }: Antippen wartet, ob ein zweites folgt (nur bei Objekten mit Doppeltippen)
    const cancelHold = () => clearTimeout(holdTimer);
    const gesture = (ref, g) => this.onObjectGesture?.(ref, g);
    const rayAt = (x, y) => {
      const rect = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), this.camera);
      return ray;
    };
    // vorderstes Objekt unter dem zuletzt gesetzten Strahl, das auf die Geste reagiert (Leuchten vor Möbeln)
    const objectAt = (g) => {
      const layers = this.activeLayers;
      for (const hits of [layers.flatMap((l) => l.lampHits), layers.flatMap((l) => l.itemHits)]) {
        for (const h of ray.intersectObjects(hits, false)) {
          const ref = h.object.userData.ref;
          if (this.objectGestures?.(ref).has(g)) return ref;
        }
      }
      return null;
    };
    el.addEventListener('pointerdown', (e) => {
      pointers++;
      cancelHold();
      // nur ein Finger zählt als Antippen; ein zweiter Finger macht daraus eine Geste
      down = pointers === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), touch: e.pointerType !== 'mouse' } : null;
      // langes Drücken nur auf ein Objekt, nur mit der Haupttaste und nicht im Editiermodus
      if (!down || e.button !== 0 || this.tapHandler || !this.onObjectGesture) return;
      const start = down;
      holdTimer = setTimeout(() => {
        if (down !== start) return;
        rayAt(start.x, start.y);
        const ref = objectAt('hold');
        if (!ref) return;
        down = null; // das Loslassen ist dann kein Antippen mehr
        gesture(ref, 'hold');
      }, HOLD_MS);
    });
    el.addEventListener('pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > (down.touch ? 14 : 6)) cancelHold();
    });
    el.addEventListener('pointercancel', () => { pointers = Math.max(0, pointers - 1); down = null; cancelHold(); });
    // iOS/Android: kein Kontextmenü beim langen Drücken
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerup', (e) => {
      pointers = Math.max(0, pointers - 1);
      cancelHold();
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      const tol = down.touch ? 14 : 6; // Finger sind ungenauer als die Maus
      down = null;
      if (moved > tol || dt > 700 || this.suppressTap) return;
      rayAt(e.clientX, e.clientY);
      // Im Editiermodus entscheidet der Editor, was ein Antippen bedeutet
      if (this.tapHandler?.(ray)) return;
      // Objekte haben Vorrang vor Räumen; mit Doppeltippen wartet das Antippen kurz auf ein zweites
      const dbl = objectAt('double_tap');
      if (pendingTap) {
        const p = pendingTap;
        clearTimeout(p.timer);
        pendingTap = null;
        if (dbl && dbl.type === p.ref.type && dbl.id === p.ref.id) return gesture(dbl, 'double_tap');
        if (p.tap) gesture(p.ref, 'tap'); // anderes Ziel: das erste Antippen jetzt ausführen
      }
      const ref = objectAt('tap');
      if (dbl) {
        const p = { ref: dbl, tap: !!ref && ref.type === dbl.type && ref.id === dbl.id };
        p.timer = setTimeout(() => {
          pendingTap = null;
          if (p.tap) gesture(dbl, 'tap');
        }, DOUBLE_MS);
        pendingTap = p;
        return;
      }
      if (ref) return gesture(ref, 'tap');
      const targets = this.activeFloors.flatMap((f) => [...f.rooms.values()].map((r) => r.hitMesh));
      const hit = ray.intersectObjects(targets, false)[0];
      if (hit) this.onRoomTap?.(hit.object.userData.roomId);
    });
  }

  dispose() {
    this.paused = true;
    cancelAnimationFrame(this._raf);
    this.skyEnv.dispose();
    this._resizeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
