// Umgebung für Spiegelungen und weiches Himmelslicht: ein kleiner Himmel (Verlauf Zenit -> Horizont -> Boden plus
// Sonnen- bzw. Mondscheibe), daraus per PMREM eine vorgefilterte Umgebungstextur für alle MeshStandardMaterials
// (scene.environment). Berechnet nur, wenn sich Tageszeit oder Sonnenrichtung merklich ändern – nicht pro Bild.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith, uHorizon, uGround, uSunColor, uSunDir;
uniform float uSunSize;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.6));
  vec3 col = h >= 0.0 ? sky : mix(uHorizon * 0.6, uGround, clamp(-h * 4.0, 0.0, 1.0));
  // Gestirn: helle Scheibe mit weichem Hof
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (smoothstep(1.0 - uSunSize, 1.0, s) * 8.0 + pow(s, 64.0) * 0.6);
  gl_FragColor = vec4(col, 1.0);
}`;

export class SkyEnvironment {
  constructor(renderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = new THREE.Scene();
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunSize: { value: 0.002 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
    this.target = null;
    this.key = null;
  }

  /**
   * @param day      0 = Nacht … 1 = Tag
   * @param dir      Richtung zum Gestirn (Welt, normiert)
   * @param isSun    Sonne (sonst Mond)
   * @param warm     0 = tief stehende, warme Sonne … 1 = hoch
   * @returns Umgebungstextur (neu nur bei merklicher Änderung)
   */
  update(day, dir, isSun, warm) {
    const key = [day.toFixed(2), dir.x.toFixed(1), dir.y.toFixed(1), dir.z.toFixed(1), isSun, warm.toFixed(1)].join();
    if (key === this.key && this.target) return this.target.texture;
    this.key = key;
    const mix = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), day);
    const u = this.uniforms;
    u.uZenith.value.copy(mix(0x0b1020, 0x4f7fc0));
    u.uHorizon.value.copy(mix(0x161b26, 0xbfd3e6).lerp(new THREE.Color(0xffc48a), isSun ? (1 - warm) * 0.5 * day : 0));
    u.uGround.value.copy(mix(0x0c0b0a, 0x5d5446));
    u.uSunColor.value.copy(isSun ? new THREE.Color(0xffd7a8).lerp(new THREE.Color(0xfff6ea), warm) : new THREE.Color(0x8796b8).multiplyScalar(0.25));
    u.uSunDir.value.copy(dir);
    u.uSunSize.value = isSun ? 0.0015 : 0.0008;
    const old = this.target;
    this.target = this.pmrem.fromScene(this.scene, 0, 0.1, 100);
    old?.dispose();
    return this.target.texture;
  }

  /** Farbe am Horizont (Hintergrund und Nebel passen dazu) */
  get horizon() {
    return this.uniforms.uHorizon.value;
  }

  dispose() {
    this.target?.dispose();
    this.pmrem.dispose();
  }
}
