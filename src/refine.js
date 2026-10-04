// Ruhebild-Verfeinerung (Qualität „Hoch“): Steht die Kamera still, wird das Bild mit Umgebungsverdeckung (GTAO:
// weiche Schatten in Ecken, unter Möbeln, an Wandfüßen) gerechnet. Während Drehen/Zoomen bleibt das schnelle Bild.
// Render-on-demand bleibt: ein verfeinertes Bild kostet einmal etwas mehr, nicht pro Sekunde.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** GTAO, das unsichtbare Trefferflächen und Durchsichtiges (Glas, Lichtschein, Kontaktschatten) nicht verdeckt */
class HouseGTAOPass extends GTAOPass {
  _overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      if (!o.visible) return;
      const m = o.material;
      if (o.isPoints || o.isLine || o.isLine2 || o.isSprite || (o.isMesh && (m.visible === false || m.transparent))) {
        o.visible = false;
        cache.push(o);
      }
    });
  }
}

export class Refiner {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null; // erst bei Bedarf (Qualität „Sparsam“ braucht nichts davon)
  }

  _ensure() {
    if (this.composer) return;
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    // HalfFloat: Licht und Tonwerte wie beim direkten Rendern (Tonemapping erst im OutputPass)
    const target = new THREE.WebGLRenderTarget(size.x * r.getPixelRatio(), size.y * r.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const gtao = new HouseGTAOPass(this.scene, this.camera, size.x, size.y);
    // Maße in Metern: Verdeckung über ~0,6 m, dünne Teile (Stuhlbeine) nur schwach
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1.1, samples: 16, distanceFallOff: 1 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    gtao.blendIntensity = 0.85;
    this.gtao = gtao;
    this.composer.addPass(gtao);
    this.composer.addPass(new OutputPass());
    this.setSize();
  }

  setSize() {
    if (!this.composer) return;
    const r = this.renderer, size = r.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(size.x, size.y);
  }

  render() {
    this._ensure();
    this.composer.render();
  }

  dispose() {
    this.composer?.dispose();
    this.gtao?.dispose();
  }
}
