"""Gemeinsamer Speicher des Modells (docs/DATA_MODEL.md) – für alle Benutzer gleich.

Das Panel speichert das ganze Modell über WebSocket (nur Administratoren), alle Benutzer laden es von hier.
Gespeichert wird zusätzlich der Prüfwert der Datei model.yaml, aus der das Modell hervorging: Legt jemand später eine
andere model.yaml in den Datenordner (Import), erkennt das Panel daran, dass die Datei neuer ist, und zeigt sie.

WebSocket-Befehle:
  ha_3d_dashboard/model/get        -> {model, header, file_hash, revision, updated_at, updated_by}
  ha_3d_dashboard/model/save       (Admin) {model, header?, file_hash?, revision?} -> {revision}
  ha_3d_dashboard/model/subscribe  -> Ereignisse {revision} nach jedem Speichern
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN, SIGNAL_MODEL_SAVED, STORAGE_KEY, STORAGE_VERSION

DATA_STORE = f"{DOMAIN}_store"


class ModelStore:
    """Das gespeicherte Modell samt Revision (zählt jedes Speichern, für Konflikterkennung)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data: dict[str, Any] | None = None

    async def async_load(self) -> dict[str, Any]:
        if self.data is None:
            self.data = await self._store.async_load() or {"model": None, "revision": 0}
        return self.data

    async def async_save(self, model: dict[str, Any], header: str, file_hash: str | None, user_id: str | None) -> int:
        data = await self.async_load()
        self.data = {
            "model": model,
            "header": header,
            "file_hash": file_hash,
            "revision": data["revision"] + 1,
            "updated_at": dt_util.utcnow().isoformat(),
            "updated_by": user_id,
        }
        await self._store.async_save(self.data)
        async_dispatcher_send(self.hass, SIGNAL_MODEL_SAVED, self.data["revision"])
        return self.data["revision"]


@callback
def async_setup_storage(hass: HomeAssistant) -> None:
    """Speicher anlegen und WebSocket-Befehle registrieren (einmal pro HA-Start)."""
    hass.data[DATA_STORE] = ModelStore(hass)
    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_subscribe)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/model/get"})
@websocket_api.async_response
async def ws_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    data = await hass.data[DATA_STORE].async_load()
    connection.send_result(msg["id"], data)


def _model(value: Any) -> dict[str, Any]:
    """Grobe Prüfung; die genaue (Schema, Migration) macht das Panel beim Laden."""
    if not isinstance(value, dict) or value.get("schema") != "ha3d" or not isinstance(value.get("version"), int):
        raise vol.Invalid("kein ha3d-Modell (schema: ha3d, version)")
    return value


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/model/save",
        vol.Required("model"): _model,
        vol.Optional("header", default=""): str,
        vol.Optional("file_hash"): vol.Any(str, None),
        # Revision, auf der die Änderungen beruhen; weicht sie ab, hat inzwischen jemand anderes gespeichert
        vol.Optional("revision"): int,
    }
)
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    store: ModelStore = hass.data[DATA_STORE]
    current = (await store.async_load())["revision"]
    if "revision" in msg and msg["revision"] != current:
        connection.send_error(
            msg["id"], "conflict", "Das Modell wurde inzwischen an anderer Stelle gespeichert – bitte neu laden"
        )
        return
    revision = await store.async_save(msg["model"], msg["header"], msg.get("file_hash"), connection.user.id)
    connection.send_result(msg["id"], {"revision": revision})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/model/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    @callback
    def saved(revision: int) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {"revision": revision}))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_MODEL_SAVED, saved)
    connection.send_result(msg["id"])
