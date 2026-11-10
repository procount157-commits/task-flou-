// Mapping between Hayati tasks and Google Calendar events (REST v3). Pure.
import { endOf, isDateStr, isTimeStr, type TaskRow } from './task';

/** Google event ids: base32hex characters (0-9, a-v), length 5–1024. Deterministic from the task id → retries can't duplicate. */
export function eventIdFor(taskId: string) {
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let bits = '';
  for (const byte of new TextEncoder().encode(`hayati:${taskId}`)) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out.slice(0, 1024);
}

export const addDaysIso = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export type GEvent = {
  id?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  reminders?: { useDefault: boolean; overrides?: { method: 'popup' | 'email'; minutes: number }[] };
  extendedProperties?: { private?: Record<string, string> };
  updated?: string;
  transparency?: 'opaque' | 'transparent';
  htmlLink?: string;
};

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Whether a task should exist on the calendar at all. Inbox/undated/closed tasks never do. */
export function wantsEvent(t: TaskRow, o: { subtasks: boolean }) {
  if (!isDateStr(t.date)) return false;
  if (t.completed || t.status === 'cancelled' || t.status === 'archived') return false;
  if (t.parent_id && !o.subtasks) return false;
  return true;
}

/** Task → event body. Date only → all-day event (no invented time). Time → timed event in the task's timezone. */
export function taskToEvent(t: TaskRow, tz: string, parentTitle?: string): GEvent {
  const ev: GEvent = {
    id: eventIdFor(t.id),
    summary: parentTitle ? `${t.title} · ${parentTitle}` : t.title,
    description: [t.description, t.notes, t.due_date ? `⏳ ${t.due_date}` : '', '— Hayati'].filter(Boolean).join('\n'),
    extendedProperties: { private: { hayatiTaskId: t.id, hayatiVersion: String(t.version ?? 1) } },
    transparency: 'opaque',
  };
  const zone = t.timezone || tz;
  if (isTimeStr(t.time)) {
    ev.start = { dateTime: `${t.date}T${t.time}:00`, timeZone: zone };
    ev.end = { dateTime: `${t.date}T${endOf(t)}:00`, timeZone: zone };
    const mins = t.reminder_minutes?.length ? t.reminder_minutes : [10];
    ev.reminders = { useDefault: false, overrides: mins.slice(0, 5).map((minutes) => ({ method: 'popup' as const, minutes })) };
  } else {
    ev.start = { date: t.date };
    ev.end = { date: addDaysIso(t.date, 1) };
    ev.reminders = { useDefault: false, overrides: [] };
  }
  if (t.recurrence_rule) ev.recurrence = [t.recurrence_rule];
  else if (t.repeat_days?.length && !(t as any).repeat_source_id) ev.recurrence = [`RRULE:FREQ=WEEKLY;BYDAY=${t.repeat_days.map((d) => BYDAY[d]).join(',')}`];
  return ev;
}

/** Event → task patch, for an event Hayati manages (has hayatiTaskId). Moving/renaming in Google updates the task. */
export function eventToPatch(ev: GEvent, t: TaskRow): Partial<TaskRow> | 'unschedule' | null {
  if (ev.status === 'cancelled') return 'unschedule';
  const patch: Partial<TaskRow> = {};
  const title = (ev.summary ?? '').split(' · ')[0].trim();
  if (title && title !== t.title) patch.title = title;
  if (ev.start?.date) {
    if (ev.start.date !== t.date) patch.date = ev.start.date;
    if (t.time) {
      patch.time = undefined;
      patch.end_time = undefined;
    }
  } else if (ev.start?.dateTime) {
    const [d, rest] = ev.start.dateTime.split('T');
    const time = rest.slice(0, 5);
    const endTime = ev.end?.dateTime?.split('T')[1]?.slice(0, 5);
    if (d !== t.date) patch.date = d;
    if (time !== t.time) patch.time = time;
    if (endTime && endTime !== endOf(t)) {
      patch.end_time = endTime;
      const [sh, sm] = time.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const m = eh * 60 + em - (sh * 60 + sm);
      if (m > 0) patch.minutes = m;
    }
  }
  return Object.keys(patch).length ? patch : null;
}

/** The task id a Google event belongs to, or undefined for the user's own (external) events. */
export const managedTaskId = (ev: GEvent) => ev.extendedProperties?.private?.hayatiTaskId;

/** Calendar view item for an external event (shown as busy, never edited by Hayati). */
export function externalBusy(ev: GEvent): { start: string; end: string; allDay: boolean; title: string } | null {
  if (ev.status === 'cancelled' || ev.transparency === 'transparent' || managedTaskId(ev)) return null;
  if (ev.start?.dateTime && ev.end?.dateTime) return { start: ev.start.dateTime, end: ev.end.dateTime, allDay: false, title: ev.summary ?? '' };
  if (ev.start?.date && ev.end?.date) return { start: ev.start.date, end: ev.end.date, allDay: true, title: ev.summary ?? '' };
  return null;
}
