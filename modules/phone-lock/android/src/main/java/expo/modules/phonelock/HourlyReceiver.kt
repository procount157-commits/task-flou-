package expo.modules.phonelock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Fires at the top of each hour, and after a restart to put the hourly alarm back. */
class HourlyReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!Hourly.isEnabled(context)) return
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) Hourly.show(context, false)
    Hourly.scheduleNext(context)
  }
}
