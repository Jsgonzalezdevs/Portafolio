# App Android del asistente

App kiosco para la Lenovo YT3-850F (Android 6, 1 GB). Muestra
`https://www.juliangonzalez.lat/app` a pantalla completa, con la pantalla siempre
encendida, y le añade la voz que el WebView no trae:

- **Palabra clave** con Porcupine (Picovoice), en el dispositivo. Usa pocos MB
  y poca CPU.
- **Voz a texto** con el reconocedor de Google del sistema (necesita internet).
- **Texto a voz** con el TTS del sistema, en español.
- **Arranque automático** al encender la tablet. Si se va la luz, vuelve sola
  al panel.

El token y la conexión con la Mac los sigue manejando la página web; la app
solo pone la voz. Ciclo de una orden:

```
«jarvis» → pitido → reconoce lo que dices → la web lo envía a /chat
       → la Mac responde → la tablet lo lee en voz alta → vuelve a esperar la palabra
```

Si la IA pide confirmación («¿Seguro que quieres abrir la puerta?»), la tablet
escucha la respuesta directamente, sin esperar la palabra clave.

## Compilar

Necesita JDK 17 y el SDK de Android (están en esta Mac):

```bash
zsh android/scripts/web.sh        # compila el panel y lo mete en el APK (ver «Rápida» abajo)
cd android
JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew assembleDebug
```

El APK sale en `android/app/build/outputs/apk/debug/app-debug.apk` (~3,5 MB).

## Instalar en la tablet

**Opción A · Cable USB (recomendada)**

1. En la tablet: Ajustes › Información de la tablet › toca 7 veces «Número de
   compilación». Luego Ajustes › Opciones de desarrollador › activa
   «Depuración USB».
2. Conéctala a la Mac, acepta la huella en la tablet e instala:
   ```bash
   ~/Library/Android/sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```

**Opción B · Sin cable**: pasa el APK a la tablet (Drive, correo…). Activa
Ajustes › Seguridad › «Orígenes desconocidos» y ábrelo.

## Antes de usarla, en la tablet

1. **Actualiza «Android System WebView» y «Google»** desde Play Store. El
   WebView llega hasta la versión 106 en Android 6, y el reconocimiento de voz
   vive en la app de Google.
2. **Voz en español**: Ajustes › Idioma y entrada › Texto a voz › Motor de
   Google › Instalar datos de voz › Español. Descárgala para que funcione sin
   conexión.
3. Abre **Asistente**, acepta el permiso del micrófono y empareja el panel con
   la URL del túnel y el token, como en el navegador.

## Palabra clave (Picovoice)

1. Crea una cuenta gratuita en <https://console.picovoice.ai> y copia tu
   **AccessKey**. El plan gratuito es para uso personal; la clave se valida en
   línea de vez en cuando.
2. En el panel toca **Voz** (arriba, junto al estado) y pega la AccessKey.
3. Elige la palabra. Las incorporadas son en inglés: «jarvis», «computer»,
   «picovoice», «bumblebee»… «Jarvis» funciona bien con acento hispano.

**Palabra propia en español** (p. ej. «Oye casa»): créala en la consola de
Picovoice con idioma *Spanish* y plataforma *Android*. Descarga el `.ppn` y el
modelo español `porcupine_params_es.pv`, y cópialos con los nombres exactos:

```bash
adb push Oye-casa_es_android.ppn /sdcard/Android/data/lat.juliangonzalez.asistente/files/palabra.ppn
```

```bash
adb push porcupine_params_es.pv /sdcard/Android/data/lat.juliangonzalez.asistente/files/modelo.pv
```

En **Voz**, elige «Personalizada».

Sin AccessKey todo funciona igual, pero se habla tocando el botón de
micrófono del chat.

## Rápida: el panel viaja dentro del APK

La YT3-850F (Snapdragon 210, 1 GB de RAM, Android 6) es lenta. Medido en la tablet real (`adb logcat -s Arranque`),
lo que más pesaba era el arranque y, dentro de él, pedir la página a internet (DNS, conexión, TLS y la
verificación de certificado de arriba: 4-5 s solo para recibir 100 KB).

