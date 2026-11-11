package lat.juliangonzalez.asistente

import android.content.Context

/** Ajustes de la tablet. La AccessKey de Picovoice se escribe a mano en la tablet y no sale de ella. */
class Preferencias(contexto: Context) {
    private val prefs = contexto.getSharedPreferences("asistente", Context.MODE_PRIVATE)

    var url: String
        get() = prefs.getString("url", URL_POR_DEFECTO) ?: URL_POR_DEFECTO
        set(v) = prefs.edit().putString("url", v.trim()).apply()

    var accessKey: String
        get() = prefs.getString("accessKey", "") ?: ""
        set(v) = prefs.edit().putString("accessKey", v.trim()).apply()

    /** Nombre de una palabra incorporada de Porcupine (JARVIS…) o [PERSONALIZADA]. */
    var palabra: String
        get() = prefs.getString("palabra", "JARVIS") ?: "JARVIS"
        set(v) = prefs.edit().putString("palabra", v).apply()

    var sensibilidad: Float
        get() = prefs.getFloat("sensibilidad", 0.6f)
        set(v) = prefs.edit().putFloat("sensibilidad", v.coerceIn(0f, 1f)).apply()

    companion object {
        const val URL_POR_DEFECTO = "https://www.juliangonzalez.lat/app"
        const val PERSONALIZADA = "PERSONALIZADA"
    }
}
