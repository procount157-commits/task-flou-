package expo.modules.phonelock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/** An alarm coming due: hands over to the service that rings until the challenge is solved. */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val start = Intent(context, AlarmService::class.java)
      .putExtra(Alarms.EXTRA_ID, intent.getStringExtra(Alarms.EXTRA_ID) ?: "")
      .putExtra(Alarms.EXTRA_SOUND, intent.getStringExtra(Alarms.EXTRA_SOUND) ?: "")
      .putExtra(Alarms.EXTRA_LABEL, intent.getStringExtra(Alarms.EXTRA_LABEL) ?: "")
    try {
      ContextCompat.startForegroundService(context, start)
    } catch (e: Exception) {
      // nothing more can be done from a receiver if the system refuses the start
    }
  }
}
