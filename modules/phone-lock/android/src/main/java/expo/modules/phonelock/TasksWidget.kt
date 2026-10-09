package expo.modules.phonelock

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

/**
 * Today's tasks on the home screen. The app writes the list here whenever its tasks change; ticking a
 * task in the widget marks it done in place and queues the id until the app opens and records it.
 */
class TasksWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, render(context))
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action == ACTION_TOGGLE) {
      val taskId = intent.getStringExtra("id") ?: return
      toggle(context, taskId)
      refresh(context)
    }
  }

  companion object {
    const val ACTION_TOGGLE = "expo.modules.phonelock.WIDGET_TOGGLE"
    private const val ROWS = 5
    private val CHECKS = intArrayOf(R.id.check0, R.id.check1, R.id.check2, R.id.check3, R.id.check4)
    private val TITLES = intArrayOf(R.id.title0, R.id.title1, R.id.title2, R.id.title3, R.id.title4)
    private val TIMES = intArrayOf(R.id.time0, R.id.time1, R.id.time2, R.id.time3, R.id.time4)
    private val ROW_IDS = intArrayOf(R.id.row0, R.id.row1, R.id.row2, R.id.row3, R.id.row4)

    private fun prefs(context: Context) = context.getSharedPreferences("widget", Context.MODE_PRIVATE)
    private fun data(context: Context) = try { JSONObject(prefs(context).getString("data", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }

    /** The app's latest list: {header, empty, items: [{id, title, time, done}]}. */
    fun save(context: Context, json: String) {
      prefs(context).edit().putString("data", json).apply()
      refresh(context)
    }

    /** Ids ticked in the widget since the app last looked. */
    fun take(context: Context): String {
      val out = prefs(context).getString("done", "[]") ?: "[]"
      prefs(context).edit().putString("done", "[]").apply()
      return out
    }

    private fun toggle(context: Context, taskId: String) {
      val d = data(context)
      val items = d.optJSONArray("items") ?: JSONArray()
      for (i in 0 until items.length()) items.optJSONObject(i)?.let { if (it.optString("id") == taskId) it.put("done", !it.optBoolean("done")) }
      prefs(context).edit().putString("data", d.toString()).apply()
      val done = try { JSONArray(prefs(context).getString("done", "[]")) } catch (e: Exception) { JSONArray() }
      done.put(taskId)
      prefs(context).edit().putString("done", done.toString()).apply()
    }

    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, TasksWidget::class.java))
      for (id in ids) manager.updateAppWidget(id, render(context))
    }

    private fun open(context: Context, url: String, code: Int): PendingIntent {
      val it = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      return PendingIntent.getActivity(context, code, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun render(context: Context): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.hayati_widget)
      val d = data(context)
      val items = d.optJSONArray("items") ?: JSONArray()
      val open = items.let { a -> (0 until a.length()).count { !(a.optJSONObject(it)?.optBoolean("done") ?: false) } }
      v.setTextViewText(R.id.header, "${d.optString("header", "Today")} · $open")
      v.setOnClickPendingIntent(R.id.header, open(context, "hayati://", 8800))
      v.setOnClickPendingIntent(R.id.add, open(context, "hayati://?add=1", 8801))
      v.setViewVisibility(R.id.empty, if (items.length() == 0) View.VISIBLE else View.GONE)
      v.setTextViewText(R.id.empty, d.optString("empty", ""))
      for (i in 0 until ROWS) {
        val o = items.optJSONObject(i)
        if (o == null) { v.setViewVisibility(ROW_IDS[i], View.GONE); continue }
        val done = o.optBoolean("done")
        v.setViewVisibility(ROW_IDS[i], View.VISIBLE)
        v.setTextViewText(CHECKS[i], if (done) "✓" else "○")
        v.setTextColor(CHECKS[i], if (done) 0xFF5AD27A.toInt() else 0xFF8FA8FF.toInt())
        v.setTextViewText(TITLES[i], o.optString("title"))
        v.setTextColor(TITLES[i], if (done) 0xFF7E86A8.toInt() else 0xFFFFFFFF.toInt())
        v.setTextViewText(TIMES[i], o.optString("time"))
        val toggle = Intent(context, TasksWidget::class.java).setAction(ACTION_TOGGLE).putExtra("id", o.optString("id"))
        v.setOnClickPendingIntent(CHECKS[i], PendingIntent.getBroadcast(context, 8900 + i, toggle, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        v.setOnClickPendingIntent(TITLES[i], open(context, "hayati://", 8810 + i))
      }
      return v
    }
  }
}
