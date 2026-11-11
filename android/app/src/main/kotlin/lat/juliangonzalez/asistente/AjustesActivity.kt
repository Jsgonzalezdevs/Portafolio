package lat.juliangonzalez.asistente

import ai.picovoice.porcupine.Porcupine
import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast

/** Ajustes nativos, sin XML ni AndroidX: menos RAM y menos APK en una tablet de 1 GB. */
class AjustesActivity : Activity() {

    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        val prefs = Preferencias(this)
        val dp = { v: Int -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt() }

        val columna = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(16), dp(24), dp(24))
        }
        fun titulo(t: String) = columna.addView(TextView(this).apply {
            text = t
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setPadding(0, dp(18), 0, dp(4))
        })
        fun nota(t: String) = columna.addView(TextView(this).apply {
            text = t
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            alpha = 0.7f
        })

        titulo("Dirección del panel")
        val url = EditText(this).apply {
            setText(prefs.url)
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
        }
        columna.addView(url, MATCH_PARENT, WRAP_CONTENT)

        titulo("AccessKey de Picovoice (palabra clave)")
        val clave = EditText(this).apply {
            setText(prefs.accessKey)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true
            hint = "Gratis en console.picovoice.ai"
        }
        columna.addView(clave, MATCH_PARENT, WRAP_CONTENT)
        nota("Sin AccessKey no hay palabra clave, pero el botón de micrófono del panel sigue funcionando.")

        titulo("Palabra clave")
        val opciones = Porcupine.BuiltInKeyword.entries.map { it.name } + Preferencias.PERSONALIZADA
        val nombres = opciones.map {
            if (it == Preferencias.PERSONALIZADA) "Personalizada (palabra.ppn + modelo.pv)" else it.lowercase().replace('_', ' ')
        }
        val palabra = Spinner(this).apply {
            adapter = ArrayAdapter(this@AjustesActivity, android.R.layout.simple_spinner_dropdown_item, nombres)
            setSelection(opciones.indexOf(prefs.palabra).coerceAtLeast(0))
        }
        columna.addView(palabra, MATCH_PARENT, WRAP_CONTENT)
        nota(
            "Las incorporadas están en inglés («jarvis», «computer»…). Para una en español créala en " +
                "console.picovoice.ai y copia los archivos a:\n${getExternalFilesDir(null)?.absolutePath}"
        )

        titulo("Sensibilidad")
        val valor = TextView(this)
        val sensibilidad = SeekBar(this).apply {
            max = 100
            progress = (prefs.sensibilidad * 100).toInt()
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar?, p: Int, deUsuario: Boolean) {
                    valor.text = "${p}% — más alto oye mejor pero se activa más por error"
                }
                override fun onStartTrackingTouch(s: SeekBar?) {}
                override fun onStopTrackingTouch(s: SeekBar?) {}
            })
        }
        valor.text = "${sensibilidad.progress}% — más alto oye mejor pero se activa más por error"
        columna.addView(sensibilidad, MATCH_PARENT, WRAP_CONTENT)
        columna.addView(valor)

        val guardar = Button(this).apply {
            text = "Guardar"
            setOnClickListener {
                val nueva = url.text.toString().trim()
                if (!nueva.startsWith("https://")) {
                    Toast.makeText(this@AjustesActivity, "La dirección debe empezar por https://", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                prefs.url = nueva
                prefs.accessKey = clave.text.toString()
                prefs.palabra = opciones[palabra.selectedItemPosition]
                prefs.sensibilidad = sensibilidad.progress / 100f
                setResult(RESULT_OK)
                finish()
            }
        }
        columna.addView(guardar, MATCH_PARENT, WRAP_CONTENT)
        (guardar.layoutParams as LinearLayout.LayoutParams).topMargin = dp(24)

        setContentView(ScrollView(this).apply { addView(columna) })
    }
}
