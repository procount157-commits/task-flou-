package expo.modules.phonelock

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import android.media.RingtoneManager
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PhoneLockModule : Module() {
  private var tonePromise: Promise? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val policy: DevicePolicyManager
    get() = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
  private val admin: ComponentName
    get() = ComponentName(context, LockAdminReceiver::class.java)

  private fun lockIntent(code: Int, minutes: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      20_000 + code,
      Intent(context, LockAlarmReceiver::class.java).putExtra(LockAlarmReceiver.EXTRA_MINUTES, minutes),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

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

    // Books a hard lock for a moment in the future; `code` identifies it so it can be cancelled.
    Function("scheduleLock") { code: Int, atMillis: Double, minutes: Int ->
      val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val pending = lockIntent(code, minutes)
      val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
      if (exact) {
        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis.toLong(), pending)
      } else {
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis.toLong(), pending)
      }
      exact
    }

    Function("cancelLock") { code: Int ->
      (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(lockIntent(code, 0))
    }

    // Turns the hourly question card on or off. `payload` is JSON with the texts to draw on it.
    Function("setHourly") { enabled: Boolean, fromHour: Int, toHour: Int, payload: String ->
      context.getSharedPreferences(Hourly.PREFS, Context.MODE_PRIVATE).edit()
        .putBoolean("enabled", enabled)
        .putInt("from", fromHour)
        .putInt("to", toHour)
        .putString("payload", payload)
        .apply()
      if (enabled) Hourly.scheduleNext(context) else Hourly.cancel(context)
    }

    // Shows the card straight away, for the test button.
    Function("showHourly") {
      Hourly.show(context, true)
    }

    // Goal and dream reminders written ahead by the app: [{at, title, body, url?}]
    Function("scheduleNudges") { json: String ->
      Nudges.schedule(context, json)
    }

    // Whether reminders and the hourly question are also read aloud.
    Function("setSpeak") { on: Boolean ->
      context.getSharedPreferences(Hourly.PREFS, Context.MODE_PRIVATE).edit().putBoolean("speak", on).apply()
    }

    Function("speak") { text: String ->
      Speaker.say(context, text)
    }

    // The live countdown capsule (Live Update on Android 16, Now Bar on Samsung).
    Function("showLive") { title: String, text: String, endAt: Double, url: String ->
      LiveUpdate.show(context, title, text, endAt.toLong(), url)
    }

    Function("clearLive") {
      LiveUpdate.clear(context)
    }

    // Sessions answered inside the notification since the app last looked, as a JSON array.
    Function("takeHourly") {
      HourlySession.take(context)
    }

    // The session was finished in the app, so the pinned question is taken down.
    Function("closeHourly") {
      HourlySession.close(context)
    }

    /* alarms */

    Function("scheduleAlarm") { code: Int, atMillis: Double, id: String, sound: String, label: String ->
      Alarms.schedule(context, code, atMillis.toLong(), id, sound, label)
    }

    Function("clearAlarms") {
      Alarms.clear(context)
    }

    // Starts ringing now: the alarm's own test button, and the ringing screen when the service is not up yet.
    Function("startRinging") { id: String, sound: String, label: String ->
      if (AlarmService.ringingId.isEmpty()) {
        ContextCompat.startForegroundService(
          context,
          Intent(context, AlarmService::class.java).putExtra(Alarms.EXTRA_ID, id).putExtra(Alarms.EXTRA_SOUND, sound).putExtra(Alarms.EXTRA_LABEL, label)
        )
      }
    }

    Function("stopRinging") {
      context.stopService(Intent(context, AlarmService::class.java))
    }

    Function("ringingId") {
      AlarmService.ringingId
    }

    // The phone's own tone chooser; resolves with the chosen tone's address and name, or null if cancelled.
    AsyncFunction("pickRingtone") { current: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
      } else {
        tonePromise = promise
        val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER)
          .putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM or RingtoneManager.TYPE_RINGTONE)
          .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
          .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
        if (current.isNotEmpty()) intent.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Uri.parse(current))
        activity.startActivityForResult(intent, TONE_REQUEST)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == TONE_REQUEST) {
        val waiting = tonePromise
        tonePromise = null
        @Suppress("DEPRECATION")
        val uri = payload.data?.getParcelableExtra<Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
        if (uri == null) {
          waiting?.resolve(null)
        } else {
          val title = try { RingtoneManager.getRingtone(context, uri)?.getTitle(context) ?: "" } catch (e: Exception) { "" }
          waiting?.resolve(mapOf("uri" to uri.toString(), "title" to title))
        }
      }
    }
  }

  companion object {
    private const val TONE_REQUEST = 7411
  }
}
