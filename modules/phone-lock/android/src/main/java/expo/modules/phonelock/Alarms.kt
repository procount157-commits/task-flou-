package expo.modules.phonelock

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/** Books real alarm-clock alarms and remembers them, so they can be put back after a restart. */
object Alarms {
  private const val PREFS = "alarms"
  private const val KEY = "list"
  const val EXTRA_ID = "id"
  const val EXTRA_SOUND = "sound"
  const val EXTRA_LABEL = "label"

  private fun pending(context: Context, code: Int, id: String, sound: String, label: String): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      30_000 + code,
      Intent(context, AlarmReceiver::class.java).putExtra(EXTRA_ID, id).putExtra(EXTRA_SOUND, sound).putExtra(EXTRA_LABEL, label),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

  fun openAppIntent(context: Context, id: String, requestCode: Int): PendingIntent {
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("hayati://alarm?ring=$id"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, requestCode, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun set(context: Context, code: Int, at: Long, id: String, sound: String, label: String) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val fire = pending(context, code, id, sound, label)
    val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
    if (exact) {
      // an alarm-clock alarm is the one kind Android will not delay to save battery
      alarms.setAlarmClock(AlarmManager.AlarmClockInfo(at, openAppIntent(context, id, 31_000 + code)), fire)
    } else {
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire)
    }
  }

  private fun read(context: Context): JSONArray =
    try { JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]")) } catch (e: Exception) { JSONArray() }

  private fun write(context: Context, list: JSONArray) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, list.toString()).apply()
  }

  fun schedule(context: Context, code: Int, at: Long, id: String, sound: String, label: String) {
    set(context, code, at, id, sound, label)
    val list = read(context)
    list.put(JSONObject().put("code", code).put("at", at).put("id", id).put("sound", sound).put("label", label))
    write(context, list)
  }

  fun clear(context: Context) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val list = read(context)
    for (i in 0 until list.length()) {
      val item = list.optJSONObject(i) ?: continue
      alarms.cancel(pending(context, item.optInt("code"), item.optString("id"), item.optString("sound"), item.optString("label")))
    }
    write(context, JSONArray())
  }

  /** After a restart Android has dropped every alarm; this books the ones still in the future again. */
  fun restore(context: Context) {
    val list = read(context)
    val now = System.currentTimeMillis()
    for (i in 0 until list.length()) {
      val item = list.optJSONObject(i) ?: continue
      val at = item.optLong("at")
      if (at > now) set(context, item.optInt("code"), at, item.optString("id"), item.optString("sound"), item.optString("label"))
    }
  }
}
