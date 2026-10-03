// three.js-Szene: Kamera, Licht, Umgebung, Render-on-demand, Antippen von Räumen und Lampen.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FloorModel, createSharedMaterials } from './house.js';
import { FurnishingLayer } from './furnishing.js';
import { LightTable, lightUniforms, withRoomLight, OUTDOOR_IDX, MAX_LAMPS, MAX_LAMPS_PER_ROOM } from './roomlight.js';
import { pointInPoly } from './geometry.js';
import { groundTexture } from './textures.js';

// Warmweiß ~2700 K
const DEFAULT_LIGHT = new THREE.Color().setRGB(1.0, 0.8, 0.6, THREE.SRGBColorSpace);
const LAMP_INTENSITY = { ceiling: 1.7, pendant: 1.6, floor: 1.2, table: 0.9, wall: 1.1, spot: 1.0 };

export class HouseScene {
  /**
   * @param house        data/house.json (Bauwerk)
   * @param furnishing   { devices, items } aus data/devices.yaml und data/furniture.yaml
   */
  /** assetBase: Ordner der Daten (für Texturen wie textures/…), wie data_url */
  constructor(container, house, furnishing, { onRoomTap, onLampTap, onViewChange, assetBase = null } = {}) {
    this.container = container;
    this.house = house;
    this.onRoomTap = onRoomTap;
    this.onLampTap = onLampTap;
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
    this.scene.background = new THREE.Color(0x0a0d13);
    this.scene.fog = new THREE.Fog(0x0a0d13, 45, 95);

    this.shared = createSharedMaterials();
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
    this.activeFloor = this.floors[0];
    this.activeFloor.makeFloorAO();
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
        this.lightTable.setLampPosition(l.idx - 1, [l.pos[0], l.height + fm.group.position.y, l.pos[1]], l.range);
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
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  _buildEnvironment() {
    const fm = this.activeFloor;
    const pts = fm.floor.walls.flat();
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    this.bounds = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    const cx = (this.bounds.x0 + this.bounds.x1) / 2, cz = (this.bounds.z0 + this.bounds.z1) / 2;
    this.center = new THREE.Vector3(cx, 0, cz);

    // Rasen
    const gt = groundTexture();
    gt.repeat.set(1 / gt.userData.metersPerRepeat, 1 / gt.userData.metersPerRepeat);
    const groundMat = withRoomLight(new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }), {});
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
    const uv = ground.geometry.attributes.uv;
    const pos = ground.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) + cx, -pos.getY(i) + cz);
    ground.geometry.setAttribute('roomIdx', new THREE.Float32BufferAttribute(new Float32Array(uv.count), 1));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.12, cz);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Bodenplatte unter dem Haus (sichtbare Kante)
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.95 });
    const outline = this._houseOutline();
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false }), slabMat);
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = -0.141;
    slab.receiveShadow = true;
    this.scene.add(slab);

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
    const elev = sun?.elevation ?? -20;
    const azim = sun?.azimuth ?? 20; // ohne Sensor: Mond im Süden (Sonne gegenüber)
    const key = `${azim.toFixed(1)}/${elev.toFixed(1)}`;
    if (key === this._skyKey) return;
    this._skyKey = key;

    const day = THREE.MathUtils.smoothstep(elev, -6, 8);
    this.daylight = day;
    const L = (a, b) => a + (b - a) * day;
    const mix = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), day);

    // Halbkugel: Nacht kühl und gedämpft, Tag hell mit warmem Bodenreflex
    this.hemi.color.copy(mix(0x525a6c, 0xc9d8ec));
    this.hemi.groundColor.copy(mix(0x1e1d1c, 0x6e6250));
    this.hemi.intensity = L(1.2, 1.6);
    this.scene.background.copy(mix(0x0a0d13, 0x8d9aa8));
    this.scene.fog.color.copy(this.scene.background);

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
    this.renderer.shadowMap.needsUpdate = true;
    this.onSkyChange?.(day);
    this.requestRender();
  }

  /** Außenkontur für die Bodenplatte: zeilenweise abgetastetes Treppenpolygon aus Räumen und Wänden. */
  _houseOutline() {
    const fm = this.activeFloor;
    const cell = 0.25;
    const { x0, x1, z0, z1 } = this.bounds;
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
    const H = this.activeFloor.H;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const v = new THREE.Vector3();
    for (const [x, z] of this.activeFloor.floor.walls.flat()) for (const y of [0, H]) {
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
    const step = (now) => {
      const k = duration ? Math.min(1, (now - t0) / duration) : 1;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease-in-out
      sph.theta = start + delta * e;
      this.camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
      this.camera.lookAt(c.target);
      c.update();
      this.renderer.render(this.scene, this.camera);
      this.onViewChange?.();
      if (k < 1) requestAnimationFrame(step);
      else this.resize(); // Bildausschnitt für die neue Blickrichtung neu einpassen
    };
    if (duration) requestAnimationFrame(step);
    else step(t0);
  }

  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const moving = this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.frames = (this.frames || 0) + 1;
      if (moving) this.requestRender();
    });
  }

  /** Sofort rendern (für Tests). */
  renderNow() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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

  setOutdoorLight(on) {
    return this.setRoomLight('aussen', on);
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

  get activeLayer() {
    return this.furnishing[this.floors.indexOf(this.activeFloor)];
  }

  /** Lampen-Position live setzen (Editor: Leuchte wird verschoben, Licht wandert mit). */
  moveLampLight(lampId, [x, y, z]) {
    const s = this.lamps.get(lampId);
    if (!s) return;
    this.lightTable.setLampPosition(s.idx - 1, [x, y + s.floor.group.position.y, z], s.lamp.range);
    this.lightTable.commit();
    this.requestRender();
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    let down = null;
    let pointers = 0;
    el.addEventListener('pointerdown', (e) => {
      pointers++;
      // nur ein Finger zählt als Antippen; ein zweiter Finger macht daraus eine Geste
      down = pointers === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), touch: e.pointerType !== 'mouse' } : null;
    });
    el.addEventListener('pointercancel', () => { pointers = Math.max(0, pointers - 1); down = null; });
    el.addEventListener('pointerup', (e) => {
      pointers = Math.max(0, pointers - 1);
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      const tol = down.touch ? 14 : 6; // Finger sind ungenauer als die Maus
      down = null;
      if (moved > tol || dt > 700 || this.suppressTap) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      // Im Editiermodus entscheidet der Editor, was ein Antippen bedeutet
      if (this.tapHandler?.(ray)) return;
      // Lampen haben Vorrang vor Räumen
      const layer = this.activeLayer;
      const lampHit = ray.intersectObjects(layer?.lampHits || [], false)[0];
      if (lampHit) return this.onLampTap?.(lampHit.object.userData.lampId);
      const targets = [...this.activeFloor.rooms.values()].map((r) => r.hitMesh);
      const hit = ray.intersectObjects(targets, false)[0];
      if (hit) this.onRoomTap?.(hit.object.userData.roomId);
    });
  }

  dispose() {
    this._resizeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
