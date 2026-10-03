// Einrichtungs-Schicht: Möbel (furniture.yaml) und Leuchten (devices.yaml).
// Unabhängig vom Hausmodell: lässt sich jederzeit verwerfen und neu aufbauen, ohne das Haus anzufassen.
// Bezug zum Haus nur über Raum-IDs und Plan-Koordinaten.
import * as THREE from 'three';
import { Builder } from './geometry.js';
import { PartCollector, PALETTE, FURNITURE, LAMPS } from './models.js';
import { withRoomLight, lampMaterial } from './roomlight.js';

// Leuchtende Teile: Farbe im ausgeschalteten Zustand
const GLOW_OFF = { shade: 0x8f897d, bulb: 0x7d786f, disc: 0x1f1e1c };

/** Schlüssel eines bearbeitbaren Objekts, z. B. "item:sofa" oder "lamp:eg_wohnen_stehlampe". */
export const refKey = (type, id) => `${type}:${id}`;

/**
 * Ankerpunkt eines Objekts: dort sitzt das Koordinatensystem im Editor.
 * Möbel: am Boden (bzw. auf `elevation` bei Bildern, TV, Vorhängen); Leuchten: an der Lichtquelle.
 */
export function anchorOf(type, e) {
  const y = type === 'lamp' ? e.height : e.elevation ?? 0;
  return { x: e.pos[0], y, z: e.pos[1], rot: e.rot || 0 };
}

export class FurnishingLayer {
  /**
   * @param floorModel  FloorModel der Etage (Raum-Indizes, Deckenhöhen)
   * @param lamps       Leuchten dieser Etage, jeweils mit globalem `idx` (1-basiert, für die LightTable)
   * @param items       Möbel dieser Etage
   * @param exclude     Set von refKeys, die nicht in die zusammengefassten Meshes kommen (gerade im Editor)
   */
  constructor(floorModel, lamps, items, shared, { exclude = new Set() } = {}) {
    this.shared = shared;
    this.floorModel = floorModel;
    this.group = new THREE.Group();
    this.group.name = `furnishing-${floorModel.floor.id}`;
    this.lampHits = [];
    this.itemHits = [];
    this.boxes = new Map(); // refKey -> lokale Box3 (Ankerkoordinaten)
    this.warnings = [];

    const P = new PartCollector();
    const pools = new Builder();
    for (const it of items) {
      const box = this._buildItem(P, it, anchorOf('item', it), exclude.has(refKey('item', it.id)));
      if (box) this._hitBox('item', it, box);
    }
    for (const lamp of lamps) {
      const box = this._buildLamp(P, lamp, anchorOf('lamp', lamp), exclude.has(refKey('lamp', lamp.id)));
      if (box) this.boxes.set(refKey('lamp', lamp.id), box);
      if (lamp.room === 'aussen' && lamp.kind === 'wall') {
        const [fx, fz] = lamp.facing || [0, 0];
        quad(pools, lamp.pos[0] + fx * 1.2, lamp.pos[1] + fz * 1.2, 1.6, 1.6, lamp.idx, -0.1);
      }
      // Trefferfläche zum Antippen (größer als der Leuchtkörper)
      const hit = new THREE.Mesh(shared.lampHitGeometry, shared.hitMaterial);
      hit.position.set(lamp.pos[0], lamp.height, lamp.pos[1]);
      hit.userData.lampId = lamp.id;
      hit.userData.ref = { type: 'lamp', id: lamp.id };
      this.lampHits.push(hit);
      this.group.add(hit);
    }

    for (const m of P.build((key, kind) => this._material(key, kind))) this.group.add(m);
    if (!pools.empty) {
      const m = new THREE.Mesh(pools.geometry('lampIdx'), shared.mat.pool);
      m.renderOrder = 3;
      this.group.add(m);
    }
    for (const w of this.warnings) console.warn('ha-3d-dashboard:', w);
  }

  _roomIdx(room) {
    return room === 'aussen' ? 0 : this.floorModel.rooms.get(room)?.idx || 0;
  }

