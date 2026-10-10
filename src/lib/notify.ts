import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { parse, today } from './dates';
import { logError } from './errlog';
import { aiRoutes } from './integrations';
import { HourlyCard, hourlyCardAvailable, nativeAlarmAvailable, setHourlyCard, syncNativeAlarms } from './phonelock';
import type { Alarm, DailyTask, Habit } from './types';

const native = Platform.OS !== 'web';
// the app's own loud three-note chime, and the channel that carries it
const CHIME = 'notify_chime.wav';
const MAIN = 'main';
let ready: Promise<boolean> | undefined;
let lastSignature = '';

// Asks for permission once and sets up the Android channel; resolves false when notifications are unavailable.
export function initNotifications(): Promise<boolean> {
  if (!native) return Promise.resolve(false);
  return (ready ??= (async () => {
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
      });
      if (Platform.OS === 'android')
        // a new channel id, because Android never changes the sound of a channel that already exists
        await Notifications.setNotificationChannelAsync(MAIN, {
          name: 'Reminders', importance: Notifications.AndroidImportance.MAX, sound: CHIME, vibrationPattern: [0, 350, 150, 350, 150, 500],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      const cur = await Notifications.getPermissionsAsync();
      const granted = cur.granted || (await Notifications.requestPermissionsAsync()).granted;
      // a refusal is not remembered, so the next attempt asks again instead of failing for good
      if (!granted) ready = undefined;
      return granted;
    } catch (e) {
      logError('notifications', e);
      ready = undefined;
      return false;
    }
  })());
}

export async function cancel(...ids: string[]) {
  if (!native) return;
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

export async function scheduleAt(id: string, title: string, body: string, when: Date) {
  if (!(await initNotifications()) || when.getTime() <= Date.now()) return;
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, sound: CHIME },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: MAIN },
  }).catch((e) => logError('schedule', e));
}

export async function scheduleDaily(id: string, title: string, body: string, time: string) {
  await cancel(id);
  if (!(await initNotifications())) return;
  const [hour, minute] = time.split(':').map(Number);
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, sound: CHIME },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: MAIN },
  }).catch((e) => logError('schedule', e));
}

// Rebuilds every habit and high-priority-task reminder from the current data.
export async function syncReminders(habits: Habit[], tasks: DailyTask[], labels: { habit: string; task: string }) {
  const day = today();
  // rebuilding every reminder is slow on a phone, so it only happens when something that affects them changed
  const signature = JSON.stringify([
    day,
    habits.map((h) => [h.id, h.title, h.time, h.repeat_days, h.is_active, h.end_date]),
    tasks.filter((t) => t.priority === 'high' && !t.completed && t.time && t.date >= day && !t.parent_id).map((t) => [t.id, t.title, t.date, t.time]),
  ]);
  if (signature === lastSignature) return;
  lastSignature = signature;
  if (!(await initNotifications())) return;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await cancel(...all.map((n) => n.identifier).filter((id) => id.startsWith('habit-') || id.startsWith('task-')));
  for (const h of habits) {
    if (h.is_active === false || !h.time || (h.end_date && h.end_date < day)) continue;
    const [hour, minute] = h.time.split(':').map(Number);
    for (const d of h.repeat_days?.length ? h.repeat_days : [0, 1, 2, 3, 4, 5, 6])
      await Notifications.scheduleNotificationAsync({
        identifier: `habit-${h.id}-${d}`,
        content: { title: labels.habit, body: h.title, sound: CHIME },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: d + 1, hour, minute, channelId: MAIN },
      }).catch((e) => logError('schedule', e));
  }
  const upcoming = tasks.filter((t) => t.priority === 'high' && !t.completed && t.time && t.date >= day && !t.parent_id).slice(0, 30);
  for (const t of upcoming) {
    const when = parse(t.date);
    const [hh, mm] = t.time!.split(':').map(Number);
    when.setHours(hh, mm, 0, 0);
    await scheduleAt(`task-${t.id}`, labels.task, t.title, when);
  }
}

