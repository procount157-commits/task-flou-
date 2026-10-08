import * as Calendar from 'expo-calendar/legacy';
import { Platform } from 'react-native';

import { addDays, isTime, parse } from './dates';
import { db, kv } from './db';
import { logError } from './errlog';
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
export const getAutoCalendar = () => kv.get<boolean>('gcal:auto', true);

async function targetCalendar(): Promise<string | undefined> {
  const saved = await getCalendarId();
  const all = await listWritableCalendars();
  const found = all.find((c) => c.id === saved) ?? all[0];
  if (found && found.id !== saved) await setCalendarId(found.id);
  return found?.id;
}

function eventDetails(task: DailyTask) {
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
    }
    if (end <= start) end = new Date(start.getTime() + 60 * 60000);
  } else end = parse(addDays(task.date, 1));
  return { title: task.title, notes: task.notes, startDate: start, endDate: end, allDay: !timed, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

// Creates the task's event, or updates the one it already has. Returns false when no calendar could be written.
export async function saveTaskToCalendar(task: DailyTask): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const calendarId = await targetCalendar();
  if (!calendarId) return false;
  const details = eventDetails(task);
  if (task.calendar_event_id) {
    try {
      await Calendar.updateEventAsync(task.calendar_event_id, details);
      return true;
    } catch {
      // the event was deleted in the calendar app; fall through and make a new one
    }
  }
  const id = await Calendar.createEventAsync(calendarId, details);
  await db.update('DailyTask', task.id, { calendar_event_id: id });
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
  if (task && !task.parent_id) await saveTaskToCalendar(task).catch((e) => logError('calendar', e));
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