- **`PanelLocal`**: la página `/app` y sus 3 archivos (JS, CSS, favicon; ~140 KB) van dentro del APK y se sirven desde
  `shouldInterceptRequest`, sin red. La página sigue siendo `https://www.juliangonzalez.lat/app` (mismo origen,
  mismo localStorage, mismo CORS con la Mac). Abre aunque no haya internet.
- **`ActualizadorWeb`**: 1 minuto después de abrir (y cada 6 h) pide `/app` al sitio con nuestras raíces; si cambió, baja
  los archivos nuevos (la página al final) a `filesDir/web`, que tiene prioridad sobre el APK. Si algo falla o la
  página no parece el panel, no toca nada. La versión nueva se estrena en el siguiente arranque o de noche (el panel
  llama a `AndroidAsistente.recargar()` al entrar en modo noche). Al instalar un APK nuevo se descarta lo bajado.
- **Hay que correr `scripts/web.sh` antes de compilar** (compila el panel y lo copia a `app/src/main/assets/web`, que no se
  sube a git). Sin eso la app sigue funcionando pero pide la página a internet.
- **Voz perezosa**: el motor de voz de Google ya no se arranca al abrir (costaba ~1 s de hilo principal): se pide al decir
  algo por primera vez o 25 s después de abrir. Sin AccessKey de Picovoice no hay palabra clave, así que no hay nada que vigilar.
- **Modo ligero** (`html.ligero`, en la app o con ≤ 1 GB): sin fundidos ni transiciones. En la tablet cada fotograma
  cuesta ~80 ms; sin animaciones, cambiar de pestaña pasa de ~100 fotogramas a ~40.

Resultado (arranque en frío, `am start` → panel a la vista): de ~9-10 s a ~3 s con el sistema caliente (~9 s justo tras encender
la tablet o instalar, por el WebView y el caché de archivos fríos).

### Lo que no se arregla desde la app (y qué se hizo por cable)

Con la tablet en reposo, **la app de Google (`googlequicksearchbox:search`) llegó a gastar 30-38 % de CPU y ~110 MB** (servicio de
asistente / «Ok Google» en segundo plano) y el sistema está casi siempre en memoria «crítica» (zRAM llena, `kswapd`
trabajando). Detenerla (`am force-stop`) bajaba el arranque del WebView de 3,9 s a 2,2 s, pero volvía sola.

Hecho por cable el 2026-11-20 (equivale a Ajustes › Asistente y entrada de voz › Asistente › **Ninguno**):

```bash
adb shell "settings put secure voice_interaction_service ''"
adb shell "settings put secure assistant ''"
```

Para deshacerlo (valores de antes):

```bash
adb shell settings put secure voice_interaction_service com.google.android.googlequicksearchbox/com.google.android.voiceinteraction.GsaVoiceInteractionService
adb shell settings delete secure assistant
```

El reconocimiento del botón de micrófono no se toca (`voice_recognition_service` sigue siendo el de Google). El sistema sigue
mostrando el servicio ligado hasta que se reinicie la tablet. Esta ROM **no deja** desactivar apps ni componentes por cable
(`pm disable-user` da `SecurityException`): quitar Fotos, Vídeos, Música, Hangouts, Google+ y el antivirus hay que hacerlo en
Ajustes › Apps. Con el sistema en calma el arranque en frío medido fue de **1,8 s** hasta el panel a la vista.

## Emparejar la tablet desde la Mac por cable

Escribir 64 caracteres en la tablet es incómodo. Con el cable: toca el campo **Token** en la tablet y ejecuta tú,
en la Mac, este comando (el token no se muestra en ninguna parte):

```bash
~/Library/Android/sdk/platform-tools/adb shell input text "$(cat "$HOME/Library/Application Support/mac-agent/.token")"
```

La **Dirección** puede quedar vacía (se busca sola por el túnel) o ser `http://IP-de-la-Mac:8787` si usas la red
local (ver «Red local» en `mac-agent/README.md`). La app permite `http://` y contenido mixto por eso.

