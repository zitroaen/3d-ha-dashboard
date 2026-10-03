// Custom Panel <ha-3d-dashboard> für Home Assistant (panel_custom).
// HA setzt die Properties hass, narrow, route und panel. Keine Tokens, keine externen Requests.
// Das Modell (model.yaml, docs/DATA_MODEL.md) wird zur Laufzeit geladen – standardmäßig aus
// demselben Ordner wie dieses Skript, oder aus panel_custom → config → data_url.
import { HouseScene } from './scene.js';
import { loadData, DataUnavailableError } from './data.js';
import { loadDemoData } from './demo.js';
import { Editor } from './editor.js';
import { LayoutStore, DEMO_USER_DATA_KEY, MODEL_FILE, applyOverrides, download } from './store.js';
import { toScene, writeBack } from './model/model.js';
import { toYaml, yamlHeader } from './model/yaml.js';
import { entitiesOf, lampLight, callForEntities } from './ha.js';
import { EntityPicker, areaForRoom } from './picker.js';

const ICON = {"edit": "M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z", "move": "M13 6v5h5V7.75L22.25 12 18 16.25V13h-5v5h3.25L12 22.25 7.75 18H11v-5H6v3.25L1.75 12 6 7.75V11h5V6H7.75L12 1.75 16.25 6H13z", "align": "M3 2h2v20H3V2zm4 5h14v4H7V7zm0 6h9v4H7v-4z", "undo": "M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A8 8 0 0 1 20.1 16l2.37-.78A10.5 10.5 0 0 0 12.5 8z", "save": "M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z", "export": "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z", "done": "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"};
ICON.link = 'M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z';
ICON.plug = 'M16 7V3h-2v4h-4V3H8v4h-.01C6.9 7 6 7.9 6 8.99v5.49L9.5 18v3h5v-3l3.5-3.51v-5.5C18 7.89 17.1 7 16 7z';
ICON.close = 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';
const icon = (name) => `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="${ICON[name]}"/></svg>`;

const MODULE_BASE = new URL('./', import.meta.url);

