import * as Calendar from 'expo-calendar/legacy';
import { Platform } from 'react-native';

import { addDays, isTime, parse } from './dates';
import { db, kv } from './db';
import { logError } from './errlog';
import { syncCalendarNow } from './phonelock';
import type { DailyTask } from './types';

export type CalInfo = { id: string; title: string; account: string };

// Calendars on this phone that events can be written to. Google's own are listed first:
// an event saved to one of them reaches Google Calendar through the phone's normal account sync.
export async function listWritableCalendars(): Promise<CalInfo[]> {
  if (Platform.OS === 'web') return [];
  const perm = await Calendar.requestCalendarPermissionsAsync();
  if (!perm.granted) return [];
  const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return all
    .filter((c) => c.allowsModifications)
    .sort((a, b) => Number(b.source?.type === 'com.google') - Number(a.source?.type === 'com.google') || Number(!!b.isPrimary) - Number(!!a.isPrimary))
    .map((c) => ({ id: c.id, title: c.title, account: c.source?.name ?? '' }));
}

export const getCalendarId = () => kv.get<string>('gcal:id', '');
export const setCalendarId = (id: string) => kv.set('gcal:id', id);
// on by default: tasks go to the calendar unless the user turns it off
let pushTimer: ReturnType<typeof setTimeout> | undefined;
// A burst of writes ends in one request to the phone to sync that account with Google straight away.
function pushToGoogle() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const status = await calendarStatus().catch(() => null);
    if (status?.google && status.account) syncCalendarNow(status.account);
  }, 1500);
}

export type CalendarStatus = { name: string; account: string; google: boolean };
// The calendar tasks are being written to, or null when there is none (no permission, or no account).
export async function calendarStatus(): Promise<CalendarStatus | null> {
  if (Platform.OS === 'web') return null;
  const perm = await Calendar.getCalendarPermissionsAsync().catch(() => null);
  if (!perm?.granted) return null;
  const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT).catch(() => []);
  const id = await getCalendarId();
  const chosen = all.find((c) => c.id === id) ?? all.filter((c) => c.allowsModifications).sort((a, b) => Number(b.source?.type === 'com.google') - Number(a.source?.type === 'com.google'))[0];
  return chosen ? { name: chosen.title, account: chosen.source?.name ?? '', google: chosen.source?.type === 'com.google' } : null;
}

export const getAutoCalendar = () => kv.get<boolean>('gcal:auto', true);

async function targetCalendar(): Promise<string | undefined> {
  const saved = await getCalendarId();
  const all = await listWritableCalendars();
  const found = all.find((c) => c.id === saved) ?? all[0];
  if (found && found.id !== saved) await setCalendarId(found.id);
  return found?.id;
}

function eventDetails(task: DailyTask, parentTitle?: string) {
  const start = parse(task.date);
  let end: Date;
  const timed = isTime(task.time);
  if (timed) {
    const [h, m] = task.time!.split(':').map(Number);
    start.setHours(h, m, 0, 0);
    end = new Date(start);
    if (isTime(task.end_time)) {
      const [eh, em] = task.end_time!.split(':').map(Number);
      end.setHours(eh, em, 0, 0);
    } else if (task.minutes) end = new Date(start.getTime() + task.minutes * 60000);
    if (end <= start) end = new Date(start.getTime() + 60 * 60000);
  } else end = parse(addDays(task.date, 1));
  return {
    title: `${task.completed ? '✓ ' : ''}${parentTitle ? `${task.title} · ${parentTitle}` : task.title}`, notes: task.notes, startDate: start, endDate: end, allDay: !timed,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    // Google Calendar itself reminds ten minutes before a timed task
    alarms: timed && !task.completed ? [{ relativeOffset: -10 }] : [],
  };
}

// Creates the task's event, or updates the one it already has. Returns false when no calendar could be written.
export async function saveTaskToCalendar(task: DailyTask): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const calendarId = await targetCalendar();
  if (!calendarId) return false;
  // a timed step of a task goes in as its own event, named after its task
  const parent = task.parent_id ? (await db.list('DailyTask')).find((x) => x.id === task.parent_id) : undefined;
  const details = eventDetails(task, parent?.title);
  if (task.calendar_event_id) {
    try {
      await Calendar.updateEventAsync(task.calendar_event_id, details);
      pushToGoogle();
      return true;
    } catch {
      // the event was deleted in the calendar app; fall through and make a new one
    }
  }
  const id = await Calendar.createEventAsync(calendarId, details);
  await db.update('DailyTask', task.id, { calendar_event_id: id });
  pushToGoogle();
  return true;
}

export async function removeTaskFromCalendar(task: DailyTask) {
  if (Platform.OS === 'web' || !task.calendar_event_id) return;
  await Calendar.deleteEventAsync(task.calendar_event_id).catch(() => {});
}

// Called after a task is created or changed: keeps its event in step when automatic sync is on.
export async function autoSyncTask(taskId: string) {
  if (Platform.OS === 'web' || !(await getAutoCalendar())) return;
  const task = (await db.list('DailyTask')).find((x) => x.id === taskId);
  // whole tasks always; their steps too unless the user turned that off (timed steps always go)
  if (task && (!task.parent_id || isTime(task.time) || (await kv.get<boolean>('gcal:subs', true)))) await saveTaskToCalendar(task).catch((e) => logError('calendar', e));
}

