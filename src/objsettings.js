// Einstellungen eines Objekts im Editor (docs/DATA_MODEL.md → ha): Entities nach Rolle (Schalten, Anzeigen), was
// Antippen, Doppeltippen und langes Drücken tun, und ob der Zustand über dem Objekt angezeigt wird.
// Entities wählt die Entity-Auswahl (picker.js); dieser Bildschirm hält nur die Übersicht.
import { GESTURES, defaultAction, normAction, roleEntities, showsBadge } from './model/model.js';

export const ROLE_LABEL = { power: 'Schalten', info: 'Anzeigen' };
const ROLE_HINT = {
  power: 'An/Aus (Licht, Steckdose, Gerät). Mehrere: an, sobald eine an ist; Schalten betrifft alle.',
  info: 'Werte zur Anzeige, z. B. Leistung, Restzeit, Zustand.',
};
const GESTURE_LABEL = { tap: 'Antippen', double_tap: 'Doppeltippen', hold: 'Lange drücken' };
const ACTION_LABEL = { toggle: 'Umschalten', 'more-info': 'HA-Dialog', service: 'Dienst aufrufen', navigate: 'Seite öffnen', none: 'Nichts' };

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class ObjectSettings {
  /**
   * @param root      Container im Shadow-DOM
   * @param onChange  (ha) => void – neue HA-Einstellungen des Objekts
   * @param onPick    (role) => void – Entity-Auswahl für eine Rolle öffnen
   */
  constructor(root, { onChange, onPick, onClose } = {}) {
    this.root = root;
    this.onChange = onChange;
    this.onPick = onPick;
    this.onClose = onClose;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const { act, role, id } = b.dataset;
      if (act === 'close') this.close();
      if (act === 'pick') this.onPick?.(role);
      if (act === 'remove') this._setRole(role, roleEntities(this.entry, role).filter((x) => x !== id));
    });
    root.addEventListener('change', (e) => {
      const g = e.target.closest('[data-g]')?.dataset.g;
      if (g) this._setGesture(g);
      if (e.target.dataset.badge != null) this._setBadge(e.target.value);
    });
  }

  /**
   * @param entry  Objekt (interne Kopie aus der Szene, mit `ha`)
   * @param light  Objekt kann leuchten (Standardaktionen wie bei Leuchten)
   */
  open({ entry, light, hass }) {
    this.entry = entry;
    this.light = light;
    this.hass = hass;
    this.root.classList.add('show');
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('show');
    this.onClose?.();
  }

  get isOpen() {
    return this.root.classList.contains('show');
  }

  get ha() {
    return structuredClone(this.entry.ha || {});
  }

  _setRole(role, list) {
    const ha = this.ha;
    ha.entities = { ...(ha.entities || {}), [role]: list.length ? (list.length === 1 ? list[0] : list) : undefined };
    this.onChange?.(ha);
  }

  _setGesture(g) {
    const row = this.root.querySelector(`[data-g="${g}"]`);
    const val = (sel) => row.querySelector(sel)?.value.trim() || '';
    const action = val('select');
    const ha = this.ha;
    if (!action) delete ha[g];
    else {
      const a = { action };
      if (action === 'service') a.service = val('[name=service]');
      if (action === 'navigate') a.path = val('[name=path]');
      if (action === 'more-info' && val('[name=entity]')) a.entity = val('[name=entity]');
      if (action !== 'none' && val('[name=confirm]')) a.confirm = val('[name=confirm]');
      // Kurzform, wenn nichts weiter angegeben ist
      ha[g] = Object.keys(a).length === 1 && action !== 'service' && action !== 'navigate' ? action : a;
    }
    this.onChange?.(ha);
  }

  _setBadge(v) {
    const ha = this.ha;
    if (v === '') delete ha.badge;
    else ha.badge = v === 'true';
    this.onChange?.(ha);
  }

  /** Nach jeder Änderung (auch Rückgängig) neu zeichnen */
  render() {
    if (!this.isOpen) return;
    const e = this.entry;
    const st = this.hass?.states || {};
    const roles = Object.keys(ROLE_LABEL).map((role) => {
      const ents = roleEntities(e, role);
      const chips = ents.map((id) => `<span class="chip on">${esc(st[id]?.attributes?.friendly_name || id)}<small>${esc(id)}${
        st[id] ? ` · ${esc(st[id].state)}` : ' · fehlt in HA'}</small><button data-act="remove" data-role="${role}" data-id="${esc(id)}" aria-label="Verknüpfung lösen">✕</button></span>`).join('');
      return `<section><h3>${ROLE_LABEL[role]}</h3><p class="hint">${ROLE_HINT[role]}</p>
        <div class="linked">${chips}<button class="add" data-act="pick" data-role="${role}">+ Entity</button></div></section>`;
    }).join('');
    const gestures = GESTURES.map((g) => {
      const a = normAction(e.ha?.[g]);
      const def = defaultAction(e, g, this.light);
      const opts = [`<option value="">Standard (${ACTION_LABEL[def.action]})</option>`]
        .concat(Object.entries(ACTION_LABEL).map(([k, l]) => `<option value="${k}" ${a?.action === k ? 'selected' : ''}>${l}</option>`)).join('');
      const extra = [];
      if (a?.action === 'service') extra.push(`<input name="service" placeholder="Dienst, z. B. script.kamin_an" value="${esc(a.service)}" autocomplete="off" spellcheck="false">`);
      if (a?.action === 'navigate') extra.push(`<input name="path" placeholder="Seite, z. B. /lovelace/energie" value="${esc(a.path)}" autocomplete="off" spellcheck="false">`);
      if (a?.action === 'more-info') extra.push(`<input name="entity" placeholder="Entity (leer = erste verknüpfte)" value="${esc(a.entity)}" autocomplete="off" spellcheck="false">`);
      if (a && a.action !== 'none') extra.push(`<input name="confirm" placeholder="Rückfrage vorher (leer = keine)" value="${esc(a.confirm)}" autocomplete="off">`);
      return `<div class="gesture" data-g="${g}"><label>${GESTURE_LABEL[g]}<select aria-label="${GESTURE_LABEL[g]}">${opts}</select></label>${extra.join('')}</div>`;
    }).join('');
    const badge = e.ha?.badge;
    this.root.innerHTML = `
      <header><h2>${esc(e.name || e.id)}</h2><button data-act="close" aria-label="Schließen">✕</button></header>
      <div class="body">
        ${roles}
        <section><h3>Gesten</h3>${gestures}</section>
        <section><h3>Zustand über dem Objekt</h3>
          <select data-badge aria-label="Zustand anzeigen">
            <option value="" ${badge == null ? 'selected' : ''}>Automatisch (${showsBadge({ ha: { ...e.ha, badge: undefined } }, this.light) ? 'anzeigen' : 'nicht anzeigen'})</option>
            <option value="true" ${badge === true ? 'selected' : ''}>Anzeigen</option>
            <option value="false" ${badge === false ? 'selected' : ''}>Nicht anzeigen</option>
          </select></section>
      </div>`;
  }
}
