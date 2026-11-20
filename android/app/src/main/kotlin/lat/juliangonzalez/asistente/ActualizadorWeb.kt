package lat.juliangonzalez.asistente

import android.content.Context
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException

/**
 * Mantiene al día la copia del panel que lleva la app (ver PanelLocal): pide /app al sitio y, si cambió, baja
 * los archivos nuevos. Así publicar en Vercel sigue llegando a la tablet sin reinstalar nada.
 *
 * Es a prueba de fallos: si algo no baja o la página no parece el panel (error de Vercel, portal de wifi…) no se
 * toca nada. Los archivos nuevos se escriben antes que la página, así nunca queda una página sin sus archivos.
 */
class ActualizadorWeb(private val contexto: Context, private val confianza: Confianza) {

    private val raiz = File(contexto.filesDir, "web")

    /** true si bajó una versión nueva. Bloquea: llamar fuera del hilo principal. */
    @Synchronized
    fun comprobar(host: String): Boolean {
        val pagina = descargar("https://$host/app") ?: return false
        if (!parecePanel(pagina)) {
            Log.w(ETIQUETA, "/app no parece el panel (${pagina.size} bytes): no se actualiza")
            return false
        }
        val actual = PanelLocal.leer(contexto, "app/index.html")
        if (actual != null && actual.contentEquals(pagina)) {
            Log.i(ETIQUETA, "El panel ya está al día")
            return false
        }

        // Todo lo que la página (y sus hojas y scripts) citan y aún no está.
        val nuevos = LinkedHashMap<String, ByteArray>()
        val citados = LinkedHashSet<String>()
        val pendientes = ArrayDeque(referencias(pagina.toString(Charsets.UTF_8), null))
        while (pendientes.isNotEmpty()) {
            val relativa = pendientes.removeFirst()
            if (!citados.add(relativa)) continue
            val bytes = if (PanelLocal.existe(contexto, relativa)) PanelLocal.leer(contexto, relativa) else descargar("https://$host/$relativa")?.also { nuevos[relativa] = it }
            if (bytes == null) {
                Log.w(ETIQUETA, "No se pudo bajar $relativa: se queda la versión anterior")
                return false
            }
            if (relativa.endsWith(".css") || relativa.endsWith(".js")) pendientes.addAll(referencias(bytes.toString(Charsets.UTF_8), relativa))
        }

        for ((relativa, bytes) in nuevos) escribir(File(raiz, relativa), bytes)
        escribir(File(raiz, "app/index.html"), pagina)
        limpiar(citados)
        Log.i(ETIQUETA, "Panel actualizado: ${nuevos.size} archivo(s) nuevo(s)")
        return true
    }

    private fun parecePanel(pagina: ByteArray): Boolean {
        if (pagina.size < 500 || pagina.size > MAX_PAGINA) return false
        val texto = pagina.toString(Charsets.UTF_8)
        return texto.contains("<title>Asistente</title>") && texto.contains("id=\"pantalla-panel\"")
    }

    private fun descargar(url: String): ByteArray? {
        val conexion = try {
            confianza.abrir(url)
        } catch (_: Exception) {
            return null
        }
        return try {
            conexion.instanceFollowRedirects = true
            if (conexion.responseCode != 200) return null
            val salida = ByteArrayOutputStream()
            conexion.inputStream.use { entrada ->
                val buffer = ByteArray(16 * 1024)
                while (true) {
                    val n = entrada.read(buffer)
                    if (n < 0) break
                    salida.write(buffer, 0, n)
                    if (salida.size() > MAX_ARCHIVO) return null
                }
            }
            salida.toByteArray()
        } catch (e: IOException) {
            Log.w(ETIQUETA, "Falló la descarga de $url: ${e.message}")
            null
        } finally {
            conexion.disconnect()
        }
    }

    private fun escribir(destino: File, bytes: ByteArray) {
        destino.parentFile?.mkdirs()
        val temporal = File(destino.parentFile, "${destino.name}.tmp")
        temporal.writeBytes(bytes)
        if (!temporal.renameTo(destino)) {
            destino.delete()
            temporal.renameTo(destino)
        }
    }

    /** Borra de lo descargado lo que la página nueva ya no usa. */
    private fun limpiar(vigentes: Set<String>) {
        File(raiz, "assets").listFiles()?.forEach { if ("assets/${it.name}" !in vigentes) it.delete() }
    }

    companion object {
        private const val ETIQUETA = "ActualizadorWeb"
        private const val MAX_PAGINA = 512 * 1024
        private const val MAX_ARCHIVO = 3 * 1024 * 1024
        private val CITA_RAIZ = Regex("""/(assets/[A-Za-z0-9_.-]+|favicon\.svg)""")
        private val CITA_VECINA = Regex("""["'(]\./([A-Za-z0-9_.-]+\.(?:js|css))""")

        /** Archivos locales (ruta relativa) que cita un texto; `desde` es el archivo que lo contiene, si no es la página. */
        fun referencias(texto: String, desde: String?): Set<String> {
            val salida = LinkedHashSet<String>()
            CITA_RAIZ.findAll(texto).forEach { salida.add(it.groupValues[1]) }
            if (desde != null) {
                val carpeta = desde.substringBeforeLast('/', "")
                CITA_VECINA.findAll(texto).forEach { salida.add(if (carpeta.isEmpty()) it.groupValues[1] else "$carpeta/${it.groupValues[1]}") }
            }
            return salida
        }
    }
}