/* ───────── hourly check-in ───────── */
export type CheckinSettings = { enabled: boolean; from: string; to: string };
// on by default: the hourly question is the heart of the app
export const CHECKIN_DEFAULTS: CheckinSettings = { enabled: true, from: '07:00', to: '23:00' };

// One pinned notification per hour inside the chosen window; tapping it opens the check-in screen.
export async function scheduleCheckins(s: CheckinSettings, card: HourlyCard): Promise<boolean> {
  if (!native) return false;
  const question = card.title;
  const prompts = card.questions;
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await cancel(...all.map((n) => n.identifier).filter((id) => id.startsWith('checkin-')));
  const from = Number(s.from.slice(0, 2));
  const to = Number(s.to.slice(0, 2));
  if (!s.enabled) {
    if (hourlyCardAvailable) setHourlyCard(false, from, to, card);
    return true;
  }
  if (!(await initNotifications())) return false;
  // the big drawn card, posted by the phone itself every hour; the plain notifications below are the fallback
  if (hourlyCardAvailable) return setHourlyCard(true, from, to, { ...card, ai: await aiRoutes().catch(() => []) });
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('checkin', { name: 'Hourly check-in', importance: Notifications.AndroidImportance.MAX, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC });
  const start = Number(s.from.slice(0, 2));
  const end = Number(s.to.slice(0, 2));
  for (let h = start; h <= end; h++)
    await Notifications.scheduleNotificationAsync({
      identifier: `checkin-${h}`,
      // each hour carries a different question to think about; tapping opens the session with the microphone already on
      content: { title: '🎙 ' + question, body: prompts.length ? prompts[h % prompts.length] : `${String(h).padStart(2, '0')}:00`, sound: true, sticky: true, autoDismiss: false, priority: Notifications.AndroidNotificationPriority.MAX, data: { url: '/checkin?auto=1' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: h, minute: 0, channelId: 'checkin' },
    }).catch((e) => logError('schedule', e));
  return true;
}

/* ───────── alarms ───────── */

const NAGS = [0, 1, 2, 3, 4, 6, 8, 10];
const DAYS_AHEAD = 6;
const alarmKey = (id: string, date: string, k: number) => `alarm-${id}-${date}-${k}`;
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Each alarm becomes a burst of siren notifications a minute apart, booked for the coming days.
// The sound plays on the alarm stream, so a silenced ringer does not mute it.
export async function scheduleAlarms(alarms: Alarm[], title: string): Promise<boolean> {
  if (!native) return false;
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await cancel(...all.map((n) => n.identifier).filter((id) => id.startsWith('alarm-')));
  if (!alarms.some((a) => a.enabled)) {
    if (nativeAlarmAvailable) syncNativeAlarms(alarms);
    return true;
  }
  if (!(await initNotifications())) return false;
  // the real thing: a service that rings until dismissed; the notification burst below is the fallback
  if (nativeAlarmAvailable) {
    syncNativeAlarms(alarms);
    return true;
  }
  if (Platform.OS === 'android')
    for (const sound of ['ambulance', 'whistle', 'wail', 'police', 'klaxon', 'beeper', 'buzzer', 'bell', 'alert'])
      await Notifications.setNotificationChannelAsync(`alarm-${sound}`, {
        name: `Alarm (${sound})`, importance: Notifications.AndroidImportance.MAX, sound: `alarm_${sound}.wav`, bypassDnd: true,
        vibrationPattern: [0, 800, 400, 800, 400, 800], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        audioAttributes: { usage: Notifications.AndroidAudioUsage.ALARM, contentType: Notifications.AndroidAudioContentType.SONIFICATION },
      });
  const now = Date.now();
  for (const a of alarms.filter((x) => x.enabled)) {
    const [hh, mm] = a.time.split(':').map(Number);
    for (let d = 0; d <= DAYS_AHEAD; d++) {
      const base = new Date();
      base.setDate(base.getDate() + d);
      base.setHours(hh, mm, 0, 0);
      if (a.days.length && !a.days.includes(base.getDay())) continue;
      for (const k of NAGS) {
        const when = new Date(base.getTime() + k * 60000);
        const id = alarmKey(a.id, ymdOf(base), k);
        if (when.getTime() <= now) continue;
        await Notifications.scheduleNotificationAsync({
          identifier: id,
          content: { title: `⏰ ${title}`, body: `${a.time}${a.label ? ' · ' + a.label : ''}`, sound: `alarm_${a.sound}.wav`, sticky: true, autoDismiss: false, priority: Notifications.AndroidNotificationPriority.MAX, data: { url: `/alarm?ring=${a.id}` } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: `alarm-${a.sound}` },
        }).catch((e) => logError('schedule', e));
      }
    }
  }
  return true;
}

// Called once the challenge is solved: silences what is on screen and drops the rest of today's burst.
export async function silenceAlarm(id: string) {
  if (!native) return;
  const today = ymdOf(new Date());
  await cancel(...NAGS.map((k) => alarmKey(id, today, k)));
  await Notifications.dismissAllNotificationsAsync().catch(() => {});
}

// Opens the screen named in a tapped notification, including the one that launched the app.
export function onNotificationOpen(open: (url: string) => void) {
  if (!native) return () => {};
  const handle = (r: Notifications.NotificationResponse | null) => {
    const url = r?.notification.request.content.data?.url;
    if (typeof url === 'string') open(url);
  };
  try {
    handle(Notifications.getLastNotificationResponse());
  } catch {}
  const tapped = Notifications.addNotificationResponseReceivedListener(handle);
  // an alarm that fires while the app is open goes straight to the ringing screen
  const received = Notifications.addNotificationReceivedListener((n) => {
    const url = n.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/alarm')) open(url);
  });
  return () => {
    tapped.remove();
    received.remove();
  };
}

/* ───────── self-check ───────── */
export type NotifyReport = { supported: boolean; granted: boolean; canAskAgain: boolean; scheduled: number; checkins: number; alarms: number; reminders: number; next: string[] };

// What the phone itself says about notifications: permission, and what is actually booked.
export async function notifyReport(): Promise<NotifyReport> {
  const empty = { supported: native, granted: false, canAskAgain: true, scheduled: 0, checkins: 0, alarms: 0, reminders: 0, next: [] };
  if (!native) return empty;
  try {
    const perm = await Notifications.getPermissionsAsync();
    const all = await Notifications.getAllScheduledNotificationsAsync();
    const ids = all.map((n) => n.identifier);
    return {
      supported: true, granted: perm.granted, canAskAgain: perm.canAskAgain, scheduled: all.length,
      checkins: ids.filter((i) => i.startsWith('checkin-')).length, alarms: ids.filter((i) => i.startsWith('alarm-')).length,
      reminders: ids.filter((i) => i.startsWith('habit-') || i.startsWith('task-') || i.startsWith('pomo-')).length,
      next: ids.slice(0, 6),
    };
  } catch (e) {
    logError('report', e);
    return empty;
  }
}

// Fires in `seconds`; with `siren` it uses an alarm channel so the alarm sound itself can be checked.
export async function testNotification(title: string, body: string, seconds: number, siren?: 'ambulance' | 'whistle' | 'wail') {
  if (!(await initNotifications())) return false;
  try {
    if (siren && Platform.OS === 'android')
      await Notifications.setNotificationChannelAsync(`alarm-${siren}`, {
        name: `Alarm (${siren})`, importance: Notifications.AndroidImportance.MAX, sound: `alarm_${siren}.wav`, bypassDnd: true, vibrationPattern: [0, 800, 400, 800],
        audioAttributes: { usage: Notifications.AndroidAudioUsage.ALARM, contentType: Notifications.AndroidAudioContentType.SONIFICATION },
      });
    await Notifications.scheduleNotificationAsync({
      identifier: `test-${Date.now()}`,
      content: { title, body, sound: siren ? `alarm_${siren}.wav` : true, priority: Notifications.AndroidNotificationPriority.MAX, data: siren ? {} : { url: '/checkin?auto=1' } },
      trigger: seconds > 0 ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId: siren ? `alarm-${siren}` : 'default' } : null,
    });
    return true;
  } catch (e) {
    logError('test', e);
    return false;
  }
}
