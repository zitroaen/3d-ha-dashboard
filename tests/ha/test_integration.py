"""Integration: Einrichtung per Klick legt das Panel an, Optionen ändern es, Entfernen nimmt es wieder weg."""

from pathlib import Path

import pytest

from homeassistant import config_entries
from homeassistant.components.frontend import DATA_PANELS
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component

from custom_components.ha_3d_dashboard.const import BUNDLE_FILE, DOMAIN, PANEL_URL_PATH

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "custom_components" / DOMAIN / "frontend"


@pytest.fixture
def bundle():
    """Bundle bereitstellen (im Release baut es der Workflow hinein; hier reicht ein Platzhalter)."""
    path = FRONTEND_DIR / BUNDLE_FILE
    created = not path.exists()
    if created:
        FRONTEND_DIR.mkdir(exist_ok=True)
        path.write_text("// Platzhalter für die Tests\n")
    yield path
    if created:
        path.unlink()


async def _add(hass: HomeAssistant):
    await async_setup_component(hass, "http", {})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    return result["result"]


async def test_einrichten_legt_panel_an(hass: HomeAssistant, hass_client, bundle) -> None:
    entry = await _add(hass)
    assert entry.state is config_entries.ConfigEntryState.LOADED

    panel = hass.data[DATA_PANELS][PANEL_URL_PATH]
    assert panel.sidebar_title == "Haus 3D"
    assert panel.sidebar_icon == "mdi:home-floor-3"
    assert not panel.require_admin
    custom = panel.config["_panel_custom"]
    assert custom["name"] == "ha-3d-dashboard"
    assert panel.config["data_url"] == "/local/ha-3d-dashboard/"

    # das Bundle wird unter module_url ausgeliefert
    client = await hass_client()
    resp = await client.get(custom["module_url"])
    assert resp.status == 200


async def test_nur_ein_eintrag(hass: HomeAssistant, bundle) -> None:
    await _add(hass)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"


async def test_optionen_aendern_panel(hass: HomeAssistant, bundle) -> None:
    entry = await _add(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {"sidebar_title": "Mein Haus", "sidebar_icon": "mdi:home", "data_url": "/local/haus/"},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()

    panel = hass.data[DATA_PANELS][PANEL_URL_PATH]
    assert panel.sidebar_title == "Mein Haus"
    assert panel.sidebar_icon == "mdi:home"
    assert panel.config["data_url"] == "/local/haus/"


async def test_entfernen_nimmt_panel_weg(hass: HomeAssistant, bundle) -> None:
    entry = await _add(hass)
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert PANEL_URL_PATH not in hass.data[DATA_PANELS]


async def test_ohne_bundle_klare_fehlermeldung(hass: HomeAssistant, caplog) -> None:
    if (FRONTEND_DIR / BUNDLE_FILE).exists():
        pytest.skip("Bundle liegt vor (lokaler Release-Build)")
    entry = await _add(hass)
    assert entry.state is config_entries.ConfigEntryState.SETUP_ERROR
    assert PANEL_URL_PATH not in hass.data.get(DATA_PANELS, {})
    assert "fehlt" in caplog.text
