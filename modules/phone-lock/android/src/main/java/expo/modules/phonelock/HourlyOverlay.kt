package expo.modules.phonelock

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * The hourly question as a large card drawn over whatever is on screen. It has no close button and
 * ignores Back and Home: it leaves only when the last question is answered. The bottom of the screen
 * stays uncovered so a phone call can still be taken.
 */
object HourlyOverlay {
  private fun prefs(context: Context) = context.getSharedPreferences(Hourly.PREFS, Context.MODE_PRIVATE)

  fun allowed(context: Context): Boolean = Settings.canDrawOverlays(context)
  fun wanted(context: Context): Boolean = prefs(context).getBoolean("overlay", true)
  fun setWanted(context: Context, on: Boolean) = prefs(context).edit().putBoolean("overlay", on).apply()

  private fun send(context: Context, action: String, text: String?) {
    if (!allowed(context) || !wanted(context)) return
    val intent = Intent(context, OverlayService::class.java).setAction(action)
    if (text != null) intent.putExtra(OverlayService.EXTRA_TEXT, text)
    try {
      ContextCompat.startForegroundService(context, intent)
    } catch (e: Exception) {
      // the system refused to start it from the background; the pinned notification still asks
    }
  }

  fun show(context: Context) = send(context, OverlayService.ACTION_SHOW, null)
  fun result(context: Context, text: String) = send(context, OverlayService.ACTION_RESULT, text)

  fun hide(context: Context) {
    try {
      context.stopService(Intent(context, OverlayService::class.java))
    } catch (e: Exception) {
    }
  }
}

/** Owns the overlay window; running in the foreground keeps the card on screen while the app is closed. */
class OverlayService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var root: View? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    handler.removeCallbacksAndMessages(null)
    if (intent?.action == ACTION_RESULT) {
      render(intent.getStringExtra(EXTRA_TEXT) ?: "")
    } else {
      render(null)
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    remove()
    super.onDestroy()
  }

  private fun remove() {
    val view = root ?: return
    root = null
    try {
      (getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(view)
    } catch (e: Exception) {
    }
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  /** Draws the current question, or — when [result] is given — the closing screen with the AI's reading. */
  private fun render(result: String?) {
    if (!Settings.canDrawOverlays(this)) {
      stopSelf()
      return
    }
    val state = HourlySession.state(this)
    if (result == null && state == null) {
      stopSelf()
      return
    }
    remove()

    val payload = HourlySession.payloadOf(this)
    val bold = Hourly.face(this, "Cairo_700Bold.ttf", Typeface.DEFAULT_BOLD)
    val regular = Hourly.face(this, "Cairo_400Regular.ttf", Typeface.DEFAULT)
    val white = Color.WHITE

    val card = LinearLayout(this)
    card.orientation = LinearLayout.VERTICAL
    card.gravity = Gravity.CENTER_HORIZONTAL
    card.setPadding(dp(22), dp(46), dp(22), dp(26))
    val radius = dp(30).toFloat()
    val background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF4772FA.toInt(), 0xFF6A4DF5.toInt(), 0xFF1B1F3B.toInt()))
    background.cornerRadii = floatArrayOf(0f, 0f, 0f, 0f, radius, radius, radius, radius)
    card.background = background
    card.minimumHeight = (resources.displayMetrics.heightPixels * 0.62f).toInt()

    fun label(text: String, size: Float, color: Int, face: Typeface, top: Int): TextView {
      val view = TextView(this)
      view.text = text
      view.textSize = size
      view.setTextColor(color)
      view.typeface = face
      view.gravity = Gravity.CENTER
      val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
      params.topMargin = dp(top)
      view.layoutParams = params
      return view
    }

    fun button(text: String, solid: Boolean, onTap: () -> Unit): TextView {
      val view = label(text, 19f, if (solid) 0xFF27348B.toInt() else white, bold, 10)
      view.setPadding(dp(14), dp(13), dp(14), dp(13))
      val shape = GradientDrawable()
      shape.cornerRadius = dp(16).toFloat()
      shape.setColor(if (solid) white else 0x33FFFFFF)
      view.background = shape
      view.isClickable = true
      view.setOnClickListener { onTap() }
      return view
    }

    if (result != null) {
      card.addView(label(payload.optString("doneTitle", "✅"), 26f, white, bold, 0))
      card.addView(label(if (result.isEmpty()) payload.optString("analyzing", "…") else result, 19f, 0xFFE8ECFF.toInt(), regular, 18))
      card.addView(button("✓", true) { stopSelf() })
      // the reading stays long enough to be read, then the card leaves by itself
      handler.postDelayed({ stopSelf() }, if (result.isEmpty()) 45_000L else 30_000L)
    } else if (state != null) {
      val time = label(state.optString("time"), 52f, white, bold, 0)
      // emergency exit: holding the clock for five seconds closes the session
      val escape = Runnable { HourlySession.close(this) }
      time.setOnTouchListener { _, event ->
        when (event.action) {
          MotionEvent.ACTION_DOWN -> handler.postDelayed(escape, 5000)
          MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> handler.removeCallbacks(escape)
        }
        true
      }
      card.addView(time)
      card.addView(label(state.optString("progress"), 15f, 0xFFD5DBFF.toInt(), regular, 0))
      card.addView(label(state.optString("q"), 27f, white, bold, 10))
      val goal = payload.optString("goal")
      if (goal.isNotEmpty()) card.addView(label("🎯 $goal", 15f, 0xFFFFE08A.toInt(), regular, 6))

      val choices = state.optJSONArray("choices")
      if (choices != null) {
        for (i in 0 until minOf(6, choices.length())) {
          val choice = choices.optString(i)
          card.addView(button(choice, true) { HourlySession.answer(this, choice, null) })
        }
      }
      card.addView(
        button(payload.optString("voiceLabel", "🎙"), false) {
          val open = Intent(Intent.ACTION_VIEW, Uri.parse("hayati://checkin?auto=1"))
            .setPackage(packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
          try {
            startActivity(open)
          } catch (e: Exception) {
          }
          // out of the way while speaking; back again if the session was left unfinished
          remove()
          handler.postDelayed({ if (HourlySession.state(this) != null) render(null) else stopSelf() }, 120_000L)
        }
      )
      val quote = state.optString("quote")
      if (quote.isNotEmpty()) card.addView(label(quote, 14f, 0xFFD5DBFF.toInt(), regular, 16))
    }

    val scroll = ScrollView(this)
    scroll.isFillViewport = false
    scroll.addView(card, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      // not focusable, so Back and Home go to the app underneath and never close the card
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    )
    params.gravity = Gravity.TOP
    try {
      (getSystemService(Context.WINDOW_SERVICE) as WindowManager).addView(scroll, params)
      root = scroll
    } catch (e: Exception) {
      stopSelf()
    }
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Hourly card", NotificationManager.IMPORTANCE_MIN))
    }
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle(HourlySession.payloadOf(this).optString("title", "Hourly question"))
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setOngoing(true)
      .build()
  }

  companion object {
    const val ACTION_SHOW = "expo.modules.phonelock.OVERLAY_SHOW"
    const val ACTION_RESULT = "expo.modules.phonelock.OVERLAY_RESULT"
    const val EXTRA_TEXT = "text"
    private const val CHANNEL = "hourly-overlay"
    private const val NOTIFICATION_ID = 7345
  }
}
