import * as Calendar from 'expo-calendar/legacy';
import { Platform } from 'react-native';

import { addDays, isTime, parse } from './dates';
import { db, kv } from './db';
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
export const getAutoCalendar = () => kv.get<boolean>('gcal:auto', false);

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
  if (task && !task.parent_id) await saveTaskToCalendar(task).catch(() => {});
}
