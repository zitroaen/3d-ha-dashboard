// Lokaler Dev-Server: Engine + Datenordner, nimmt Editor-Änderungen entgegen.
//   npm run serve                           -> Demo-Haus, http://127.0.0.1:8123/tests/harness.html
//   DATA_DIR=../data ENTITIES=../reference/entities.txt node tests/devserver.mjs   -> eigenes Haus
// Der Editor speichert hier direkt in model.yaml des Datenordners (nur von 127.0.0.1).
import { DATA_DIR, ENTITIES } from './lib/config.mjs';
import { createServer } from './lib/server.mjs';

const PORT = Number(process.env.PORT || 8123);
createServer({ dataDir: DATA_DIR, entities: ENTITIES, writable: true, log: true }).listen(PORT, '127.0.0.1', () => {
  console.log(`Daten:  ${DATA_DIR}`);
  console.log(`Export: ${ENTITIES || '(keiner – HA wird nur aus den Verknüpfungen im Modell simuliert)'}`);
  console.log(`http://127.0.0.1:${PORT}/tests/harness.html`);
});
