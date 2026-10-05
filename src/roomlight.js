// Raumlicht im Shader: Jede Fläche kennt ihren Raum (Vertex-Attribut `roomIdx`, 0 = keiner).
// Die Lampen eines Raums wirken nur auf Flächen dieses Raums – kein Durchscheinen durch Wände,
// keine Schatten-Maps pro Lampe, ein Draw-Call pro Material. Das ist unser "gebackenes" Licht.
//
// Lampen und Räume stehen in einer kleinen Float-Textur (statt Uniform-Arrays, die auf
// Mobil-GPUs schnell an ihr Limit kommen):
//   Zeile 0: Lampe i  -> Position (Welt) xyz, Reichweite
//   Zeile 1: Lampe i  -> Farbe × Helligkeit (linear), 0 wenn aus
//   Zeile 2: Raum r   -> erste Lampe, Anzahl Lampen
//   Zeile 3: Raum r   -> Summe der Lampenfarben (für indirektes Licht / Glas)
import * as THREE from 'three';

export const MAX_ROOMS = 64;
export const MAX_LAMPS = 128;
export const MAX_LAMPS_PER_ROOM = 12;
export const OUTDOOR_IDX = MAX_ROOMS; // Pseudo-Raum für die Außenbeleuchtung

const TEX_W = Math.max(MAX_ROOMS, MAX_LAMPS);

export class LightTable {
  constructor() {
    this.data = new Float32Array(TEX_W * 4 * 4);
    this.texture = new THREE.DataTexture(this.data, TEX_W, 4, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
  }

  _set(row, col, x, y, z, w) {
    const o = (row * TEX_W + col) * 4;
    this.data[o] = x; this.data[o + 1] = y; this.data[o + 2] = z; this.data[o + 3] = w;
  }

  setLampPosition(i, [x, y, z], range) { this._set(0, i, x, y, z, range); }
  setLampColor(i, c) { this._set(1, i, c.r, c.g, c.b, 0); }
  setRoomRange(roomIdx, start, count) { this._set(2, roomIdx - 1, start, count, 0, 0); }
  setRoomSum(roomIdx, c) { this._set(3, roomIdx - 1, c.r, c.g, c.b, 0); }
  clear() { this.data.fill(0); }
  commit() { this.texture.needsUpdate = true; }
}

// Gemeinsame Uniforms für alle Materialien
export const lightUniforms = {
  uLights: { value: null },
  uFloorAO: { value: null },
  uFloorAOBox: { value: new THREE.Vector4(0, 0, 1, 1) }, // xMin, zMin, Breite, Tiefe
  // Wetter (scene.setWeather): Nässe 0..1 (dunkler, glänzend) und Schneedecke 0..1 (auf nach oben zeigenden Flächen)
  uWet: { value: 0 },
  uSnow: { value: 0 },
  // Höhenraster (scene.js): Hangschattierung (r) und Geländehöhe (g) je Rasterpunkt; Lage xMin, zMin, Breite, Tiefe
  uTerrain: { value: null },
  uTerrainBox: { value: new THREE.Vector4(0, 0, 1, 1) },
  uTerrainOn: { value: 0 },
  // Luftbild auf dem Boden-Belag (site.terrain.texture): Plan (x, z) -> Bild (u, v), Mischung, Helligkeit
  uAerial: { value: null },
  uAerialU: { value: new THREE.Vector3() },
  uAerialV: { value: new THREE.Vector3() },
  uAerialK: { value: 0 },
};

const VERT_PARS = /* glsl */ `
attribute float roomIdx;
varying float vRoomIdx;
varying vec3 vRoomWorld;
varying float vUpN;
`;
const VERT_MAIN = /* glsl */ `
vRoomIdx = roomIdx;
#ifdef USE_INSTANCING
vRoomWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vUpN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal).y;
#else
vRoomWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vUpN = normalize(mat3(modelMatrix) * objectNormal).y;
#endif
`;
const FRAG_PARS = /* glsl */ `
uniform highp sampler2D uLights;
uniform sampler2D uFloorAO;
uniform vec4 uFloorAOBox;
uniform float uWet, uSnow;
uniform sampler2D uTerrain, uAerial;
uniform vec4 uTerrainBox;
uniform float uTerrainOn, uAerialK;
uniform vec3 uAerialU, uAerialV;
varying float vRoomIdx;
varying vec3 vRoomWorld;
varying float vUpN;

// Licht aller Lampen des eigenen Raums + etwas indirektes Licht (Reflexion von Wänden/Decke)
vec3 roomIrradiance(vec3 n, float bounce) {
  int r = int(vRoomIdx + 0.5) - 1;
  if (r < 0) return vec3(0.0);
  vec4 info = texelFetch(uLights, ivec2(r, 2), 0);
  vec3 sum = texelFetch(uLights, ivec2(r, 3), 0).rgb;
  if (dot(sum, sum) < 1e-8) return vec3(0.0);
  vec3 acc = sum * bounce;
  int start = int(info.x + 0.5), count = int(info.y + 0.5);
  for (int k = 0; k < ${MAX_LAMPS_PER_ROOM}; k++) {
    if (k >= count) break;
    vec3 col = texelFetch(uLights, ivec2(start + k, 1), 0).rgb;
    if (dot(col, col) < 1e-8) continue;
    vec4 lamp = texelFetch(uLights, ivec2(start + k, 0), 0);
    vec3 L = (viewMatrix * vec4(lamp.xyz, 1.0)).xyz + vViewPosition; // Fragment liegt bei -vViewPosition
    float d = length(L);
    float fall = pow(clamp(1.0 - d / lamp.w, 0.0, 1.0), 2.0);
    float ndl = max(dot(n, L / d), 0.0);
    acc += col * fall * (0.2 + 0.8 * ndl);
  }
  return acc;
}
`;

const BOUNCE = 0.07;

/**
 * Erweitert ein MeshStandardMaterial um Raumlicht.
 * opts.floorAO: Boden-AO-Textur über die Etage legen
 * opts.wallAO: Wände zum Boden hin abdunkeln (Kontaktschatten)
 * opts.glow: Fläche leuchtet selbst in der Raumlichtfarbe (Glas), Faktor
 * opts.weather: Fläche im Freien – wird bei Regen nass (dunkler, glänzend) und bei Schnee weiß (nur Oberseiten);
 *   liegt sie auf dem Höhenraster, bekommt sie dessen Hangschattierung
 * opts.aerial: Boden-Belag – das Luftbild liegt darauf (wo es Daten hat)
 */
export function withRoomLight(material, opts = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, lightUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);

