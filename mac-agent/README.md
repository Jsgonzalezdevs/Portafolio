# mac-agent

Agente local que expone la Mac a la tablet del asistente (`juliangonzalez.lat/app`).
Es el "cerebro" de la arquitectura: la tablet (Lenovo YT3-850F, Android 6, 1 GB)
solo muestra el panel y, más adelante, escucha la palabra clave; todo lo que toca
la Mac pasa por aquí.

- **Node 24+ ejecuta el TypeScript directamente.** Única dependencia: el SDK
  oficial de Claude (`@anthropic-ai/sdk`) para el chat.
- **Solo escucha en 127.0.0.1**: se llega a él a través de un túnel HTTPS.
- **Lista blanca de acciones**: no existe una orden de shell libre; los binarios
  se lanzan con `execFile`, sin pasar por un intérprete.

## API

Todas las rutas, salvo `/salud`, piden `Authorization: Bearer <token>`.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/salud` | `{ ok: true }` (sin token) |
| GET | `/estado` | CPU, RAM, disco, batería, volumen, uptime |
| GET | `/catalogo` | Acciones, escenas y apps configuradas |
| GET | `/eventos` | Flujo SSE: evento `estado` cada 3 s |
| POST | `/acciones/:id` | Ejecuta una acción con cuerpo JSON |
| POST | `/chat` | `{ texto, nueva? }` → `{ respuesta, acciones, esperandoConfirmacion }` |
| GET | `/agenda` | Permisos, eventos de hoy y mañana, recordatorios pendientes |
| POST | `/agenda/permisos` | Abre en la Mac el aviso de permisos de macOS |
| POST | `/avisos/:id/descartar` | `{ completar? }` cierra el aviso de un recordatorio vencido |

`/estado` y los eventos `estado` llevan además `avisos`: los recordatorios que
acaban de vencer.

Acciones: `volumen.fijar {nivel}`, `volumen.silenciar {silenciar}`,
`media.playpause`, `media.siguiente`, `media.anterior`, `pantalla.apagar`,
`app.abrir {id}`, `escena.ejecutar {id}`.

Diez tokens inválidos en un minuto bloquean esa IP durante un minuto.

## Chat con Claude (`/chat`)

Claude recibe las acciones de arriba como herramientas, más `leer_estado_mac`.
Solo puede hacer lo que está en la lista blanca. Las respuestas están pensadas
para leerse en voz alta: una o dos frases, sin formato.

- **Modelo y esfuerzo**: `asistente.modelo` (por defecto `claude-opus-5-5`) y
  `asistente.esfuerzo` (por defecto `low`) en `config.json`. Por voz, la
  latencia pesa más que la profundidad. Sube a `medium` si notas respuestas
  flojas.
- **Respaldo ante rechazos**: si el modelo declina una petición por política,
  la API la reintenta sola con su respaldo por defecto
  (`fallbacks: "default"`).
- **Memoria de la charla**: dura `asistente.minutosConversacion` (10 por
  defecto) sin actividad, o hasta pulsar «Nueva charla». Vive en memoria: si el
  agente se reinicia, se pierde. Si Claude falla a mitad de una respuesta, la
  charla también se descarta, para no dejar un historial roto.
- **Confirmaciones**: una escena con `"confirmar": true` (abrir una puerta, por
  ejemplo) no se ejecuta la primera vez que Claude la pide. El agente la
  bloquea, Claude pregunta y solo se ejecuta si se vuelve a pedir después de
  que tú respondas. El botón de la escena en el panel no pregunta: tocarlo ya
  es confirmar.
- **Fecha y hora**: van en cada mensaje, no en las instrucciones fijas, para
  que la caché del prompt siga sirviendo.

### Llave del chat (Groq gratis o Claude)

Un solo paso: copia la llave al portapapeles y ejecuta

```bash
zsh mac-agent/scripts/llave.sh
```

El script reconoce de quién es la llave (`gsk_…` = Groq, `sk-ant-…` = Claude),
la comprueba, la guarda con permisos 600 junto al agente, vacía el portapapeles
y reinicia el agente. La llave nunca se escribe en la terminal.

- **Groq** (gratis): crea la llave en <https://console.groq.com/keys>. El
  agente usa `openai/gpt-oss-120b` y, si falla o se acaba su cupo gratuito,
  pasa solo a `qwen/qwen3.8-27b` y luego a `openai/gpt-oss-20b`. El cupo
  gratuito es por minuto (unos 8.000 tokens en el principal). Se cambian con
  `asistente.modelosGroq` en `config.json`.
- **Claude**: llave de <https://console.anthropic.com>. Usa `asistente.modelo`.

Con `"proveedor": "auto"` (por defecto) manda Groq si hay llave de Groq; si no,
Claude. Para forzar uno, pon `"groq"` o `"claude"`. El resto (herramientas,
confirmaciones, agenda) funciona igual con los dos: lo que protege la Mac lo
impone el agente, no el modelo. Los modelos de Groq se equivocan algo más al
usar herramientas, sobre todo con fechas.

Sin ninguna llave, el chat responde que falta y el resto del panel sigue
funcionando.

## Agenda: Calendario y Recordatorios

El agente usa el **Calendario y los Recordatorios de macOS** (EventKit) a
través de una mini app en Swift, `Agenda del asistente.app`, que compila el
instalador. El Calendario de macOS junta todas las cuentas configuradas en la
Mac (iCloud, Google…), así que no hay que conectar nada más.

- **Panel**: la tarjeta «Agenda» muestra los eventos de hoy y mañana y los
  recordatorios pendientes.
- **Claude**: puede ver la agenda, crear eventos, y ver, crear y completar
  recordatorios («recuérdame sacar la basura a las 8»).
- **Avisos**: cuando vence un recordatorio con hora, la tablet muestra un aviso
  grande y lo dice en voz alta. El recordatorio también suena en el iPhone,
  porque vive en Recordatorios de Apple. Solo se anuncian los que vencieron
  hace menos de 15 minutos, así que al arrancar no recita los atrasados.
- **Permiso**: la primera vez, toca «Pedir permiso en la Mac» en la tarjeta y
  acepta los dos avisos de macOS (Calendarios y Recordatorios) en la pantalla
  de la Mac. Si los negaste, se cambian en Ajustes del Sistema › Privacidad y
  seguridad.

Por qué es una app aparte y se lanza con `open`: macOS atribuye el permiso al
proceso «responsable». Un binario suelto lanzado por node heredaría la
petición de node, que no declara para qué quiere el calendario, y macOS la
negaría sin preguntar. Si cambia `agenda/agenda.swift`, el instalador recompila
la app y macOS puede volver a pedir el permiso.

Necesita `swiftc` (`xcode-select --install`). Sin él, el agente funciona igual
pero sin agenda.

## Instalar en la Mac

```bash
zsh mac-agent/scripts/instalar.sh
```

1. Copia el agente a `~/Library/Application Support/mac-agent` e instala el
   SDK ahí. Va fuera de `~/Documents` porque macOS bloquea esa carpeta a los
   procesos de launchd.
2. Lo registra como LaunchAgent: arranca al iniciar sesión y se reinicia si cae.
3. Genera el token en `~/Library/Application Support/mac-agent/.token`.

Para actualizar después de cambiar el código, vuelve a ejecutar el mismo script.
`config.json`, `.token` y `.anthropic-key` no se tocan.

**Permisos**: la primera vez que pulses reproducir/pausar, macOS pedirá permiso
para que `node` controle Spotify o Música. Acéptalo en la Mac.

**Que la Mac no se duerma enchufada** (si no, el asistente se queda sin cerebro):

```bash
sudo pmset -c sleep 0 displaysleep 10
```

### Escenas de domótica

Cada escena es un Atajo de macOS. Para luces de Apple Home, crea en la app
Atajos un atajo «Encender luces sala» con la acción *Controlar mi casa* y añádelo
a `config.json`:

```json
{ "id": "luces-sala", "nombre": "Luces sala", "atajo": "Encender luces sala" }
```

Después reinicia el agente:

```bash
launchctl kickstart -k gui/$(id -u)/lat.juliangonzalez.mac-agent
```

## Publicarlo con HTTPS (túnel)

`juliangonzalez.lat/app` se sirve por HTTPS, y el navegador bloquea las llamadas
de esa página a `http://192.168.x.x`. Por eso el agente se publica con un túnel.
Hay dos caminos:

