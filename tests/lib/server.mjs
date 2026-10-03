// Statischer Server für Harness, Dev-Server und Tests:
//   /data/*                  -> Datenordner (DATA_DIR)
//   /reference/entities.txt  -> HA-Export (ENTITIES), falls vorhanden
//   alles andere             -> Engine (dist/, tests/, node_modules/ …)
//   POST /__save/<datei>     -> schreibt furniture.yaml / devices.yaml in den Datenordner (nur wenn writable)
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { ENGINE_ROOT } from './config.mjs';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.yaml': 'text/yaml', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};
const WRITABLE = new Set(['furniture.yaml', 'devices.yaml']);

/** Pfad sicher unter einem Basisordner auflösen (kein ../ hinaus) */
function inside(base, rel) {
  const p = resolve(base, '.' + sep + rel);
  if (p !== base && !p.startsWith(base + sep)) throw new Error('outside');
  return p;
}

export function createServer({ dataDir, entities = null, writable = false, log = false }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);
    try {
      if (req.method === 'POST' && path.startsWith('/__save/')) {
        const file = path.slice('/__save/'.length);
        if (!writable || !WRITABLE.has(file)) return res.writeHead(403).end();
        let body = '';
        for await (const chunk of req) body += chunk;
        await writeFile(join(dataDir, file), body, 'utf8');
        if (log) console.log(`gespeichert: ${join(dataDir, file)}`);
        return res.writeHead(204).end();
      }
      let file;
      if (path.startsWith('/data/')) file = inside(dataDir, path.slice('/data/'.length));
      else if (path === '/reference/entities.txt') {
        if (!entities) return res.writeHead(404).end();
        file = entities;
      } else file = inside(ENGINE_ROOT, path.slice(1));
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
}

/** Server auf freiem Port starten; liefert { server, base } */
export async function startServer(opts, port = 0) {
  const server = createServer(opts);
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
