package lat.juliangonzalez.asistente

import android.content.Context
import android.net.http.SslCertificate
import android.util.Log
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * Certificados en Android 6.
 *
 * Let's Encrypt cambió sus certificados y casi todo (el sitio, Open-Meteo, GitHub) ahora cuelga de las raíces
 * ISRG Root X1 / X2, que Android trae desde la 7.1.1. En Android 6 el WebView las rechaza y el panel se queda
 * en blanco. Esta tablet no se puede actualizar, así que la app lleva esas dos raíces (son públicas) y hace
 * ella misma la verificación de la cadena.
 *
 * Solo se le dice al WebView que siga (`proceed`) cuando:
 *  1. la cadena que entrega el servidor es válida contra las raíces del sistema o estas dos (fechas y nombre
 *     del sitio incluidos: lo hace una conexión TLS normal con estas raíces), y
 *  2. el certificado de esa conexión es exactamente el que el WebView acaba de rechazar.
 * Un certificado caducado, de otro sitio o falso sigue siendo rechazado.
 */
class Confianza(private val contexto: Context) {

    private val gestor: X509TrustManager by lazy { combinar(delSistema(), propio()) }
    private val ssl: SSLContext by lazy { SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(gestor), null) } }

    /** «host:puerto|huella» de lo ya verificado, para no repetir el apretón de manos con cada archivo. */
    private val verificados: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** true si el certificado que rechazó el WebView es válido con nuestras raíces. Bloquea: llamar fuera del hilo principal. */
    fun verificar(host: String, puerto: Int, certificado: SslCertificate?): Boolean {
        val rechazado = certificado?.let(::derDe) ?: return false
        val clave = "$host:$puerto|${huella(rechazado)}"
        if (clave in verificados) return true
        val conexion = try {
            URL("https://$host:$puerto/").openConnection() as HttpsURLConnection
        } catch (_: Exception) {
            return false
        }
        return try {
            conexion.sslSocketFactory = ssl.socketFactory
            conexion.connectTimeout = TIEMPO_MS
            conexion.readTimeout = TIEMPO_MS
            conexion.instanceFollowRedirects = false
            conexion.requestMethod = "HEAD"
            // Basta con el apretón de manos TLS: valida la cadena y el nombre del sitio con nuestras raíces.
            conexion.connect()
            val hoja = conexion.serverCertificates.firstOrNull()?.encoded ?: return false
            val igual = MessageDigest.isEqual(hoja, rechazado)
            Log.i(ETIQUETA, "$host: cadena válida con nuestras raíces; ${if (igual) "es el mismo certificado que vio el WebView" else "PERO es otro certificado"}")
            if (igual) verificados.add(clave)
            igual
        } catch (e: Exception) {
            Log.w(ETIQUETA, "No se pudo verificar $host: ${e.javaClass.simpleName}: ${e.message}")
            false
        } finally {
            conexion.disconnect()
        }
    }

    /** El certificado del WebView en DER (`SslCertificate.getX509Certificate` solo existe desde Android 10). */
    private fun derDe(c: SslCertificate): ByteArray? = SslCertificate.saveState(c)?.getByteArray("x509-certificate")

    private fun huella(der: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it) }

    private fun delSistema(): X509TrustManager {
        val fabrica = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        fabrica.init(null as KeyStore?)
        return fabrica.trustManagers.filterIsInstance<X509TrustManager>().first()
    }

    private fun propio(): X509TrustManager {
        val formato = CertificateFactory.getInstance("X.509")
        val almacen = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null, null) }
        for ((nombre, recurso) in listOf("isrg-root-x1" to R.raw.isrg_root_x1, "isrg-root-x2" to R.raw.isrg_root_x2)) {
            contexto.resources.openRawResource(recurso).use { almacen.setCertificateEntry(nombre, formato.generateCertificate(it)) }
        }
        val fabrica = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        fabrica.init(almacen)
        return fabrica.trustManagers.filterIsInstance<X509TrustManager>().first()
    }

    /** Vale lo que valga para el del sistema o, si no, para el nuestro. */
    private fun combinar(sistema: X509TrustManager, nuestro: X509TrustManager) = object : X509TrustManager {
        override fun checkClientTrusted(cadena: Array<out X509Certificate>, tipo: String) = sistema.checkClientTrusted(cadena, tipo)

        override fun checkServerTrusted(cadena: Array<out X509Certificate>, tipo: String) {
            try {
                sistema.checkServerTrusted(cadena, tipo)
            } catch (_: CertificateException) {
                nuestro.checkServerTrusted(cadena, tipo)
            }
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = sistema.acceptedIssuers + nuestro.acceptedIssuers
    }

    private companion object {
        const val ETIQUETA = "Confianza"
        const val TIEMPO_MS = 8_000
    }
}
