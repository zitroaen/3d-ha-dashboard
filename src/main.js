// Custom Panel <ha-3d-dashboard> für Home Assistant (panel_custom).
// HA setzt die Properties hass, narrow, route und panel. Keine Tokens, keine externen Requests.
// Das Modell (model.yaml, docs/DATA_MODEL.md) wird zur Laufzeit geladen – standardmäßig aus
// demselben Ordner wie dieses Skript, oder aus panel_custom → config → data_url.
import { HouseScene } from './scene.js';
import { loadData, loadShared, DataUnavailableError } from './data.js';
import { loadDemoData } from './demo.js';
import { Editor } from './editor.js';
import { LayoutStore, DEMO_USER_DATA_KEY, MODEL_FILE, SHARED_WS, applyOverrides, download } from './store.js';
import { toScene, writeBack, gestureAction, roleEntities, showsBadge, GESTURES, activityOf } from './model/model.js';
import { CATALOG, hasCapability, DEFAULT_MOUNT, DEFAULT_LIGHT_HEIGHT, MODEL_LIGHT_HEIGHT } from './model/catalog.js';
import { CatalogPanel } from './catalogpanel.js';
import { pointInPoly } from './geometry.js';
import { toYaml, yamlHeader } from './model/yaml.js';
import { entitiesOf, lampLight, callForEntities, isOn, stateText } from './ha.js';
import { EntityPicker, areaForRoom } from './picker.js';
import { ObjectSettings } from './objsettings.js';
import { SettingsMenu } from './menu.js';
import { WEATHER_PRESETS, weatherParams, weatherKind, weatherLabel, pickWeatherEntity, temperatureText, weatherIcon } from './weather.js';

const ICON = {"edit": "M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z", "move": "M13 6v5h5V7.75L22.25 12 18 16.25V13h-5v5h3.25L12 22.25 7.75 18H11v-5H6v3.25L1.75 12 6 7.75V11h5V6H7.75L12 1.75 16.25 6H13z", "align": "M3 2h2v20H3V2zm4 5h14v4H7V7zm0 6h9v4H7v-4z", "undo": "M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A8 8 0 0 1 20.1 16l2.37-.78A10.5 10.5 0 0 0 12.5 8z", "save": "M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z", "export": "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z", "done": "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"};
ICON.link = 'M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z';
ICON.plug = 'M16 7V3h-2v4h-4V3H8v4h-.01C6.9 7 6 7.9 6 8.99v5.49L9.5 18v3h5v-3l3.5-3.51v-5.5C18 7.89 17.1 7 16 7z';
ICON.cog = 'M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1s.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66Z';
ICON.close = 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';
ICON.trash = 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';
ICON.catalog = 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z';
const icon = (name) => `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="${ICON[name]}"/></svg>`;

const MODULE_BASE = new URL('./', import.meta.url);
// beim Bauen eingesetzt (scripts/build.mjs); ungebündelt (Tests direkt aus src/) unbekannt
const VERSION = typeof __HA3D_VERSION__ !== 'undefined' ? __HA3D_VERSION__ : 'dev';
console.info(`%c 3D-HA-Dashboard %c ${VERSION} `, 'background:#f0b45a;color:#1a1408;font-weight:600', 'background:#12151b;color:#e8e2d8');