export type DeviceEvent = { id: string; title: string; date: string; time?: string; end?: string; allDay: boolean };

const two = (n: number) => String(n).padStart(2, '0');
const dayOf = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

// Events already in the phone's calendars between two days, for showing next to the app's own tasks.
export async function readDeviceEvents(from: string, to: string): Promise<DeviceEvent[]> {
  if (Platform.OS === 'web') return [];
  try {
    const perm = await Calendar.getCalendarPermissionsAsync();
    if (!perm.granted) return [];
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    // a phone with no calendar account has nothing to read, and Android refuses an empty list
    if (!calendars.length) return [];
    const end = parse(addDays(to, 1));
    const events = await Calendar.getEventsAsync(calendars.map((c) => c.id), parse(from), end);
    return events.map((e) => {
      const start = new Date(e.startDate);
      const finish = new Date(e.endDate);
      return { id: e.id, title: e.title, date: dayOf(start), allDay: !!e.allDay, time: e.allDay ? undefined : `${two(start.getHours())}:${two(start.getMinutes())}`, end: e.allDay ? undefined : `${two(finish.getHours())}:${two(finish.getMinutes())}` };
    });
  } catch (e) {
    logError('calendar-read', e);
    return [];
  }
}

export type SyncReport = { written: number; failed: number; calendar?: CalInfo; error?: string };

// Writes every open task from today on to the chosen calendar, and says where they went.
export async function syncAllTasks(): Promise<SyncReport> {
  if (Platform.OS === 'web') return { written: 0, failed: 0, error: 'web' };
  try {
    const all = await listWritableCalendars();
    if (!all.length) return { written: 0, failed: 0, error: 'none' };
    const id = await targetCalendar();
    const calendar = all.find((c) => c.id === id);
    const day = new Date();
    const from = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const tasks = (await db.list('DailyTask')).filter((x) => (!x.parent_id || isTime(x.time)) && !x.completed && x.date >= from);
    let written = 0;
    let failed = 0;
    for (const task of tasks) {
      try {
        if (await saveTaskToCalendar(task)) written++;
        else failed++;
      } catch (e) {
        failed++;
        logError('calendar', e);
      }
    }
    return { written, failed, calendar };
  } catch (e) {
    logError('calendar-sync', e);
    return { written: 0, failed: 0, error: String((e as Error)?.message ?? e) };
  }
}

// True when the chosen calendar belongs to a Google account, so events reach Google Calendar.
export async function googleCalendarLinked(): Promise<boolean | null> {
  if (Platform.OS === 'web') return null;
  const perm = await Calendar.getCalendarPermissionsAsync().catch(() => null);
  if (!perm?.granted) return false;
  const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT).catch(() => []);
  const id = await getCalendarId();
  const chosen = all.find((c) => c.id === id) ?? all.find((c) => c.allowsModifications);
  return chosen?.source?.type === 'com.google';
}

const two2 = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => `${two2(d.getHours())}:${two2(d.getMinutes())}`;
let pulling = false;

/**
 * Brings changes made in the calendar back into the app: a task whose event was moved takes the new day
 * and time, a renamed event renames its task, and a task whose event was deleted is unlinked from it.
 * Returns how many tasks changed.
 */
export async function pullCalendarChanges(): Promise<number> {
  if (Platform.OS === 'web' || pulling || !(await getAutoCalendar())) return 0;
  pulling = true;
  try {
    const perm = await Calendar.getCalendarPermissionsAsync();
    const id = await getCalendarId();
    if (!perm.granted || !id) return 0;
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 86400000);
    const to = new Date(now.getTime() + 90 * 86400000);
    const events = await Calendar.getEventsAsync([id], from, to);
    const byId = new Map(events.map((e) => [e.id, e]));
    const fromDay = dayOf(from);
    const toDay = dayOf(to);
    const tasks = (await db.list('DailyTask')).filter((x) => x.calendar_event_id && x.date >= fromDay && x.date <= toDay);
    let changed = 0;
    for (const task of tasks) {
      const ev = byId.get(task.calendar_event_id!);
      if (!ev) {
        await db.update('DailyTask', task.id, { calendar_event_id: undefined });
        changed++;
        continue;
      }
      const start = new Date(ev.startDate);
      const end = new Date(ev.endDate);
      const patch: Partial<DailyTask> = {};
      if (dayOf(start) !== task.date) patch.date = dayOf(start);
      if (!ev.allDay) {
        if (hm(start) !== task.time) patch.time = hm(start);
        if (task.end_time && hm(end) !== task.end_time) patch.end_time = hm(end);
      }
      // the event title carries "✓ " and " · task" decorations the app added itself
      const bare = (ev.title ?? '').replace(/^✓\s*/, '').split(' · ')[0].trim();
      if (bare && bare !== task.title) patch.title = bare;
      if (Object.keys(patch).length) {
        await db.update('DailyTask', task.id, patch);
        changed++;
      }
    }
    return changed;
  } catch (e) {
    logError('calendar-pull', e);
    return 0;
  } finally {
    pulling = false;
  }
}
