package lat.juliangonzalez.asistente

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.File
import java.io.IOException
import java.io.InputStream

/**
 * El panel (/app) viaja dentro de la app y se sirve desde aquí, sin red.
 *
 * Por qué: en esta tablet pedir la página a internet cuesta 4-5 s la primera vez (DNS, conexión, TLS con raíces
 * que Android 6 no trae, y nuestra propia verificación del certificado). La página pesa ~100 KB: sale mucho
 * más a cuenta llevarla puesta. Además abre aunque no haya internet.
 *
 * La página sigue «viviendo» en https://www.juliangonzalez.lat/app (mismo origen, mismo localStorage, mismo
 * CORS con la Mac): solo cambia de dónde salen sus bytes. `ActualizadorWeb` la mantiene al día.
 *
 * Primero se mira la copia descargada (filesDir/web) y, si no hay, la que lleva el APK (assets/web).
 */
class PanelLocal(private val contexto: Context) {

    init {
        // Si la app se acaba de instalar o actualizar, lo que lleva dentro es lo más nuevo: se descarta lo bajado antes.
        val prefs = contexto.getSharedPreferences("web", Context.MODE_PRIVATE)
        val instalada = contexto.packageManager.getPackageInfo(contexto.packageName, 0).lastUpdateTime
        if (prefs.getLong("apk", 0L) != instalada) {
            File(contexto.filesDir, "web").deleteRecursively()
            prefs.edit().putLong("apk", instalada).apply()
        }
    }

    /** La respuesta local de esta petición, o null si debe ir a la red (otro sitio, otra ruta, no GET). */
    fun responder(peticion: WebResourceRequest, host: String?): WebResourceResponse? {
        if (host == null || peticion.method != "GET") return null
        val url = peticion.url
        if (url.scheme != "https" || url.host != host) return null
        val ruta = url.path ?: return null
        val relativa = relativa(ruta) ?: return null
        val flujo = abrir(contexto, relativa) ?: return null
        return WebResourceResponse(tipo(relativa), "utf-8", 200, "OK", mapOf("Cache-Control" to "no-cache"), flujo)
    }

    companion object {
        private val ARCHIVO_SEGURO = Regex("^[A-Za-z0-9_.-]+$")

        /** Ruta del sitio → archivo local, solo para lo que usa el panel. */
        fun relativa(ruta: String): String? = when {
            ruta == "/app" || ruta == "/app/" -> "app/index.html"
            ruta == "/favicon.svg" -> "favicon.svg"
            ruta.startsWith("/assets/") -> ruta.removePrefix("/assets/").takeIf { ARCHIVO_SEGURO.matches(it) }?.let { "assets/$it" }
            else -> null
        }

        fun tipo(relativa: String): String = when (relativa.substringAfterLast('.', "")) {
            "html" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "woff2" -> "font/woff2"
            "json", "webmanifest" -> "application/json"
            else -> "application/octet-stream"
        }

        fun copiaDescargada(contexto: Context, relativa: String) = File(File(contexto.filesDir, "web"), relativa)

        fun abrir(contexto: Context, relativa: String): InputStream? {
            val copia = copiaDescargada(contexto, relativa)
            if (copia.isFile) return copia.inputStream()
            return try {
                contexto.assets.open("web/$relativa")
            } catch (_: IOException) {
                null
            }
        }

        fun leer(contexto: Context, relativa: String): ByteArray? = try {
            abrir(contexto, relativa)?.use { it.readBytes() }
        } catch (_: IOException) {
            null
        }

        fun existe(contexto: Context, relativa: String): Boolean = abrir(contexto, relativa)?.also { it.close() } != null
    }
}
