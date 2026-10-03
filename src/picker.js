// Entity-Auswahl im Editor: alle aktuell in Home Assistant vorhandenen Entities (live aus hass), mit Suche,
// vorgefiltert auf den HA-Bereich des Raums, in dem das Gerät steht. Bereich einer Entity = eigener Bereich
// oder der ihres Geräts (Entity-/Geräte-Registry aus hass.entities / hass.devices / hass.areas).

/** Namen vergleichbar machen: "Küche" ~ "kueche", "Bad EG" ~ "bad_eg" */
export const normName = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');

/**
 * HA-Bereich zu einem Raum des Modells.
 * @param areaMap  Bereich -> HA-Bereich aus dem Modell (ha_area) – { bad: "bad_eg", ... } (area_id), hat Vorrang
 */
export function areaForRoom(hass, floorId, room, areaMap = {}) {
  const areas = hass?.areas || {};
  const explicit = areaMap[`${floorId}/${room.id}`] ?? areaMap[room.id];
  if (explicit && areas[explicit]) return areas[explicit];
  const want = [normName(room.name), normName(room.id)];
  return Object.values(areas).find((a) => want.includes(normName(a.name)) || want.includes(normName(a.area_id))) || null;
}

/** Alle Entities mit Name, Bereich, Zustand – ohne versteckte und Diagnose-/Konfigurations-Entities. */
export function listEntities(hass) {
  const states = hass?.states || {};
  const reg = hass?.entities || {};
  const devs = hass?.devices || {};
  const areas = hass?.areas || {};
  const out = [];
  for (const [id, st] of Object.entries(states)) {
    const r = reg[id];
    if (r?.hidden || r?.entity_category) continue;
    const areaId = r?.area_id || devs[r?.device_id]?.area_id || null;
    out.push({
      id,
      domain: id.split('.')[0],
      name: st.attributes?.friendly_name || id,
      state: st.state,
      areaId,
      areaName: areas[areaId]?.name || '',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// Filter der Liste; Steckdosen (und andere Schalter) sind in HA switch.*
const DOMAINS = [
  { key: 'light', label: 'Licht', match: (d) => d === 'light' },
  { key: 'switch', label: 'Steckdosen', match: (d) => d === 'switch' },
  { key: 'sensor', label: 'Sensoren', match: (d) => d === 'sensor' || d === 'binary_sensor' },
  { key: 'all', label: 'Alle', match: () => true },
];

export class EntityPicker {
  /**
   * @param root      Container im Shadow-DOM
   * @param onChange  (entityIds) => void  – Verknüpfungen des Geräts geändert
   */
  constructor(root, { onChange, onClose } = {}) {
    this.root = root;
    this.onChange = onChange;
    this.onClose = onClose;
    this.domain = 'light';
    this.onlyArea = true;
    root.innerHTML = `
      <header><h2></h2><button class="close" aria-label="Schließen">✕</button></header>
      <div class="linked"></div>
      <input class="search" type="search" placeholder="Entity suchen (Name oder ID) …" autocomplete="off" spellcheck="false">
      <div class="chips"></div>
      <ul class="list"></ul>`;
    this.search = root.querySelector('.search');
    this.search.addEventListener('input', () => this._renderList());
    root.querySelector('.close').addEventListener('click', () => this.close());
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, id } = b.dataset;
      if (act === 'add') this._set([...this.linked.filter((x) => x !== id), id]);
      if (act === 'remove') this._set(this.linked.filter((x) => x !== id));
      if (act === 'area') { this.onlyArea = !this.onlyArea; this._render(); }
      if (act === 'domain') { this.domain = id; this._render(); }
    });
  }

  /**
   * @param device   Objekt (intern, aus dem Modell übersetzt): { id, name }
   * @param linked   bereits verknüpfte Entities dieser Rolle
   * @param role     Rolle (power, info) – bestimmt Titel und Vorfilter
   * @param light    Objekt ist eine Leuchte (Vorfilter Licht)
   * @param area     HA-Bereich des Raums (oder null)
   * @param usedBy   Map entity_id -> Gerätename (für "bereits verknüpft mit …")
   */
  open({ hass, device, linked = [], role = 'power', light = true, area, usedBy }) {
    this.hass = hass;
    this.device = device;
    this.role = role;
    this.area = area;
    this.usedBy = usedBy;
    this.linked = [].concat(linked ?? []).filter(Boolean);
    this.onlyArea = !!area;
    // Filter passend zur Rolle und zur bestehenden Verknüpfung (z. B. Lampe an einer Steckdose)
    const all = (p) => this.linked.length && this.linked.every((id) => id.startsWith(p));
    this.domain = role === 'info' ? (all('light.') || all('switch.') ? 'all' : 'sensor')
      : all('switch.') || (!light && !all('light.')) ? 'switch' : 'light';
    this.search.value = '';
    this.root.classList.add('show');
    this._render();
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('show');
    this.onClose?.();
  }

  get isOpen() {
    return this.root.classList.contains('show');
  }

  _set(list) {
    this.linked = list;
    this.onChange?.(list.length === 0 ? null : list.length === 1 ? list[0] : list);
    this._render();
  }

  _render() {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    this.esc = esc;
    this.root.querySelector('h2').textContent = `${this.role === 'info' ? 'Anzeigen' : 'Schalten'}: ${this.device.name || this.device.id}`;
    const st = this.hass?.states || {};
    this.root.querySelector('.linked').innerHTML = this.linked.length
      ? this.linked.map((id) => `<span class="chip on">${esc(st[id]?.attributes?.friendly_name || id)}<small>${esc(id)}${st[id] ? '' : ' · fehlt in HA'}</small>
          <button data-act="remove" data-id="${esc(id)}" aria-label="Verknüpfung lösen">✕</button></span>`).join('')
      : '<span class="hint">Noch keine Entity verknüpft – unten auswählen.</span>';
    this.root.querySelector('.chips').innerHTML =
      (this.area ? `<button class="chip ${this.onlyArea ? 'sel' : ''}" data-act="area">Bereich: ${esc(this.area.name)}</button>` : '<span class="hint">Kein passender HA-Bereich – alle Bereiche</span>') +
      DOMAINS.map((d) => `<button class="chip ${this.domain === d.key ? 'sel' : ''}" data-act="domain" data-id="${d.key}">${d.label}</button>`).join('');
    this._renderList();
  }

  _renderList() {
    const esc = this.esc;
    const q = normName(this.search.value);
    const dom = DOMAINS.find((d) => d.key === this.domain);
    let items = listEntities(this.hass).filter((e) => dom.match(e.domain));
    if (this.onlyArea && this.area && !q) items = items.filter((e) => e.areaId === this.area.area_id);
    if (q) {
      // Suche geht über alle Bereiche, Treffer im eigenen Bereich zuerst
      items = items.filter((e) => normName(e.name).includes(q) || normName(e.id).includes(q) || normName(e.areaName).includes(q));
      if (this.area) items.sort((a, b) => (b.areaId === this.area.area_id) - (a.areaId === this.area.area_id));
    }
    const shown = items.slice(0, 200);
    this.root.querySelector('.list').innerHTML = shown.map((e) => {
      const linked = this.linked.includes(e.id);
      const other = !linked && this.usedBy.get(e.id);
      return `<li><button data-act="${linked ? 'remove' : 'add'}" data-id="${esc(e.id)}" class="${linked ? 'linked' : ''}">
        <b>${esc(e.name)}</b><small>${esc(e.id)}${e.areaName ? ` · ${esc(e.areaName)}` : ''} · ${esc(e.state)}${other ? ` · bereits: ${esc(other)}` : ''}</small>
        <span class="mark">${linked ? '✓' : '+'}</span></button></li>`;
    }).join('') + (items.length > shown.length ? `<li class="more">… ${items.length - shown.length} weitere – Suche verfeinern</li>` : '') +
      (!items.length ? '<li class="more">Keine Treffer</li>' : '');
  }
}
