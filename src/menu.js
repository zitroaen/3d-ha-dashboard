// Einstellungsmenü (Zahnrad oben rechts): Ansicht (Tageszeit, Qualität), Haus (Bearbeiten, Link-Check), Info.
// Ansichts-Einstellungen gelten pro Gerät (localStorage) – ein Wand-Tablet darf sparsam rechnen, der PC nicht.

const PREFS_KEY = 'ha3d_view_prefs';
export const DEFAULT_PREFS = { daytime: 'auto', quality: 'auto', weather: 'auto', theme: 'auto' };

/** Ansichts-Einstellungen dieses Geräts (ohne Speicher, z. B. privates Fenster: Standardwerte) */
export function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* ohne Speicher gilt die Einstellung bis zum Neuladen */ }
}

const THEME = [['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']];
const DAYTIME = [['auto', 'Automatisch'], ['day', 'Tag'], ['night', 'Nacht']];
const QUALITY = [['auto', 'Automatisch'], ['high', 'Hoch'], ['low', 'Sparsam']];
const WEATHER = [['auto', 'Automatisch'], ['clear', 'Klar'], ['cloudy', 'Bewölkt'], ['rain', 'Regen'], ['snow', 'Schnee'], ['fog', 'Nebel']];
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class SettingsMenu {
  /**
   * @param root      Container im Shadow-DOM
   * @param onPrefs   (prefs) => void – Ansichts-Einstellung geändert
   * @param onAction  ('edit' | 'links') => void
   */
  constructor(root, { onPrefs, onAction } = {}) {
    this.root = root;
    this.onPrefs = onPrefs;
    this.onAction = onAction;
    this.prefs = loadPrefs();
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'close') return this.close();
      if (b.dataset.pref) {
        this.prefs = { ...this.prefs, [b.dataset.pref]: b.dataset.value };
        savePrefs(this.prefs);
        this.onPrefs?.(this.prefs);
        return this.render();
      }
      if (b.dataset.act) {
        this.close();
        this.onAction?.(b.dataset.act);
      }
    });
  }

  get isOpen() {
    return this.root.classList.contains('show');
  }

  /**
   * @param info { canEdit, version, source, quality (tatsächliche Stufe bei „Automatisch“), daylight }
   */
  open(info) {
    this.info = info;
    this.root.classList.add('show');
    this.render();
  }

  close() {
    this.root.classList.remove('show');
  }

  toggle(info) {
    if (this.isOpen) this.close();
    else this.open(info);
  }

  render() {
    if (!this.isOpen) return;
    const { canEdit, version, source, quality, weather } = this.info || {};
    const seg = (pref, opts) => `<div class="seg" role="group">${opts.map(([v, l]) =>
      `<button data-pref="${pref}" data-value="${v}" class="${this.prefs[pref] === v ? 'on' : ''}" aria-pressed="${this.prefs[pref] === v}">${l}</button>`).join('')}</div>`;
    const autoQ = this.prefs.quality === 'auto' && quality ? `<p class="hint">Automatisch gewählt: ${quality === 'high' ? 'Hoch' : 'Sparsam'}</p>` : '';
    this.root.innerHTML = `
      <header><h2>Einstellungen</h2><button data-act="close" aria-label="Schließen">✕</button></header>
      <div class="body">
        <section><h3>Ansicht</h3>
          <label>Darstellung</label>${seg('theme', THEME)}
          <p class="hint">Bedienelemente hell oder dunkel; Automatisch folgt Home Assistant.</p>
          <label>Tageszeit</label>${seg('daytime', DAYTIME)}
          <p class="hint">Automatisch folgt der Sonne aus Home Assistant (sun.sun).</p>
          <label>Wetter</label>${seg('weather', WEATHER).replace('class="seg"', 'class="seg wrap"')}
          <p class="hint">${weather ? `Automatisch: ${esc(weather)}` : 'Automatisch: keine Wetter-Entity in Home Assistant gefunden'}</p>
          <label>Qualität</label>${seg('quality', QUALITY)}
          ${autoQ}
          <p class="hint">Hoch: Raumschatten und volle Auflösung, sobald die Ansicht stillsteht. Sparsam: für ältere Tablets.</p>
        </section>
        <section><h3>Haus</h3>
          ${canEdit ? '<button class="item" data-act="edit"><b>Bearbeiten</b><small>Möbel und Leuchten verschieben, verknüpfen, Gesten einstellen</small></button>' : ''}
          <button class="item" data-act="links"><b>Verknüpfungen prüfen</b><small>Link-Check: welche Entities fehlen oder frei sind</small></button>
        </section>
        <section><h3>Info</h3>
          <p class="about">Version ${esc(version)}<br>${esc(source)}</p>
        </section>
      </div>`;
  }
}
