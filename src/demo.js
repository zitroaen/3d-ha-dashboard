// Eingebautes Demo-Haus (erfundenes Haus aus examples/demo), damit das Panel ohne eigene Daten ausprobiert werden
// kann: panel_custom → config → demo: true, oder automatisch, wenn unter data_url nichts zu laden ist.
// Die Dateien werden beim Build ins Bundle eingebettet (esbuild: .json als Objekt, .yaml als Text).
import house from '../examples/demo/house.json';
import furniture from '../examples/demo/furniture.yaml';
import devices from '../examples/demo/devices.yaml';
import { parseData } from './data.js';

/** Demo-Daten im selben Format wie loadData() */
export const loadDemoData = () => parseData({ house: JSON.stringify(house), furniture, devices });
