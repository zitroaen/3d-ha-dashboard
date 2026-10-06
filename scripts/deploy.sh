#!/usr/bin/env bash
# Kopiert Panel und Daten nach Home Assistant (per SSH/scp). Nur mit ausdrücklicher Freigabe ausführen.
#
#   bash engine/scripts/deploy.sh          # aus dem Instanz-Ordner: Code + Daten
#   bash engine/scripts/deploy.sh --data   # nur Daten, kein Build
#
# Einstellungen aus ha3d.config.json der Instanz ("data", "ha": { "ssh": "root@homeassistant.local",
# "config": "/config" }) oder aus Umgebungsvariablen (DATA_DIR, HA_SSH, HA_CONFIG – haben Vorrang).
#
# Ziel: $HA_CONFIG/www/ha-3d-dashboard/ (HA_CONFIG Standard /config). Das Panel lädt seine Daten aus diesem
# Ordner. Nach einem Code-Deploy in der configuration.yaml unter panel_custom die Version in module_url (?v=N)
# erhöhen; Daten-Änderungen brauchen das nicht. Achtung: /local/ ist in HA ohne Anmeldung erreichbar.
set -euo pipefail
ENGINE="$(cd "$(dirname "$0")/.." && pwd)"

# Werte aus ha3d.config.json im aktuellen Ordner (Instanz), falls nicht per Umgebung gesetzt
conf() { [[ -f ha3d.config.json ]] && node -e "const c=require(require('path').resolve('ha3d.config.json'));const v=$1;if(v!=null)console.log(v)" || true; }
: "${DATA_DIR:=$(conf "c.data && require('path').resolve(c.data)")}"
: "${HA_SSH:=$(conf "c.ha && c.ha.ssh")}"
: "${HA_CONFIG:=$(conf "c.ha && c.ha.config")}"
: "${HA_SSH:?HA_SSH fehlt (ha3d.config.json -> ha.ssh, z. B. root@homeassistant.local)}"
: "${DATA_DIR:?DATA_DIR fehlt (ha3d.config.json -> data)}"
: "${HA_CONFIG:=/config}"
DATA_DIR="$(cd "$DATA_DIR" && pwd)"
DEST="$HA_CONFIG/www/ha-3d-dashboard"

DATA_DIR="$DATA_DIR" node "$ENGINE/tests/validate-data.mjs"
FILES=("$DATA_DIR/model.yaml")
if [[ "${1:-}" != "--data" ]]; then
  (cd "$ENGINE" && npm run build)
  FILES+=("$ENGINE/dist/ha-3d-dashboard.js")
fi

ssh "$HA_SSH" "mkdir -p '$DEST/textures' '$DEST/models'"
scp "${FILES[@]}" "$HA_SSH:$DEST/"
if compgen -G "$DATA_DIR/textures/*" > /dev/null; then scp "$DATA_DIR"/textures/* "$HA_SSH:$DEST/textures/"; fi
# eigene Modelle (models/<id>.yaml, glTF-Dateien)
if compgen -G "$DATA_DIR/models/*" > /dev/null; then scp "$DATA_DIR"/models/* "$HA_SSH:$DEST/models/"; fi
echo "Deploy fertig: ${FILES[*]}"
