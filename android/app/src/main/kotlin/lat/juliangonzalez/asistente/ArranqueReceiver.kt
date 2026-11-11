package lat.juliangonzalez.asistente

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Al encender la tablet, abre el panel solo (si se va la luz, vuelve sin tocar nada). */
class ArranqueReceiver : BroadcastReceiver() {
    override fun onReceive(contexto: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        contexto.startActivity(
            Intent(contexto, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
