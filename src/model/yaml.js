// Modell als gut lesbares YAML schreiben: Maps als Block, Koordinaten und kurze Einträge in einer Zeile
// (Flow-Stil), lange bzw. verschachtelte Einträge als Block. Ergebnis ist gültiges YAML (js-yaml liest es zurück).
// Ein Kopfkommentar (z. B. aus der bisherigen Datei) bleibt erhalten.

const INLINE_MAX = 118;
const PLAIN = /^[\p{L}_][\p{L}\p{N}_ .\/#:+()-]*$/u;
const RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;

function scalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : 'null';
  if (typeof v === 'boolean') return String(v);
  const s = String(v);
  // ohne Anführungszeichen nur, wenn eindeutig ein String bleibt (kein ": ", kein " #", nicht wie Zahl/Bool)
  if (PLAIN.test(s) && !RESERVED.test(s) && !/: |\s#|^-|:$/.test(s) && !/^[\d.+-]/.test(s)) return s;
  return JSON.stringify(s);
}

const isScalar = (v) => v === null || typeof v !== 'object';

/** Einzeilige Darstellung (Flow-Stil) */
function flow(v) {
  if (isScalar(v)) return scalar(v);
  if (Array.isArray(v)) return `[${v.map(flow).join(', ')}]`;
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  return entries.length ? `{ ${entries.map(([k, x]) => `${scalar(k)}: ${flow(x)}`).join(', ')} }` : '{}';
}

function block(v, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) {
    if (!v.length) return ' []';
    return v.map((x) => {
      if (isScalar(x)) return `\n${pad}- ${scalar(x)}`;
      const one = flow(x);
      if (one.length + indent + 2 <= INLINE_MAX) return `\n${pad}- ${one}`;
      if (Array.isArray(x)) return `\n${pad}-${block(x, indent + 2)}`;
      // Map als Listeneintrag: erster Schlüssel hinter "- ", weitere eingerückt
      const body = block(x, indent + 2);
      return `\n${pad}- ${body.slice(indent + 3)}`;
    }).join('');
  }
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  if (!entries.length) return ' {}';
  return entries.map(([k, x]) => {
    const key = `\n${pad}${scalar(k)}:`;
    if (isScalar(x)) return `${key} ${scalar(x)}`;
    const one = flow(x);
    // Zahlenlisten (Koordinaten, Polygone) immer einzeilig; sonst einzeilig, wenn kurz genug
    if (one.length + indent + k.length + 2 <= INLINE_MAX || isNumeric(x)) return `${key} ${one}`;
    return key + block(x, indent + 2);
  }).join('');
}

const isNumeric = (v) => Array.isArray(v) && v.every((x) => typeof x === 'number' || isNumeric(x));

/**
 * @param value   Modell (oder beliebige JSON-Daten)
 * @param header  Kommentar über dem Inhalt (Zeilen ohne/mit "#")
 */
export function toYaml(value, header = '') {
  const head = header ? header.split(/\r?\n/).map((l) => (l.startsWith('#') || !l ? l : `# ${l}`)).join('\n').replace(/\n*$/, '\n') : '';
  return head + block(value, 0).replace(/^\n/, '') + '\n';
}

/** Kopfkommentar einer YAML-Datei (zusammenhängende Kommentar-/Leerzeilen am Anfang) */
export function yamlHeader(text) {
  const lines = (text || '').split(/\r?\n/);
  const out = [];
  for (const l of lines) {
    if (l.startsWith('#') || (!l.trim() && out.length)) out.push(l);
    else break;
  }
  return out.join('\n').trimEnd();
}
