#!/bin/zsh
# Instala (o actualiza) mac-agent como LaunchAgent del usuario.
#
# Por qué se copia fuera del repo: ~/Documents está protegido por macOS (TCC) y
# un proceso lanzado por launchd recibe "Operation not permitted" al leerlo.
# El agente vive en ~/Library/Application Support/mac-agent; ahí quedan también
# su config.json y su .token, que esta instalación nunca sobrescribe.
set -euo pipefail

ORIGEN="${0:A:h:h}"
DESTINO="$HOME/Library/Application Support/mac-agent"
ETIQUETA="lat.juliangonzalez.mac-agent"
PLIST="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
NODE="${NODE:-$(command -v node || true)}"
[[ -z "$NODE" && -x "$HOME/.local/node24/bin/node" ]] && NODE="$HOME/.local/node24/bin/node"

if [[ -z "$NODE" ]]; then
  echo "No encuentro node. Ejecuta: NODE=/ruta/a/node $0" >&2
  exit 1
fi
if ! "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo "mac-agent necesita Node 24 o superior ($NODE es $("$NODE" -v))." >&2
  exit 1
fi

mkdir -p "$DESTINO/logs" "$HOME/Library/LaunchAgents"
rsync -a --delete --exclude '*.test.ts' "$ORIGEN/src/" "$DESTINO/src/"
cp "$ORIGEN/package.json" "$ORIGEN/package-lock.json" "$DESTINO/"
# Única dependencia: el SDK oficial de Claude. Se instala junto al agente.
PATH="${NODE:h}:$PATH" "${NODE:h}/npm" ci --omit=dev --prefix "$DESTINO" --no-audit --no-fund --loglevel=error
# Calendario y Recordatorios: mini app en Swift. Si no compila, el agente
# funciona igual, solo que sin agenda.
if ! zsh "$ORIGEN/agenda/construir.sh" "$DESTINO"; then
  echo "Aviso: sin agenda (no se pudo compilar el ayudante). El resto funciona." >&2
fi

if [[ ! -f "$DESTINO/config.json" ]]; then
  cp "$ORIGEN/config.example.json" "$DESTINO/config.json"
  echo "Creado $DESTINO/config.json desde el ejemplo: edita escenas y apps."
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETIQUETA</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DESTINO/src/server.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$DESTINO</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DESTINO/logs/agente.log</string>
  <key>StandardErrorPath</key><string>$DESTINO/logs/agente.log</string>
</dict>
</plist>
EOF

# bootout no es inmediato: si se hace bootstrap antes de que el servicio viejo
# termine de salir, falla con "Input/output error" y el agente queda apagado.
launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
for _ in {1..20}; do
  launchctl print "gui/$(id -u)/$ETIQUETA" >/dev/null 2>&1 || break
  sleep 0.5
done
arrancado=""
for _ in {1..5}; do
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
    arrancado=1
    break
  fi
  sleep 1
done
if [[ -z "$arrancado" ]]; then
  echo "No se pudo registrar el servicio. Prueba: launchctl bootstrap gui/$(id -u) \"$PLIST\"" >&2
  exit 1
fi

for _ in {1..10}; do
  curl -fsS "http://127.0.0.1:8787/salud" >/dev/null 2>&1 && break
  sleep 0.5
done
if [[ ! -f "$DESTINO/.anthropic-key" ]]; then
  echo "Falta la clave de Claude para el chat. Guárdala así (no queda en el historial de la terminal):"
  echo "  pbpaste > \"$DESTINO/.anthropic-key\" && chmod 600 \"$DESTINO/.anthropic-key\""
  echo "y vuelve a ejecutar este script."
fi

if [[ -d "$DESTINO/Agenda del asistente.app" ]]; then
  echo "Agenda: la primera vez, abre el panel y toca «Pedir permiso en la Mac» (o ejecuta:"
  echo "  open -W \"$DESTINO/Agenda del asistente.app\" --args pedir-permisos )"
  echo "y acepta los avisos de Calendarios y Recordatorios en esta pantalla."
fi

if curl -fsS "http://127.0.0.1:8787/salud" >/dev/null 2>&1; then
  echo "mac-agent en marcha en http://127.0.0.1:8787"
  echo "Token: $DESTINO/.token  (cópialo con: pbcopy < \"$DESTINO/.token\")"
else
  echo "El agente no respondió todavía. Revisa: tail -f \"$DESTINO/logs/agente.log\"" >&2
fi
