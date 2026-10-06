// Vorschaubilder für den Katalog: jedes Modell einmal klein (schräg von oben) mit dem vorhandenen Renderer in eine
// Textur rechnen und als Bild-URL zwischenspeichern. Eigene kleine Szene mit einfachem Licht – unabhängig vom Haus,
// kein zweiter WebGL-Kontext.
import * as THREE from 'three';
import { PartCollector, FURNITURE, LAMPS, defaultLamp, paletteParams } from './models.js';
import { CATALOG, hasCapability, DEFAULT_MOUNT, DEFAULT_LIGHT_HEIGHT, MODEL_LIGHT_HEIGHT } from './model/catalog.js';

const SIZE = 128;
const cache = new Map(); // Modell -> data-URL
let stage = null;

function setup() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4 });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const mats = new Map();
  const material = (key, kind) => {
    const k = `${kind}:${key}`;
    if (!mats.has(k)) {
      mats.set(k, kind === 'glow'
        ? new THREE.MeshBasicMaterial({ color: 0xffe2a8 })
        : new THREE.MeshStandardMaterial(paletteParams(key) || { color: 0x9a9a9a, roughness: 0.8 }));
    }
    return mats.get(k);
  };
  return { scene, camera, target, material, pixels: new Uint8Array(SIZE * SIZE * 4) };
}

/** Geometrie eines Katalog-Modells mit Standardwerten bauen (wie im Haus, nur ohne Raumlicht) */
function buildModel(model, material) {
  const P = new PartCollector();
  P.static = true; // bewegliche Teile stehen
  P.begin(0, 0, 0, 0);
  if (hasCapability(model, 'light')) {
    const mount = DEFAULT_MOUNT[model] || 'ceiling';
    const l = { height: MODEL_LIGHT_HEIGHT[model] ?? DEFAULT_LIGHT_HEIGHT[mount] ?? 2, length: 3, sag: 0.25, bulbs: 6 };
    (LAMPS[model] || defaultLamp)(P, l, { ceiling: l.height + 0.3, roomIdx: 0, lampIdx: 0 });
  } else FURNITURE[model]?.(P, { kind: model }, { ceiling: 2.4 });
  return P.build(material);
}

/**
 * Vorschaubild (data-URL, transparent) eines Modells. Rechnet beim ersten Aufruf (wenige Millisekunden), danach aus
 * dem Zwischenspeicher. null, wenn das Modell nichts zeichnet.
 */
export function modelPreview(renderer, model) {
  if (cache.has(model)) return cache.get(model);
  if (!CATALOG[model]) return null;
  stage ??= setup();
  const { scene, camera, target, material, pixels } = stage;
  const group = new THREE.Group();
  for (const m of buildModel(model, material)) group.add(m);
  scene.add(group);
  const box = new THREE.Box3().setFromObject(group);
  let url = null;
  if (!box.isEmpty()) {
    // schräg von vorn oben, Kugel um das Modell füllt das Bild
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(0.75, 0.75, 1).normalize();
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.02;
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    camera.lookAt(sphere.center);
    camera.near = dist / 20;
    camera.far = dist * 4;
    camera.updateProjectionMatrix();

    const c = renderTo(renderer, scene, camera, target, pixels);
    url = c.toDataURL('image/png');
  }
  scene.remove(group);
  group.traverse((o) => o.isMesh && o.geometry.dispose());
  cache.set(model, url);
  return url;
}

/** Szene in das Render-Target rechnen und als Canvas (richtig herum) zurückgeben */
function renderTo(renderer, scene, camera, target, pixels) {
  const prevTarget = renderer.getRenderTarget(), prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  // (Schatten bleiben eingeschaltet – kein Licht hier wirft welche; Umschalten würde alle Shader neu bauen)
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  // Bild (WebGL liest von unten nach oben) in ein Canvas umdrehen
  const W = target.width, H = target.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Vorschau einer Oberfläche (Belag, Fassade): 2 × 2 m schräg von oben, mit Textur, Relief und Farbe des Materials
 * aus der Szene (ohne Raumlicht). Für das Werkzeug `scripts/preview.mjs`.
 */
export function surfacePreview(renderer, mat, size = 256) {
  stage ??= setup();
  const { scene } = stage;
  const target = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ color: mat.color, map: mat.map, normalMap: mat.normalMap, normalScale: mat.normalScale, roughness: mat.roughness, metalness: mat.metalness });
  // UV in Metern wie im Haus (die Texturen wiederholen sich je Meter)
  const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
  const plane = new THREE.Mesh(geo, m);
  scene.add(plane);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 3.6, 1.6);
  camera.lookAt(0, 0, 0.05);
  const c = renderTo(renderer, scene, camera, target, new Uint8Array(size * size * 4));
  scene.remove(plane);
  geo.dispose();
  m.dispose();
  target.dispose();
  return c.toDataURL('image/png');
}

/**
 * Kontaktbogen: Vorschaubilder mit Beschriftung in einem Raster (data-URL). items: [{ label, url }]
 */
export async function contactSheet(items, cell = 192, cols = 6) {
  const rows = Math.ceil(items.length / cols), pad = 22;
  const c = document.createElement('canvas');
  c.width = cols * cell;
  c.height = rows * (cell + pad);
  const g = c.getContext('2d');
  g.fillStyle = '#20242b';
  g.fillRect(0, 0, c.width, c.height);
  g.font = '13px sans-serif';
  for (const [i, it] of items.entries()) {
    const x = (i % cols) * cell, y = Math.floor(i / cols) * (cell + pad);
    if (it.url) {
      const img = new Image();
      img.src = it.url;
      await img.decode();
      g.drawImage(img, x + 4, y + 4, cell - 8, cell - 8);
    }
    g.fillStyle = it.error ? '#ff8080' : '#e8e6e1';
    g.fillText(it.label.slice(0, 30), x + 6, y + cell + 15);
  }
  return c.toDataURL('image/png');
}
