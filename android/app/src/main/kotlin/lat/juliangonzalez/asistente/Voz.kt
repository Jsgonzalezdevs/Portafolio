package lat.juliangonzalez.asistente

import ai.picovoice.porcupine.Porcupine
import ai.picovoice.porcupine.PorcupineActivationException
import ai.picovoice.porcupine.PorcupineException
import ai.picovoice.porcupine.PorcupineManager
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * Ciclo de voz de la tablet, todo en el hilo principal:
 *
 *   VIGILANDO (Porcupine) ──palabra──▶ ESCUCHANDO (SpeechRecognizer)
 *        ▲                                   │ texto → la web lo manda a /chat
 *        └──────── HABLANDO (TTS) ◀── hablar() desde la web
 *
 * Solo un componente usa el micrófono a la vez: Porcupine se detiene antes de
 * reconocer y vuelve a arrancar cuando termina de hablar (así no se oye a sí mismo).
 * Sin AccessKey de Picovoice no hay palabra clave, pero el botón de micrófono funciona.
 */
class Voz(private val contexto: Context, private val emitir: (JSONObject) -> Unit) {

    private enum class Fase { APAGADA, VIGILANDO, ESCUCHANDO, ESPERANDO_RESPUESTA, HABLANDO }

    private val principal = Handler(Looper.getMainLooper())
    private val prefs = Preferencias(contexto)
    private var fase = Fase.APAGADA
    private var activa = false

    private var porcupine: PorcupineManager? = null
    private var errorPalabra: String? = null
    private var reconocedor: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsListo = false
    private var escucharTrasHablar = false
    private val tono by lazy { ToneGenerator(AudioManager.STREAM_MUSIC, 70) }

    /** Si la web no responde (sin red, error), no nos quedamos sordos para siempre. */
    private val rescate = Runnable {
        if (fase == Fase.ESPERANDO_RESPUESTA) vigilar()
    }

    val estado: JSONObject
        get() = JSONObject()
            .put("palabraClave", porcupine != null)
            .put("palabra", nombrePalabra())
            .put("error", errorPalabra ?: JSONObject.NULL)
            .put("reconocimiento", SpeechRecognizer.isRecognitionAvailable(contexto))
            .put("fase", fase.name.lowercase())

    fun iniciar() {
        if (activa) return
        activa = true
        if (tts == null) prepararTts()
        if (porcupine == null) crearPorcupine()
        vigilar()
        emitir(evento("estado-voz").put("estado", estado))
    }

    fun detener() {
        activa = false
        principal.removeCallbacks(rescate)
        detenerPorcupine()
        reconocedor?.cancel()
        tts?.stop()
        fase = Fase.APAGADA
    }

    fun liberar() {
        detener()
        porcupine?.delete()
        porcupine = null
        reconocedor?.destroy()
        reconocedor = null
        tts?.shutdown()
        tts = null
        tono.release()
    }

    /** Recarga la palabra clave tras cambiar los ajustes. */
    fun reconfigurar() {
        val estabaActiva = activa
        detener()
        porcupine?.delete()
        porcupine = null
        if (estabaActiva) iniciar()
    }

    // ---------- Palabra clave ----------

    private fun nombrePalabra(): String = when (prefs.palabra) {
        Preferencias.PERSONALIZADA -> "personalizada"
        else -> prefs.palabra.lowercase().replace('_', ' ')
    }

    private fun crearPorcupine() {
        errorPalabra = null
        if (prefs.accessKey.isBlank()) {
            errorPalabra = "Sin AccessKey de Picovoice: usa el botón de micrófono."
            return
        }
        try {
            val constructor = PorcupineManager.Builder()
                .setAccessKey(prefs.accessKey)
                .setSensitivity(prefs.sensibilidad)
                .setErrorCallback { e -> principal.post { fallaPalabra(e) } }
            if (prefs.palabra == Preferencias.PERSONALIZADA) {
                // Archivos generados en console.picovoice.ai, copiados con adb (ver android/README.md).
                val carpeta = contexto.getExternalFilesDir(null)
                val palabra = File(carpeta, "palabra.ppn")
                val modelo = File(carpeta, "modelo.pv")
                if (!palabra.exists()) {
                    errorPalabra = "Falta palabra.ppn en ${carpeta?.absolutePath}"
                    return
                }
                constructor.setKeywordPath(palabra.absolutePath)
                if (modelo.exists()) constructor.setModelPath(modelo.absolutePath)
            } else {
                constructor.setKeyword(Porcupine.BuiltInKeyword.valueOf(prefs.palabra))
            }
            porcupine = constructor.build(contexto) { principal.post { alDetectarPalabra() } }
        } catch (e: PorcupineActivationException) {
            errorPalabra = "Picovoice rechazó la AccessKey: ${e.message}"
        } catch (e: PorcupineException) {
            errorPalabra = "No se pudo iniciar la palabra clave: ${e.message}"
        } catch (e: IllegalArgumentException) {
            errorPalabra = "Palabra clave desconocida: ${prefs.palabra}"
        }
    }

