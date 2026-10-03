#!/usr/bin/env bash
# Abhängigkeiten für die Tests der HA-Integration (Python ≥ 3.13):
#   bash tests/ha/install.sh && python -m pytest tests/ha
# Dazu das HA-Frontend-Paket in der Version, die zur installierten HA gehört (die Integration hängt von frontend ab).
# Mit uv (z. B. in der CI) geht die Installation deutlich schneller, sonst pip.
set -euo pipefail
cd "$(dirname "$0")"
if command -v uv >/dev/null && [ -n "${VIRTUAL_ENV:-}" ]; then PIP=(uv pip); else PIP=(python -m pip); fi
"${PIP[@]}" install -r requirements.txt
"${PIP[@]}" install "$(python -c 'import json, os, homeassistant; print(json.load(open(os.path.join(os.path.dirname(homeassistant.__file__), "components/frontend/manifest.json")))["requirements"][0])')"