  /** Ein Möbel in P bauen (Anker = Weltlage) oder nur vermessen (skip). Liefert die Box in Ankerkoordinaten. */
  _buildItem(P, it, at, skip = false) {
    const make = FURNITURE[it.kind];
    if (!make) {
      this.warnings.push(`Möbel ${it.id}: unbekannte Art "${it.kind}"`);
      return null;
    }
    const target = skip ? new PartCollector() : P;
    target.begin(at.x, at.z, at.rot, this._roomIdx(it.room), at.y - (it.elevation ?? 0));
    make(target, it);
    return target.bounds.clone().translate(new THREE.Vector3(0, -(it.elevation ?? 0), 0));
  }

  _buildLamp(P, lamp, at, skip = false) {
    const room = this.floorModel.rooms.get(lamp.room);
    const ceiling = room?.ceiling ?? this.floorModel.floor.ceiling;
    let model = lamp.model || (lamp.kind === 'wall' ? 'wall_box' : 'disc');
    if (!LAMPS[model]) {
      this.warnings.push(`Leuchte ${lamp.id}: unbekanntes Modell "${lamp.model}"`);
      model = 'disc';
    }
    const target = skip ? new PartCollector() : P;
    target.begin(at.x, at.z, at.rot, this._roomIdx(lamp.room), at.y - lamp.height);
    LAMPS[model](target, lamp, { ceiling, roomIdx: this._roomIdx(lamp.room), lampIdx: lamp.idx });
    return target.bounds.clone().translate(new THREE.Vector3(0, -lamp.height, 0));
  }

  /** Unsichtbare Trefferbox eines Möbels (für Auswahl im Editor). */
  _hitBox(type, e, box) {
    this.boxes.set(refKey(type, e.id), box);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const at = anchorOf(type, e);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x, 0.05), Math.max(size.y, 0.05), Math.max(size.z, 0.05)), this.shared.hitMaterial);
    const m = new THREE.Matrix4().makeRotationY(-THREE.MathUtils.degToRad(at.rot)).setPosition(at.x, at.y, at.z);
    hit.applyMatrix4(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).premultiply(m));
    hit.userData.ref = { type, id: e.id };
    this.itemHits.push(hit);
    this.group.add(hit);
  }

  /**
   * Ein Objekt einzeln bauen, mit dem Ursprung im Anker (für den Editor: wird als Ganzes verschoben/gedreht).
   * Liefert { group, box }.
   */
  buildSingle(type, e) {
    const P = new PartCollector();
    const at = { x: 0, y: 0, z: 0, rot: 0 };
    const box = type === 'lamp' ? this._buildLamp(P, e, at) : this._buildItem(P, e, at);
    const group = new THREE.Group();
    for (const m of P.build((key, kind) => this._material(key, kind))) group.add(m);
    return { group, box };
  }

  /** Materialien werden pro Szene geteilt (shared.furnitureMats). */
  _material(key, kind) {
    const cache = (this.shared.furnitureMats ??= new Map());
    const k = `${kind}:${key}`;
    if (!cache.has(k)) {
      if (kind === 'glow') cache.set(k, lampMaterial({ strength: 1.6, offColor: GLOW_OFF[key] ?? 0x777777 }));
      else if (key.startsWith('tex:')) {
        // Bildtextur aus dem Datenordner (z. B. tex:textures/gemaelde.jpg)
        cache.set(k, withRoomLight(new THREE.MeshStandardMaterial({ map: this.shared.loadTexture(key.slice(4)), roughness: 0.85 })));
      } else cache.set(k, withRoomLight(new THREE.MeshStandardMaterial(PALETTE[key] || { color: 0xff00ff })));
    }
    return cache.get(k);
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry !== this.shared.lampHitGeometry) o.geometry.dispose();
    });
  }
}

/** Waagrechtes Rechteck (UV 0..1) mit Normale nach oben. */
function quad(b, cx, cz, hw, hd, idx, y) {
  const A = [cx - hw, y, cz - hd], B = [cx + hw, y, cz - hd], C = [cx + hw, y, cz + hd], D = [cx - hw, y, cz + hd];
  for (const [p, uv] of [[A, [0, 0]], [C, [1, 1]], [B, [1, 0]], [A, [0, 0]], [D, [0, 1]], [C, [1, 1]]]) {
    b.pos.push(...p);
    b.room.push(idx);
    b.uv.push(uv[0], uv[1]);
  }
}
