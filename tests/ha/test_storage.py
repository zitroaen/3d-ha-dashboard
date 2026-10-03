"""Gemeinsamer Speicher: alle Benutzer lesen dasselbe Modell, nur Administratoren speichern, Konflikte werden erkannt."""

import pytest

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.ha_3d_dashboard.const import DOMAIN, STORAGE_KEY

from .test_integration import _add, bundle  # noqa: F401  (Fixture)

MODEL = {"schema": "ha3d", "version": 2, "site": {"name": "Test"}, "buildings": [], "outdoor": [], "objects": []}


@pytest.fixture
async def ws(hass: HomeAssistant, hass_ws_client, bundle):  # noqa: F811
    await _add(hass)
    return await hass_ws_client(hass)


async def test_leer_ohne_modell(hass: HomeAssistant, ws) -> None:
    await ws.send_json_auto_id({"type": f"{DOMAIN}/model/get"})
    res = await ws.receive_json()
    assert res["success"]
    assert res["result"]["model"] is None
    assert res["result"]["revision"] == 0


async def test_speichern_und_laden(hass: HomeAssistant, ws, hass_storage) -> None:
    await ws.send_json_auto_id({"type": f"{DOMAIN}/model/subscribe"})
    assert (await ws.receive_json())["success"]

    await ws.send_json_auto_id(
        {"type": f"{DOMAIN}/model/save", "model": MODEL, "header": "# Test", "file_hash": "abc", "revision": 0}
    )
    # Ereignis an Abonnenten und Ergebnis (Reihenfolge egal)
    msgs = [await ws.receive_json(), await ws.receive_json()]
    assert any(m.get("type") == "event" and m["event"] == {"revision": 1} for m in msgs)
    assert any(m.get("type") == "result" and m["result"] == {"revision": 1} for m in msgs)

    await ws.send_json_auto_id({"type": f"{DOMAIN}/model/get"})
    got = (await ws.receive_json())["result"]
    assert got["model"] == MODEL
    assert got["header"] == "# Test"
    assert got["file_hash"] == "abc"
    assert got["revision"] == 1
    await hass.async_block_till_done()
    assert hass_storage[STORAGE_KEY]["data"]["model"] == MODEL


async def test_konflikt(hass: HomeAssistant, ws) -> None:
    await ws.send_json_auto_id({"type": f"{DOMAIN}/model/save", "model": MODEL, "revision": 0})
    assert (await ws.receive_json())["success"]
    # beruht noch auf Revision 0 -> abgelehnt
    await ws.send_json_auto_id({"type": f"{DOMAIN}/model/save", "model": MODEL, "revision": 0})
    res = await ws.receive_json()
    assert not res["success"]
    assert res["error"]["code"] == "conflict"


async def test_kein_modell_abgelehnt(hass: HomeAssistant, ws) -> None:
    await ws.send_json_auto_id({"type": f"{DOMAIN}/model/save", "model": {"rooms": []}})
    res = await ws.receive_json()
    assert not res["success"]
    assert res["error"]["code"] == "invalid_format"


async def test_nur_admins_speichern(hass: HomeAssistant, ws, hass_admin_user) -> None:
    hass_admin_user.groups = []  # Benutzer ohne Admin-Rechte
    await ws.send_json_auto_id({"type": f"{DOMAIN}/model/save", "model": MODEL})
    res = await ws.receive_json()
    assert not res["success"]
    assert res["error"]["code"] == "unauthorized"
    # lesen darf jeder
    await ws.send_json_auto_id({"type": f"{DOMAIN}/model/get"})
    assert (await ws.receive_json())["success"]


async def test_panel_gemeinsam(hass: HomeAssistant, ws) -> None:
    from homeassistant.components.frontend import DATA_PANELS

    from custom_components.ha_3d_dashboard.const import PANEL_URL_PATH

    assert hass.data[DATA_PANELS][PANEL_URL_PATH].config["shared"] is True


async def test_bleibt_nach_neuladen(hass: HomeAssistant, ws) -> None:
    await ws.send_json_auto_id({"type": f"{DOMAIN}/model/save", "model": MODEL})
    assert (await ws.receive_json())["success"]
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is config_entries.ConfigEntryState.LOADED
    await ws.send_json_auto_id({"type": f"{DOMAIN}/model/get"})
    assert (await ws.receive_json())["result"]["revision"] == 1
    assert await async_setup_component(hass, DOMAIN, {})
