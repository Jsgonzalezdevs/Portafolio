package lat.juliangonzalez.asistente

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.BatteryManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * Kiosco: el dashboard de /app a pantalla completa, siempre encendido, con un
 * puente JS (`window.AndroidAsistente`) para la voz nativa.
 *
 * El puente solo se expone al origen configurado: cualquier navegación fuera
 * de él se bloquea, así ninguna otra página puede usar el micrófono.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var voz: Voz
    private lateinit var prefs: Preferencias
    private val principal = Handler(Looper.getMainLooper())
    private var origen = ""
    private var urlCargada = ""
    private var nocheNativa = false
    private var ultimaClaveBateria: String? = null

    private val reintentar = Runnable { cargar() }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        prefs = Preferencias(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0b0d12"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.setSupportZoom(false)
            settings.allowFileAccess = false
            webViewClient = Cliente()
            addJavascriptInterface(Puente(), "AndroidAsistente")
        }
        setContentView(web)

        voz = Voz(this) { evento -> enviarALaWeb(evento) }
        cargar()
    }

    private fun cargar() {
        principal.removeCallbacks(reintentar)
        urlCargada = prefs.url
        origen = Uri.parse(urlCargada).let { "${it.scheme}://${it.authority}" }
        web.loadUrl(urlCargada)
    }

    override fun onResume() {
        super.onResume()
        pantallaCompleta()
        ultimaClaveBateria = null
        registerReceiver(receptorBateria, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        // Ajustes pudo cambiar la URL o la palabra clave.
        if (prefs.url != urlCargada) cargar()
        if (tienePermisoMicro()) voz.iniciar() else pedirPermisoMicro()
    }

    override fun onPause() {
        try {
            unregisterReceiver(receptorBateria)
        } catch (_: IllegalArgumentException) {
        }
        voz.detener()
        super.onPause()
    }

    override fun onDestroy() {
        voz.liberar()
        web.destroy()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(conFoco: Boolean) {
        super.onWindowFocusChanged(conFoco)
        if (conFoco) pantallaCompleta()
    }

    @Deprecated("Activity.onBackPressed sigue siendo la vía en Android 6")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() // Kiosco: atrás nunca cierra la app.
    }

    @Suppress("DEPRECATION")
    private fun pantallaCompleta() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    // ---------- Permiso de micrófono (Android 6 es el primero con permisos en tiempo de ejecución) ----------

    private fun tienePermisoMicro() = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun pedirPermisoMicro() = requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), PERMISO_MICRO)

    override fun onRequestPermissionsResult(codigo: Int, permisos: Array<out String>, resultados: IntArray) {
        super.onRequestPermissionsResult(codigo, permisos, resultados)
        if (codigo != PERMISO_MICRO) return
        if (resultados.firstOrNull() == PackageManager.PERMISSION_GRANTED) voz.iniciar()
        else enviarALaWeb(JSONObject().put("tipo", "error").put("mensaje", "Sin permiso de micrófono no hay voz."))
    }

    // ---------- Comunicación con la web ----------

    private fun enviarALaWeb(evento: JSONObject) {
        val js = "window.dispatchEvent(new CustomEvent('asistente-nativo',{detail:$evento}))"
        principal.post { web.evaluateJavascript(js, null) }
    }

    /** Métodos llamables desde JS. Llegan en un hilo del WebView: todo se pasa al principal. */
    private inner class Puente {
        @JavascriptInterface fun version(): String = packageManager.getPackageInfo(packageName, 0).versionName ?: ""

        @JavascriptInterface fun estadoVoz(): String = voz.estado.toString()

        @JavascriptInterface fun escuchar() { principal.post { voz.escuchar() } }

        @JavascriptInterface fun hablar(texto: String?, escucharDespues: Boolean) {
            principal.post { voz.hablar(texto.orEmpty(), escucharDespues) }
        }

        @JavascriptInterface fun listo() { principal.post { voz.listo() } }

        @JavascriptInterface fun ajustes() { principal.post { abrirAjustes() } }

        /** Modo noche: brillo al mínimo (true) o el que haya elegido el usuario en el sistema (false). */
        @JavascriptInterface fun brillo(noche: Boolean) { principal.post { aplicarBrillo(noche) } }

        @JavascriptInterface fun bateria(): String = leerBateria().toString()
    }

    /**
     * El brillo se cambia solo para la ventana de esta app (no toca el ajuste del sistema, no pide
     * permisos y se deshace solo al salir de la app). El sistema no baja del mínimo de la pantalla.
     */
    private fun aplicarBrillo(noche: Boolean) {
        nocheNativa = noche
        val ajustes = window.attributes
        ajustes.screenBrightness = if (noche) prefs.brilloNochePct / 100f else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        window.attributes = ajustes
    }

    // ---------- Batería de la tablet ----------

    private fun leerBateria(): JSONObject {
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return JSONObject()
        val nivel = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val escala = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        val estado = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val temperatura = i.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
        return JSONObject()
            .put("nivel", if (nivel >= 0 && escala > 0) nivel * 100 / escala else JSONObject.NULL)
            .put("cargando", estado == BatteryManager.BATTERY_STATUS_CHARGING)
            .put("enchufada", i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0)
            // El sistema la da en décimas de grado.
            .put("temperaturaC", if (temperatura == Int.MIN_VALUE) JSONObject.NULL else temperatura / 10.0)
    }

    /** Avisa al panel solo cuando cambia algo que importa (el sistema avisa muy a menudo). */
    private val receptorBateria = object : BroadcastReceiver() {
        override fun onReceive(contexto: Context, intent: Intent) {
            val b = leerBateria()
            val clave = "${b.opt("nivel")}|${b.opt("cargando")}|${b.opt("enchufada")}|${Math.round(b.optDouble("temperaturaC", -99.0))}"
            if (clave == ultimaClaveBateria) return
            ultimaClaveBateria = clave
            enviarALaWeb(b.put("tipo", "bateria"))
        }
    }

    private fun abrirAjustes() = startActivityForResult(Intent(this, AjustesActivity::class.java), AJUSTES)

    @Deprecated("startActivityForResult es lo disponible sin AndroidX")
    override fun onActivityResult(codigo: Int, resultado: Int, datos: Intent?) {
        super.onActivityResult(codigo, resultado, datos)
        if (codigo == AJUSTES && resultado == RESULT_OK) {
            voz.reconfigurar()
            aplicarBrillo(nocheNativa) // por si cambió el brillo de noche
        }
    }

    private inner class Cliente : WebViewClient() {
        override fun shouldOverrideUrlLoading(vista: WebView, peticion: WebResourceRequest): Boolean {
            val url = peticion.url
            if (url.scheme == "asistente" && url.host == "ajustes") {
                abrirAjustes()
                return true
            }
            if (url.scheme == "asistente" && url.host == "reintentar") {
                cargar()
                return true
            }
            return "${url.scheme}://${url.authority}" != origen // fuera del dominio: bloqueado
        }

        @Deprecated("Versión para Android 6 (API 23)")
        override fun shouldOverrideUrlLoading(vista: WebView, url: String): Boolean =
            shouldOverrideUrlLoading(vista, SimplePeticion(Uri.parse(url)))

        override fun onReceivedError(vista: WebView, peticion: WebResourceRequest, error: WebResourceError) {
            if (peticion.isForMainFrame) sinConexion(error.description?.toString() ?: "")
        }
    }

    /** Pantalla propia cuando no carga el panel: reintenta sola y deja abrir Ajustes (por si la URL está mal). */
    private fun sinConexion(detalle: String) {
        val html = """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="background:#0b0d12;color:#e8ecf3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
            <div><h1 style="font-weight:300">Sin conexión con el panel</h1>
            <p style="color:#8b95a7">${detalle.replace("<", "&lt;")}<br>Reintento en 15 segundos…</p>
            <p><a style="color:#5b9dff;font-size:20px;margin:0 16px" href="asistente://reintentar">Reintentar ahora</a>
            <a style="color:#5b9dff;font-size:20px;margin:0 16px" href="asistente://ajustes">Ajustes</a></p></div></body></html>
        """.trimIndent()
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
        principal.postDelayed(reintentar, 15_000)
    }

    companion object {
        private const val PERMISO_MICRO = 1
        private const val AJUSTES = 2
    }
}

/** WebResourceRequest mínimo para reutilizar la lógica de navegación en la API antigua. */
private class SimplePeticion(private val uri: Uri) : WebResourceRequest {
    override fun getUrl() = uri
    override fun isForMainFrame() = true
    override fun isRedirect() = false
    override fun hasGesture() = true
    override fun getMethod() = "GET"
    override fun getRequestHeaders(): Map<String, String> = emptyMap()
}