**Rápido · túnel de Cloudflare sin cuenta**:

```bash
zsh mac-agent/scripts/tunel.sh
```

Descarga `cloudflared` (comprueba que esté firmado por Cloudflare), lo deja
como servicio e imprime el enlace de emparejamiento. La URL
`*.trycloudflare.com` **cambia cada vez que el túnel se reinicia** (también al
reiniciar la Mac). Para ver el enlace actual:

```bash
zsh mac-agent/scripts/tunel.sh enlace
```

Este túnel no pasa el flujo SSE en vivo; el panel lo detecta y consulta
`/estado` cada 4 s. Para una URL fija usa una de estas dos:

**A · Tailscale Funnel** (no exige mover el DNS):

```bash
tailscale funnel --bg 8787
```

Usa la URL `https://<tu-mac>.<tailnet>.ts.net` como «Agente» en la tablet. La
tablet no necesita tener Tailscale.

**B · Cloudflare Tunnel** con `agente.juliangonzalez.lat` (exige que el DNS del
dominio esté en Cloudflare):

```bash
cloudflared tunnel login
cloudflared tunnel create mac-agent
cloudflared tunnel route dns mac-agent agente.juliangonzalez.lat
```

Crea `~/.cloudflared/config.yml`:

```yaml
tunnel: mac-agent
credentials-file: /Users/<usuario>/.cloudflared/<id>.json
ingress:
  - hostname: agente.juliangonzalez.lat
    service: http://127.0.0.1:8787
  - service: http_status:404
```

Y déjalo como servicio:

```bash
sudo cloudflared service install
```

Si usas otro dominio u origen, añádelo a `origenes` en `config.json` (CORS).

## Emparejar la tablet

Abre `https://juliangonzalez.lat/app` en la tablet y pega la URL del agente y el
token. También puedes enviarte este enlace; el fragmento `#` nunca llega a
ningún servidor y se borra de la barra al cargar:

```
https://juliangonzalez.lat/app#agente=<url-del-agente>&token=<token>
```

Para revocar una tablet, borra el `.token` y reinicia el agente: se genera uno
nuevo.

## Desarrollo

```bash
cd mac-agent
npm install     # SDK de Claude
npm test        # node:test (Claude simulado, no gasta API)
npm run check   # tsc
AGENT_CONFIG=/ruta/config.json AGENT_TOKEN=<32+ caracteres> npm start
```
