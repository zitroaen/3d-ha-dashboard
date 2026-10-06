// Einstellungen eines Objekts im Editor (docs/DATA_MODEL.md → ha): Entities nach Rolle (Schalten, Anzeigen), was
// Antippen, Doppeltippen und langes Drücken tun, und ob der Zustand über dem Objekt angezeigt wird.
// Entities wählt die Entity-Auswahl (picker.js); dieser Bildschirm hält nur die Übersicht.
import { GESTURES, defaultAction, normAction, roleEntities, showsBadge, badgeSpec, playerSpec } from './model/model.js';

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
  constructor(root, { onChange, onPick, onClose, onState } = {}) {
    this.root = root;
    this.onChange = onChange;
    this.onState = onState;
    this.onPick = onPick;
    this.onClose = onClose;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const { act, role, id } = b.dataset;
      if (act === 'close') this.close();
      if (act === 'pick') this.onPick?.(role);
      if (act === 'remove') this._setRole(role, roleEntities(this.entry, role).filter((x) => x !== id));
      if (act === 'state') this.onState?.(b.dataset.value === 'off' ? undefined : b.dataset.value);
    });
    root.addEventListener('change', (e) => {
      const g = e.target.closest('[data-g]')?.dataset.g;
      if (g) this._setGesture(g);
      if (e.target.closest('[data-badge-sec]')) this._setBadge();
      if (e.target.dataset.player != null) this._setPlayer(e.target.value);
    });
  }

  /**
   * @param entry  Objekt (interne Kopie aus der Szene, mit `ha`)
   * @param light  Objekt kann leuchten (Standardaktionen wie bei Leuchten)
   * @param anim   Modell hat eine Animation (fester Zustand ohne Entity einstellbar)
   */
  open({ entry, light, hass, anim = false }) {
    this.entry = entry;
    this.light = light;
    this.anim = anim;
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

  /** Zustandsanzeige aus den Bedienelementen: Kurzform true/false, sonst { show, entities, when } */
  _setBadge() {
    const sec = this.root.querySelector('[data-badge-sec]');
    const v = sec.querySelector('[data-badge]').value;
    const entities = [...sec.querySelectorAll('input[data-show]:checked')].map((c) => c.value);
    const all = [...sec.querySelectorAll('input[data-show]')].map((c) => c.value);
    const op = sec.querySelector('[data-when-op]')?.value || '';
    const val = sec.querySelector('[data-when-val]')?.value.trim() ?? '';
    const ent = sec.querySelector('[data-when-entity]')?.value || '';
    const ha = this.ha;
    const out = {};
    if (v !== '') out.show = v === 'true';
    // nur eine echte Auswahl speichern (alle info-Entities angehakt = Standard)
    const info = roleEntities(this.entry, 'info');
    const isDefault = entities.length === info.length && entities.every((x) => info.includes(x));
    if (all.length && !isDefault) out.entities = entities;
    if (op) {
      const when = {};
      if (ent) when.entity = ent;
      if (op === 'state' || op === 'not_state') when[op] = val.includes(',') ? val.split(',').map((x) => x.trim()).filter(Boolean) : val;
      else when[op] = Number(val.replace(',', '.')) || 0;
      out.when = when;
    }
    if (!Object.keys(out).length) delete ha.badge;
    else if (Object.keys(out).length === 1 && 'show' in out) ha.badge = out.show;
    else ha.badge = out;
    this.onChange?.(ha);
  }

  _setPlayer(v) {
    const ha = this.ha;
    if (v === '') delete ha.player;
    else ha.player = v === 'true';
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
    // Animation ohne Entity: fester Zustand (z. B. Ventilator dreht sich immer)
    const linked = roleEntities(e, 'power').length > 0;
    const stateSec = this.anim ? `<section><h3>Animation</h3>
      <p class="hint">${linked ? 'Folgt der verknüpften Entity (an = bewegt sich). Ohne Entity gilt:' : 'Keine Entity verknüpft – fester Zustand:'}</p>
      <div class="seg" role="group">${[['off', 'Steht still'], ['on', 'Läuft immer']].map(([v, l]) => {
        const on = (e.state === 'on') === (v === 'on');
        return `<button data-act="state" data-value="${v}" class="${on ? 'on' : ''}" aria-pressed="${on}">${l}</button>`;
      }).join('')}</div></section>` : '';
    this.root.innerHTML = `
      <header><h2>${esc(e.name || e.id)}</h2><button data-act="close" aria-label="Schließen">✕</button></header>
      <div class="body">
        ${roles}
        ${stateSec}
        <section><h3>Gesten</h3>${gestures}</section>
        ${this._badgeSection(e, st)}
      </div>`;
  }

  /** Zustand über dem Objekt: anzeigen ja/nein, welche Werte, unter welcher Bedingung; Medienplayer */
  _badgeSection(e, st) {
    const spec = badgeSpec(e);
    const linked = [...roleEntities(e, 'power'), ...roleEntities(e, 'info')];
    const shown = spec.entities ?? roleEntities(e, 'info');
    const name = (id) => st[id]?.attributes?.friendly_name || id;
    const checks = linked.length ? `<p class="hint">Welche Werte? (ohne Haken: Zustand der Schalt-Entity, z. B. An/Aus)</p>
      <div class="checks">${linked.map((id) => `<label class="check"><input type="checkbox" data-show value="${esc(id)}" ${shown.includes(id) ? 'checked' : ''}>
        <span>${esc(name(id))}<small>${esc(id)}${st[id] ? ` · ${esc(st[id].state)}` : ''}</small></span></label>`).join('')}</div>` : '';
    const w = spec.when || {};
    const op = ['state', 'not_state', 'above', 'below'].find((k) => w[k] != null) || '';
    const val = op ? [].concat(w[op]).join(', ') : '';
    const ops = [['', 'Immer'], ['state', 'Zustand ist'], ['not_state', 'Zustand ist nicht'], ['above', 'Wert größer als'], ['below', 'Wert kleiner als']]
      .map(([k, l]) => `<option value="${k}" ${op === k ? 'selected' : ''}>${l}</option>`).join('');
    const when = linked.length ? `<label>Nur anzeigen, wenn<select data-when-op aria-label="Bedingung">${ops}</select></label>
      ${op ? `<div class="when"><select data-when-entity aria-label="Entity der Bedingung"><option value="">erste angezeigte Entity</option>${
        linked.map((id) => `<option value="${esc(id)}" ${w.entity === id ? 'selected' : ''}>${esc(name(id))}</option>`).join('')}</select>
        <input data-when-val placeholder="${op === 'above' || op === 'below' ? 'Zahl, z. B. 25' : 'z. B. playing, on, cleaning'}" value="${esc(val)}" autocomplete="off" spellcheck="false"></div>` : ''}` : '';
    const auto = showsBadge({ ha: { ...e.ha, badge: undefined } }, this.light) ? 'anzeigen' : 'nicht anzeigen';
    const pl = linked.some((id) => id.startsWith('media_player.')) ? `<section><h3>Medienplayer</h3>
      <p class="hint">Kleiner Player über dem Objekt (Titel, Zurück, Pause, Weiter), solange Musik spielt.</p>
      <select data-player aria-label="Medienplayer"><option value="" ${e.ha?.player == null ? 'selected' : ''}>Automatisch (${playerSpec(e) ? 'an' : 'aus'})</option>
        <option value="true" ${e.ha?.player === true ? 'selected' : ''}>Anzeigen, wenn Musik spielt</option>
        <option value="false" ${e.ha?.player === false ? 'selected' : ''}>Nicht anzeigen</option></select></section>` : '';
    return `<section data-badge-sec><h3>Zustand über dem Objekt</h3>
      <select data-badge aria-label="Zustand anzeigen">
        <option value="" ${spec.show == null ? 'selected' : ''}>Automatisch (${auto})</option>
        <option value="true" ${spec.show === true ? 'selected' : ''}>Anzeigen</option>
        <option value="false" ${spec.show === false ? 'selected' : ''}>Nicht anzeigen</option>
      </select>${spec.show === false ? '' : checks + when}</section>${pl}`;
  }
}
