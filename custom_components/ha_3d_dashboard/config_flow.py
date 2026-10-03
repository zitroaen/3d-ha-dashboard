"""Einrichtung über die Oberfläche: ein Klick, keine Fragen. Titel, Symbol und Datenordner unter Optionen."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    CONF_DATA_URL,
    CONF_SIDEBAR_ICON,
    CONF_SIDEBAR_TITLE,
    DEFAULT_DATA_URL,
    DEFAULT_SIDEBAR_ICON,
    DEFAULT_SIDEBAR_TITLE,
    DOMAIN,
)


class Dashboard3DConfigFlow(ConfigFlow, domain=DOMAIN):
    """Legt den einzigen Eintrag an; danach erscheint das Panel in der Seitenleiste."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title=DEFAULT_SIDEBAR_TITLE, data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return Dashboard3DOptionsFlow()


class Dashboard3DOptionsFlow(OptionsFlow):
    """Titel und Symbol in der Seitenleiste, Ordner mit den Hausdaten."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        options = self.config_entry.options
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_SIDEBAR_TITLE,
                    default=options.get(CONF_SIDEBAR_TITLE, DEFAULT_SIDEBAR_TITLE),
                ): selector.TextSelector(),
                vol.Required(
                    CONF_SIDEBAR_ICON,
                    default=options.get(CONF_SIDEBAR_ICON, DEFAULT_SIDEBAR_ICON),
                ): selector.IconSelector(),
                vol.Required(
                    CONF_DATA_URL,
                    default=options.get(CONF_DATA_URL, DEFAULT_DATA_URL),
                ): selector.TextSelector(),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
