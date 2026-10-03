"""3D-HA-Dashboard: trägt das 3D-Grundriss-Panel ohne YAML in die Seitenleiste ein.

Die Integration liefert das gebündelte Panel (frontend/ha-3d-dashboard.js) selbst aus und registriert es als
Seitenleisten-Panel – genau das, was sonst ein panel_custom-Eintrag in der configuration.yaml erledigt. Außerdem
hält sie das Modell für alle Benutzer gemeinsam (storage.py).
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import (
    BUNDLE_FILE,
    CONF_DATA_URL,
    CONF_SIDEBAR_ICON,
    CONF_SIDEBAR_TITLE,
    DEFAULT_DATA_URL,
    DEFAULT_SIDEBAR_ICON,
    DEFAULT_SIDEBAR_TITLE,
    DOMAIN,
    ELEMENT_NAME,
    PANEL_URL_PATH,
    STATIC_URL,
)
from .storage import async_setup_storage

_LOGGER = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent / "frontend"

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Gemeinsamen Speicher und WebSocket-Befehle einmal pro HA-Start anlegen."""
    async_setup_storage(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Bundle ausliefern und Panel in der Seitenleiste anlegen."""
    if not await hass.async_add_executor_job((FRONTEND_DIR / BUNDLE_FILE).is_file):
        _LOGGER.error(
            "%s fehlt in %s – bitte über HACS ein Release installieren (nicht den Entwicklungsstand)",
            BUNDLE_FILE,
            FRONTEND_DIR,
        )
        return False

    # Statische Pfade lassen sich nicht wieder abmelden, also nur einmal pro HA-Start registrieren
    if not hass.data.get(DOMAIN):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), cache_headers=True)]
        )
        hass.data[DOMAIN] = True

    # Version als Cache-Brecher: nach einem Update lädt der Browser das neue Bundle
    version = (await async_get_integration(hass, DOMAIN)).version
    options = entry.options
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=ELEMENT_NAME,
        sidebar_title=options.get(CONF_SIDEBAR_TITLE, DEFAULT_SIDEBAR_TITLE),
        sidebar_icon=options.get(CONF_SIDEBAR_ICON, DEFAULT_SIDEBAR_ICON),
        module_url=f"{STATIC_URL}/{BUNDLE_FILE}?v={version}",
        # shared: das Panel lädt und speichert das Modell gemeinsam über die Integration (storage.py)
        config={"data_url": options.get(CONF_DATA_URL, DEFAULT_DATA_URL), "shared": True},
        require_admin=False,
    )

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Panel aus der Seitenleiste entfernen."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Geänderte Optionen (Titel, Symbol, Datenordner) übernehmen."""
    await hass.config_entries.async_reload(entry.entry_id)
