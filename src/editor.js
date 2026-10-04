// Editiermodus: Möbel und Leuchten antippen, mit einem Koordinatensystem (Pfeile = verschieben,
// Ring = drehen) bewegen oder mit dem Anlege-Werkzeug bündig an Wand oder Boden setzen.
// Das gewählte Objekt wird für die Dauer der Bearbeitung einzeln gebaut (alle anderen bleiben
// zusammengefasst); beim Abwählen wandern die neuen Werte in die Daten und die Einrichtung wird neu gebaut.
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { refKey, anchorOf } from './furnishing.js';
import { layoutValues } from './store.js';
import { cleanHa, roleEntities } from './model/model.js';

const ACCENT = 0xf0b45a;
const r2 = (v) => Math.round(v * 100) / 100;           // cm
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Drehwinkel um die Hochachse (Radiant) aus der Quaternion – NICHT aus rotation.y lesen: three.js zerlegt eine
 * reine Hochachsen-Drehung über 90° in Euler (180°, 180° − θ, 180°), rotation.y wäre dann falsch.
 */
const getYaw = (obj) => {
  const v = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion);
  return Math.atan2(v.x, v.z);
};
const setYaw = (obj, yaw) => obj.quaternion.setFromAxisAngle(Y_AXIS, yaw);

const rDeg = (v) => Math.round((((v % 360) + 360) % 360) * 10) / 10 % 360; // 359.96 -> 0

// Flächen eines Objekts in lokalen Koordinaten (für das Anlege-Werkzeug)
const FACES = {
  back: new THREE.Vector3(0, 0, -1), front: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(-1, 0, 0), right: new THREE.Vector3(1, 0, 0),
  bottom: new THREE.Vector3(0, -1, 0),
};

export class Editor {
  /**
   * @param view      HouseScene
   * @param onChange  (info) => void  – Auswahl/Werte geändert (für die Werkzeugleiste)
   */
  constructor(view, { onChange, onLinkChange } = {}) {
    this.view = view;
    this.onChange = onChange;
    this.onLinkChange = onLinkChange;
    this.enabled = false;
    this.tool = 'move';       // 'move' | 'align'
    this.sel = null;          // { type, id, entry, proxy, box }
    this.alignFace = 'back';
    this.undoStack = [];
    this.changes = new Map(); // refKey -> { type, id, values } (seit dem letzten Speichern)

    const cam = view.camera, dom = view.renderer.domElement;
    // Verschieben entlang der Objektachsen; nur die Bodenebene als Fläche
    this.move = new TransformControls(cam, dom);
    Object.assign(this.move, { space: 'local', size: 0.6, showXY: false, showYZ: false, translationSnap: 0.01 });
    this.move.setMode('translate');
    // Drehen nur um die senkrechte Achse; Ring größer als die Pfeile, damit sich die Griffe nicht überlagern
    this.rotate = new TransformControls(cam, dom);
    Object.assign(this.rotate, { space: 'local', size: 0.95, showX: false, showZ: false, showE: false, showXYZE: false, rotationSnap: THREE.MathUtils.degToRad(5) });
    this.rotate.setMode('rotate');

    for (const tc of [this.move, this.rotate]) {
      tc.addEventListener('change', () => view.requestRender());
      tc.addEventListener('dragging-changed', (e) => {
        view.controls.enabled = !e.value;
        view._dragging = e.value; // beim Ziehen schnelle Bilder, danach verfeinern
        if (e.value) {
          this._pushUndo();
          view.suppressTap = true;
        } else {
          this._readProxy();
          // Das pointerup nach dem Ziehen ist kein Antippen
          setTimeout(() => (view.suppressTap = false), 0);
        }
      });
      tc.addEventListener('objectChange', () => this._readProxy(true));
    }
    this.helpers = [this.move.getHelper(), this.rotate.getHelper()];
  }

