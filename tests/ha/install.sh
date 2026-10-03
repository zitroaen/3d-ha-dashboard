#!/usr/bin/env bash
# Abhängigkeiten für die Tests der HA-Integration (Python ≥ 3.13):
#   bash tests/ha/install.sh && python -m pytest tests/ha
# Dazu das HA-Frontend-Paket in der Version, die zur installierten HA gehört (die Integration hängt von frontend ab).
set -euo pipefail
cd "$(dirname "$0")"
python -m pip install -r requirements.txt
python -m pip install "$(python -c 'import json, os, homeassistant; print(json.load(open(os.path.join(os.path.dirname(homeassistant.__file__), "components/frontend/manifest.json")))["requirements"][0])')"
