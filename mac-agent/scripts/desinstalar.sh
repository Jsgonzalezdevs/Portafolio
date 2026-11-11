#!/bin/zsh
# Detiene y quita el LaunchAgent. Deja intactos config.json y .token por si reinstalas.
set -euo pipefail
ETIQUETA="lat.juliangonzalez.mac-agent"
launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$ETIQUETA.plist"
echo "mac-agent detenido. Sus datos siguen en ~/Library/Application Support/mac-agent"