const STYLE = `
:host { display: block; position: relative; width: 100%; height: 100%; background: #07090d; overflow: hidden;
  /* Ab HA 2026.9 hat der Panel-Container keine Höhe mehr (height: 100% ergäbe 0). Das Panel reicht deshalb bis zum
     unteren Bildschirmrand: --ha3d-fit-height misst _fitHeight() (in der iOS-App beginnt das Panel unter der
     Statusleiste, 100dvh wäre dort zu hoch). */
  min-height: var(--ha3d-fit-height, 100dvh);
  font-family: var(--paper-font-body1_-_font-family, 'Segoe UI', Roboto, sans-serif); color: var(--g-fg);
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; touch-action: none;
  /* Glas-Design (Darstellung Dunkel; Hell siehe unten): durchscheinende, weichgezeichnete Flächen, feine Lichtkante,
     eher eckige Formen. Ausgewählt = invertiert (wie ein Schalter), Bernstein nur für Zustände (an, ungespeichert). */
  --g-bg: rgba(20, 23, 29, 0.55); --g-panel: rgba(18, 21, 27, 0.8); --g-fg: #ece7de; --g-fg-dim: rgba(236, 231, 222, 0.6);
  --g-line: rgba(255, 255, 255, 0.14); --g-line-strong: rgba(255, 255, 255, 0.3); --g-hover: rgba(255, 255, 255, 0.08);
  --g-well: rgba(0, 0, 0, 0.28); --g-sel-bg: rgba(240, 236, 228, 0.94); --g-sel-fg: #15181d;
  --g-accent: #f0b45a; --g-accent-fg: #1a1408; --g-ok: #6cc28a; --g-ok-bg: rgba(108, 194, 138, 0.18);
  --g-blur: blur(18px) saturate(160%); --g-shadow: 0 6px 24px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  --g-bar: linear-gradient(rgba(7, 9, 13, 0.75), rgba(7, 9, 13, 0));
  --r-btn: 12px; --r-panel: 14px; --r-item: 8px;
  color: var(--g-fg); }
:host([theme="light"]) {
  --g-bg: rgba(250, 250, 252, 0.62); --g-panel: rgba(248, 248, 250, 0.84); --g-fg: #1d2026; --g-fg-dim: rgba(29, 32, 38, 0.6);
  --g-line: rgba(20, 24, 30, 0.12); --g-line-strong: rgba(20, 24, 30, 0.3); --g-hover: rgba(0, 0, 0, 0.06);
  --g-well: rgba(0, 0, 0, 0.06); --g-sel-bg: #34373c; --g-sel-fg: #fff;
  --g-accent: #c47d1c; --g-accent-fg: #fff; --g-ok: #3a9a5f; --g-ok-bg: rgba(60, 160, 95, 0.16);
  --g-shadow: 0 6px 24px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.85);
  --g-bar: linear-gradient(rgba(245, 246, 248, 0.45), rgba(245, 246, 248, 0)); }
/* Glasflächen: gemeinsamer Schatten und Lichtkante */
.compass, .settings-toggle, .levels, .settings, .links, .picker, .objcfg, .tools, .editinfo, .toast, .demo-note, .confirm > div, .weather, .badge {
  box-shadow: var(--g-shadow); }
button { touch-action: manipulation; }
#stage { position: absolute; inset: 0; }
.vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 50%, transparent 55%, #000a 100%); transition: opacity 1s; }
:host([day]) .vignette { opacity: 0.35; }
.bar { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  pointer-events: none; background: var(--g-bar); }
.bar > * { pointer-events: auto; }
.title { font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.85; }
.floor { font-size: 13px; opacity: 0.55; }
/* Ebenen (Stockwerke): unten links (im Editor über der Werkzeugleiste), obere Ebenen oben; nur bei mehr als einer
   Ebene. Touch-Ziele 48 px */
.levels { position: absolute; left: 12px; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column;
  border-radius: var(--r-panel); overflow: hidden; background: var(--g-bg); border: 1px solid var(--g-line);
  backdrop-filter: var(--g-blur); -webkit-backdrop-filter: var(--g-blur); }
:host([editing]) .levels { bottom: calc(var(--ha3d-editbar-h, 136px) + 24px + env(safe-area-inset-bottom, 0px)); }
.levels[hidden] { display: none; }
/* eine durchgehende Glas-Leiste, obere Ebene oben, gewählte Ebene invertiert */
.levels button { min-width: 58px; height: 54px; padding: 0 8px; border: 0; border-radius: 0; background: transparent;
  color: var(--g-fg); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
.levels button + button { border-top: 1px solid var(--g-line); }
.levels button.on { background: var(--g-sel-bg); color: var(--g-sel-fg); }
.levels button.on + button, .levels button:has(+ button.on) { border-color: transparent; }
/* Wetter oben: Symbol und Temperatur, antippen öffnet den HA-Wetterdialog */
.fps { position: absolute; right: 12px; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); padding: 6px 10px; border-radius: var(--r-item);
  background: var(--g-bg); border: 1px solid var(--g-line); backdrop-filter: var(--g-blur); -webkit-backdrop-filter: var(--g-blur);
  font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--g-fg); pointer-events: none; text-align: right; }
.fps b { font-size: 15px; } .fps small { color: var(--g-fg-dim); }
.picker.show ~ .fps, .objcfg.show ~ .fps { display: none; }
:host([editing]) .fps { bottom: calc(var(--ha3d-editbar-h, 80px) + 30px + env(safe-area-inset-bottom, 0px)); }
.weather { display: inline-flex; align-items: center; gap: 6px; min-height: 48px; white-space: nowrap; flex-shrink: 0; margin-left: auto; margin-right: 140px; padding: 0 12px;
  border: 1px solid var(--g-line); border-radius: var(--r-btn); background: var(--g-bg); color: inherit; font: inherit; font-size: 14px; cursor: pointer;
  backdrop-filter: var(--g-blur); -webkit-backdrop-filter: var(--g-blur); }
.weather[hidden] { display: none; }
:host([narrow]) .weather { margin-right: 78px; padding: 0 6px; }
/* Niederschlag als Bildschirm-Effekt: nur verschobene Ebenen (GPU-Compositing), das 3D-Bild rechnet dafür nicht neu */
.precip { position: absolute; inset: 0; pointer-events: none; overflow: hidden; display: none; }
:host([precip="rain"]) .precip, :host([precip="snow"]) .precip { display: block; }
.precip::before, .precip::after { content: ''; position: absolute; left: -10%; right: -10%; top: -200px; bottom: 0; will-change: transform; }
:host([precip="rain"]) .precip::before { background: repeating-linear-gradient(103deg, transparent 0 18px, #b9d3ee2e 18px 19px, transparent 19px 41px);
  background-size: 160px 200px; animation: ha3d-fall .45s linear infinite; }
:host([precip="rain"]) .precip::after { background: repeating-linear-gradient(103deg, transparent 0 33px, #b9d3ee1f 33px 34px, transparent 34px 67px);
  background-size: 230px 200px; animation: ha3d-fall .7s linear infinite; }
:host([precip="snow"]) .precip::before { background-image: radial-gradient(circle, #ffffffd0 0 1.6px, transparent 2.2px), radial-gradient(circle, #ffffff90 0 1.1px, transparent 1.6px);
  background-size: 90px 100px, 60px 50px; background-position: 0 0, 25px 30px; animation: ha3d-fall 5s linear infinite; }
:host([precip="snow"]) .precip::after { background-image: radial-gradient(circle, #ffffffa0 0 2px, transparent 2.8px);
  background-size: 140px 200px; animation: ha3d-fall 8s linear infinite; }
@keyframes ha3d-fall { from { transform: translateY(0); } to { transform: translateY(200px); } }
@media (prefers-reduced-motion: reduce) { .precip::before, .precip::after { animation: none; } }
:host([quality="low"]) .precip::after { display: none; } /* sparsam: nur eine Ebene */
button.menu { display: none; width: 48px; height: 48px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
/* Kompass: zeigt, wo Norden im Bild liegt; antippen = einnorden. Touch-Ziel 56 px */
.compass { position: absolute; top: 10px; right: 12px; width: 56px; height: 56px; padding: 0; border-radius: 50%;
  border: 1px solid var(--g-line); background: var(--g-bg); color: var(--g-fg); cursor: pointer; backdrop-filter: var(--g-blur); -webkit-backdrop-filter: var(--g-blur); }
.compass:active { background: var(--g-hover); }
.compass svg { width: 100%; height: 100%; display: block; }
.compass .needle { transform-origin: 28px 28px; } /* kein Übergang: folgt dem Bild ohne Verzögerung */
/* Editiermodus: Stift unter dem Kompass, Werkzeugleiste unten (Touch-Ziele >= 56 px) */
.settings-toggle { position: absolute; top: 76px; right: 12px; width: 56px; height: 56px; border-radius: var(--r-btn);
  border: 1px solid var(--g-line); background: var(--g-bg); color: var(--g-fg); cursor: pointer; display: flex; align-items: center; justify-content: center; }
:host([editing]) .settings-toggle { display: none; } /* im Editor: Fertig/Abbrechen in der Leiste */
.settings-toggle.on { background: var(--g-sel-bg); color: var(--g-sel-fg); border-color: var(--g-sel-bg); }
/* Einstellungsmenü: Seitenleiste rechts neben Kompass/Zahnrad, Touch-Ziele >= 48 px */
.settings { position: absolute; top: 10px; right: 80px; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); width: min(380px, calc(100% - 100px)); display: none; flex-direction: column;
  border-radius: var(--r-panel); background: var(--g-panel); backdrop-filter: var(--g-blur); -webkit-backdrop-filter: var(--g-blur); border: 1px solid var(--g-line); overflow: hidden; }
.settings.show { display: flex; }
.settings header { display: flex; align-items: center; padding: 8px 8px 4px 16px; }
.settings header h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
.settings header button { width: 48px; height: 48px; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 18px; cursor: pointer; }
.settings .body { overflow-y: auto; padding: 0 12px 12px; touch-action: pan-y; -webkit-overflow-scrolling: touch; }
.settings h3 { margin: 14px 0 6px; font-size: 13px; font-weight: 600; opacity: 0.75; text-transform: uppercase; letter-spacing: .05em; }
.settings label { display: block; margin: 8px 0 4px; font-size: 14px; }
.settings .seg, .objcfg .seg, .catalog .seg { display: flex; gap: 4px; padding: 4px; border-radius: var(--r-btn); background: var(--g-well); }
.settings .seg button, .objcfg .seg button, .catalog .seg button { flex: 1; min-height: 48px; border: 0; border-radius: var(--r-item); background: transparent; color: inherit; font: inherit; font-size: 14px; cursor: pointer; }
.settings .seg.wrap { flex-wrap: wrap; } .settings .seg.wrap button { flex: 1 0 30%; }
.settings .seg button.on, .objcfg .seg button.on, .catalog .seg button.on { background: var(--g-sel-bg); color: var(--g-sel-fg); font-weight: 600; }
.settings .hint { margin: 6px 2px 0; font-size: 12px; opacity: 0.6; }
.settings .item { width: 100%; min-height: 56px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px;
  margin-bottom: 6px; padding: 8px 14px; border: 1px solid var(--g-line); border-radius: var(--r-item); background: var(--g-hover); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.settings .item b { font-weight: 500; font-size: 15px; } .settings .item small { font-size: 12px; opacity: 0.6; }
.settings .about { margin: 0 2px; font-size: 13px; opacity: 0.7; line-height: 1.5; }
/* Link-Check: Liste aller Geräte mit Verknüpfungsstatus */
.links { position: absolute; top: 10px; right: 80px; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); width: min(420px, calc(100% - 100px)); display: none; flex-direction: column;
  border-radius: var(--r-panel); background: var(--g-panel); backdrop-filter: var(--g-blur); -webkit-backdrop-filter: var(--g-blur); border: 1px solid var(--g-line); overflow: hidden; }
.links.show { display: flex; }
.links header { display: flex; align-items: center; gap: 8px; padding: 10px 8px 6px 16px; }
.links header h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
.links header h2 small { display: block; font-size: 11px; font-weight: 400; opacity: 0.55; }
.links header button { width: 48px; height: 48px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
.links .summary { padding: 0 16px 8px; font-size: 13px; opacity: 0.7; }
.links .body { overflow-y: auto; padding: 0 8px 12px; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
.links h3 { margin: 12px 8px 4px; font-size: 13px; font-weight: 600; opacity: 0.75; text-transform: uppercase; letter-spacing: .05em; }
.links ul { list-style: none; margin: 0; padding: 0; }
.links li { display: grid; grid-template-columns: 14px 1fr; column-gap: 8px; padding: 8px; border-radius: var(--r-item); min-height: 40px; align-items: center; }
.links li b { font-weight: 500; font-size: 14px; }
.links li small { grid-column: 2; font-size: 12px; opacity: 0.6; word-break: break-all; }
.links .dot { width: 10px; height: 10px; border-radius: 50%; background: #777; grid-row: span 2; }
.links li.ok .dot { background: #6cc28a; } .links li.bad .dot { background: #e0624f; } .links li.warn .dot { background: #e0b04f; }
.links li.free .dot { background: transparent; border: 1.5px solid #9aa; }
/* Entity-Auswahl (Editor): Seitenleiste rechts, große Zeilen für Touch */
.picker { position: absolute; top: 10px; right: 80px; bottom: calc(var(--ha3d-editbar-h, 136px) + 24px + env(safe-area-inset-bottom, 0px)); width: min(440px, calc(100% - 100px)); display: none; flex-direction: column;
  border-radius: var(--r-panel); background: var(--g-panel); backdrop-filter: var(--g-blur); -webkit-backdrop-filter: var(--g-blur); border: 1px solid var(--g-line); overflow: hidden; }
.picker.show { display: flex; }
.picker header { display: flex; align-items: center; padding: 8px 8px 4px 16px; }
.picker header h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
.picker header button, .picker .chip button { width: 48px; height: 48px; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 18px; cursor: pointer; }
.picker .linked { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 12px 8px; }
.picker .search { margin: 0 12px 8px; height: 48px; padding: 0 14px; border-radius: var(--r-item); border: 1px solid var(--g-line); background: var(--g-well);
  color: inherit; font: inherit; font-size: 16px; user-select: text; -webkit-user-select: text; }
.picker .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 8px; }
.picker .chip { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border-radius: var(--r-btn); border: 1px solid var(--g-line);
  background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.picker .chip.sel { background: var(--g-sel-bg); color: var(--g-sel-fg); border-color: var(--g-sel-bg); }
.picker .chip.on { background: var(--g-ok-bg); border-color: var(--g-ok); padding-right: 0; flex-wrap: wrap; }
.picker .chip.on small { font-size: 11px; opacity: 0.7; }
.picker .hint { font-size: 13px; opacity: 0.6; padding: 6px 4px; }
.picker .list { list-style: none; margin: 0; padding: 0 8px 12px; overflow-y: auto; touch-action: pan-y; -webkit-overflow-scrolling: touch; }
.picker .list button { width: 100%; min-height: 56px; display: grid; grid-template-columns: 1fr 32px; text-align: left; padding: 6px 10px; border: 0;
  border-radius: var(--r-item); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.picker .list button:active { background: var(--g-hover); }
.picker .list button.linked { background: var(--g-ok-bg); }
.picker .list b { font-weight: 500; font-size: 14px; } .picker .list small { grid-column: 1; font-size: 12px; opacity: 0.6; word-break: break-all; }
.picker .list .mark { grid-column: 2; grid-row: 1 / span 2; align-self: center; font-size: 20px; text-align: center; color: var(--g-accent); }
.picker .more { padding: 10px; font-size: 13px; opacity: 0.6; text-align: center; }
/* Einstellungen eines Objekts (Editor): gleiche Stelle wie die Entity-Auswahl, die sich darüberlegt */
.objcfg { position: absolute; top: 10px; right: 80px; bottom: calc(var(--ha3d-editbar-h, 136px) + 24px + env(safe-area-inset-bottom, 0px)); width: min(440px, calc(100% - 100px)); display: none; flex-direction: column;
  border-radius: var(--r-panel); background: var(--g-panel); backdrop-filter: var(--g-blur); -webkit-backdrop-filter: var(--g-blur); border: 1px solid var(--g-line); overflow: hidden; }
.objcfg.show { display: flex; }
.picker.show ~ .objcfg { display: none; }
.catalog .tabs { margin: 0 12px 8px; }
.catalog .chip { min-height: 48px; }
.catalog .tabs, .catalog .chips, .catalog .search, .catalog .hint { flex-shrink: 0; }
.catalog .hint { margin: 0 16px 8px; }
.catalog .list .mark { color: var(--g-fg-dim); }
.objcfg header { display: flex; align-items: center; padding: 8px 8px 4px 16px; }
.objcfg header h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
.objcfg header button, .objcfg .chip button { width: 48px; height: 48px; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 18px; cursor: pointer; }
.objcfg .body { overflow-y: auto; padding: 0 12px 12px; touch-action: pan-y; -webkit-overflow-scrolling: touch; }
.objcfg h3 { margin: 12px 0 2px; font-size: 13px; font-weight: 600; opacity: 0.75; text-transform: uppercase; letter-spacing: .05em; }
.objcfg .hint { margin: 0 0 6px; font-size: 12px; opacity: 0.6; }
.objcfg .linked { display: flex; flex-wrap: wrap; gap: 6px; }
.objcfg .chip { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 0 0 12px; border-radius: var(--r-btn); flex-wrap: wrap;
  background: var(--g-ok-bg); border: 1px solid var(--g-ok); font-size: 13px; }
.objcfg .chip small { font-size: 11px; opacity: 0.7; }
.objcfg button.add { min-height: 48px; padding: 0 16px; border-radius: var(--r-btn); border: 1px dashed var(--g-line-strong); background: transparent; color: inherit; font: inherit; font-size: 14px; cursor: pointer; }
.objcfg .gesture { display: flex; flex-direction: column; gap: 6px; margin: 6px 0 10px; }
.objcfg label { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.objcfg select, .objcfg input { min-height: 48px; padding: 0 12px; border-radius: var(--r-item); border: 1px solid var(--g-line); background: var(--g-well); color: inherit;
  font: inherit; font-size: 16px; user-select: text; -webkit-user-select: text; }
.objcfg label select { flex: 1; }
.objcfg > .body > section > select { width: 100%; }
/* Zustand über Objekten (Waschmaschine: Restzeit …): folgt der Kamera, lässt Taps durch */
.badges { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
:host([editing]) .badges { display: none; }
.badge { position: absolute; left: 0; top: 0; padding: 3px 9px; border-radius: 6px; background: var(--g-bg); border: 1px solid var(--g-line);
  font-size: 12px; font-weight: 600; white-space: nowrap; will-change: transform; }
.badge.on { background: var(--g-accent); color: var(--g-accent-fg); border-color: var(--g-accent); }
.badge[hidden] { display: none; }
/* Rückfrage vor einer Aktion */
.confirm { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; background: #0008; }
.confirm.show { display: flex; }
.confirm > div { max-width: min(360px, calc(100% - 32px)); padding: 18px; border-radius: var(--r-panel); background: var(--g-panel); border: 1px solid var(--g-line); }
.confirm p { margin: 0 0 14px; font-size: 15px; }
.confirm .row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.confirm button { min-width: 96px; min-height: 48px; border-radius: var(--r-item); border: 1px solid var(--g-line); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.confirm button.yes { background: var(--g-sel-bg); color: var(--g-sel-fg); border-color: var(--g-sel-bg); }
/* volle Breite (mit left: 50% stünde nur die halbe Breite zur Verfügung und die Knöpfe brächen zu früh um);
   die leeren Ränder lassen Taps zur 3D-Ansicht durch */
.editbar { position: absolute; left: 12px; right: 12px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); display: none; flex-direction: column; align-items: center; gap: 8px;
  pointer-events: none; }
.editbar > * { pointer-events: auto; }
:host([editing]) .editbar { display: flex; }
:host([editing]) .toast { bottom: calc(var(--ha3d-editbar-h, 136px) + 24px + env(safe-area-inset-bottom, 0px)); }
.editinfo { padding: 7px 14px; border-radius: var(--r-btn); background: var(--g-bg); font-size: 14px; text-align: center; max-width: 100%; }
.editinfo b { color: var(--g-accent); font-weight: 600; }
.tools { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; padding: 6px; border-radius: var(--r-panel); background: var(--g-bg);
  backdrop-filter: var(--g-blur); -webkit-backdrop-filter: var(--g-blur); max-width: 100%; } /* schmale Bildschirme: zweite Zeile statt abgeschnittener Knöpfe */
.tools button { min-width: 64px; height: 60px; padding: 4px 8px; border: 0; border-radius: var(--r-item); background: transparent; color: var(--g-fg);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font: inherit; font-size: 11px; cursor: pointer; }
.tools button:active { background: var(--g-line); }
.tools button.active { background: var(--g-sel-bg); color: var(--g-sel-fg); }
.tools button:disabled { opacity: 0.35; }
.tools button.dirty { color: var(--g-accent); }
.tools button[hidden] { display: none; }
:host([narrow]) button.menu { display: inline-flex; align-items: center; justify-content: center; }
.toast { position: absolute; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); padding: 6px 14px; border-radius: var(--r-panel);
  background: var(--g-bg); font-size: 13px; opacity: 0; transition: opacity .25s; pointer-events: none; }
.toast.show { opacity: 1; }
/* Demo-Hinweis: dezent oben links, antippen blendet ihn aus (Touch-Ziel >= 48 px) */
.demo-note { position: absolute; top: 56px; left: 12px; max-width: calc(100% - 100px); min-height: 48px; padding: 6px 14px; border-radius: var(--r-btn);
  border: 1px solid var(--g-line); background: var(--g-bg); color: var(--g-fg); font: inherit; font-size: 13px; line-height: 1.3; text-align: left;
  cursor: pointer; backdrop-filter: var(--g-blur); -webkit-backdrop-filter: var(--g-blur); display: none; }
.demo-note[hidden] { display: none; }
:host([demo]) .demo-note:not([hidden]) { display: block; }
:host([demo][editing]) .demo-note { display: none; } /* im Editor nicht über Lampenauswahl und Leiste */
.demo-note small { display: block; opacity: 0.65; font-size: 11px; }
.error { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; padding: 24px;
  text-align: center; color: #e8b4a8; font-size: 15px; white-space: pre-line; }
.error.show { display: flex; }
`;

