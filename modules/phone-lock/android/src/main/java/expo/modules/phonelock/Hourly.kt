package expo.modules.phonelock

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * The hourly question: a large square card notification drawn here, posted at the top of every hour
 * inside the user's window. Each firing books the next one, so it keeps going while the app is closed.
 */
object Hourly {
  const val PREFS = "hourly"
  // a channel keeps the sound it was created with, so the loud chime needed a new channel
  const val CHANNEL = "hourly-card-2"
  const val NOTIFICATION_ID = 7342
  private const val ALARM_CODE = 9101
  private const val SIZE = 1080
  private const val MARGIN = 84f

  private fun alarmIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(context, ALARM_CODE, Intent(context, HourlyReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

  fun isEnabled(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false)

  fun scheduleNext(context: Context) {
    val next = Calendar.getInstance().apply {
      add(Calendar.HOUR_OF_DAY, 1)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
    if (exact) {
      alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.timeInMillis, alarmIntent(context))
    } else {
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.timeInMillis, alarmIntent(context))
    }
  }

  fun cancel(context: Context) {
    (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(alarmIntent(context))
  }

  /** A high-importance channel with the app's own loud chime and a strong vibration. */
  fun loudChannel(context: Context, id: String, name: String): NotificationChannel {
    val channel = NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH)
    channel.setSound(
      Uri.parse("android.resource://" + context.packageName + "/raw/notify_chime"),
      AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    )
    channel.enableVibration(true)
    channel.vibrationPattern = longArrayOf(0, 350, 150, 350, 150, 500)
    channel.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
    return channel
  }

  private fun pick(list: JSONArray?, index: Int): String = if (list == null || list.length() == 0) "" else list.optString(index % list.length())

  /** Posts the card. Outside the chosen hours it stays quiet unless [force] is set (the test button). */
  fun show(context: Context, force: Boolean) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val now = Calendar.getInstance()
    val hour = now.get(Calendar.HOUR_OF_DAY)
    if (!force && (hour < prefs.getInt("from", 7) || hour > prefs.getInt("to", 23))) return

    val payload = try { JSONObject(prefs.getString("payload", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(loudChannel(context, CHANNEL, "Hourly question"))
    }
    // the questions are answered inside the notification itself when the app sent them
    if ((payload.optJSONArray("steps")?.length() ?: 0) > 0) {
      HourlySession.start(context)
      return
    }
    val title = payload.optString("title", "What are you doing now?")
    val lines = payload.optJSONArray("lines")
    // a different deep question and quote each hour of each day
    val turn = hour + now.get(Calendar.DAY_OF_YEAR) * 7
    val question = pick(payload.optJSONArray("questions"), turn)
    val quote = pick(payload.optJSONArray("quotes"), turn)
    val goal = payload.optString("goal", "")
    val tap = payload.optString("tap", "")
    val time = String.format("%02d:00", hour)

    val card = drawCard(context, time, title, lines, question, goal, quote, tap)

    val open = Intent(Intent.ACTION_VIEW, Uri.parse("hayati://checkin?auto=1"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val tapIntent = PendingIntent.getActivity(context, ALARM_CODE + 1, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    val text = listOf(question, quote).filter { it.isNotEmpty() }.joinToString(" — ")
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle("$time · $title")
      .setContentText(text)
      .setLargeIcon(card)
      .setStyle(NotificationCompat.BigPictureStyle().bigPicture(card).bigLargeIcon(null as Bitmap?).setSummaryText(text))
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setColor(0xFF4772FA.toInt())
      .setOngoing(true)
      .setAutoCancel(true)
      .setContentIntent(tapIntent)
      .build()
    try {
      manager.notify(NOTIFICATION_ID, notification)
    } catch (e: SecurityException) {
      // notifications are not allowed; the app's check screen reports this to the user
    }
  }

  fun face(context: Context, file: String, fallback: Typeface): Typeface =
    try { Typeface.createFromAsset(context.assets, "fonts/$file") } catch (e: Exception) { fallback }

  fun drawCard(context: Context, time: String, title: String, lines: JSONArray?, question: String, goal: String, quote: String, tap: String): Bitmap {
    val bitmap = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val background = Paint(Paint.ANTI_ALIAS_FLAG)
    background.shader = LinearGradient(0f, 0f, SIZE.toFloat(), SIZE.toFloat(), intArrayOf(0xFF4772FA.toInt(), 0xFF6A4DF5.toInt(), 0xFF1B1F3B.toInt()), null, Shader.TileMode.CLAMP)
    canvas.drawRect(0f, 0f, SIZE.toFloat(), SIZE.toFloat(), background)

    val bold = face(context, "Cairo_700Bold.ttf", Typeface.DEFAULT_BOLD)
    val regular = face(context, "Cairo_400Regular.ttf", Typeface.DEFAULT)
    val width = (SIZE - MARGIN * 2).toInt()

    fun layout(text: String, size: Float, color: Int, typeface: Typeface): StaticLayout {
      val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
      paint.textSize = size
      paint.color = color
      paint.typeface = typeface
      return StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
        .setAlignment(Layout.Alignment.ALIGN_CENTER)
        .setLineSpacing(0f, 1.1f)
        .setMaxLines(4)
        .build()
    }

    fun draw(block: StaticLayout, top: Float): Float {
      canvas.save()
      canvas.translate(MARGIN, top)
      block.draw(canvas)
      canvas.restore()
      return top + block.height
    }

    var y = 56f
    y = draw(layout(time, 132f, 0xFFFFFFFF.toInt(), bold), y)
    y = draw(layout(title, 66f, 0xFFFFFFFF.toInt(), bold), y) + 18f
    if (lines != null) {
      for (i in 0 until lines.length()) {
        y = draw(layout(lines.optString(i), 54f, 0xFFE3E9FF.toInt(), regular), y) + 4f
      }
    }
    y += 26f
    if (question.isNotEmpty()) y = draw(layout(question, 50f, 0xFFFFE08A.toInt(), bold), y) + 18f
    if (goal.isNotEmpty()) y = draw(layout("🎯 $goal", 40f, 0xFFFFFFFF.toInt(), regular), y)

    // the quote and the call to act sit at the bottom edge, whatever the text above needed
    val footer = layout(listOf(quote, tap).filter { it.isNotEmpty() }.joinToString("\n"), 36f, 0xFFD5DBFF.toInt(), regular)
    draw(footer, maxOf(y + 20f, SIZE - footer.height - 50f))
    return bitmap
  }
}