    private fun fallaPalabra(e: PorcupineException) {
        errorPalabra = e.message
        emitir(evento("error").put("mensaje", "Palabra clave: ${e.message}"))
    }

    private fun arrancarPorcupine() {
        try {
            porcupine?.start()
        } catch (e: PorcupineException) {
            fallaPalabra(e)
        }
    }

    private fun detenerPorcupine() {
        try {
            porcupine?.stop()
        } catch (_: PorcupineException) {
        }
    }

    private fun vigilar() {
        principal.removeCallbacks(rescate)
        if (!activa) return
        fase = Fase.VIGILANDO
        arrancarPorcupine()
        emitir(evento("vigilando"))
    }

    private fun alDetectarPalabra() {
        if (fase != Fase.VIGILANDO) return
        emitir(evento("palabra"))
        escuchar()
    }

    // ---------- Reconocimiento (voz → texto) ----------

    fun escuchar() {
        if (!activa) return
        if (!SpeechRecognizer.isRecognitionAvailable(contexto)) {
            emitir(evento("error").put("mensaje", "Esta tablet no tiene reconocimiento de voz (instala la app de Google)."))
            return
        }
        principal.removeCallbacks(rescate)
        tts?.stop()
        detenerPorcupine()
        fase = Fase.ESCUCHANDO
        tono.startTone(ToneGenerator.TONE_PROP_ACK, 120)
        emitir(evento("escuchando"))
        // Pausa corta para que el pitido no entre en la grabación.
        principal.postDelayed({ if (fase == Fase.ESCUCHANDO) iniciarReconocedor() }, 250)
    }

    private fun iniciarReconocedor() {
        val r = reconocedor ?: SpeechRecognizer.createSpeechRecognizer(contexto).also {
            it.setRecognitionListener(oyente)
            reconocedor = it
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-CO")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, contexto.packageName)
        r.startListening(intent)
    }

    private val oyente = object : RecognitionListener {
        override fun onResults(resultados: Bundle?) {
            val texto = resultados?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()
            if (texto.isNullOrEmpty()) return sinVoz()
            fase = Fase.ESPERANDO_RESPUESTA
            emitir(evento("texto").put("texto", texto))
            principal.postDelayed(rescate, 45_000)
        }

        override fun onPartialResults(parciales: Bundle?) {
            val texto = parciales?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            if (!texto.isNullOrBlank()) emitir(evento("parcial").put("texto", texto))
        }

        override fun onError(codigo: Int) {
            if (fase != Fase.ESCUCHANDO) return
            when (codigo) {
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> sinVoz()
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> {
                    emitir(evento("error").put("mensaje", "El reconocimiento de voz necesita internet."))
                    vigilar()
                }
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                    emitir(evento("error").put("mensaje", "Falta el permiso del micrófono."))
                    vigilar()
                }
                else -> {
                    // ERROR_RECOGNIZER_BUSY / CLIENT: se recrea el reconocedor la próxima vez.
                    reconocedor?.destroy()
                    reconocedor = null
                    sinVoz()
                }
            }
        }

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun sinVoz() {
        emitir(evento("sin-voz"))
        vigilar()
    }

    // ---------- Texto → voz ----------

    private fun prepararTts() {
        tts = TextToSpeech(contexto) { estado ->
            val motor = tts ?: return@TextToSpeech
            if (estado != TextToSpeech.SUCCESS) return@TextToSpeech
            val idiomas = listOf("es-CO", "es-US", "es-MX", "es-ES", "es").map(Locale::forLanguageTag)
            ttsListo = idiomas.any { motor.setLanguage(it) >= TextToSpeech.LANG_AVAILABLE }
            if (!ttsListo) emitir(evento("error").put("mensaje", "No hay voz en español: instálala en Ajustes › Idioma › Texto a voz."))
            motor.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) {
                    principal.post { terminoDeHablar() }
                }

                @Deprecated("API antigua, se mantiene por Android 6")
                override fun onError(id: String?) {
                    principal.post { terminoDeHablar() }
                }
            })
        }
    }

    /** Llamado por la web con la respuesta de /chat. */
    fun hablar(texto: String, escucharDespues: Boolean) {
        if (!activa) return
        principal.removeCallbacks(rescate)
        escucharTrasHablar = escucharDespues
        val motor = tts
        if (motor == null || !ttsListo || texto.isBlank()) return terminoDeHablar()
        detenerPorcupine()
        reconocedor?.cancel()
        fase = Fase.HABLANDO
        emitir(evento("hablando"))
        motor.speak(texto, TextToSpeech.QUEUE_FLUSH, Bundle(), "respuesta")
    }

    /** La web avisa que no habrá respuesta hablada (error, mensaje vacío…). */
    fun listo() {
        if (fase == Fase.ESPERANDO_RESPUESTA || fase == Fase.HABLANDO) {
            tts?.stop()
            vigilar()
        }
    }

    private fun terminoDeHablar() {
        if (!activa) return
        if (escucharTrasHablar) {
            escucharTrasHablar = false
            escuchar()
        } else {
            vigilar()
        }
    }

    private fun evento(tipo: String) = JSONObject().put("tipo", tipo)
}