const STYLE = `
:host { display: block; position: relative; width: 100%; height: 100%; background: #07090d; overflow: hidden;
  /* Ab HA 2026.9 hat der Panel-Container keine Höhe mehr (height: 100% ergäbe 0). Das Panel reicht deshalb bis zum
     unteren Bildschirmrand: --ha3d-fit-height misst _fitHeight() (in der iOS-App beginnt das Panel unter der
     Statusleiste, 100dvh wäre dort zu hoch). */
  min-height: var(--ha3d-fit-height, 100dvh);
  font-family: var(--paper-font-body1_-_font-family, 'Segoe UI', Roboto, sans-serif); color: #e8e2d8;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; touch-action: none; }
button { touch-action: manipulation; }
#stage { position: absolute; inset: 0; }
.vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 50%, transparent 55%, #000a 100%); transition: opacity 1s; }
:host([day]) .vignette { opacity: 0.35; }
.bar { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  pointer-events: none; background: linear-gradient(#07090dcc, #07090d00); }
.bar > * { pointer-events: auto; }
.title { font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.85; }
.floor { font-size: 13px; opacity: 0.55; }
/* Ebenen (Stockwerke): unten links (im Editor über der Werkzeugleiste), obere Ebenen oben; nur bei mehr als einer
   Ebene. Touch-Ziele 48 px */
.levels { position: absolute; left: 12px; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 8px; }
:host([editing]) .levels { bottom: calc(var(--ha3d-editbar-h, 136px) + 24px + env(safe-area-inset-bottom, 0px)); }
.levels[hidden] { display: none; }
.levels button { min-width: 48px; height: 48px; padding: 0 8px; border-radius: 24px; border: 1px solid #ffffff22; background: #12151bcc;
  color: #e8e2d8; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; backdrop-filter: blur(6px); }
.levels button.on { background: #f0b45a; color: #1a1408; border-color: #f0b45a; }
button.menu { display: none; width: 48px; height: 48px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
/* Kompass: zeigt, wo Norden im Bild liegt; antippen = einnorden. Touch-Ziel 56 px */
.compass { position: absolute; top: 10px; right: 12px; width: 56px; height: 56px; padding: 0; border-radius: 50%;
  border: 1px solid #ffffff22; background: #12151bcc; color: #e8e2d8; cursor: pointer; backdrop-filter: blur(6px); }
.compass:active { background: #1d222bdd; }
.compass svg { width: 100%; height: 100%; display: block; }
.compass .needle { transform-origin: 28px 28px; transition: transform .08s linear; }
/* Editiermodus: Stift unter dem Kompass, Werkzeugleiste unten (Touch-Ziele >= 56 px) */
.edit-toggle { position: absolute; top: 76px; right: 12px; width: 56px; height: 56px; border-radius: 50%;
  border: 1px solid #ffffff22; background: #12151bcc; color: #e8e2d8; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.links-toggle { position: absolute; top: 140px; right: 12px; width: 56px; height: 56px; border-radius: 50%;
  border: 1px solid #ffffff22; background: #12151bcc; color: #e8e2d8; cursor: pointer; display: flex; align-items: center; justify-content: center; }
/* Link-Check: Liste aller Geräte mit Verknüpfungsstatus */
.links { position: absolute; top: 10px; right: 80px; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); width: min(420px, calc(100% - 100px)); display: none; flex-direction: column;
  border-radius: 16px; background: #12151bf2; backdrop-filter: blur(8px); border: 1px solid #ffffff1a; overflow: hidden; }
.links.show { display: flex; }
.links header { display: flex; align-items: center; gap: 8px; padding: 10px 8px 6px 16px; }
.links header h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
.links header button { width: 48px; height: 48px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
.links .summary { padding: 0 16px 8px; font-size: 13px; opacity: 0.7; }
.links .body { overflow-y: auto; padding: 0 8px 12px; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
.links h3 { margin: 12px 8px 4px; font-size: 13px; font-weight: 600; opacity: 0.75; text-transform: uppercase; letter-spacing: .05em; }
.links ul { list-style: none; margin: 0; padding: 0; }
.links li { display: grid; grid-template-columns: 14px 1fr; column-gap: 8px; padding: 8px; border-radius: 10px; min-height: 40px; align-items: center; }
.links li b { font-weight: 500; font-size: 14px; }
.links li small { grid-column: 2; font-size: 12px; opacity: 0.6; word-break: break-all; }
.links .dot { width: 10px; height: 10px; border-radius: 50%; background: #777; grid-row: span 2; }
.links li.ok .dot { background: #6cc28a; } .links li.bad .dot { background: #e0624f; } .links li.warn .dot { background: #e0b04f; }
.links li.free .dot { background: transparent; border: 1.5px solid #9aa; }
/* Entity-Auswahl (Editor): Seitenleiste rechts, große Zeilen für Touch */
.picker { position: absolute; top: 10px; right: 80px; bottom: calc(var(--ha3d-editbar-h, 136px) + 24px + env(safe-area-inset-bottom, 0px)); width: min(440px, calc(100% - 100px)); display: none; flex-direction: column;
  border-radius: 16px; background: #12151bf5; backdrop-filter: blur(8px); border: 1px solid #ffffff1a; overflow: hidden; }
.picker.show { display: flex; }
.picker header { display: flex; align-items: center; padding: 8px 8px 4px 16px; }
.picker header h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
.picker header button, .picker .chip button { width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 18px; cursor: pointer; }
.picker .linked { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 12px 8px; }
.picker .search { margin: 0 12px 8px; height: 48px; padding: 0 14px; border-radius: 12px; border: 1px solid #ffffff26; background: #0b0d12;
  color: inherit; font: inherit; font-size: 16px; user-select: text; -webkit-user-select: text; }
.picker .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 8px; }
.picker .chip { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border-radius: 20px; border: 1px solid #ffffff26;
  background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.picker .chip.sel { background: #f0b45a; color: #1a1408; border-color: #f0b45a; }
.picker .chip.on { background: #2b3a30; border-color: #6cc28a; padding-right: 0; flex-wrap: wrap; }
.picker .chip.on small { font-size: 11px; opacity: 0.7; }
.picker .hint { font-size: 13px; opacity: 0.6; padding: 6px 4px; }
.picker .list { list-style: none; margin: 0; padding: 0 8px 12px; overflow-y: auto; touch-action: pan-y; -webkit-overflow-scrolling: touch; }
.picker .list button { width: 100%; min-height: 56px; display: grid; grid-template-columns: 1fr 32px; text-align: left; padding: 6px 10px; border: 0;
  border-radius: 10px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.picker .list button:active { background: #ffffff14; }
.picker .list button.linked { background: #2b3a30; }
.picker .list b { font-weight: 500; font-size: 14px; } .picker .list small { grid-column: 1; font-size: 12px; opacity: 0.6; word-break: break-all; }
.picker .list .mark { grid-column: 2; grid-row: 1 / span 2; align-self: center; font-size: 20px; text-align: center; color: #f0b45a; }
.picker .more { padding: 10px; font-size: 13px; opacity: 0.6; text-align: center; }
:host([editing]) .edit-toggle { background: #f0b45a; color: #1a1408; border-color: #f0b45a; }
/* volle Breite (mit left: 50% stünde nur die halbe Breite zur Verfügung und die Knöpfe brächen zu früh um);
   die leeren Ränder lassen Taps zur 3D-Ansicht durch */
.editbar { position: absolute; left: 12px; right: 12px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); display: none; flex-direction: column; align-items: center; gap: 8px;
  pointer-events: none; }
.editbar > * { pointer-events: auto; }
:host([editing]) .editbar { display: flex; }
:host([editing]) .toast { bottom: calc(var(--ha3d-editbar-h, 136px) + 24px + env(safe-area-inset-bottom, 0px)); }
.editinfo { padding: 7px 14px; border-radius: 14px; background: #12151be6; font-size: 14px; text-align: center; max-width: 100%; }
.editinfo b { color: #f0b45a; font-weight: 600; }
.tools { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; padding: 6px; border-radius: 18px; background: #12151be6;
  backdrop-filter: blur(8px); max-width: 100%; } /* schmale Bildschirme: zweite Zeile statt abgeschnittener Knöpfe */
.tools button { min-width: 64px; height: 60px; padding: 4px 8px; border: 0; border-radius: 12px; background: transparent; color: #e8e2d8;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font: inherit; font-size: 11px; cursor: pointer; }
.tools button:active { background: #ffffff1a; }
.tools button.active { background: #f0b45a; color: #1a1408; }
.tools button:disabled { opacity: 0.35; }
.tools button.dirty { color: #f0b45a; }
.tools button[hidden] { display: none; }
:host([narrow]) button.menu { display: inline-flex; align-items: center; justify-content: center; }
.toast { position: absolute; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); padding: 6px 14px; border-radius: 16px;
  background: #1a1c20d9; font-size: 13px; opacity: 0; transition: opacity .25s; pointer-events: none; }
.toast.show { opacity: 1; }
/* Demo-Hinweis: dezent oben links, antippen blendet ihn aus (Touch-Ziel >= 48 px) */
.demo-note { position: absolute; top: 56px; left: 12px; max-width: calc(100% - 100px); min-height: 48px; padding: 6px 14px; border-radius: 24px;
  border: 1px solid #ffffff22; background: #12151bcc; color: #e8e2d8; font: inherit; font-size: 13px; line-height: 1.3; text-align: left;
  cursor: pointer; backdrop-filter: blur(6px); display: none; }
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
      <div class="bar">
        <button class="menu" title="Menü"><svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg></button>
        <span class="title"></span><span class="floor"></span>
      </div>
      <div class="levels" hidden></div>
      <button class="compass" title="Ansicht einnorden" aria-label="Ansicht einnorden">
        <svg viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="22" fill="none" stroke="#ffffff1f" stroke-width="1"/>
          <g class="needle">
            <path d="M28 7 L33 28 L23 28 Z" fill="#d9573f"/>
            <path d="M28 49 L33 28 L23 28 Z" fill="#cfc8bb"/>
            <circle cx="28" cy="28" r="2.2" fill="#12151b"/>
            <text x="28" y="5.5" text-anchor="middle" font-size="7" font-weight="600" fill="#d9573f" font-family="inherit">N</text>
          </g>
        </svg>
      </button>
      <button class="edit-toggle" title="Bearbeiten" aria-label="Bearbeiten">${icon('edit')}</button>
      <button class="links-toggle" title="Link-Check" aria-label="Link-Check">${icon('link')}</button>
      <div class="links">
        <header><h2>Link-Check</h2><button class="links-close" aria-label="Schließen">${icon('close')}</button></header>
        <div class="summary"></div>
        <div class="body">
          <h3>Geräte im Modell</h3><ul class="devices"></ul>
          <h3>HA-Lichter ohne Zuordnung</h3><ul class="free"></ul>
        </div>
      </div>
      <div class="picker"></div>
      <div class="editbar">
        <div class="editinfo"></div>
        <div class="tools">
          <button data-act="move">${icon('move')}Verschieben</button>
          <button data-act="align">${icon('align')}Anlegen</button>
          <button data-act="link" hidden>${icon('plug')}Verknüpfen</button>
          <button data-act="undo">${icon('undo')}Rückgängig</button>
          <button data-act="export">${icon('export')}Export</button>
          <button data-act="cancel">${icon('close')}Abbrechen</button>
          <button data-act="done">${icon('done')}Fertig</button>
        </div>
      </div>
      <button class="demo-note" hidden aria-label="Hinweis ausblenden"></button>
      <div class="toast"></div>
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
    // Stift: Bearbeiten beginnen bzw. wie „Fertig“ beenden (speichert)
    this.shadowRoot.querySelector('.edit-toggle').addEventListener('click', () => (this.hasAttribute('editing') ? this.finishEditing() : this.setEditing(true)));
    this.shadowRoot.querySelector('.links-toggle').addEventListener('click', () => this._toggleLinks());
    this.shadowRoot.querySelector('.links-close').addEventListener('click', () => this._toggleLinks(false));
    this.shadowRoot.querySelector('.tools').addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act) this._editAction(act);
    });
    // Höhe der Werkzeugleiste (1 oder 2 Zeilen) für Lampenauswahl und Meldungen darüber
    new ResizeObserver(([e]) => e.contentRect.height && this.style.setProperty('--ha3d-editbar-h', `${Math.round(e.contentRect.height)}px`))
      .observe(this.shadowRoot.querySelector('.editbar'));
    this._ready = new Promise((res) => (this._resolveReady = res));
  }

  connectedCallback() {
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
    document.removeEventListener('visibilitychange', this._onVisible);
    window.removeEventListener('resize', this._onResize);
    window.visualViewport?.removeEventListener('resize', this._onResize);
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

  /** Demo-Modus aktiv (config.demo oder Fallback ohne erreichbare Daten): lokal schalten, nichts speichern */
  get demo() {
    return this.hasAttribute('demo');
  }

  _setDemo(on, note = '') {
    this.toggleAttribute('demo', on);
    const el = this.shadowRoot.querySelector('.demo-note');
    el.innerHTML = on ? `Demo-Haus – eigene Daten: siehe Anleitung${note ? `<small>${note}</small>` : ''}` : '';
    el.hidden = !on;
  }

  /** Daten laden: eingebettetes Demo-Haus (config.demo) oder aus data_url bzw. neben dem Modul, sonst Demo-Fallback */
  async _fetchData() {
    if (this._panel?.config?.demo === true) {
      this._setDemo(true);
      return loadDemoData();
    }
    try {
      const data = await loadData(this.dataUrl);
      this._setDemo(false);
      return data;
    } catch (e) {
      // nur bei unerreichbaren Daten (404, Netzwerk) und nur, solange noch nichts angezeigt wird;
      // kaputte eigene Daten bleiben ein Fehler und werden nie durch das Demo-Haus ersetzt
      if (!(e instanceof DataUnavailableError) || (this.view && !this.demo)) throw e;
      console.warn('ha-3d-dashboard: Daten nicht erreichbar, zeige Demo-Haus –', e.message);
      this._setDemo(true, this._panel?.config?.data_url ? `keine Daten unter ${this._panel.config.data_url}` : 'keine Daten neben dem Modul');
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
    return new LayoutStore({ saveUrl: this._panel?.config?.save_url || null, hass: this._hass });
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
      onLampTap: (id) => this._onLampTap(id),
      onLampHold: (id) => this._onLampHold(id),
      onViewChange: () => this._updateCompass(),
    });
    this._updateCompass();
    this.areaMap = data.areaMap || {};
    this.editor = new Editor(this.view, {
      onChange: (info) => this._renderEditBar(info),
      // neue Verknüpfung: Zustand der Leuchte sofort aus HA übernehmen
      onLinkChange: (id) => {
        // Verknüpfung gelöst -> Leuchte aus; sonst Zustand sofort aus HA übernehmen
        const s = this.view.lamps.get(id);
        if (s && !entitiesOf(s.lamp).length) this.view.setLamp(id, false);
        else if (this._hass) this._applyHass();
      },
    });
    this.picker ??= new EntityPicker(this.shadowRoot.querySelector('.picker'), {
      onChange: (ent) => this.editor?.setEntity(ent),
      onClose: () => this.editor?._emit(),
    });
    if (this.hasAttribute('editing')) this.editor.setEnabled(true);
    this.shadowRoot.querySelector('.title').textContent = data.house.name || '';
    this._renderLevel();
    if (this._hass) this._applyHass();
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
    this._leaveEditing();
    if (!discard) return;
    ed.changes.clear();
    this._keys = null; // Daten neu laden = Stand vor den Änderungen
    this.reloadData();
    this._toast('Änderungen verworfen');
  }

  _leaveEditing() {
    this.picker?.close();
    this.toggleAttribute('editing', false);
    this.editor.setEnabled(false);
  }

  /** Änderungen speichern (Dev-Server: Dateien; HA: Benutzerdaten; Demo-Haus: eigene Demo-Benutzerdaten). */
  async _save() {
    const ed = this.editor;
    try {
      // Änderungen ins Modell übernehmen und das Modell speichern
      for (const { type, id } of ed.changes.values()) writeBack(type, ed._entry({ type, id }));
      await this.store.save(this.model, [...ed.changes.values()].map((c) => c.id), this._modelHeader);
      this._keys = { ...this._keys, objects: JSON.stringify(this.model.objects) };
      ed.changes.clear();
      ed._emit();
      this._toast(this.demo ? 'Gespeichert – Demo-Haus, für diesen HA-Benutzer'
        : this.store.mode === 'files' ? 'Gespeichert (model.yaml)' : 'Gespeichert – gilt für diesen HA-Benutzer, Export für die Datei');
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
    else if (act === 'link') this._openPicker();
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

  /** Entity-Auswahl für die gewählte Leuchte öffnen, vorgefiltert auf den HA-Bereich ihres Raums. */
  _openPicker() {
    const s = this.editor?.sel;
    if (!s || s.type !== 'lamp') return;
    const fm = this.view.floors.find((f) => f.floor.id === s.entry.floor);
    const room = fm?.rooms.get(s.entry.room)?.room;
    const area = room ? areaForRoom(this._hass, s.entry.floor, room, this.areaMap) : null;
    const usedBy = new Map();
    for (const d of this.view.furnishingData.devices) {
      if (d.id !== s.id) for (const e of entitiesOf(d)) usedBy.set(e, d.name || d.id);
    }
    this.picker.open({ hass: this._hass, device: s.entry, area, usedBy });
    this.editor._emit();
  }

  _renderEditBar(info) {
    // Auswahl gewechselt -> Entity-Auswahl schließen
    if (this.picker?.isOpen && info.selection?.id !== this.picker.device?.id) this.picker.close();
    if (!info.enabled) this.picker?.close();
    const root = this.shadowRoot;
    for (const b of root.querySelectorAll('.tools button')) {
      const act = b.dataset.act;
      b.classList.toggle('active', act === info.tool);
      if (act === 'undo') b.disabled = !info.canUndo;
      if (act === 'done') b.classList.toggle('dirty', info.dirty);
      if (act === 'export') b.hidden = this.demo || this.store.mode === 'files';
      if (act === 'link') {
        b.hidden = info.selection?.type !== 'lamp';
        b.classList.toggle('active', !!this.picker?.isOpen);
      }
    }
    const s = info.selection;
    const FACE = { back: 'Rückseite', front: 'Vorderseite', left: 'linke Seite', right: 'rechte Seite', bottom: 'Unterseite' };
    let text;
    if (!s) text = this.demo ? 'Möbel oder Leuchte antippen (Demo-Haus)' : 'Möbel oder Leuchte antippen';
    else {
      const y = s.height ?? s.elevation;
      text = `<b>${s.name}</b> · x ${s.pos[0].toFixed(2)} · y ${s.pos[1].toFixed(2)}${y != null ? ` · Höhe ${y.toFixed(2)}` : ''} · ${(s.rot || 0).toFixed(0)}°`;
      if (s.type === 'lamp') {
        const n = s.entity == null ? 0 : [].concat(s.entity).length;
        text += ` · ${n ? `${n} Entit${n === 1 ? 'y' : 'ies'} verknüpft` : 'nicht verknüpft'}`;
      }
      if (info.tool === 'align') text += `<br>Anlegen mit <b>${FACE[info.alignFace]}</b> – andere Fläche am Objekt antippen oder Wand/Boden antippen`;
    }
    root.querySelector('.editinfo').innerHTML = text;
  }

  _updateCompass() {
    const deg = this.view?.northScreenAngle() ?? 0;
    this.shadowRoot.querySelector('.compass .needle').style.transform = `rotate(${deg.toFixed(1)}deg)`;
  }

  _showError(text) {
    const el = this.shadowRoot.querySelector('.error');
    el.textContent = text || '';
    el.classList.toggle('show', !!text);
  }

  set hass(hass) {
    this._hass = hass;
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
    const sun = states['sun.sun'];
    const a = sun?.attributes;
    this.view.setSky(a && Number.isFinite(a.elevation) ? { azimuth: a.azimuth, elevation: a.elevation } : null);
    this.toggleAttribute('day', this.view.daylight > 0.5);

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
    if (this.shadowRoot.querySelector('.links.show')) this._renderLinks();
  }

  /**
   * Entities einer Leuchte, die HA schaltet. Im Demo-Modus nur solche, die es in HA wirklich gibt (eine im Editor
   * verknüpfte echte Lampe); ohne HA-Verbindung keine.
   */
  _liveEntities(lamp) {
    if (!this._hass) return [];
    const ents = entitiesOf(lamp);
    return this.demo ? ents.filter((e) => e in (this._hass.states || {})) : ents;
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

  /**
   * Leuchte lange drücken: HA-eigenen Dialog der verknüpften Entity öffnen (Farbe, Helligkeit, Verlauf …).
   * Bei mehreren Entities (z. B. drei Spots) die erste.
   */
  _onLampHold(lampId) {
    const s = this.view.lamps.get(lampId);
    const [entityId] = this._liveEntities(s.lamp);
    if (!entityId) return this._toast(`${s.lamp.name ?? lampId}: nicht mit HA verknüpft – im Editor (Stift) verknüpfen`);
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
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

  _toggleLinks(show = !this.shadowRoot.querySelector('.links').classList.contains('show')) {
    this.shadowRoot.querySelector('.links').classList.toggle('show', show);
    if (show) this._renderLinks();
  }

  /** Alle Geräte mit ihrem Verknüpfungsstatus und HA-Lichter, die noch keinem Gerät zugeordnet sind. */
  _renderLinks() {
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