  setEnabled(on) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.view.tapHandler = (ray) => this._onTap(ray);
      for (const h of this.helpers) this.view.scene.add(h);
    } else {
      this.select(null);
      this.view.tapHandler = null;
      for (const h of this.helpers) h.removeFromParent();
    }
    this._emit();
  }

  setTool(tool) {
    this.tool = tool;
    this.alignFace = 'back';
    this._showGizmo();
    this._updateFaceMarker();
    this._emit();
  }

  // ------------------------------------------------------------------ Auswahl

  /** @param ref { type: 'item'|'lamp', id } oder null */
  select(ref) {
    const v = this.view;
    if (this.sel) {
      this.move.detach();
      this.rotate.detach();
      this.sel.proxy.removeFromParent();
      this.sel = null;
    }
    if (!ref) {
      // alles wieder zusammengefasst bauen
      v.setFurnishing(v.furnishingData);
      this._emit();
      return;
    }
    const entry = this._entry(ref);
    if (!entry) return;
    v.setFurnishing(v.furnishingData, { exclude: new Set([refKey(ref.type, ref.id)]) });
    // Etage des Objekts (eine Ebene kann mehrere Gebäude-Etagen und die Außen-Etage zeigen)
    const fm = v.floorModel(entry.floor) || v.activeFloor;
    const layer = v.furnishing[v.floors.indexOf(fm)];
    const buildEntry = ref.type === 'lamp' ? { ...entry, idx: v.lamps.get(ref.id)?.idx ?? 0 } : entry;
    const { group, box } = layer.buildSingle(ref.type, buildEntry);
    const proxy = group;
    proxy.name = 'editor-proxy';
    // Auswahlrahmen
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x + 0.02, size.y + 0.02, size.z + 0.02)),
      new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true, opacity: 0.9 })
    );
    frame.position.copy(c);
    frame.renderOrder = 10;
    proxy.add(frame);
    const at = anchorOf(ref.type, entry);
    proxy.position.set(at.x, at.y + fm.group.position.y, at.z);
    setYaw(proxy, -THREE.MathUtils.degToRad(at.rot));
    v.scene.add(proxy);
    this.sel = { ...ref, entry, proxy, box, floorY: fm.group.position.y };
    this.alignFace = 'back';
    this._showGizmo();
    this._updateFaceMarker();
    v.requestRender();
    this._emit();
  }

  /** Auswahl aufheben, ohne die Einrichtung neu zu bauen (der Aufrufer baut sie ohnehin neu) */
  clearSelection() {
    if (!this.sel) return;
    this.move.detach();
    this.rotate.detach();
    this.sel.proxy.removeFromParent();
    this._faceMarker = null;
    this.sel = null;
  }

  _entry({ type, id }) {
    const d = this.view.furnishingData;
    return (type === 'lamp' ? d.devices : d.items).find((e) => e.id === id);
  }

  _showGizmo() {
    const s = this.sel;
    this.move.detach();
    this.rotate.detach();
    if (!s || this.tool !== 'move') return this.view.requestRender();
    // senkrecht verschieben nur, wo es eine Höhe gibt (Leuchten, Bilder, TV, Vorhänge)
    this.move.showY = s.type === 'lamp' || s.entry.elevation != null;
    this.move.attach(s.proxy);
    this.rotate.attach(s.proxy);
    this.view.requestRender();
  }

  // ------------------------------------------------------------------ Werte

  /** Lage des Proxys in die Daten übernehmen. live = während des Ziehens (nur Licht nachführen). */
  _readProxy(live = false) {
    const s = this.sel;
    if (!s) return;
    const p = s.proxy.position, e = s.entry;
    const y = Math.max(0, p.y - s.floorY - (e.base || 0));
    e.pos = [r2(p.x), r2(p.z)];
    const rot = rDeg(-THREE.MathUtils.radToDeg(getYaw(s.proxy)));
    if (e.rot != null || rot !== 0) e.rot = rot; // Leuchten ohne Drehung bekommen kein "rot: 0"
    if (s.type === 'lamp') e.height = r2(y);
    else if (e.elevation != null) e.elevation = r2(y);
    if (s.type === 'lamp') this.view.moveLampLight(s.id, [p.x, y, p.z]);
    // im Gelände: nach dem Verschieben der Bodenhöhe an der neuen Stelle folgen (Höhe über Boden bleibt)
    if (!live) {
      const nb = this.view.baseAt(e.floor, e.room, e.pos);
      if (Math.abs(nb - (e.base || 0)) > 1e-3) {
        e.base = nb;
        p.y = s.floorY + nb + y;
        const st = s.type === 'lamp' && this.view.lamps.get(s.id);
        if (st) {
          st.lamp.base = nb;
          this.view.moveLampLight(s.id, [p.x, y, p.z]);
        }
      }
    }
    if (!live) this.changes.set(refKey(s.type, s.id), { type: s.type, id: s.id, values: layoutValues(s.type, e) });
    this._emit();
  }

  _pushUndo() {
    const s = this.sel;
    if (!s) return;
    this.undoStack.push({ type: s.type, id: s.id, values: structuredClone(layoutValues(s.type, s.entry)) });
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  /** Schalt-Entities (Rolle power) des gewählten Objekts setzen (String, Liste oder null). */
  setEntity(entity) {
    const ha = structuredClone(this.sel?.entry.ha || {});
    ha.entities = { ...(ha.entities || {}), power: entity ?? undefined };
    this.setHa(ha);
  }

  /** HA-Einstellungen (`ha`: Entities nach Rolle, Gesten, Zustandsanzeige) des gewählten Objekts setzen. */
  setHa(ha) {
    const s = this.sel;
    if (!s) return;
    this._pushUndo();
    this._applyHa(s.type, s.id, s.entry, cleanHa(ha));
    this.changes.set(refKey(s.type, s.id), { type: s.type, id: s.id, values: layoutValues(s.type, s.entry) });
    this._emit();
  }

  /** Fester Zustand des gewählten Objekts ohne Entity ('on' oder undefined = aus) */
  setState(state) {
    const s = this.sel;
    if (!s) return;
    this._pushUndo();
    s.entry.state = state;
    this.changes.set(refKey(s.type, s.id), { type: s.type, id: s.id, values: layoutValues(s.type, s.entry) });
    this._emit();
  }

  _applyHa(type, id, e, ha) {
    e.ha = ha;
    if (type === 'lamp') {
      e.entity = roleEntities(e, 'power');
      const st = this.view.lamps.get(id);
      if (st) {
        st.lamp.entity = e.entity; // Kopie in der Szene mitführen
        st.lamp.ha = ha;
        st.haRefs = null;          // Zustand beim nächsten hass-Update neu übernehmen
      }
    }
    this.onLinkChange?.({ type, id });
  }

  undo() {
    const u = this.undoStack.pop();
    if (!u) return;
    if (u.restore) return u.restore(); // Objektbestand (Hinzufügen/Einlagern/Löschen), siehe main.js
    const e = this._entry(u);
    Object.assign(e, u.values);
    this._applyHa(u.type, u.id, e, e.ha);
    this.changes.set(refKey(u.type, u.id), { type: u.type, id: u.id, values: layoutValues(u.type, e) });
    // neu auswählen = Proxy an der alten Lage neu aufbauen
    this.select({ type: u.type, id: u.id });
  }

  // ------------------------------------------------------------------ Antippen

  _onTap(ray) {
    const v = this.view;
    const s = this.sel;
    if (this.tool === 'align' && s) {
      // 1. eigene Fläche wählen
      const faceName = this._hitOwnFace(ray);
      if (faceName) {
        this.alignFace = faceName;
        this._updateFaceMarker();
        this._emit();
        return true;
      }
      // 2. Fläche des Hauses antippen
      const house = v.activeFloors.flatMap((f) => f.group.children).filter((c) => c.isMesh && c.material !== v.shared.hitMaterial);
      const hit = ray.intersectObjects(house, false)[0];
      if (hit) {
        this._pushUndo();
        this._alignTo(hit);
        this._readProxy();
        return true;
      }
      return true;
    }
    // Objekt wählen (Leuchten vor Möbeln)
    const hit = ray.intersectObjects(v.activeLayers.flatMap((l) => [...l.lampHits, ...l.itemHits]), false)[0];
    if (hit) this.select(hit.object.userData.ref);
    else if (s) this.select(null);
    return true;
  }

  /** Welche Fläche der eigenen Box wurde angetippt? */
  _hitOwnFace(ray) {
    const s = this.sel;
    const inv = s.proxy.matrixWorld.clone().invert();
    const r = ray.ray.clone().applyMatrix4(inv);
    const p = r.intersectBox(s.box, new THREE.Vector3());
    if (!p) return null;
    const b = s.box, eps = 0.02;
    if (Math.abs(p.z - b.min.z) < eps) return 'back';
    if (Math.abs(p.z - b.max.z) < eps) return 'front';
    if (Math.abs(p.x - b.min.x) < eps) return 'left';
    if (Math.abs(p.x - b.max.x) < eps) return 'right';
    if (Math.abs(p.y - b.min.y) < eps) return 'bottom';
    return null;
  }

  /** Gewählte Objektfläche bündig an die angetippte Haus-Fläche setzen. */
  _alignTo(hit) {
    const s = this.sel, proxy = s.proxy, b = s.box;
    const N = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    if (N.y > 0.7) {
      // Boden: Unterkante auf die Fläche
      proxy.position.y = hit.point.y - b.min.y;
      return;
    }
    N.y = 0;
    N.normalize();
    const faceName = this.alignFace === 'bottom' ? 'back' : this.alignFace;
    const local = FACES[faceName];
    // drehen: Objektfläche zeigt gegen die Wand (-N)
    const world = local.clone().applyQuaternion(proxy.quaternion);
    const ang = (v) => Math.atan2(v.x, v.z);
    let yaw = getYaw(proxy) + ang(N.clone().negate()) - ang(world);
    // Magicplan-Wände sind um Zehntelgrad schief: nahe an 90°-Schritten auf den rechten Winkel einrasten
    const q = Math.PI / 2, snapped = Math.round(yaw / q) * q;
    if (Math.abs(yaw - snapped) < THREE.MathUtils.degToRad(1)) yaw = snapped;
    setYaw(proxy, yaw);
    proxy.updateMatrixWorld(true);
    // verschieben: Flächenmitte auf die Wandebene (+ 2 mm Luft gegen Flimmern)
    const c = b.getCenter(new THREE.Vector3());
    const fc = c.clone();
    if (faceName === 'back') fc.z = b.min.z;
    if (faceName === 'front') fc.z = b.max.z;
    if (faceName === 'left') fc.x = b.min.x;
    if (faceName === 'right') fc.x = b.max.x;
    proxy.localToWorld(fc);
    const d = fc.clone().sub(hit.point).dot(N);
    proxy.position.addScaledVector(N, 0.002 - d);
    this.view.requestRender();
  }

  _updateFaceMarker() {
    const s = this.sel;
    this._faceMarker?.removeFromParent();
    this._faceMarker = null;
    if (!s || this.tool !== 'align') return this.view.requestRender();
    const b = s.box, size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const f = this.alignFace;
    const geo = f === 'back' || f === 'front' ? new THREE.PlaneGeometry(size.x, size.y)
      : f === 'bottom' ? new THREE.PlaneGeometry(size.x, size.z) : new THREE.PlaneGeometry(size.z, size.y);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthTest: false }));
    m.renderOrder = 11;
    m.position.copy(c);
    if (f === 'back') m.position.z = b.min.z - 0.005;
    if (f === 'front') m.position.z = b.max.z + 0.005;
    if (f === 'left') { m.position.x = b.min.x - 0.005; m.rotation.y = Math.PI / 2; }
    if (f === 'right') { m.position.x = b.max.x + 0.005; m.rotation.y = Math.PI / 2; }
    if (f === 'bottom') { m.position.y = b.min.y + 0.005; m.rotation.x = Math.PI / 2; }
    s.proxy.add(m);
    this._faceMarker = m;
    this.view.requestRender();
  }

  _emit() {
    const s = this.sel;
    this.onChange?.({
      enabled: this.enabled,
      tool: this.tool,
      alignFace: this.alignFace,
      canUndo: this.undoStack.length > 0,
      dirty: this.changes.size > 0,
      selection: s ? { type: s.type, id: s.id, name: s.entry.name || s.entry.id, room: s.entry.room, floor: s.entry.floor, ...layoutValues(s.type, s.entry) } : null,
    });
  }

  dispose() {
    this.setEnabled(false);
    this.move.dispose();
    this.rotate.dispose();
  }
}
