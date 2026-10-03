// Demo-Haus: die Dateien aus examples/demo stecken als Text im Bundle (Plugin in scripts/build.mjs).
// So läuft das Panel auch ohne eigene Daten (HACS-Installation zum Ausprobieren).
import demoText from 'demo-data';
import { parseData } from './data.js';

export const loadDemoData = () => parseData({ ...demoText });
