#!/bin/zsh
# Publica el mac-agent por HTTPS con un túnel rápido de Cloudflare (sin cuenta)
# y lo deja como LaunchAgent: arranca con la sesión y se reinicia si cae.
#
#   zsh mac-agent/scripts/tunel.sh            instala/reinicia y muestra el enlace
#   zsh mac-agent/scripts/tunel.sh enlace     solo muestra el enlace actual
#   zsh mac-agent/scripts/tunel.sh quitar     detiene y quita el servicio
#
# Ojo: la URL *.trycloudflare.com cambia cada vez que el túnel se reinicia
# (reinicio de la Mac incluido). Este script imprime el enlace de emparejamiento
# nuevo; para una URL fija usa Tailscale Funnel o un túnel con nombre (README).
set -euo pipefail

ETIQUETA="lat.juliangonzalez.tunel"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
BIN="$HOME/.local/bin/cloudflared"
LOG="$HOME/Library/Logs/mac-agent-tunel.log"
TOKEN="$HOME/Library/Application Support/mac-agent/.token"
PANEL="https://www.juliangonzalez.lat/app"

enlace() {
  local url=""
  for _ in {1..30}; do
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1 || true)
    [[ -n "$url" ]] && break
    sleep 1
  done
  if [[ -z "$url" ]]; then
    echo "El túnel no ha dado URL todavía. Revisa: tail -f \"$LOG\"" >&2
    exit 1
  fi
  echo "Agente:  $url"
  if [[ -r "$TOKEN" ]]; then
    echo
    echo "Enlace de emparejamiento (ábrelo en la tablet; contiene el token, no lo compartas):"
    echo "$PANEL#agente=$url&token=$(tr -d '\n' < "$TOKEN")"
  fi
}

case "${1:-instalar}" in
  enlace)
    enlace
    exit 0
    ;;
  quitar)
    launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Túnel detenido y quitado."
    exit 0
    ;;
esac

if [[ ! -x "$BIN" ]]; then
  echo "Descargando cloudflared (Cloudflare, ~20 MB)…"
  mkdir -p "${BIN:h}"
  TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/cloudflared.tgz" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz
  tar -xzf "$TMP/cloudflared.tgz" -C "$TMP"
  if ! codesign -dv --verbose=2 "$TMP/cloudflared" 2>&1 | grep -q 'Developer ID Application: Cloudflare Inc.'; then
    echo "La firma de cloudflared no es de Cloudflare: no lo instalo." >&2
    exit 1
  fi
  mv "$TMP/cloudflared" "$BIN"
  rm -rf "$TMP"
fi

if ! curl -fsS http://127.0.0.1:8787/salud >/dev/null 2>&1; then
  echo "Aviso: el agente no responde en 127.0.0.1:8787. Instálalo antes: zsh mac-agent/scripts/instalar.sh" >&2
fi

mkdir -p "$HOME/Library/LaunchAgents" "${LOG:h}"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIQUETA</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
    <string>tunnel</string>
    <string>--no-autoupdate</string>
    <!-- HTTP/2 (TCP) en vez de QUIC (UDP): en redes caseras QUIC se corta con
         "no recent network activity", el túnel se cierra y cambia de URL. -->
    <string>--protocol</string>
    <string>http2</string>
    <string>--url</string>
    <string>http://127.0.0.1:8787</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

: > "$LOG"
launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
for _ in {1..20}; do
  launchctl print "gui/$(id -u)/$ETIQUETA" >/dev/null 2>&1 || break
  sleep 0.5
done
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Túnel en marcha como servicio."
enlace
