package expo.modules.phonelock

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/** A scheduled lock coming due: starts the same hard lock the "lock now" button starts. */
class LockAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val policy = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    if (!policy.isAdminActive(ComponentName(context, LockAdminReceiver::class.java))) return
    val minutes = intent.getIntExtra(EXTRA_MINUTES, 25).coerceIn(1, 180)
    val endAt = System.currentTimeMillis() + minutes * 60_000L
    try {
      ContextCompat.startForegroundService(context, Intent(context, LockService::class.java).putExtra(LockService.EXTRA_END, endAt))
    } catch (e: Exception) {
      // the system refused a background start; lock the screen once rather than not at all
      policy.lockNow()
    }
  }

  companion object {
    const val EXTRA_MINUTES = "minutes"
  }
}
