import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { parse, today } from './dates';
import type { DailyTask, Habit } from './types';

const native = Platform.OS !== 'web';
let ready: Promise<boolean> | undefined;

// Asks for permission once and sets up the Android channel; resolves false when notifications are unavailable.
export function initNotifications(): Promise<boolean> {
  if (!native) return Promise.resolve(false);
  return (ready ??= (async () => {
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
      });
      if (Platform.OS === 'android')
        await Notifications.setNotificationChannelAsync('default', { name: 'Reminders', importance: Notifications.AndroidImportance.HIGH });
      const cur = await Notifications.getPermissionsAsync();
      return cur.granted || (await Notifications.requestPermissionsAsync()).granted;
    } catch {
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
    content: { title, body, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: 'default' },
  }).catch(() => {});
}

export async function scheduleDaily(id: string, title: string, body: string, time: string) {
  await cancel(id);
  if (!(await initNotifications())) return;
  const [hour, minute] = time.split(':').map(Number);
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: 'default' },
  }).catch(() => {});
}

// Rebuilds every habit and high-priority-task reminder from the current data.
export async function syncReminders(habits: Habit[], tasks: DailyTask[], labels: { habit: string; task: string }) {
  if (!(await initNotifications())) return;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await cancel(...all.map((n) => n.identifier).filter((id) => id.startsWith('habit-') || id.startsWith('task-')));
  const day = today();
  for (const h of habits) {
    if (h.is_active === false || !h.time || (h.end_date && h.end_date < day)) continue;
    const [hour, minute] = h.time.split(':').map(Number);
    for (const d of h.repeat_days?.length ? h.repeat_days : [0, 1, 2, 3, 4, 5, 6])
      await Notifications.scheduleNotificationAsync({
        identifier: `habit-${h.id}-${d}`,
        content: { title: labels.habit, body: h.title, sound: true },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: d + 1, hour, minute, channelId: 'default' },
      }).catch(() => {});
  }
  const upcoming = tasks.filter((t) => t.priority === 'high' && !t.completed && t.time && t.date >= day && !t.parent_id).slice(0, 30);
  for (const t of upcoming) {
    const when = parse(t.date);
    const [hh, mm] = t.time!.split(':').map(Number);
    when.setHours(hh, mm, 0, 0);
    await scheduleAt(`task-${t.id}`, labels.task, t.title, when);
  }
}