class Ha3dDashboard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div id="stage"></div>
      <div class="vignette"></div>
      <div class="precip"></div>
      <div class="badges"></div>
      <div class="bar">
        <button class="menu" title="Menü"><svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg></button>
        <span class="title"></span><span class="floor"></span>
        <button class="weather" hidden title="Wetter"></button>
      </div>
      <div class="levels" hidden></div>
      <button class="compass" title="Ansicht einnorden" aria-label="Ansicht einnorden">
        <svg viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="22" fill="none" style="stroke: var(--g-line)" stroke-width="1"/>
          <g class="needle">
            <path d="M28 7 L33 28 L23 28 Z" fill="#d9573f"/>
            <path d="M28 49 L33 28 L23 28 Z" style="fill: var(--g-fg-dim)"/>
            <circle cx="28" cy="28" r="2.2" style="fill: var(--g-fg)"/>
            <text x="28" y="5.5" text-anchor="middle" font-size="7" font-weight="600" fill="#d9573f" font-family="inherit">N</text>
          </g>
        </svg>
      </button>
      <button class="settings-toggle" title="Einstellungen" aria-label="Einstellungen">${icon('cog')}</button>
      <div class="settings"></div>
      <div class="links">
        <header><h2>Link-Check<small class="about"></small></h2><button class="links-close" aria-label="Schließen">${icon('close')}</button></header>
        <div class="summary"></div>
        <div class="body">
          <h3>Geräte im Modell</h3><ul class="devices"></ul>
          <h3>HA-Lichter ohne Zuordnung</h3><ul class="free"></ul>
        </div>
      </div>
      <div class="picker"></div>
      <div class="objcfg"></div>
      <div class="picker catalog"></div>
      <div class="editbar">
        <div class="editinfo"></div>
        <div class="tools">
          <button data-act="catalog">${icon('catalog')}Katalog</button>
          <button data-act="move">${icon('move')}Verschieben</button>
          <button data-act="align">${icon('align')}Anlegen</button>
          <button data-act="link" hidden>${icon('plug')}Verknüpfen</button>
          <button data-act="remove" hidden>${icon('trash')}Entfernen</button>
          <button data-act="undo">${icon('undo')}Rückgängig</button>
          <button data-act="export">${icon('export')}Export</button>
          <button data-act="cancel">${icon('close')}Abbrechen</button>
          <button data-act="done">${icon('done')}Fertig</button>
        </div>
      </div>
      <button class="demo-note" hidden aria-label="Hinweis ausblenden"></button>
      <div class="toast"></div>
      <div class="confirm"><div><p></p><div class="row"><button class="no">Abbrechen</button><button class="alt" hidden></button><button class="yes">OK</button></div></div></div>
      <div class="fps" hidden aria-live="off"></div>
      <div class="error"></div>`;
    this.shadowRoot.querySelector('button.menu').addEventListener('click', () => {
      this.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true }));
    });
    this.shadowRoot.querySelector('.demo-note').addEventListener('click', (e) => (e.currentTarget.hidden = true));
    this.shadowRoot.querySelector('.levels').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-level]');
      if (b) this.setLevel(Number(b.dataset.level));
    });
    this.shadowRoot.querySelector('.compass').addEventListener('click', () => this.view?.faceNorth());
    // Zahnrad: Einstellungsmenü (Ansicht, Bearbeiten, Link-Check, Info)
    this.menu = new SettingsMenu(this.shadowRoot.querySelector('.settings'), {
      onPrefs: (prefs) => this._applyPrefs(prefs),
      onAction: (act) => (act === 'edit' ? this.setEditing(true) : this._toggleLinks(true)),
    });
    this.prefs = this.menu.prefs;
    // Darstellung erst in connectedCallback setzen: Attribute im Konstruktor sind verboten, HA legt das Panel mit
    // document.createElement an (sonst NotSupportedError -> weiße Seite)
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => this._applyTheme());
    this.shadowRoot.querySelector('.settings-toggle').addEventListener('click', () => this._toggleMenu());
    // Wetter antippen: HA-Wetterdialog (Vorhersage)
    this.shadowRoot.querySelector('.weather').addEventListener('click', () => {
      const entityId = this._weatherEntity();
      if (entityId) this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
    });
    this.shadowRoot.querySelector('.links-close').addEventListener('click', () => this._toggleLinks(false));
    this.shadowRoot.querySelector('.tools').addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act) this._editAction(act);
    });
    // Höhe der Werkzeugleiste (1 oder 2 Zeilen) für Lampenauswahl und Meldungen darüber
    new ResizeObserver(([e]) => e.contentRect.height && this.style.setProperty('--ha3d-editbar-h', `${Math.round(e.contentRect.height)}px`))
      .observe(this.shadowRoot.querySelector('.editbar'));
    this._ready = new Promise((res) => (this._resolveReady = res));
    this._hassReady = new Promise((res) => (this._resolveHass = res));
  }

  connectedCallback() {
    this._applyTheme();
    // beim Wiederanzeigen neu laden – aber nicht mitten in einer Bearbeitung
    this._onVisible ??= () => document.visibilityState === 'visible' && !this.editor?.changes.size && this.reloadData();
    document.addEventListener('visibilitychange', this._onVisible);
    this._onResize ??= () => this._fitHeight();
    window.addEventListener('resize', this._onResize);
    window.visualViewport?.addEventListener('resize', this._onResize);
    this._fitHeight();
    requestAnimationFrame(this._onResize); // nach dem Layout von HA noch einmal messen
    // Erst starten, wenn HA die Properties (panel) gesetzt hat und das Element Größe hat
    requestAnimationFrame(() => this.reloadData());
  }

  disconnectedCallback() {
    clearInterval(this._fpsTimer);
    document.removeEventListener('visibilitychange', this._onVisible);
    window.removeEventListener('resize', this._onResize);
    window.visualViewport?.removeEventListener('resize', this._onResize);
    this._unsubShared?.then((un) => un()).catch(() => {});
    this._unsubShared = null;
    this.editor?.dispose();
    this.editor = null;
    this.view?.dispose();
    this.view = null;
    this._keys = null;
  }

  /** Höhe vom oberen Rand des Panels bis zum unteren Bildschirmrand (siehe :host im STYLE) */
  _fitHeight() {
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const top = Math.max(0, this.getBoundingClientRect().top);
    this.style.setProperty('--ha3d-fit-height', `${Math.max(200, Math.round(vh - top))}px`);
  }

  get dataUrl() {
    const configured = this._panel?.config?.data_url;
    // Ordner: ohne abschließenden Schrägstrich würde der letzte Teil beim Auflösen von model.yaml ersetzt
    return configured ? new URL(configured.endsWith('/') ? configured : `${configured}/`, location.href) : MODULE_BASE;
  }

  /** Gemeinsames Modell über die Integration (panel config `shared`): für alle Benutzer gleich */
  get shared() {
    return this._panel?.config?.shared === true;
  }

  /** Demo-Modus aktiv (config.demo oder Fallback ohne erreichbare Daten): lokal schalten, nichts speichern */
  get demo() {
    return this.hasAttribute('demo');
  }

  _setDemo(on, note = '') {
    this.toggleAttribute('demo', on);
    const el = this.shadowRoot.querySelector('.demo-note');
    el.innerHTML = on ? `Demo-Haus – eigene Daten: siehe Anleitung${note ? `<small>${note}</small>` : ''}` : '';
    el.hidden = !on;
    this._updateReadonly();
  }

  /** Gemeinsames Modell bearbeiten dürfen nur Administratoren (das Demo-Haus speichert jeder für sich) */
  _updateReadonly() {
    this.toggleAttribute('readonly', this.shared && !this.demo && this._hass?.user?.is_admin === false);
  }

  /** Daten laden: eingebettetes Demo-Haus (config.demo) oder aus data_url bzw. neben dem Modul, sonst Demo-Fallback */
  async _fetchData() {
    if (this._panel?.config?.demo === true) {
      this._setDemo(true);
      this._source = 'Demo-Haus';
      return loadDemoData();
    }
    try {
      const data = this.shared ? await loadShared(await this._hassReady, this.dataUrl) : await loadData(this.dataUrl);
      this._shared = this.shared ? { revision: data.revision, fileHash: data.fileHash } : null;
      this._source = data.source === 'shared' ? 'gespeichertes Modell' : `${MODEL_FILE} aus ${this.dataUrl.pathname}`;
      this._setDemo(false);
      if (this.shared) this._subscribeShared();
      return data;
    } catch (e) {
      // nur bei unerreichbaren Daten (404, Netzwerk) und nur, solange noch nichts angezeigt wird;
      // kaputte eigene Daten bleiben ein Fehler und werden nie durch das Demo-Haus ersetzt
      if (!(e instanceof DataUnavailableError) || (this.view && !this.demo)) throw e;
      console.warn('ha-3d-dashboard: Daten nicht erreichbar, zeige Demo-Haus –', e.message);
      this._setDemo(true, this._panel?.config?.data_url ? `keine Daten unter ${this._panel.config.data_url}` : 'keine Daten neben dem Modul');
      this._source = 'Demo-Haus';
      return loadDemoData();
    }
  }

  /**
   * Daten (neu) laden. Nur was sich geändert hat, wird neu aufgebaut:
   * Haus geändert -> ganze Szene; nur Einrichtung/Geräte -> nur diese Schicht.
   */
  async reloadData() {
    if (this._loading) return this._loading;
    this._loading = (async () => {
      try {
        const data = await this._fetchData();
        // In HA: im Editor gespeicherte Lage-Änderungen (Benutzerdaten) über die Dateien legen
        // (Demo-Haus: aus eigenen Demo-Benutzerdaten, siehe store)
        applyOverrides(data.model, await this.store.loadOverrides());
        const scene = toScene(data.model);
        if (!scene.house.floors.length) throw new Error('Das Modell enthält noch keine Gebäude – Grundriss importieren (docs/SETUP.md)');
        // Was hat sich geändert? Bauwerk -> ganze Szene; nur Objekte -> nur die Einrichtungs-Schicht
        const { site, buildings, outdoor, objects } = data.model;
        const keys = { structure: JSON.stringify([site, buildings, outdoor]), objects: JSON.stringify(objects) };
        const old = this._keys;
        this._keys = keys;
        this.model = data.model;
        this._modelHeader = yamlHeader(data.text);
        this._showError(null);
        if (!this.view || old?.structure !== keys.structure) {
          const states = this.view ? new Map([...this.view.lamps].map(([id, s]) => [id, s])) : null;
          const level = this.view?.level;
          this.view?.dispose();
          this._createView(scene);
          if (level != null && this.view.setLevel(level)) this._renderLevel();
          if (states) for (const [id, s] of states) this.view.setLamp(id, s.on, s);
        } else if (old.objects !== keys.objects) {
          this.view.setFurnishing({ devices: scene.devices, items: scene.items });
          this.areaMap = scene.areaMap;
          if (this._hass) this._applyHass(); // neue Leuchten-Objekte -> Zustand aus HA neu setzen
          else this._applyActivity();
        }
      } catch (e) {
        console.error('ha-3d-dashboard:', e);
        if (!this.view) this._showError(`Daten konnten nicht geladen werden:\n${e.message}`);
        else this._toast('Daten-Update fehlgeschlagen – siehe Konsole');
      } finally {
        this._loading = null;
      }
    })();
    return this._loading;
  }

  get store() {
    // Demo-Haus: nie in Dateien, nur in eigene Benutzerdaten – die Daten des eigenen Hauses bleiben unberührt
    if (this.demo) return new LayoutStore({ hass: this._hass, key: DEMO_USER_DATA_KEY });
    return new LayoutStore({ saveUrl: this._panel?.config?.save_url || null, hass: this._hass, shared: this._shared });
  }

  /** Speichert ein anderer Administrator das gemeinsame Modell, laden alle anderen Panels neu (nicht im Editor) */
  _subscribeShared() {
    if (this._unsubShared || !this._hass?.connection?.subscribeMessage) return;
    this._unsubShared = this._hass.connection.subscribeMessage((ev) => {
      if (ev.revision === this._shared?.revision) return;
      // im Editor nicht unter den Händen austauschen: nach dem Schließen nachladen (beim Speichern: Konflikt)
      if (this.hasAttribute('editing')) this._reloadOnLeave = true;
      else this.reloadData();
    }, { type: `${SHARED_WS}/subscribe` });
    this._unsubShared.catch((e) => {
      console.warn('ha-3d-dashboard: Aktualisierungen des gemeinsamen Modells nicht abonnierbar', e);
      this._unsubShared = null;
    });
  }

  /** Ebene wechseln (Stockwerk); im Editiermodus wird die Auswahl aufgehoben */
  setLevel(level) {
    if (!this.view || level === this.view.level) return;
    if (this.editor?.sel) this.editor.select(null);
    if (this.view.setLevel(level)) this._renderLevel();
  }

  /** Kürzel einer Ebene: UG, EG, 1. OG … */
  static levelLabel(l) {
    return l === 0 ? 'EG' : l < 0 ? `${l === -1 ? '' : `${-l}. `}UG` : `${l}. OG`;
  }

  _renderLevel() {
    const v = this.view;
    this.shadowRoot.querySelector('.floor').textContent = v.levelName();
    const el = this.shadowRoot.querySelector('.levels');
    el.hidden = v.levels.length < 2;
    el.innerHTML = [...v.levels].reverse().map((l) =>
      `<button data-level="${l}" class="${l === v.level ? 'on' : ''}" aria-label="Ebene ${Ha3dDashboard.levelLabel(l)}">${Ha3dDashboard.levelLabel(l)}</button>`).join('');
  }

  _createView(data) {
    this.editor?.dispose();
    this.editor = null;
    this.view = new HouseScene(this.shadowRoot.getElementById('stage'), data.house, { devices: data.devices, items: data.items }, {
      assetBase: this.dataUrl,
      onRoomTap: (id) => this._onRoomTap(id),
      onObjectGesture: (ref, g) => this._onGesture(ref, g),
      objectGestures: (ref) => this._gesturesOf(ref),
      onViewChange: () => this._updateCompass(),
      onRender: () => {
        this._placeBadges();
        this._updateCompass(); // im selben Bild wie die Szene, sonst hinkt die Nadel beim Drehen nach
      },
      onQualityChange: (q) => {
        this.setAttribute('quality', q);
        if (this.menu?.isOpen) this._toggleMenu(true);
      },
    });
    this._updateCompass();
    this.areaMap = data.areaMap || {};
    this.editor = new Editor(this.view, {
      onChange: (info) => this._renderEditBar(info),
      // neue Verknüpfung: Zustand der Leuchte sofort aus HA übernehmen
      onLinkChange: ({ type, id }) => {
        // Verknüpfung gelöst -> Leuchte aus; sonst Zustand sofort aus HA übernehmen
        const s = type === 'lamp' && this.view.lamps.get(id);
        if (s && !entitiesOf(s.lamp).length) this.view.setLamp(id, false);
        else if (this._hass) this._applyHass();
        this.settings?.render();
      },
    });
    this.picker ??= new EntityPicker(this.shadowRoot.querySelector('.picker'), {
      onChange: (ent) => {
        const role = this.picker.role;
        const ha = structuredClone(this.editor?.sel?.entry.ha || {});
        ha.entities = { ...(ha.entities || {}), [role]: ent ?? undefined };
        this.editor?.setHa(ha);
      },
      onClose: () => this.editor?._emit(),
    });
    this.settings ??= new ObjectSettings(this.shadowRoot.querySelector('.objcfg'), {
      onChange: (ha) => this.editor?.setHa(ha),
      onState: (state) => {
        this.editor?.setState(state);
        this._applyActivity();
        this.settings.render();
      },
      onPick: (role) => this._openPicker(role),
      onClose: () => this.editor?._emit(),
    });
    this.catalog ??= new CatalogPanel(this.shadowRoot.querySelector('.catalog'), {
      onAdd: (model) => this._addObject(model),
      onRestore: (id) => this._restoreObject(id),
      onClose: () => this.editor?._emit(),
    });
    if (this.hasAttribute('editing')) this.editor.setEnabled(true);
    this.shadowRoot.querySelector('.title').textContent = data.house.name || '';
    this._renderLevel();
    this.view.setQuality?.(this.prefs.quality);
    this.setAttribute('quality', this.view.quality);
    this._applyMotion();
    if (this._hass) this._applyHass();
    else {
      this._applyWeather();
      this._applySky();
      this._updateBadges();
      this._applyActivity();
    }
    this._resolveReady(this);
  }

  // ------------------------------------------------------------------ Editiermodus

  /** Editiermodus an; aus = Abbrechen (Änderungen verwerfen). */
  setEditing(on) {
    if (!this.editor) return;
    if (!on) return this.cancelEditing();
    this.toggleAttribute('editing', true);
    this.editor.setEnabled(true);
  }

  /** „Fertig“: Änderungen speichern und den Editiermodus verlassen. Scheitert das Speichern, bleibt er offen. */
  async finishEditing() {
    const ed = this.editor;
    if (!ed) return;
    // Demo-Haus ohne HA (reine Vorschau): nirgends zu speichern, Änderungen bleiben nur in der Ansicht
    if (ed.changes.size && !(this.demo && !this._hass) && !(await this._save())) return;
    ed.changes.clear();
    this._leaveEditing();
  }

  /** „Abbrechen“: alle Änderungen seit dem letzten Speichern verwerfen und den Editiermodus verlassen. */
  cancelEditing() {
    const ed = this.editor;
    if (!ed) return;
    const discard = ed.changes.size > 0;
    if (discard) {
      ed.changes.clear();
      this._keys = null; // Daten neu laden = Stand vor den Änderungen
      this._reloadOnLeave = true;
    }
    this._leaveEditing();
    if (discard) this._toast('Änderungen verworfen');
  }

  _leaveEditing() {
    this.picker?.close();
    this.settings?.close();
    this.catalog?.close();
    this.toggleAttribute('editing', false);
    this.editor.setEnabled(false);
    if (this._reloadOnLeave) {
      this._reloadOnLeave = false;
      this.reloadData();
    }
  }

  /** Änderungen speichern (Dev-Server: Dateien; HA: Benutzerdaten; Demo-Haus: eigene Demo-Benutzerdaten). */
  async _save() {
    const ed = this.editor;
    try {
      // Änderungen ins Modell übernehmen und das Modell speichern
      for (const { type, id } of ed.changes.values()) writeBack(type, ed._entry({ type, id }));
      const changes = [...ed.changes.values()];
      const present = new Set(this.model.objects.map((o) => o.id));
      await this.store.save(this.model, changes.map((c) => c.id), this._modelHeader, {
        added: changes.filter((c) => c.added && present.has(c.id)).map((c) => c.id),
        removed: changes.filter((c) => !present.has(c.id)).map((c) => c.id),
      });
      this._keys = { ...this._keys, objects: JSON.stringify(this.model.objects) };
      ed.changes.clear();
      ed._emit();
      this._toast(this.demo ? 'Gespeichert – Demo-Haus, für diesen HA-Benutzer'
        : this.store.mode === 'files' ? 'Gespeichert (model.yaml)'
          : this.store.mode === 'shared' ? 'Gespeichert – für alle Benutzer' : 'Gespeichert – gilt für diesen HA-Benutzer, Export für die Datei');
      return true;
    } catch (e) {
      console.error('ha-3d-dashboard:', e);
      this._toast(`Speichern fehlgeschlagen: ${e.message}`);
      return false;
    }
  }

  async _editAction(act) {
    const ed = this.editor;
    if (!ed) return;
    if (act === 'move' || act === 'align') ed.setTool(act);
    else if (act === 'link') this._toggleSettings();
    else if (act === 'catalog') this._toggleCatalog();
    else if (act === 'remove') await this._removeSelected();
    else if (act === 'undo') ed.undo();
    else if (act === 'done') await this.finishEditing();
    else if (act === 'cancel') this.cancelEditing();
    else if (act === 'export') {
      if (this.demo) return this._toast('Demo-Haus: kein Export');
      // fertiges Modell mit allen aktuellen Lagen (auch ungespeicherten)
      const model = structuredClone(this.model);
      const byId = new Map(model.objects.map((o) => [o.id, o]));
      const d = this.view.furnishingData;
      for (const [type, list] of [['item', d.items], ['lamp', d.devices]]) {
        for (const e of list) if (byId.has(e.id)) writeBack(type, { ...e, src: byId.get(e.id) });
      }
      download(MODEL_FILE, toYaml(model, this._modelHeader));
    }
  }

  // ------------------------------------------------------------------ Katalog: Hinzufügen, Einlagern, Löschen

  _toggleCatalog(show = !this.catalog?.isOpen) {
    this.picker.close();
    this.settings.close();
    if (show) this.catalog.open({ stored: this._storedObjects() });
    else this.catalog.close();
    this.editor._emit();
  }

  /** Eingelagerte Objekte für das Lager im Katalog */
  _storedObjects() {
    return (this.model?.objects || []).filter((o) => o.stored).map((o) => ({
      id: o.id, model: o.model, name: o.name || CATALOG[o.model]?.label || o.id,
      linked: Object.values(o.ha?.entities || {}).reduce((n, v) => n + [].concat(v).length, 0),
    }));
  }

  /**
   * Objektbestand ändern (Hinzufügen, Einlagern, Aufstellen, Löschen): ungespeicherte Lagen ins Modell, mutate(objects)
   * ausführen, Einrichtung neu bauen. Rückgängig stellt den vorigen Bestand wieder her; gespeichert wird mit „Fertig“.
   * @param mutate  (objects) => { id, added? } – das betroffene Objekt
   * @param select  danach auswählen (nicht bei Löschen/Einlagern)
   */
  _changeObjects(mutate, select = true) {
    const ed = this.editor;
    for (const { type, id } of ed.changes.values()) writeBack(type, ed._entry({ type, id }));
    const before = structuredClone(this.model.objects);
    const { id, added } = mutate(this.model.objects);
    ed.clearSelection();
    this._rebuildObjects();
    const o = this.model.objects.find((x) => x.id === id);
    const type = o && hasCapability(o.model, 'light') ? 'lamp' : 'item';
    ed.changes.set(`obj:${id}`, { type, id, added: added || ed.changes.get(`obj:${id}`)?.added, values: {} });
    ed.undoStack.push({
      restore: () => {
        this.model.objects.splice(0, this.model.objects.length, ...before);
        ed.clearSelection();
        this._rebuildObjects();
        ed._emit();
      },
    });
    if (select && o && !o.stored) ed.select({ type, id });
    else ed._emit();
  }

  _rebuildObjects() {
    const scene = toScene(this.model);
    this.view.setFurnishing({ devices: scene.devices, items: scene.items });
    this.areaMap = scene.areaMap;
    if (this._hass) this._applyHass();
    else this._applyActivity();
    this.catalog?.update(this._storedObjects());
  }

  /** Bereich (Raum, sonst Außenbereich) unter einem Plan-Punkt auf der gezeigten Ebene */
  _spaceAt(pos) {
    const floors = [...this.view.levelFloors].sort((a, b) => !!a.floor.outdoor - !!b.floor.outdoor);
    if (!floors.some((f) => f.floor.outdoor)) floors.push(...this.view.floors.filter((f) => f.floor.outdoor));
    for (const f of floors) for (const r of f.rooms.values()) if (pointInPoly(pos, r.room.polygon)) return r.room.id;
    return null;
  }

  /** Neues Objekt aus dem Katalog in der Mitte der Ansicht anlegen und auswählen (danach verschieben) */
  _addObject(model) {
    const c = CATALOG[model];
    if (!c) return;
    const t = this.view.controls.target;
    const pos = [Math.round(t.x * 100) / 100, Math.round(t.z * 100) / 100];
    const space = this._spaceAt(pos);
    this._changeObjects((objects) => {
      const ids = new Set(objects.map((o) => o.id));
      let n = 1;
      while (ids.has(`${model}_${n}`)) n++;
      const o = { id: `${model}_${n}`, name: c.label || model, model, ...(space ? { space } : {}), pos };
      if (hasCapability(model, 'light')) {
        const mount = DEFAULT_MOUNT[model] || 'ceiling';
        o.light = { height: MODEL_LIGHT_HEIGHT[model] ?? DEFAULT_LIGHT_HEIGHT[mount] ?? 2, range: 3 };
      }
      objects.push(o);
      return { id: o.id, added: true };
    });
    this.catalog.close();
    this._toast(`${c.label || model} hinzugefügt – verschieben, verknüpfen, mit Fertig speichern`);
  }

  /** Eingelagertes Objekt wieder aufstellen (alter Platz, alte Verknüpfungen) */
  _restoreObject(id) {
    this._changeObjects((objects) => {
      delete objects.find((o) => o.id === id).stored;
      return { id };
    });
    this.catalog.close();
  }

  /** Gewähltes Objekt entfernen: einlagern (bleibt mit Verknüpfungen im Lager) oder endgültig löschen */
  async _removeSelected() {
    const s = this.editor?.sel;
    if (!s) return;
    const name = s.entry.name || s.entry.id;
    const r = await this._confirm(`„${name}“ aus der Welt nehmen? Eingelagert bleibt es mit allen Verknüpfungen im Lager (Katalog) und lässt sich später wieder aufstellen.`,
      { yes: 'Einlagern', alt: 'Löschen' });
    if (!r) return;
    this._changeObjects((objects) => {
      const i = objects.findIndex((o) => o.id === s.id);
      if (r === 'yes') objects[i].stored = true;
      else objects.splice(i, 1);
      return { id: s.id };
    }, false);
    this._toast(r === 'yes' ? `„${name}“ eingelagert` : `„${name}“ gelöscht`);
  }

  /** Einstellungen des gewählten Objekts (Verknüpfungen, Gesten, Zustandsanzeige) öffnen bzw. schließen */
  _toggleSettings(show = !this.settings?.isOpen) {
    const s = this.editor?.sel;
    this.picker.close();
    this.catalog?.close();
    if (!show || !s) return this.settings.close();
    this.settings.open({ entry: s.entry, light: s.type === 'lamp', hass: this._hass, anim: !!CATALOG[s.entry.kind || s.entry.model]?.anim });
    this.editor._emit();
  }

  /**
   * Entity-Auswahl für eine Rolle des gewählten Objekts öffnen, vorgefiltert auf den HA-Bereich seines Raums.
   * @param role  power (Standard) oder info
   */
  _openPicker(role = 'power') {
    const s = this.editor?.sel;
    if (!s) return;
    const fm = this.view.floors.find((f) => f.floor.id === s.entry.floor);
    const room = fm?.rooms.get(s.entry.room)?.room;
    const area = room ? areaForRoom(this._hass, s.entry.floor, room, this.areaMap) : null;
    const usedBy = new Map();
    const d = this.view.furnishingData;
    for (const o of [...d.devices, ...d.items]) {
      if (o.id !== s.id) for (const e of roleEntities(o, role)) usedBy.set(e, o.name || o.id);
    }
    this.picker.open({ hass: this._hass, device: s.entry, linked: roleEntities(s.entry, role), role, light: s.type === 'lamp', area, usedBy });
    this.editor._emit();
  }

  _renderEditBar(info) {
    // Auswahl gewechselt -> Einstellungen und Entity-Auswahl schließen
    if (this.picker?.isOpen && info.selection?.id !== this.picker.device?.id) this.picker.close();
    if (this.settings?.isOpen && info.selection?.id !== this.settings.entry?.id) this.settings.close();
    if (!info.enabled) {
      this.picker?.close();
      this.settings?.close();
    }
    const root = this.shadowRoot;
    for (const b of root.querySelectorAll('.tools button')) {
      const act = b.dataset.act;
      b.classList.toggle('active', act === info.tool);
      if (act === 'undo') b.disabled = !info.canUndo;
      if (act === 'done') b.classList.toggle('dirty', info.dirty);
      if (act === 'export') b.hidden = this.demo || this.store.mode === 'files';
      if (act === 'remove') b.hidden = !info.selection;
      if (act === 'catalog') b.classList.toggle('active', !!this.catalog?.isOpen);
      if (act === 'link') {
        b.hidden = !info.selection;
        b.classList.toggle('active', !!(this.picker?.isOpen || this.settings?.isOpen));
      }
    }
    const s = info.selection;
    const FACE = { back: 'Rückseite', front: 'Vorderseite', left: 'linke Seite', right: 'rechte Seite', bottom: 'Unterseite' };
    let text;
    if (!s) text = this.demo ? 'Möbel oder Leuchte antippen (Demo-Haus)' : 'Möbel oder Leuchte antippen';
    else {
      const y = s.height ?? s.elevation;
      text = `<b>${s.name}</b> · x ${s.pos[0].toFixed(2)} · y ${s.pos[1].toFixed(2)}${y != null ? ` · Höhe ${y.toFixed(2)}` : ''} · ${(s.rot || 0).toFixed(0)}°`;
      const n = Object.values(s.ha?.entities || {}).reduce((k, v) => k + [].concat(v).length, 0);
      if (n || s.type === 'lamp') text += ` · ${n ? `${n} Entit${n === 1 ? 'y' : 'ies'} verknüpft` : 'nicht verknüpft'}`;
      if (info.tool === 'align') text += `<br>Anlegen mit <b>${FACE[info.alignFace]}</b> – andere Fläche am Objekt antippen oder Wand/Boden antippen`;
    }
    root.querySelector('.editinfo').innerHTML = text;
  }

  _updateCompass() {
    const deg = this.view?.northScreenAngle() ?? 0;
    const t = `rotate(${deg.toFixed(1)}deg)`;
    if (t === this._needle) return;
    this._needle = t;
    this.shadowRoot.querySelector('.compass .needle').style.transform = t;
  }

  _showError(text) {
    const el = this.shadowRoot.querySelector('.error');
    el.textContent = text || '';
    el.classList.toggle('show', !!text);
  }

  set hass(hass) {
    this._hass = hass;
    if (hass?.themes?.darkMode !== this._darkMode) {
      this._darkMode = hass?.themes?.darkMode;
      this._applyTheme();
    }
    this._resolveHass?.(hass);
    this._updateReadonly();
    if (this.view) this._applyHass();
  }
  get hass() {
    return this._hass;
  }

  set narrow(v) {
    this.toggleAttribute('narrow', !!v);
  }

  set panel(p) {
    this._panel = p;
  }

  /** Zustände aus HA übernehmen: Sonne und alle verknüpften Leuchten. */
  _applyHass() {
    const states = this._hass?.states || {};
    this._applyWeather();
    this._applySky();

    // Im Demo-Modus folgen nur Leuchten, die mit einer echten Entity verknüpft wurden, HA; die übrigen schalten lokal
    for (const [id, s] of this.view.lamps) {
      const ents = this._liveEntities(s.lamp);
      if (!ents.length) continue;
      // nur neu rechnen, wenn sich eines der State-Objekte geändert hat (HA ersetzt sie bei Änderungen)
      const refs = ents.map((e) => states[e]);
      if (s.haRefs && refs.every((r, i) => r === s.haRefs[i])) continue;
      s.haRefs = refs;
      const l = lampLight(ents, states);
      if (!l) continue;
      this.view.setLamp(id, l.on, { color: l.color ?? s.baseColor, brightness: l.on ? l.brightness : undefined });
    }
    this._updateBadges();
    this._applyActivity();
    if (this.shadowRoot.querySelector('.links.show')) this._renderLinks();
  }

  /**
   * Entities einer Leuchte, die HA schaltet. Im Demo-Modus nur solche, die es in HA wirklich gibt (eine im Editor
   * verknüpfte echte Lampe); ohne HA-Verbindung keine.
   */
  _liveEntities(lamp) {
    return this._live(entitiesOf(lamp));
  }

  /** Entities, die HA bedient (Demo-Modus: nur in HA vorhandene; ohne HA-Verbindung keine) */
  _live(ents) {
    if (!this._hass) return [];
    return this.demo ? ents.filter((e) => e in (this._hass.states || {})) : ents;
  }

  /** Internes Objekt (Möbel/Gerät oder Leuchte) zu einer Referenz { type, id } */
  _objEntry({ type, id }) {
    const d = this.view?.furnishingData;
    return (type === 'lamp' ? d?.devices : d?.items)?.find((e) => e.id === id) ?? null;
  }

  /** Gesten, auf die ein Objekt reagiert (Aktion nicht „nichts“) */
  _gesturesOf(ref) {
    const e = this._objEntry(ref);
    const out = new Set();
    if (e) for (const g of GESTURES) if (gestureAction(e, g, ref.type === 'lamp').action !== 'none') out.add(g);
    return out;
  }

  /** Geste auf einem Objekt: Aktion nach `ha` (docs/DATA_MODEL.md → Aktionen) ausführen */
  async _onGesture(ref, gesture) {
    const e = this._objEntry(ref);
    if (!e) return;
    const light = ref.type === 'lamp';
    const act = gestureAction(e, gesture, light);
    const name = e.name || e.id;
    this.dispatchEvent(new CustomEvent('object-gesture', { detail: { ...ref, gesture, action: act.action } }));
    if (act.action === 'none') return;
    if (act.confirm && !(await this._confirm(act.confirm))) return;
    try {
      if (act.action === 'toggle') return light ? await this._onLampTap(ref.id) : await this._toggleObject(e);
      if (act.action === 'more-info') return this._moreInfo(e, act.entity, light);
      if (act.action === 'service') return await this._callServiceAction(e, act);
      if (act.action === 'navigate') {
        if (!act.path) return this._toast(`${name}: keine Seite angegeben`);
        history.pushState(null, '', act.path);
        window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
      }
    } catch (err) {
      console.error('ha-3d-dashboard:', err);
      this._toast(`${name}: ${err.message || err}`);
    }
  }

  /** Objekt (keine Leuchte) umschalten: an, sobald eine power-Entity an ist -> alle aus, sonst alle an */
  async _toggleObject(e) {
    const ents = this._live(roleEntities(e, 'power'));
    if (!ents.length) return this._toast(`${e.name || e.id}: nichts zum Schalten verknüpft – im Editor (Stift) verknüpfen`);
    const on = !ents.some((id) => isOn(this._hass.states[id]));
    const cover = ents.every((id) => id.startsWith('cover.'));
    this._toast(`${e.name || e.id}: ${cover ? (on ? 'öffnet' : 'schließt') : on ? 'an' : 'aus'}`);
    await this._call(on ? 'turn_on' : 'turn_off', ents);
  }

  /** HA-eigenen Dialog öffnen: angegebene, sonst erste power-, sonst erste info-Entity */
  _moreInfo(e, entity, light) {
    const entityId = entity || this._live(roleEntities(e, 'power'))[0] || this._live(roleEntities(e, 'info'))[0];
    if (!entityId) return this._toast(`${e.name || e.id}: nicht mit HA verknüpft – im Editor (Stift) verknüpfen`);
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  /** HA-Dienst aufrufen; ohne entity_id in data gelten die power-Entities */
  async _callServiceAction(e, act) {
    const [domain, service] = String(act.service || '').split('.');
    if (!domain || !service) return this._toast(`${e.name || e.id}: kein Dienst angegeben`);
    if (!this._hass) return this._toast(`${e.name || e.id}: ${act.service} (Vorschau)`);
    const data = { ...(act.data || {}) };
    const power = this._live(roleEntities(e, 'power'));
    if (data.entity_id == null && power.length) data.entity_id = power;
    await this._hass.callService(domain, service, data);
    this._toast(`${e.name || e.id}: ${act.service}`);
  }

  /** Rückfrage im Panel (große Knöpfe); true = bestätigt */
  /**
   * Rückfrage im Panel. Mit labels { yes, alt } drei Knöpfe (Ergebnis 'yes' | 'alt' | false), sonst OK/Abbrechen
   * (true | false).
   */
  _confirm(text, labels = null) {
    const el = this.shadowRoot.querySelector('.confirm');
    el.querySelector('p').textContent = text;
    const yes = el.querySelector('.yes'), no = el.querySelector('.no'), alt = el.querySelector('.alt');
    yes.textContent = labels?.yes || 'OK';
    alt.hidden = !labels?.alt;
    alt.textContent = labels?.alt || '';
    el.classList.add('show');
    return new Promise((resolve) => {
      const done = (r) => (ev) => {
        ev.stopPropagation();
        el.classList.remove('show');
        yes.onclick = no.onclick = alt.onclick = null;
        resolve(r);
      };
      yes.onclick = done(labels ? 'yes' : true);
      alt.onclick = done('alt');
      no.onclick = done(false);
    });
  }

  // ------------------------------------------------------------------ Zustandsanzeige

  /** Zustand über Objekten (info-Werte, An/Aus geschalteter Geräte) – nur Text, keine Animation */
  _updateBadges() {
    const box = this.shadowRoot.querySelector('.badges');
    this._badges ??= new Map();
    const want = new Map();
    const d = this.view?.furnishingData;
    const states = this._hass?.states || {};
    for (const [type, list] of [['item', d?.items || []], ['lamp', d?.devices || []]]) {
      for (const e of list) {
        const light = type === 'lamp';
        if (!showsBadge(e, light)) continue;
        const info = this._live(roleEntities(e, 'info')), power = this._live(roleEntities(e, 'power'));
        const on = power.some((id) => isOn(states[id]));
        // Tore/Rollläden: Zustandstext (Offen, Zu, Öffnet …) statt An/Aus
        const covers = power.length && power.every((id) => id.startsWith('cover.'));
        const text = info.length ? info.map((id) => stateText(states[id])).join(' · ')
          : covers ? stateText(states[power[0]]) : power.length ? (on ? 'An' : 'Aus') : null;
        if (text != null) want.set(`${type}:${e.id}`, { ref: { type, id: e.id }, text, on, name: e.name || e.id });
      }
    }
    for (const [k, el] of this._badges) {
      if (want.has(k)) continue;
      el.remove();
      this._badges.delete(k);
    }
    for (const [k, b] of want) {
      let el = this._badges.get(k);
      if (!el) {
        el = document.createElement('span');
        el.className = 'badge';
        el.ref = b.ref;
        box.append(el);
        this._badges.set(k, el);
      }
      if (el.textContent !== b.text) el.textContent = b.text;
      el.title = b.name;
      el.classList.toggle('on', b.on);
    }
    this._placeBadges();
  }

  /** Anzeigen der Kamera nachführen (nach jedem Bild) */
  _placeBadges() {
    if (!this._badges?.size || !this.view) return;
    for (const el of this._badges.values()) {
      const p = this.view.objectTop(el.ref);
      const s = p && this.view.toScreen(p);
      el.hidden = !s;
      if (s) el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  /** Leuchten eines Raums mit HA-Entities */
  _linkedLamps(ids) {
    return ids.map((id) => this.view.lamps.get(id)).filter((s) => s && this._liveEntities(s.lamp).length);
  }

  /**
   * Raum antippen: alle Lichter des Raums – ist eines an, gehen alle aus, sonst alle an.
   * Verknüpfte Leuchten schaltet HA (der neue Zustand kommt über hass zurück); ohne HA-Verbindung
   * (Vorschau ohne hass) wird nur lokal geschaltet.
   */
  async _onRoomTap(roomId) {
    const room = this.view.roomById(roomId);
    const ids = this.view.lampsInRoom(roomId);
    const linked = this._linkedLamps(ids);
    const on = !this.view.isRoomLit(roomId);
    this.dispatchEvent(new CustomEvent('room-tap', { detail: { roomId, on } }));
    const local = !this._hass || this.demo;
    if (!linked.length && !local) return this._toast(`${room?.name ?? roomId}: keine Leuchte mit HA verknüpft`);
    // Demo/Vorschau: unverknüpfte Leuchten lokal schalten (verknüpfte meldet HA über hass zurück)
    if (local) for (const id of ids) if (!linked.some((s) => s.lamp.id === id)) this.view.setLamp(id, on);
    this._toast(`${room?.name ?? roomId}: ${on ? 'an' : 'aus'}${local && !linked.length ? ` (${this.demo ? 'Demo' : 'Vorschau'})` : ''}`);
    if (linked.length) await this._call(on ? 'turn_on' : 'turn_off', linked.flatMap((s) => this._liveEntities(s.lamp)));
  }

  /** Leuchte antippen: nur diese Leuchte (alle ihre Entities gemeinsam) schalten. */
  async _onLampTap(lampId) {
    const s = this.view.lamps.get(lampId);
    const ents = this._liveEntities(s.lamp);
    const on = !s.on;
    this.dispatchEvent(new CustomEvent('lamp-tap', { detail: { lampId, on } }));
    if (ents.length) {
      this._toast(`${s.lamp.name ?? lampId}: ${on ? 'an' : 'aus'}`);
      await this._call(on ? 'turn_on' : 'turn_off', ents);
    } else if (!this._hass || this.demo) {
      this.view.setLamp(lampId, on);
      this._toast(`${s.lamp.name ?? lampId}: ${on ? 'an' : 'aus'} (${this.demo ? 'Demo' : 'Vorschau'})`);
    } else {
      this._toast(`${s.lamp.name ?? lampId}: nicht mit HA verknüpft`);
    }
  }


  async _call(service, entityIds) {
    try {
      await callForEntities(this._hass, service, entityIds);
    } catch (e) {
      console.error('ha-3d-dashboard:', e);
      this._toast(`Schalten fehlgeschlagen: ${e.message || e}`);
    }
  }

  // ------------------------------------------------------------------ Link-Check

  /** Einstellungsmenü öffnen bzw. schließen (schließt den Link-Check) */
  _toggleMenu(show = !this.menu.isOpen) {
    this._toggleLinks(false);
    if (!show) return this.menu.close();
    const canEdit = !this.hasAttribute('readonly');
    const we = this._weatherEntity(), ws = we && this._hass?.states?.[we];
    const weather = we ? `${we}${ws ? ` (${[weatherLabel(weatherKind(ws)), temperatureText(ws)].filter(Boolean).join(', ')})` : ''}` : '';
    this.menu.open({ canEdit, version: VERSION, source: this._source || '', quality: this.view?.quality, weather });
  }

  /** Ansichts-Einstellungen anwenden: Tageszeit (Sonne aus HA oder fest) und Qualität */
  _applyPrefs(prefs) {
    this.prefs = prefs;
    this._applyTheme();
    if (!this.view) return;
    this.view.setQuality?.(prefs.quality);
    this.setAttribute('quality', this.view.quality);
    this._applyWeather();
    this._applySky();
    this._applyMotion();
  }

  /** Animationen (global an/aus; Automatisch = aus bei „Bewegung reduzieren“) und Leistungsanzeige */
  _applyMotion() {
    const pref = this.prefs?.animations || 'auto';
    const on = pref === 'auto' ? !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches : pref === 'on';
    this.view?.setAnimations(on);
    this._applyFps();
  }

  /**
   * Aktivität animierter Objekte (Ventilator …): verknüpfte Entities (Demo-Modus: nur in HA vorhandene) oder der
   * im Editor feste Zustand. Nur Objekte, deren Modell eine Animation hat.
   */
  _applyActivity() {
    const d = this.view?.furnishingData;
    if (!d) return;
    const states = this._hass?.states || {};
    for (const e of [...d.items, ...d.devices]) {
      if (!CATALOG[e.kind || e.model]?.anim) continue;
      // Schalt-Entities, sonst Anzeige-Werte (Leistung eines Balkonkraftwerks)
      const power = this._live(roleEntities(e, 'power'));
      const ents = power.length ? power : this._live(roleEntities(e, 'info'));
      this.view.setActivity(e.id, activityOf(ents.map((x) => states[x]), e.state, { peak: e.peak }));
    }
  }

  /** Leistungsanzeige (Einstellungen): Bilder/s, Rechenzeit je Bild, Zeichenaufrufe, Dreiecke – alle 0,5 s */
  _applyFps() {
    const el = this.shadowRoot.querySelector('.fps');
    const on = this.prefs?.fps === 'on';
    el.hidden = !on;
    clearInterval(this._fpsTimer);
    if (!on) return;
    let last = { t: performance.now(), frames: this.view?.frames || 0 };
    this._fpsTimer = setInterval(() => {
      const v = this.view;
      if (!v) return;
      const now = performance.now(), frames = v.frames || 0;
      const fps = ((frames - last.frames) * 1000) / (now - last.t);
      last = { t: now, frames };
      const info = v.renderer.info.render;
      el.innerHTML = `<b>${fps.toFixed(fps < 10 ? 1 : 0)}</b> Bilder/s${fps < 0.5 ? ' <small>(Ruhe)</small>' : ''}<br>`
        + `${(v.frameMs || 0).toFixed(1)} ms je Bild · ${v.quality === 'low' ? 'Sparsam' : 'Hoch'}<br>`
        + `${info.calls} Zeichenaufrufe · ${Math.round(info.triangles / 1000)}k Dreiecke<br>`
        + `${v._runningAnims().length} Animationen`;
    }, 500);
  }

  /**
   * Darstellung der Bedienelemente (Glas hell/dunkel): fest oder wie Home Assistant (hass.themes.darkMode), ohne HA
   * wie das System.
   */
  _applyTheme() {
    const pref = this.prefs?.theme || 'auto';
    const dark = pref === 'auto'
      ? this._hass?.themes?.darkMode ?? window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
      : pref === 'dark';
    this.setAttribute('theme', dark ? 'dark' : 'light');
  }

  /** Wetter-Entity: site.weather im Modell oder automatisch (weather.home, sonst die erste) */
  _weatherEntity() {
    return pickWeatherEntity(this._hass?.states, this.model?.site?.weather);
  }

  /** Wetter in die Szene und die Anzeige: aus HA oder fest (Einstellungsmenü, zum Testen) */
  _applyWeather() {
    if (!this.view) return;
    const pref = this.prefs?.weather || 'auto';
    const id = this._weatherEntity();
    const st = id ? this._hass?.states?.[id] : null;
    const kind = pref === 'auto' ? weatherKind(st) : pref;
    const params = pref === 'auto' ? weatherParams(st) : WEATHER_PRESETS[pref];
    this.view.setWeather(params);
    // Niederschlag als Bildschirm-Effekt; Anzeige oben mit Symbol und Temperatur
    const precip = params?.snow > 0.4 ? 'snow' : params?.rain > 0.3 ? 'rain' : null;
    if (precip) this.setAttribute('precip', precip);
    else this.removeAttribute('precip');
    const el = this.shadowRoot.querySelector('.weather');
    el.hidden = !kind;
    if (!kind) return;
    // Nacht: Tageszeit-Schalter, sonst die Sonne aus HA (sun.sun) bzw. „clear-night“ der Wetter-Entity
    const dt = this.prefs?.daytime;
    const night = dt === 'night' || (dt !== 'day' && (st?.state === 'clear-night' || this._hass?.states?.['sun.sun']?.state === 'below_horizon'));
    const html = `${weatherIcon(kind, night)}<span>${pref === 'auto' ? temperatureText(st) || weatherLabel(kind) : `${weatherLabel(kind)} (Test)`}</span>`;
    if (html !== this._weatherHtml) {
      this._weatherHtml = html;
      el.innerHTML = html;
      el.setAttribute('aria-label', `Wetter: ${weatherLabel(kind)}`);
    }
  }

  /** Sonnenstand: aus sun.sun – oder fest Tag/Nacht (Einstellungsmenü, zum Testen und für Wand-Tablets) */
  _applySky() {
    const a = this._hass?.states?.['sun.sun']?.attributes;
    const real = a && Number.isFinite(a.elevation) ? { azimuth: a.azimuth, elevation: a.elevation } : null;
    const dt = this.prefs?.daytime;
    // fest: Sonne im Süden (bzw. am wirklichen Azimut, wenn sie gerade scheint), Mond nachts
    if (dt === 'day') this.view.setSky({ azimuth: real && real.elevation > 5 ? real.azimuth : 200, elevation: 38 });
    else if (dt === 'night') this.view.setSky({ azimuth: real?.azimuth ?? 330, elevation: -25 });
    else this.view.setSky(real);
    this.toggleAttribute('day', this.view.daylight > 0.5);
  }

  _toggleLinks(show = !this.shadowRoot.querySelector('.links').classList.contains('show')) {
    if (show) this.menu?.close();
    this.shadowRoot.querySelector('.links').classList.toggle('show', show);
    if (show) this._renderLinks();
  }

  /** Alle Geräte mit ihrem Verknüpfungsstatus und HA-Lichter, die noch keinem Gerät zugeordnet sind. */
  _renderLinks() {
    // Version und Datenquelle: zeigt, ob der Browser das neue Bundle hat und woher das Modell kommt
    this.shadowRoot.querySelector('.links .about').textContent = `Version ${VERSION} · ${this._source || ''}`;
    const states = this._hass?.states || {};
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const devices = this.view?.furnishingData?.devices || [];
    const used = new Set(devices.flatMap(entitiesOf));
    const rows = [];
    let missing = 0, unlinked = 0;
    for (const d of devices) {
      const ents = entitiesOf(d);
      if (!ents.length) {
        unlinked++;
        rows.push(`<li class="none"><span class="dot"></span><b>${esc(d.name || d.id)}</b><small>${esc(d.room)} · keine Entity</small></li>`);
        continue;
      }
      for (const e of ents) {
        const st = states[e];
        if (!st) missing++;
        const cls = !st ? 'bad' : st.state === 'unavailable' ? 'warn' : 'ok';
        rows.push(`<li class="${cls}"><span class="dot"></span><b>${esc(d.name || d.id)}</b><small>${esc(e)} · ${st ? esc(st.state) : 'fehlt in HA'}</small></li>`);
      }
    }
    // HA-Lichter ohne Zuordnung (mit Bereich, wenn die Registry ihn kennt)
    const areas = this._hass?.areas || {};
    const reg = this._hass?.entities || {};
    const free = Object.keys(states).filter((e) => e.startsWith('light.') && !used.has(e)).map((e) => {
      const area = areas[reg[e]?.area_id]?.name || '';
      return { e, area, name: states[e].attributes?.friendly_name || e };
    }).sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
    const freeRows = free.map((f) => `<li class="free"><span class="dot"></span><b>${esc(f.name)}</b><small>${esc(f.e)}${f.area ? ` · ${esc(f.area)}` : ''}</small></li>`);
    const root = this.shadowRoot.querySelector('.links');
    root.querySelector('.summary').textContent =
      `${devices.length} Geräte · ${missing} fehlende Entities · ${unlinked} ohne Entity · ${free.length} HA-Lichter ohne Zuordnung`;
    root.querySelector('ul.devices').innerHTML = rows.join('');
    root.querySelector('ul.free').innerHTML = freeRows.join('') || '<li class="none"><small>keine</small></li>';
  }

  _toast(text) {
    const t = this.shadowRoot.querySelector('.toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 1400);
  }

  // --- Test-Schnittstelle ---
  whenReady() {
    return this._ready;
  }
}

if (!customElements.get('ha-3d-dashboard')) customElements.define('ha-3d-dashboard', Ha3dDashboard);
