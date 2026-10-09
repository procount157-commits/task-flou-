package expo.modules.phonelock

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import java.util.Locale

/** Reads a short text aloud with the phone's own voice, Arabic when it is available. */
object Speaker {
  fun enabled(context: Context) = context.getSharedPreferences(Hourly.PREFS, Context.MODE_PRIVATE).getBoolean("speak", true)

  fun say(context: Context, text: String, done: (() -> Unit)? = null) {
    if (text.isBlank()) { done?.invoke(); return }
    val main = Handler(Looper.getMainLooper())
    main.post {
      var tts: TextToSpeech? = null
      var finished = false
      val finish = {
        if (!finished) {
          finished = true
          try { tts?.shutdown() } catch (e: Exception) {}
          done?.invoke()
        }
      }
      // never hold a receiver past its window, even when the engine stays silent
      main.postDelayed({ finish() }, 25000)
      tts = TextToSpeech(context.applicationContext) { status ->
        val engine = tts
        if (status != TextToSpeech.SUCCESS || engine == null) { finish(); return@TextToSpeech }
        val arabic = Regex("[\\u0600-\\u06FF]").containsMatchIn(text)
        val result = engine.setLanguage(if (arabic) Locale("ar") else Locale.getDefault())
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) engine.setLanguage(Locale.getDefault())
        engine.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(id: String?) {}
          override fun onDone(id: String?) { main.post { finish() } }
          @Deprecated("old API")
          override fun onError(id: String?) { main.post { finish() } }
        })
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), "hayati")
      }
    }
  }
}

/**
 * Reminders written ahead by the app (goals, dreams, the morning brief): each fires at its time, rings
 * like any notification and, when the user asked for it, is read aloud. Survives a restart.
 */
object Nudges {
  private const val CHANNEL = "nudges"
  private const val BASE = 9500
  private const val MAX = 60

  private fun prefs(context: Context) = context.getSharedPreferences(Hourly.PREFS, Context.MODE_PRIVATE)

  private fun intent(context: Context, i: Int, title: String?, body: String?, url: String?): PendingIntent {
    val it = Intent(context, NudgeReceiver::class.java).setAction("expo.modules.phonelock.NUDGE.$i")
    if (title != null) it.putExtra("title", title)
    if (body != null) it.putExtra("body", body)
    if (url != null) it.putExtra("url", url)
    return PendingIntent.getBroadcast(context, BASE + i, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /** Replaces every booked reminder with `json`: [{at: millis, title, body, url?}]. */
  fun schedule(context: Context, json: String) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    for (i in 0 until MAX) alarms.cancel(intent(context, i, null, null, null))
    val list = try { JSONArray(json) } catch (e: Exception) { JSONArray() }
    val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
    val now = System.currentTimeMillis()
    var slot = 0
    for (k in 0 until list.length()) {
      if (slot >= MAX) break
      val o = list.optJSONObject(k) ?: continue
      val at = o.optLong("at")
      if (at <= now) continue
      val pi = intent(context, slot++, o.optString("title"), o.optString("body"), o.optString("url").ifEmpty { null })
      if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi) else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }
    prefs(context).edit().putString("nudges", json).apply()
  }

  fun restore(context: Context) = schedule(context, prefs(context).getString("nudges", "[]") ?: "[]")

  fun post(context: Context, title: String, body: String, url: String?) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Goals and dreams", NotificationManager.IMPORTANCE_HIGH))
    }
    val open = Intent(Intent.ACTION_VIEW, Uri.parse(url ?: "hayati://roadmap"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val tap = PendingIntent.getActivity(context, BASE + 99, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val n = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.star_on)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setColor(0xFF4772FA.toInt())
      .setAutoCancel(true)
      .setContentIntent(tap)
      .build()
    try { manager.notify((System.currentTimeMillis() % 100000).toInt() + 20000, n) } catch (e: SecurityException) {}
  }
}

class NudgeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val title = intent.getStringExtra("title") ?: return
    val body = intent.getStringExtra("body") ?: ""
    Nudges.post(context, title, body, intent.getStringExtra("url"))
    if (!Speaker.enabled(context)) return
    val pending = goAsync()
    Speaker.say(context, body.ifBlank { title }) { pending.finish() }
  }
}

/**
 * The live capsule: an ongoing notification with a countdown that Android 16 lifts into the status
 * bar as a Live Update (and Samsung shows in its Now Bar). On older phones it is a pinned countdown.
 */
object LiveUpdate {
  private const val CHANNEL = "live"
  private const val ID = 7343

  fun show(context: Context, title: String, text: String, endAt: Long, url: String) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(CHANNEL, "Live timer", NotificationManager.IMPORTANCE_DEFAULT)
      ch.setSound(null, null)
      manager.createNotificationChannel(ch)
    }
    val open = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val tap = PendingIntent.getActivity(context, ID, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setWhen(endAt)
      .setShowWhen(true)
      .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
      .setColor(0xFF4772FA.toInt())
      .setContentIntent(tap)
    // Android 16: ask for promotion to a Live Update chip (Notification.EXTRA_REQUEST_PROMOTED_ONGOING)
    builder.extras.putBoolean("android.requestPromotedOngoing", true)
    try { manager.notify(ID, builder.build()) } catch (e: SecurityException) {}
  }

  fun clear(context: Context) {
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(ID)
  }
}
