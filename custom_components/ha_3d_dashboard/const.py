"""Konstanten der Integration 3D-HA-Dashboard."""

DOMAIN = "ha_3d_dashboard"

# Name des Custom Elements und der Bundle-Datei (stabil, siehe CLAUDE.md)
ELEMENT_NAME = "ha-3d-dashboard"
BUNDLE_FILE = "ha-3d-dashboard.js"

# Unter dieser Adresse liefert die Integration das Bundle aus (Ordner frontend/ der Integration)
STATIC_URL = "/ha_3d_dashboard_static"

# Adresse des Panels: http://<ha>/haus-3d
PANEL_URL_PATH = "haus-3d"

CONF_SIDEBAR_TITLE = "sidebar_title"
CONF_SIDEBAR_ICON = "sidebar_icon"
CONF_DATA_URL = "data_url"

DEFAULT_SIDEBAR_TITLE = "Haus 3D"
DEFAULT_SIDEBAR_ICON = "mdi:home-floor-3"
# Gleicher Ordner wie bei der Installation von Hand (/config/www/ha-3d-dashboard/). Fehlt er, zeigt das Panel das
# eingebaute Demo-Haus mit Hinweis.
DEFAULT_DATA_URL = "/local/ha-3d-dashboard/"

# Gemeinsames Modell (für alle Benutzer gleich) in .storage/ha_3d_dashboard.model
STORAGE_KEY = f"{DOMAIN}.model"
STORAGE_VERSION = 1
# Signal an Abonnenten (Panels), wenn ein Administrator das Modell gespeichert hat
SIGNAL_MODEL_SAVED = f"{DOMAIN}_model_saved"
