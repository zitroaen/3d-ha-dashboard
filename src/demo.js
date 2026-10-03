// Demo-Haus: die Dateien aus examples/demo stecken als Text im Bundle (Plugin in scripts/build.mjs).
// So läuft das Panel auch ohne eigene Daten (HACS-Installation zum Ausprobieren).
// Die erfundenen Entities (light.demo_…) gibt es in keiner echten HA – im Panel sind die Leuchten deshalb unverknüpft.
// Wer im Editor eine echte Entity verknüpft, schaltet diese Leuchte über HA (wird im Demo-Modus nicht gespeichert).
import demoText from 'demo-data';
import { parseData } from './data.js';

export function loadDemoData() {
  const data = parseData({ ...demoText });
  for (const d of data.devices) d.entity = null;
  return data;
}
