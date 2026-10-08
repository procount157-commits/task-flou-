package expo.modules.phonelock

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PhoneLockModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val policy: DevicePolicyManager
    get() = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
  private val admin: ComponentName
    get() = ComponentName(context, LockAdminReceiver::class.java)

  override fun definition() = ModuleDefinition {
    Name("PhoneLock")

    Function("isAdmin") {
      policy.isAdminActive(admin)
    }

    // Opens the system screen where the user grants (or refuses) the screen-lock right.
    Function("requestAdmin") { explanation: String ->
      val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
        .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin)
        .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, explanation)
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    // Must be given up before the app can be uninstalled.
    Function("removeAdmin") {
      if (policy.isAdminActive(admin)) policy.removeActiveAdmin(admin)
    }

    Function("lockNow") {
      val allowed = policy.isAdminActive(admin)
      if (allowed) policy.lockNow()
      allowed
    }

    // Locks the screen and keeps re-locking it for the given minutes (capped at three hours).
    Function("startLock") { minutes: Int ->
      val allowed = policy.isAdminActive(admin)
      if (allowed) {
        val endAt = System.currentTimeMillis() + minutes.coerceIn(1, 180) * 60_000L
        ContextCompat.startForegroundService(context, Intent(context, LockService::class.java).putExtra(LockService.EXTRA_END, endAt))
      }
      allowed
    }

    Function("lockEndsAt") {
      context.getSharedPreferences(LockService.PREFS, Context.MODE_PRIVATE).getLong(LockService.KEY_END, 0L).toDouble()
    }

    // Screen pinning: keeps this app in front; Android lets the user leave by holding Back and Overview.
    Function("pin") {
      appContext.currentActivity?.startLockTask()
    }

    Function("unpin") {
      appContext.currentActivity?.stopLockTask()
    }
  }
}
