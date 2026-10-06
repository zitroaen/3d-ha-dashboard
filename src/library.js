// Beispiel-Bibliothek der Engine (library/*.yaml, als Text im Bundle). Die Instanz ergänzt und überschreibt sie in
// model.yaml (`surfaces`, …); siehe docs/LIBRARY.md.
import { load } from 'js-yaml';
import surfacesText from '../library/surfaces.yaml';
import { setSurfaceDefs } from './surfaces.js';

export const LIBRARY = { surfaces: load(surfacesText) };
setSurfaceDefs(LIBRARY.surfaces, {});

/** Einträge der Instanz (model.yaml) über die Bibliothek legen – vor jedem Aufbau der Szene */
export function applyLibrary(model) {
  setSurfaceDefs(LIBRARY.surfaces, model?.surfaces);
}