    let colorMod = '';
    if (opts.floorAO) {
      colorMod += /* glsl */ `
      vec2 aoUv = (vRoomWorld.xz - uFloorAOBox.xy) / uFloorAOBox.zw;
      diffuseColor.rgb *= mix(0.35, 1.0, texture2D(uFloorAO, aoUv).r);`;
    }
    if (opts.wallAO != null) {
      colorMod += /* glsl */ `
      diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(0.0, 0.7, vRoomWorld.y - ${opts.wallAO.toFixed(3)}));`;
    }
    if (opts.aerial) {
      colorMod += /* glsl */ `
      vec3 aP = vec3(vRoomWorld.xz, 1.0);
      vec2 aUv = vec2(dot(aP, uAerialU), dot(aP, uAerialV));
      vec4 aC = texture2D(uAerial, aUv);
      // am Bildrand weich in den Belag übergehen (5 % der Bildgröße)
      vec2 aE = smoothstep(0.0, 0.05, aUv) * smoothstep(0.0, 0.05, 1.0 - aUv);
      float aIn = aE.x * aE.y;
      diffuseColor.rgb = mix(diffuseColor.rgb, aC.rgb, uAerialK * aC.a * aIn);`;
    }
    if (opts.weather || opts.aerial) {
      // Hangschattierung nur auf Flächen, die auf dem Gelände liegen (nicht auf Dächern oder Mauerkronen darüber)
      colorMod += /* glsl */ `
      if (uTerrainOn > 0.5) {
        vec4 tS = texture2D(uTerrain, (vRoomWorld.xz - uTerrainBox.xy) / uTerrainBox.zw);
        float onT = (1.0 - smoothstep(0.12, 0.3, abs(vRoomWorld.y - tS.g))) * smoothstep(0.3, 0.6, vUpN);
        diffuseColor.rgb *= 1.0 - tS.r * onT;
      }`;
    }
    let roughMod = '';
    if (opts.weather) {
      colorMod += /* glsl */ `
      float snowF = uSnow * smoothstep(0.35, 0.8, vUpN);
      diffuseColor.rgb *= 1.0 - 0.38 * uWet * (1.0 - snowF);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.92), snowF);`;
      roughMod = /* glsl */ `
      roughnessFactor = mix(roughnessFactor, 0.14, uWet * 0.85 * (1.0 - snowF) * step(0.5, vUpN));
      roughnessFactor = mix(roughnessFactor, 0.9, snowF);`;
    }
    const glow = opts.glow ? `totalEmissiveRadiance += roomIrradiance(normal, 0.6) * ${opts.glow.toFixed(3)};` : '';

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${colorMod}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${roughMod}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${glow}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>\nreflectedLight.directDiffuse += roomIrradiance(normal, ${BOUNCE.toFixed(3)}) * diffuseColor.rgb;`
      );
  };
  material.customProgramCacheKey = () => `roomlight3:${JSON.stringify(opts)}`;
  material.userData.roomLightOpts = opts; // für Kopien mit anderer Farbe
  return material;
}

/**
 * Material, das pro Lampe leuchtet (Vertex-Attribut `lampIdx`, 0 = keine):
 * Leuchtkörper (an: Lampenfarbe, aus: offColor) oder additiver Lichtschein (additive = true).
 */
export function lampMaterial({ map = null, strength = 1, offColor = null, additive = false } = {}) {
  const m = new THREE.MeshBasicMaterial({
    map,
    transparent: additive,
    depthWrite: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  const off = offColor ? new THREE.Color(offColor) : new THREE.Color(0, 0, 0);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, lightUniforms, { uOff: { value: off } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float lampIdx;\nvarying float vLampIdx;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLampIdx = lampIdx;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform highp sampler2D uLights;\nuniform vec3 uOff;\nvarying float vLampIdx;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        int li = int(vLampIdx + 0.5) - 1;
        vec3 lc = li >= 0 ? texelFetch(uLights, ivec2(li, 1), 0).rgb : vec3(0.0);
        diffuseColor.rgb *= dot(lc, lc) > 1e-8 ? lc * ${strength.toFixed(3)} : uOff;`
      );
  };
  m.customProgramCacheKey = () => `lamp:${strength}:${additive}:${off.getHexString()}`;
  return m;
}
