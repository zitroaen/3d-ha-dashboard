// Simuliertes hass-Objekt: Zustände + callService mit Zustandswechsel (wie Home Assistant).
// Die Zustände werden aus dem Modell (model.yaml) erzeugt: jede dort verknüpfte Entity existiert, Lichter sind aus.
export function createMockHass(initialStates = {}, onChange = () => {}) {
  const hass = {
    language: 'de',
    user: { name: 'Test', is_admin: true },
    states: { ...initialStates },
    calls: [],
    async callService(domain, service, data = {}) {
      hass.calls.push({ domain, service, data });
      const ids = [].concat(data.entity_id || []);
      const next = { ...hass.states };
      for (const id of ids) {
        const cur = next[id];
        if (!cur) continue;
        let state = cur.state;
        if (service === 'turn_on') state = 'on';
        else if (service === 'turn_off') state = 'off';
        else if (service === 'toggle') state = state === 'on' ? 'off' : 'on';
        const { entity_id, ...rest } = data;
        const attributes = { ...cur.attributes, ...(service === 'turn_on' ? rest : {}) };
        if (domain === 'light' && state === 'on' && attributes.brightness == null) attributes.brightness = 255;
        next[id] = { ...cur, state, attributes, last_changed: new Date().toISOString() };
      }
      // HA setzt bei jeder Änderung ein neues hass-Objekt (neue State-Objekte für geänderte Entities)
      Object.assign(hass, { states: next });
      onChange(hass);
    },
    async callWS(msg) {
      hass.calls.push({ ws: msg });
      if (msg.type === 'frontend/get_user_data') return { value: hass._userData?.[msg.key] ?? null };
      if (msg.type === 'frontend/set_user_data') (hass._userData ??= {})[msg.key] = msg.value;
      return null;
    },
  };
  return hass;
}

/** Zustände für alle im Modell verknüpften Entities (alle Rollen): Lichter/Schalter aus, Sensoren unbekannt. */
export function statesFromModel(model) {
  const states = {};
  for (const o of model.objects || []) {
    for (const v of Object.values(o.ha?.entities || {})) {
      for (const e of [].concat(v)) {
        const dom = e.split('.')[0];
        states[e] = {
          entity_id: e,
          state: ['light', 'switch', 'fan', 'input_boolean'].includes(dom) ? 'off' : 'unknown',
          attributes: dom === 'light'
            ? { friendly_name: o.name || e, color_mode: 'color_temp', color_temp_kelvin: 2700, supported_color_modes: ['color_temp', 'xy'] }
            : { friendly_name: o.name || e },
        };
      }
    }
  }
  return states;
}
