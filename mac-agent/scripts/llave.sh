#!/bin/zsh
# Guarda la llave del chat en un solo paso:
#   1. Copia la llave (Cmd+C) desde console.groq.com/keys  (o la de Claude).
#   2. Ejecuta:  zsh mac-agent/scripts/llave.sh
#
# Lee la llave del portapapeles (nunca se escribe en la terminal ni queda en el
# historial), reconoce de quién es, la comprueba, la guarda con permisos 600
# junto al agente y lo reinicia. Con una llave de Groq el chat usa Groq.
set -euo pipefail

DESTINO="$HOME/Library/Application Support/mac-agent"
ETIQUETA="lat.juliangonzalez.mac-agent"
LLAVE=$(pbpaste | tr -d '[:space:]')

if [[ ! -d "$DESTINO" ]]; then
  echo "Primero instala el agente:  zsh mac-agent/scripts/instalar.sh" >&2
  exit 1
fi

case "$LLAVE" in
  gsk_*)
    NOMBRE="Groq"; ARCHIVO=".groq-key"
    ESTADO=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "Authorization: Bearer $LLAVE" https://api.groq.com/openai/v1/models || echo 000)
    ;;
  sk-ant-*)
    NOMBRE="Claude"; ARCHIVO=".anthropic-key"
    ESTADO=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "x-api-key: $LLAVE" -H "anthropic-version: 2023-06-01" https://api.anthropic.com/v1/models || echo 000)
    ;;
  *)
    echo "Lo que hay en el portapapeles no parece una llave." >&2
    echo "Copia la llave completa (la de Groq empieza por gsk_) y vuelve a ejecutar este comando." >&2
    exit 1
    ;;
esac

if [[ "$ESTADO" == "401" || "$ESTADO" == "403" ]]; then
  echo "$NOMBRE rechazó esa llave. Crea una nueva, cópiala y repite." >&2
  exit 1
fi
if [[ "$ESTADO" != "200" ]]; then
  echo "Aviso: no pude comprobar la llave con $NOMBRE (respuesta $ESTADO). La guardo igual."
fi

umask 077
printf '%s\n' "$LLAVE" > "$DESTINO/$ARCHIVO"
chmod 600 "$DESTINO/$ARCHIVO"
# El portapapeles ya no necesita la llave.
printf '' | pbcopy

launchctl kickstart -k "gui/$(id -u)/$ETIQUETA" >/dev/null 2>&1 || true
for _ in {1..20}; do
  curl -fsS http://127.0.0.1:8787/salud >/dev/null 2>&1 && break
  sleep 0.5
done

echo "Listo: llave de $NOMBRE guardada y agente reiniciado. Ya puedes hablarle al asistente en el panel."
