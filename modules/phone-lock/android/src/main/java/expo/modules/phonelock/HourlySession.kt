package expo.modules.phonelock

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar
import kotlin.concurrent.thread

/**
 * The hourly session played out inside the notification: one question at a time, answered by typing
 * into the notification or tapping a choice. The notification stays pinned (swiping it away brings it
 * back) until the last answer; then the AI's short reading of the answers replaces it. Each finished
 * session waits in a queue until the app opens and files it in the check-in history.
 */
object HourlySession {
  const val ACTION_ANSWER = "expo.modules.phonelock.HOURLY_ANSWER"
  const val ACTION_REPOST = "expo.modules.phonelock.HOURLY_REPOST"
  const val KEY_TEXT = "answer"
  private const val CODE = 9200

  private fun prefs(context: Context) = context.getSharedPreferences(Hourly.PREFS, Context.MODE_PRIVATE)
  private fun payload(context: Context) = try { JSONObject(prefs(context).getString("payload", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
  private fun session(context: Context) = try { JSONObject(prefs(context).getString("session", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
  private fun save(context: Context, s: JSONObject) = prefs(context).edit().putString("session", s.toString()).apply()

  fun steps(context: Context): JSONArray = payload(context).optJSONArray("steps") ?: JSONArray()

  fun payloadOf(context: Context): JSONObject = payload(context)

  /** The question waiting for an answer, as the overlay card needs it; null when no session is open. */
  fun state(context: Context): JSONObject? {
    val s = session(context)
    val steps = steps(context)
    if (s.optBoolean("done", true) || steps.length() == 0) return null
    val index = s.optInt("step", 0).coerceIn(0, steps.length() - 1)
    val step = steps.optJSONObject(index) ?: return null
    val quotes = payload(context).optJSONArray("quotes")
    val turn = Calendar.getInstance().let { it.get(Calendar.HOUR_OF_DAY) + it.get(Calendar.DAY_OF_YEAR) * 7 }
    return JSONObject()
      .put("time", s.optString("time").take(2) + ":00")
      .put("progress", "${index + 1} / ${steps.length()}")
      .put("q", step.optString("q"))
      .put("choices", step.optJSONArray("choices") ?: JSONArray())
      .put("quote", if (quotes == null || quotes.length() == 0) "" else quotes.optString(turn % quotes.length()))
  }

  /** Starts a fresh session for this hour and shows its first question. */
  fun start(context: Context) {
    val now = Calendar.getInstance()
    val s = JSONObject()
      .put("date", String.format("%04d-%02d-%02d", now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1, now.get(Calendar.DAY_OF_MONTH)))
      .put("time", String.format("%02d:%02d", now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE)))
      .put("step", 0)
      .put("answers", JSONArray())
      .put("done", false)
    save(context, s)
    post(context, false)
    // the first question is also spoken, so the hour is noticed without looking at the phone
    if (Speaker.enabled(context)) Speaker.say(context, steps(context).optJSONObject(0)?.optString("q") ?: "")
  }

  private fun broadcast(context: Context, code: Int, action: String, choice: String?, mutable: Boolean): PendingIntent {
    val intent = Intent(context, HourlyActionReceiver::class.java).setAction(action)
    if (choice != null) intent.putExtra("choice", choice)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
    return PendingIntent.getBroadcast(context, code, intent, flags)
  }

  private fun openApp(context: Context, url: String, code: Int): PendingIntent {
    val open = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, code, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /** Shows the current question. [quiet] after the first one, so answering does not ring again. */
  fun post(context: Context, quiet: Boolean) {
    val s = session(context)
    val steps = steps(context)
    if (s.optBoolean("done", true) || steps.length() == 0) return
    val index = s.optInt("step", 0).coerceIn(0, steps.length() - 1)
    val step = steps.optJSONObject(index) ?: return
    val p = payload(context)
    val question = step.optString("q")
    val choices = step.optJSONArray("choices") ?: JSONArray()
    val time = s.optString("time").take(2) + ":00"
    val progress = "${index + 1} / ${steps.length()}"
    val turn = Calendar.getInstance().let { it.get(Calendar.HOUR_OF_DAY) + it.get(Calendar.DAY_OF_YEAR) * 7 }
    val quotes = p.optJSONArray("quotes")
    val quote = if (quotes == null || quotes.length() == 0) "" else quotes.optString(turn % quotes.length())
    val card = Hourly.drawCard(context, time, question, JSONArray().put(progress), "", p.optString("goal"), quote, "")

    val builder = NotificationCompat.Builder(context, Hourly.CHANNEL)
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle("$time · $question")
      .setContentText(progress)
      .setLargeIcon(card)
      .setStyle(NotificationCompat.BigPictureStyle().bigPicture(card).bigLargeIcon(null as Bitmap?).setSummaryText("$progress · $question"))
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setColor(0xFF4772FA.toInt())
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(quiet)
      .setContentIntent(openApp(context, "hayati://checkin", CODE + 90))
      .setDeleteIntent(broadcast(context, CODE + 91, ACTION_REPOST, null, false))

    if (step.optBoolean("input", false)) {
      val labels = Array<CharSequence>(choices.length()) { choices.optString(it) }
      val input = RemoteInput.Builder(KEY_TEXT).setLabel(p.optString("typeLabel", "…")).setChoices(labels).build()
      builder.addAction(
        NotificationCompat.Action.Builder(android.R.drawable.ic_menu_edit, p.optString("replyLabel", "✍️"), broadcast(context, CODE + index * 10, ACTION_ANSWER, null, true))
          .addRemoteInput(input)
          .setAllowGeneratedReplies(true)
          .build(),
      )
      // a one-tap answer next to the text box, for the most common reply
      if (choices.length() > 0) builder.addAction(0, choices.optString(0), broadcast(context, CODE + index * 10 + 1, ACTION_ANSWER, choices.optString(0), false))
      builder.addAction(0, p.optString("voiceLabel", "🎙"), openApp(context, "hayati://checkin?auto=1", CODE + 92))
    } else {
      for (i in 0 until minOf(3, choices.length())) {
        builder.addAction(0, choices.optString(i), broadcast(context, CODE + index * 10 + 1 + i, ACTION_ANSWER, choices.optString(i), false))
      }
    }
    notify(context, builder)
    // and the same question as a card over whatever is on screen
    HourlyOverlay.show(context)
  }

  private fun notify(context: Context, builder: NotificationCompat.Builder) {
    try {
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(Hourly.NOTIFICATION_ID, builder.build())
    } catch (e: SecurityException) {
      // notifications are off; the app's check screen says so
    }
  }

  /** Records one answer and moves on, or finishes the session after the last question. */
  fun answer(context: Context, text: String, pending: BroadcastReceiver.PendingResult?) {
    val s = session(context)
    val steps = steps(context)
    if (s.optBoolean("done", true) || text.isBlank()) { pending?.finish(); return }
    val index = s.optInt("step", 0)
    val answers = s.optJSONArray("answers") ?: JSONArray()
    answers.put(JSONObject().put("q", steps.optJSONObject(index)?.optString("q") ?: "").put("a", text.trim()))
    s.put("answers", answers).put("step", index + 1)
    if (index + 1 < steps.length()) {
      save(context, s)
      post(context, true)
      pending?.finish()
      return
    }
    s.put("done", true)
    save(context, s)
    finish(context, s, pending)
  }

  /** Queues the session for the app's history, then asks the AI for a short reading of it. */
  private fun finish(context: Context, s: JSONObject, pending: BroadcastReceiver.PendingResult?) {
    val p = payload(context)
    val id = s.optString("date") + " " + s.optString("time")
    enqueue(context, s.put("id", id))
    val builder = NotificationCompat.Builder(context, Hourly.CHANNEL)
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle(p.optString("doneTitle", "✅"))
      .setContentText(p.optString("analyzing", "…"))
      .setOnlyAlertOnce(true)
      .setAutoCancel(true)
      .setColor(0xFF4772FA.toInt())
      .setContentIntent(openApp(context, "hayati://checkin", CODE + 93))
    notify(context, builder)

    val routes = p.optJSONArray("ai")
    if (routes == null || routes.length() == 0) {
      HourlyOverlay.result(context, p.optString("doneTitle", "✅"))
      pending?.finish()
      return
    }
    HourlyOverlay.result(context, "")
    // the network call runs off the main thread; the receiver stays alive until it is done
    thread {
      try {
        val dialog = StringBuilder()
        val answers = s.optJSONArray("answers") ?: JSONArray()
        for (i in 0 until answers.length()) answers.optJSONObject(i)?.let { dialog.append("Q: ").append(it.optString("q")).append("\nA: ").append(it.optString("a")).append("\n") }
        if (p.optString("goal").isNotEmpty()) dialog.append("Top goal: ").append(p.optString("goal")).append("\n")
        var reply = ""
        for (i in 0 until routes.length()) {
          val r = routes.optJSONObject(i) ?: continue
          reply = try { chat(r.optString("url"), r.optString("key"), r.optString("model"), p.optString("system"), dialog.toString()) } catch (e: Exception) { "" }
          if (reply.isNotEmpty()) break
        }
        // the card shows the reading, or simply closes if the AI could not be reached
        if (reply.isNotEmpty()) HourlyOverlay.result(context, reply) else HourlyOverlay.hide(context)
        if (reply.isNotEmpty()) {
          setInsight(context, id, reply)
          notify(
            context,
            builder.setContentText(reply).setStyle(NotificationCompat.BigTextStyle().bigText(reply)),
          )
        }
      } finally {
        pending?.finish()
      }
    }
  }

  private fun chat(base: String, key: String, model: String, system: String, user: String): String {
    val conn = URL(base.trimEnd('/') + "/chat/completions").openConnection() as HttpURLConnection
    conn.requestMethod = "POST"
    conn.connectTimeout = 8000
    conn.readTimeout = 20000
    conn.doOutput = true
    conn.setRequestProperty("Content-Type", "application/json")
    conn.setRequestProperty("Authorization", "Bearer $key")
    val body = JSONObject()
      .put("model", model)
      .put("temperature", 0.5)
      .put("messages", JSONArray().put(JSONObject().put("role", "system").put("content", system)).put(JSONObject().put("role", "user").put("content", user)))
    conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
    if (conn.responseCode !in 200..299) return ""
    val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    return JSONObject(text).optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("message")?.optString("content")?.trim() ?: ""
  }

  /* the queue of finished sessions the app has not filed yet */

  private fun queue(context: Context) = try { JSONArray(prefs(context).getString("queue", "[]") ?: "[]") } catch (e: Exception) { JSONArray() }

  @Synchronized
  private fun enqueue(context: Context, s: JSONObject) {
    val q = queue(context).put(s)
    // a phone left alone for weeks keeps only the latest month of hours
    while (q.length() > 400) q.remove(0)
    prefs(context).edit().putString("queue", q.toString()).apply()
  }

  @Synchronized
  private fun setInsight(context: Context, id: String, text: String) {
    val q = queue(context)
    for (i in 0 until q.length()) q.optJSONObject(i)?.let { if (it.optString("id") == id) it.put("insight", text) }
    prefs(context).edit().putString("queue", q.toString()).apply()
  }

  /** Hands the waiting sessions to the app and empties the queue. */
  @Synchronized
  fun take(context: Context): String {
    val out = queue(context).toString()
    prefs(context).edit().putString("queue", "[]").apply()
    return out
  }

  /** The app finished the session itself (by voice), so the pinned question goes away. */
  fun close(context: Context) {
    save(context, session(context).put("done", true))
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(Hourly.NOTIFICATION_ID)
    HourlyOverlay.hide(context)
  }
}

/** Taps and typed replies from the hourly notification. */
class HourlyActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      HourlySession.ACTION_REPOST -> HourlySession.post(context, true)
      HourlySession.ACTION_ANSWER -> {
        val typed = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(HourlySession.KEY_TEXT)?.toString()
        val text = typed ?: intent.getStringExtra("choice") ?: ""
        HourlySession.answer(context, text, goAsync())
      }
    }
  }
}
