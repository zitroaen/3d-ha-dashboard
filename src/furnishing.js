// Einrichtungs-Schicht: Objekte des Modells – Möbel/Geräte (items) und Leuchten (lamps).
// Unabhängig vom Hausmodell: lässt sich jederzeit verwerfen und neu aufbauen, ohne das Haus anzufassen.
// Bezug zum Haus nur über Raum-IDs und Plan-Koordinaten.
import * as THREE from 'three';
import { Builder, heightAt } from './geometry.js';
import { PartCollector, PALETTE, FURNITURE, LAMPS } from './models.js';
import { withRoomLight, lampMaterial } from './roomlight.js';
import { normalFromCanvas, weaveCanvas } from './textures.js';

// Stoffe bekommen ein feines Gewebe (Normalen-Karte), sonst wirken Polster wie Kunststoff
const FABRIC = /^(fabric|cushion|rug|curtain)/;

// Leuchtende Teile: Farbe im ausgeschalteten Zustand
const GLOW_OFF = { shade: 0x8f897d, bulb: 0x7d786f, disc: 0x1f1e1c };

// Kein Kontaktschatten: liegt flach am Boden oder hängt an der Wand
const NO_CONTACT = new Set(['rug', 'picture', 'curtain', 'tv', 'radiator', 'flowers']);

/** Weicher Kontaktschatten (Alpha-Verlauf, Rechteck mit runden Ecken), einmal pro Szene */
function contactTexture() {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Abstand zum Rand eines abgerundeten Rechtecks, innen voll, nach außen weich auslaufend
      const u = Math.abs((x + 0.5) / N * 2 - 1), v = Math.abs((y + 0.5) / N * 2 - 1);
      const d = Math.hypot(Math.max(u - 0.45, 0), Math.max(v - 0.45, 0)) / 0.55;
      const a = Math.pow(Math.max(0, 1 - d), 1.6);
      data.set([0, 0, 0, Math.round(a * 255)], (y * N + x) * 4);
    }
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Schlüssel eines bearbeitbaren Objekts, z. B. "item:sofa" oder "lamp:eg_wohnen_stehlampe". */
export const refKey = (type, id) => `${type}:${id}`;

/**
 * Ankerpunkt eines Objekts: dort sitzt das Koordinatensystem im Editor.
 * Möbel: am Boden (bzw. auf `elevation` bei Bildern, TV, Vorhängen); Leuchten: an der Lichtquelle.
 */
export function anchorOf(type, e) {
  // base: Bodenhöhe des Außenbereichs (Terrasse höher, Garten tiefer); in Räumen 0 (Etagenhöhe kommt von der Gruppe)
  const y = (type === 'lamp' ? e.height : e.elevation ?? 0) + (e.base || 0);
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
    const contact = new Builder();
    for (const it of items) {
      const box = this._buildItem(P, it, anchorOf('item', it), exclude.has(refKey('item', it.id)));
      if (box) this._hitBox('item', it, box);
      if (box && !exclude.has(refKey('item', it.id)) && !NO_CONTACT.has(it.kind) && !((it.elevation ?? 0) > 0.3)) this._contact(contact, it, box);
    }
    for (const lamp of lamps) {
      const box = this._buildLamp(P, lamp, anchorOf('lamp', lamp), exclude.has(refKey('lamp', lamp.id)));
      if (box) this.boxes.set(refKey('lamp', lamp.id), box);
      if (lamp.outdoor && lamp.kind === 'wall') {
        // Lichtschein auf dem Boden: freies Gelände liegt unter den Flächen, Außenbereiche auf ihrer Höhe
        const [fx, fz] = lamp.facing || [0, 0];
        quad(pools, lamp.pos[0] + fx * 1.2, lamp.pos[1] + fz * 1.2, 1.6, 1.6, lamp.idx, lamp.room === 'aussen' ? -0.1 : (lamp.base || 0) + 0.004);
      }
      // Trefferfläche zum Antippen (größer als der Leuchtkörper)
      const hit = new THREE.Mesh(shared.lampHitGeometry, shared.hitMaterial);
      hit.position.set(lamp.pos[0], lamp.height + (lamp.base || 0), lamp.pos[1]);
      hit.userData.lampId = lamp.id;
      hit.userData.ref = { type: 'lamp', id: lamp.id };
      this.lampHits.push(hit);
      this.group.add(hit);
    }

    for (const m of P.build((key, kind) => this._material(key, kind))) this.group.add(m);
    if (!contact.empty) {
      shared.contactMat ??= new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, opacity: 0.55, color: 0x000000 });
      const m = new THREE.Mesh(contact.geometry(), shared.contactMat);
      m.renderOrder = 2;
      this.group.add(m);
    }
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

  /**
   * Kontaktschatten unter einem Objekt: weiches Rechteck etwas größer als die Grundfläche, knapp über dem Boden
   * (im Gelände je Ecke auf der Geländehöhe). Ersetzt teure Umgebungsverdeckung für das „Stehen auf dem Boden“.
   */
  _contact(b, it, box) {
    const at = anchorOf('item', it);
    const room = this.floorModel.rooms.get(it.room)?.room;
    const pad = 0.12, sx = (box.max.x - box.min.x) / 2 * 1.15 + pad, sz = (box.max.z - box.min.z) / 2 * 1.15 + pad;
    const cx = (box.max.x + box.min.x) / 2, cz = (box.max.z + box.min.z) / 2;
    const r = -THREE.MathUtils.degToRad(at.rot), c = Math.cos(r), s = Math.sin(r);
    const P = ([lx, lz]) => {
      const x = at.x + (cx + lx) * c + (cz + lz) * s, z = at.z - (cx + lx) * s + (cz + lz) * c;
      const y = room?.heights ? heightAt(room.polygon, room.heights, [x, z]) + 0.02 : (it.base || 0) + 0.012;
      return [x, y, z];
    };
    const A = P([-sx, -sz]), B = P([sx, -sz]), C = P([sx, sz]), D = P([-sx, sz]);
    for (const [p, uv] of [[A, [0, 0]], [C, [1, 1]], [B, [1, 0]], [A, [0, 0]], [D, [0, 1]], [C, [1, 1]]]) {
      b.pos.push(...p);
      b.room.push(0);
      b.uv.push(uv[0], uv[1]);
    }
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
      } else {
        const params = { ...(PALETTE[key] || { color: 0xff00ff }) };
        if (FABRIC.test(key)) {
          this.shared.weave ??= (() => {
            const t = normalFromCanvas(weaveCanvas(), 1, 2.5, 128);
            t.repeat.set(10, 10);
            return t;
          })();
          Object.assign(params, { normalMap: this.shared.weave, normalScale: new THREE.Vector2(0.5, 0.5) });
        }
        cache.set(k, withRoomLight(new THREE.MeshStandardMaterial(params)));
      }
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
