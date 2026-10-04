// Logo der Integration: isometrischer Grundriss mit abgeschnittenen Wänden und einem erleuchteten Raum, auf einer
// Glas-Kachel. Erzeugt docs/logo.svg (README) und die Markenbilder der Integration
// (custom_components/ha_3d_dashboard/brand/, ab HA 2026.3 zeigt HA sie ohne home-assistant/brands an).
//   node scripts/logo.mjs        (PNG über den Test-Browser, siehe tests/lib/browser.mjs)
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser } from '../tests/lib/browser.mjs';

const C = Math.cos(Math.PI / 6), S = 0.5;
const f = (v) => Math.round(v * 100) / 100;

/** Isometrische Zeichnung: Plan x nach rechts unten, y nach links unten, z nach oben */
function house({ s, ox, oy }) {
  const P = (x, y, z) => [ox + (x - y) * C * s, oy + (x + y) * S * s - z * s];
  const poly = (pts, fill, extra = '') => `<polygon points="${pts.map((p) => p.map(f).join(',')).join(' ')}" fill="${fill}"${extra}/>`;
  // Quader: sichtbar sind Deckel, Seite x = x1 und Seite y = y1
  const box = ([x0, y0, z0], [x1, y1, z1], { top, sx, sy }) => [
    poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], sx),
    poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], sy),
    poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], top),
  ].join('');
  const floor = (x0, y0, x1, y1, fill) => poly([P(x0, y0, 0), P(x1, y0, 0), P(x1, y1, 0), P(x0, y1, 0)], fill);

  const W = 10, D = 8, T = 0.42, H = 2.4, L = 1.1; // hinten volle Höhe, vorn und innen abgeschnitten
  const wall = { top: '#f5f7fa', sx: '#c3ccd7', sy: '#9eabba' };
  const out = [];
  // Bodenplatte
  out.push(box([0, 0, -0.75], [W, D, 0], { top: '#5d6d80', sx: '#53657b', sy: '#43546a' }));
  // Böden: Wohnzimmer warm (erleuchtet), Rest kühl
  out.push(floor(0, 0, 6, D, 'url(#parkett)'));
  out.push(floor(6, 0, W, 3.6, '#7f93a8'));
  out.push(floor(6, 3.6, W, D, '#71859b'));
  // Lichtschein im Wohnzimmer
  const [gx, gy] = P(3, 4.2, 0);
  out.push(`<ellipse cx="${f(gx)}" cy="${f(gy)}" rx="${f(5.2 * s)}" ry="${f(3 * s)}" fill="url(#schein)"/>`);
  // Wände in Zeichenreihenfolge (hinten zuerst)
  const walls = [
    [[0, 0, 0], [W, T, H]], // Nord
    [[0, T, 0], [T, D, H]], // West
    [[6 - T / 2, T, 0], [6 + T / 2, 2.2, L]], // Innenwand mit Tür
    [[6 - T / 2, 3.4, 0], [6 + T / 2, D - T, L]],
    [[6 + T / 2, 3.6 - T / 2, 0], [W - T, 3.6 + T / 2, L]],
    [[W - T, T, 0], [W, D, L]], // Ost
    [[0, D - T, 0], [1.6, D, L]], // Süd mit großer Glasfront
    [[4.8, D - T, 0], [W - T, D, L]],
  ];
  for (const [a, b] of walls) out.push(box(a, b, wall));
  // Glasfront (durchsichtig) und Leuchte über dem Esstisch
  out.push(poly([P(1.6, D, 0), P(4.8, D, 0), P(4.8, D, L), P(1.6, D, L)], '#bfe3ff', ' opacity=".28"'));
  const [lx, ly] = P(3, 4.2, 1.3);
  out.push(`<circle cx="${f(lx)}" cy="${f(ly)}" r="${f(0.55 * s)}" fill="#fff4dc"/>`);
  out.push(`<circle cx="${f(lx)}" cy="${f(ly)}" r="${f(1.5 * s)}" fill="url(#lampe)"/>`);
  return out.join('\n    ');
}

const defs = `<defs>
    <linearGradient id="kachel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a3b52"/><stop offset="1" stop-color="#101a28"/>
    </linearGradient>
    <linearGradient id="glanz" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="parkett" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e2b170"/><stop offset="1" stop-color="#b98348"/>
    </linearGradient>
    <radialGradient id="schein">
      <stop offset="0" stop-color="#ffd27a" stop-opacity=".95"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lampe">
      <stop offset="0" stop-color="#ffe2a6" stop-opacity=".9"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

// Haus mittig in der Kachel (Höhe: Wandoberkante bis Unterkante Bodenplatte)
const HS = 13.2;
const ICON_HOUSE = { s: HS, ox: 128 - C * HS, oy: 128 - ((9 + 0.75) * HS - 2.4 * HS) / 2 };

// Symbol 256 × 256: Glas-Kachel mit eher eckigen Ecken (wie das Panel)
const tile = (size) => `<rect x="4" y="4" width="${size - 8}" height="${size - 8}" rx="${size * 0.16}" fill="url(#kachel)"/>
    <rect x="4" y="4" width="${size - 8}" height="${size - 8}" rx="${size * 0.16}" fill="url(#glanz)"/>
    <rect x="4.75" y="4.75" width="${size - 9.5}" height="${size - 9.5}" rx="${size * 0.16 - 0.75}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1.5"/>`;
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  ${defs}
  ${tile(256)}
  <g>
    ${house(ICON_HOUSE)}
  </g>
</svg>
`;

// Logo: Symbol und Schriftzug
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 256" width="900" height="256">
  ${defs}
  ${tile(256)}
  <g>
    ${house(ICON_HOUSE)}
  </g>
  <text x="290" y="151" font-family="Inter, 'Segoe UI', Roboto, 'DejaVu Sans', Arial, sans-serif" font-size="64" font-weight="700" textLength="584" lengthAdjust="spacingAndGlyphs" fill="#1f6fd1">3D<tspan fill="#8a97a8" font-weight="500">-HA-</tspan><tspan fill="#33445a">Dashboard</tspan></text>
</svg>
`;
// Logo für dunkles HA-Design: Schriftzug hell
const DARK_LOGO = LOGO.replace('#33445a', '#e9eef5').replace('#1f6fd1', '#5aa6ff');

const root = resolve(import.meta.dirname, '..');
const brand = resolve(root, 'custom_components/ha_3d_dashboard/brand');
mkdirSync(brand, { recursive: true });
writeFileSync(resolve(root, 'docs/logo.svg'), ICON);

const browser = await launchBrowser();
try {
  const shoot = async (svg, w, h, scale, file) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.locator('svg').screenshot({ path: resolve(brand, file), omitBackground: true });
    await page.close();
    console.log('✔', file);
  };
  for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
    await shoot(ICON, 256, 256, scale, `icon${suffix}.png`);
    await shoot(LOGO, 900, 256, scale, `logo${suffix}.png`);
    await shoot(DARK_LOGO, 900, 256, scale, `dark_logo${suffix}.png`);
  }
} finally {
  await browser.close();
}
