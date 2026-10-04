// Katalog im Editor (wie ein Einrichtungs-Katalog): alle Modelle zum Hinzufügen, nach Art gefiltert und durchsuchbar,
// dazu das Lager mit eingelagerten Objekten (`stored: true`, z. B. Weihnachtsdekoration), die sich mit allen
// Verknüpfungen wieder aufstellen lassen. Hinzufügen/Aufstellen selbst erledigt das Panel (main.js).
import { CATALOG, CATEGORY_LABEL } from './model/catalog.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ORDER = ['furniture', 'lamp', 'device', 'plant'];
const PLURAL = { furniture: 'Möbel', lamp: 'Leuchten', device: 'Geräte', plant: 'Pflanzen' };

/** Kurzbeschreibung eines Katalog-Eintrags: Art, Standardmaß, Animation */
export function catalogInfo(model) {
  const c = CATALOG[model] || {};
  const size = c.size ? `${c.size.map((v) => String(v).replace('.', ',')).join(' × ')} m` : '';
  return [CATEGORY_LABEL[c.category], size, c.anim ? 'bewegt sich' : ''].filter(Boolean).join(' · ');
}

export class CatalogPanel {
  /**
   * @param root       Container im Shadow-DOM
   * @param onAdd      (model) => void – neues Objekt dieses Modells in die Welt setzen
   * @param onRestore  (id) => void – eingelagertes Objekt wieder aufstellen
   * @param preview    (model) => Bild-URL – Vorschaubild (wird nach und nach gerechnet)
   */
  constructor(root, { onAdd, onRestore, onClose, preview } = {}) {
    this.root = root;
    this.preview = preview; // (model) => Bild-URL oder null (preview.js)
    this.onAdd = onAdd;
    this.onRestore = onRestore;
    this.onClose = onClose;
    this.tab = 'catalog';
    this.cat = 'all';
    this.query = '';
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.act === 'close') return this.close();
      if (d.tab) {
        this.tab = d.tab;
        return this.render();
      }
      if (d.cat) {
        this.cat = d.cat;
        return this.render();
      }
      if (d.add) return this.onAdd?.(d.add);
      if (d.restore) return this.onRestore?.(d.restore);
    });
    root.addEventListener('input', (e) => {
      if (!e.target.classList.contains('search')) return;
      this.query = e.target.value;
      this._renderList();
    });
  }

  get isOpen() {
    return this.root.classList.contains('show');
  }

  /** @param stored eingelagerte Objekte [{ id, name, model, linked }] */
  open({ stored = [] } = {}) {
    this.stored = stored;
    this.root.classList.add('show');
    this.render();
  }

  update(stored) {
    this.stored = stored;
    if (this.isOpen) this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('show');
    this.onClose?.();
  }

  render() {
    if (!this.isOpen) return;
    const n = this.stored?.length || 0;
    const tab = (id, label) => `<button data-tab="${id}" class="${this.tab === id ? 'on' : ''}" aria-pressed="${this.tab === id}">${label}</button>`;
    const chips = this.tab === 'catalog'
      ? `<div class="chips">${[['all', 'Alle'], ...ORDER.map((c) => [c, PLURAL[c]])].map(([c, l]) =>
        `<button class="chip ${this.cat === c ? 'sel' : ''}" data-cat="${c}">${l}</button>`).join('')}</div>
        <input class="search" type="search" placeholder="Suchen, z. B. Lampe, Tisch, Ventilator" value="${esc(this.query)}" autocomplete="off" spellcheck="false">`
      : '<p class="hint">Eingelagerte Objekte behalten Lage und Verknüpfungen. Aufstellen holt sie an ihren alten Platz zurück.</p>';
    this.root.innerHTML = `
      <header><h2>Katalog</h2><button data-act="close" aria-label="Schließen">✕</button></header>
      <div class="seg tabs" role="group">${tab('catalog', 'Katalog')}${tab('stored', `Lager${n ? ` (${n})` : ''}`)}</div>
      ${chips}
      <ul class="list"></ul>`;
    this._renderList();
  }

  _renderList() {
    const ul = this.root.querySelector('.list');
    if (!ul) return;
    const q = this.query.trim().toLowerCase();
    if (this.tab === 'stored') {
      ul.innerHTML = (this.stored || []).map((o) => `<li><button data-restore="${esc(o.id)}"><b>${esc(o.name)}</b>
        <small>${esc(CATALOG[o.model]?.label || o.model)}${o.linked ? ` · ${o.linked} verknüpft` : ''}</small><span class="mark">↺</span>${this._thumb(o.model)}</button></li>`).join('')
        || '<li class="more">Das Lager ist leer. Im Editor ein Objekt wählen → Entfernen → Einlagern.</li>';
      return this._fillThumbs();
    }
    const items = Object.entries(CATALOG)
      .filter(([, c]) => this.cat === 'all' || c.category === this.cat)
      .filter(([m, c]) => !q || `${c.label} ${m} ${CATEGORY_LABEL[c.category]}`.toLowerCase().includes(q))
      .sort(([, a], [, b]) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || (a.label || '').localeCompare(b.label || '', 'de'));
    ul.innerHTML = items.map(([m, c]) => `<li><button data-add="${m}"><b>${esc(c.label || m)}</b>
      <small>${esc(catalogInfo(m))}</small><span class="mark">+</span>${this._thumb(m)}</button></li>`).join('')
      || '<li class="more">Nichts gefunden.</li>';
    this._fillThumbs();
  }

  /** Platz für das Vorschaubild (gerechnete Bilder sofort, sonst später) */
  _thumb(model) {
    return `<img class="thumb" data-model="${esc(model)}" alt="" width="56" height="56">`;
  }

  /** Vorschaubilder nach und nach rechnen – eins pro Durchgang, damit die Liste sofort bedienbar bleibt */
  _fillThumbs() {
    clearTimeout(this._thumbTimer);
    if (!this.preview) return;
    const next = () => {
      const img = this.root.querySelector('img.thumb:not([src]):not([data-none])');
      if (!img || !this.isOpen) return;
      const url = this.preview(img.dataset.model);
      // gleiches Modell mehrfach in der Liste (Lager): alle versorgen
      for (const i of this.root.querySelectorAll(`img.thumb[data-model="${img.dataset.model}"]`)) {
        if (url) i.src = url;
        else i.dataset.none = '';
      }
      this._thumbTimer = setTimeout(next, 0);
    };
    next();
  }
}
