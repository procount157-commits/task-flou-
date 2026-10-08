package expo.modules.phonelock

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat

/**
 * Rings the alarm. It runs as a foreground service on the alarm audio stream, so it keeps sounding
 * with the screen off or locked and with the ringer silenced, until the app tells it to stop.
 */
class AlarmService : Service() {
  private var player: MediaPlayer? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra(Alarms.EXTRA_ID) ?: ringingId
    val sound = intent?.getStringExtra(Alarms.EXTRA_SOUND) ?: ""
    val label = intent?.getStringExtra(Alarms.EXTRA_LABEL) ?: ""
    ringingId = id

    val notification = buildNotification(id, label)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    play(sound)
    vibrate()
    return START_STICKY
  }

  private fun soundUri(sound: String): Uri =
    if (sound.startsWith("content://") || sound.startsWith("file://") || sound.startsWith("android.resource://")) {
      Uri.parse(sound)
    } else {
      Uri.parse("android.resource://$packageName/raw/$sound")
    }

  private fun play(sound: String) {
    stopPlayer()
    // full alarm volume: an alarm nobody hears is no alarm
    try {
      val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
    } catch (e: Exception) {
    }
    val candidates = listOf(
      if (sound.isEmpty()) null else soundUri(sound),
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    )
    for (uri in candidates) {
      if (uri == null) continue
      try {
        val next = MediaPlayer()
        next.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        next.setDataSource(this, uri)
        next.isLooping = true
        next.prepare()
        next.start()
        player = next
        return
      } catch (e: Exception) {
        // a tone that was removed or cannot be read: fall through to the next choice
      }
    }
  }

  private fun vibrate() {
    try {
      @Suppress("DEPRECATION")
      val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      val pattern = longArrayOf(0, 700, 400)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0))
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(pattern, 0)
      }
    } catch (e: Exception) {
    }
  }

  private fun stopPlayer() {
    try {
      player?.stop()
      player?.release()
    } catch (e: Exception) {
    }
    player = null
  }

  override fun onDestroy() {
    stopPlayer()
    try {
      @Suppress("DEPRECATION")
      (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).cancel()
    } catch (e: Exception) {
    }
    ringingId = ""
    super.onDestroy()
  }

  private fun buildNotification(id: String, label: String): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL, "Alarm", NotificationManager.IMPORTANCE_HIGH)
      // the service plays the sound itself, on the alarm stream
      channel.setSound(null, null)
      manager.createNotificationChannel(channel)
    }
    val open = Alarms.openAppIntent(this, id, 32_000)
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle("⏰ " + (if (label.isEmpty()) "Alarm" else label))
      .setContentText("Open the app and finish the challenge to stop it")
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setContentIntent(open)
      // puts the app's ringing screen on top, including over the lock screen
      .setFullScreenIntent(open, true)
      .build()
  }

  companion object {
    private const val CHANNEL = "alarm-ring"
    private const val NOTIFICATION_ID = 7343

    @Volatile
    var ringingId: String = ""
  }
}
