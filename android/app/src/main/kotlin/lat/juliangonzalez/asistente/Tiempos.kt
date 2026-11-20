package lat.juliangonzalez.asistente

import android.os.Process
import android.os.SystemClock
import android.util.Log

/**
 * Marcas de tiempo del arranque (`adb logcat -s Arranque`). Esta tablet tarda más de 10 s en abrir y sin medir
 * no se sabe por qué: cada marca dice los ms desde que se cargó la app y cuánta CPU ha gastado el proceso.
 */
object Tiempos {
    private val inicio = SystemClock.elapsedRealtime()

    fun marca(texto: String) {
        Log.i("Arranque", "+${SystemClock.elapsedRealtime() - inicio} ms (cpu ${Process.getElapsedCpuTime()} ms) $texto")
    }
}