Arranque en frío: en esta tablet la app tarda unos 10-15 s en mostrar el panel (arranque de Android + comprobar
el certificado + descargar la página). Mientras, se ve la pantalla oscura.

## Certificados en Android 6 (por qué la app lleva dos raíces)

Let's Encrypt cambió su jerarquía y hoy casi todo (juliangonzalez.lat en Vercel, Open-Meteo, GitHub) cuelga de
las raíces **ISRG Root X1 / X2**, que Android trae desde la 7.1.1. En Android 6 el WebView las rechaza
(`net_error -202`) y la pantalla se queda **en blanco**, sin siquiera el aviso de «sin conexión».

La app lo resuelve en `Confianza.kt`: lleva las dos raíces (públicas, en `res/raw/`, sacadas del llavero del
sistema de macOS) y, cuando el WebView rechaza un certificado «no confiable», abre ella misma una conexión TLS
al mismo sitio validándola con esas raíces. Solo si la cadena es válida (fechas y nombre incluidos) **y** el
certificado es exactamente el que rechazó el WebView, le dice que siga. Caducado, de otro nombre o falso: se
rechaza igual. El navegador Chrome de la tablet sigue sin confiar en esos sitios; solo la app lo arregla.

Las raíces vencen en 2035 (X1) y 2040 (X2). Si Let's Encrypt cambia de raíz otra vez, habrá que añadir la nueva.

El WebView de esta tablet es el **95** (no el 106): el panel no puede usar APIs posteriores (p. ej.
`AbortSignal.timeout`, de Chrome 103).

## Depurar con el cable

```bash
adb logcat -s Confianza            # qué certificados se verifican
adb forward tcp:9222 localabstract:$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | tail -1)
# luego abre chrome://inspect en Chrome y pulsa «inspect» en el WebView de la app
```

## Modo noche y cuidado de la tablet

- **Modo noche** (de 22:00 a 6:00, o con el botón de la luna del Dock): pantalla negra con solo la
  hora en ámbar apagado, y la app baja el **brillo real** al mínimo. Un toque, la palabra clave, una
  alarma o un recordatorio la despiertan un minuto. El brillo solo se cambia para esta app (no toca
  el ajuste del sistema y se deshace al salir). En **Voz** puedes subirlo hasta el 30 %.
- La YT3-850F es una pantalla **LCD, no AMOLED**: el negro no apaga píxeles, solo la luz de fondo
  baja. Por eso lo que cuenta es el brillo mínimo y no el color negro.
- Por la noche el panel de debajo no se pinta, la hora se mueve unos píxeles cada minuto (para que
  la pantalla no se marque) y el panel consulta a la Mac cada 30 s en vez de seguirla en vivo.
- **Batería de la tablet**: el panel muestra su nivel y temperatura (tarjeta «Esta tablet» en
  «Mac y Casa» y un icono en la barra de arriba) y avisa si está caliente (≥ 40 °C), si se
  descarga sin cargador o si lleva más de 6 h al 100 % enchufada.
- Lo que más desgasta una batería de litio es el calor y vivir al 100 %. Lo mejor es mantenerla
  entre 40 y 80 %: un **enchufe con temporizador** (o uno Wi-Fi) es la forma de lograrlo.

## Detalles

- **Uso de RAM**: unos 25 MB la app y Porcupine, más el WebView. Sin AndroidX,
  solo APIs del sistema.
- **Seguridad**: el puente `AndroidAsistente` solo existe para el dominio
  configurado. Cualquier enlace fuera de él se bloquea, así ninguna otra página
  puede usar el micrófono. La AccessKey queda guardada solo en la tablet.
- **Sin conexión**: si el panel no carga, la app muestra una pantalla propia,
  reintenta cada 15 s y ofrece abrir los ajustes (por si la URL está mal).
- **Depuración**: el APK debug permite inspeccionar el WebView desde Chrome en
  la Mac (`chrome://inspect`) con la tablet conectada por USB.
- **Batería**: si la tablet queda siempre enchufada, la batería puede
  hincharse con los años. Un enchufe con temporizador (p. ej. que corte unas
  horas de madrugada) ayuda.
