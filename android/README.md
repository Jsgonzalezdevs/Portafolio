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
