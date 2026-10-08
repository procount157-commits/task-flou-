package expo.modules.phonelock

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.content.ContextCompat

/**
 * Holds the phone locked until [endAt]: every time the screen comes back on before then, it is turned off again.
 * The lock ends on its own at the deadline; restarting the phone ends it early, because nothing restarts this service.
 */
class LockService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var endAt = 0L
  private var listening = false

  private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      enforce()
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val requested = intent?.getLongExtra(EXTRA_END, 0L) ?: 0L
    endAt = if (requested > 0L) requested else prefs.getLong(KEY_END, 0L)
    prefs.edit().putLong(KEY_END, endAt).apply()

    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    if (!listening) {
      val filter = IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_USER_PRESENT)
      }
      ContextCompat.registerReceiver(this, screenReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
      listening = true
    }

    handler.removeCallbacksAndMessages(null)
    handler.postDelayed({ finish() }, (endAt - System.currentTimeMillis()).coerceAtLeast(0L))
    enforce()
    return START_STICKY
  }

  private fun enforce() {
    if (System.currentTimeMillis() >= endAt) {
      finish()
      return
    }
    try {
      (getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager).lockNow()
    } catch (e: SecurityException) {
      // the admin right was taken away, so there is nothing left to enforce
      finish()
    }
  }

  private fun finish() {
    getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_END).apply()
    handler.removeCallbacksAndMessages(null)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    if (listening) {
      unregisterReceiver(screenReceiver)
      listening = false
    }
    handler.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Focus lock", NotificationManager.IMPORTANCE_LOW))
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
    return builder
      .setContentTitle("🔒 Focus lock")
      .setContentText("The phone stays locked until the focus period ends")
      .setSmallIcon(android.R.drawable.ic_lock_lock)
      .setOngoing(true)
      .build()
  }

  companion object {
    const val PREFS = "phone_lock"
    const val KEY_END = "endAt"
    const val EXTRA_END = "endAt"
    const val CHANNEL = "focus-lock"
    const val NOTIFICATION_ID = 7341
  }
}
