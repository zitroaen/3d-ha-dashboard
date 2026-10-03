// Demo-Haus: examples/demo/model.yaml steckt als Text im Bundle (Plugin in scripts/build.mjs).
// So läuft das Panel auch ohne eigene Daten (HACS-Installation zum Ausprobieren).
// Die erfundenen Entities (light.demo_…) gibt es in keiner echten HA – im Panel sind die Objekte deshalb unverknüpft.
// Wer im Editor eine echte Entity verknüpft, schaltet diese Leuchte über HA.
import demoText from 'demo-data';
import { parseData } from './data.js';

export function loadDemoData() {
  const data = parseData(demoText);
  for (const o of data.model.objects || []) delete o.ha;
  return data;
}
