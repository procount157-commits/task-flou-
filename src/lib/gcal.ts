import { File, Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { addDays, isDate, isTime } from './dates';
import type { DailyTask, Goal, Habit } from './types';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Habit colour → Google Calendar event colour id.
export const GCAL_COLORS: Record<string, string> = {
  '#ef4444': '11', '#f97316': '6', '#eab308': '5', '#22c55e': '10', '#14b8a6': '2',
  '#3b82f6': '9', '#6366f1': '1', '#a855f7': '3', '#ec4899': '4', '#6b7280': '8',
};
export const COLOR_CHOICES = Object.keys(GCAL_COLORS);

const compact = (date: string) => date.replace(/-/g, '');
const stamp = (date: string, time: string) => `${compact(date)}T${time.replace(':', '')}00`;
const plusHour = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(h + 1 > 23 ? 59 : m).padStart(2, '0')}`;
};

function span(date: string, time?: string, end?: string) {
  if (isTime(time)) return `${stamp(date, time!)}/${stamp(date, isTime(end) ? end! : plusHour(time!))}`;
  return `${compact(date)}/${compact(addDays(date, 1))}`;
}

export function rrule(days?: number[], freq: 'daily' | 'weekly' = 'daily', until?: string) {
  const end = isDate(until) ? `;UNTIL=${compact(until!)}T235959Z` : '';
  if (days?.length && days.length < 7) return `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')}${end}`;
  return `RRULE:FREQ=${freq === 'weekly' && !days?.length ? 'WEEKLY' : 'DAILY'}${end}`;
}

function eventUrl(o: { title: string; details?: string; date: string; time?: string; end?: string; recur?: string; color?: string }) {
  const q = [`action=TEMPLATE`, `text=${encodeURIComponent(o.title)}`, `dates=${span(o.date, o.time, o.end)}`];
  if (o.details) q.push(`details=${encodeURIComponent(o.details)}`);
  if (o.recur) q.push(`recur=${encodeURIComponent(o.recur)}`);
  if (o.color && GCAL_COLORS[o.color]) q.push(`color=${GCAL_COLORS[o.color]}`);
  return `https://calendar.google.com/calendar/render?${q.join('&')}`;
}

export const openGoogleCalendar = () => Linking.openURL('https://calendar.google.com/calendar/r');

export const exportTask = (t: DailyTask) =>
  Linking.openURL(eventUrl({ title: t.title, date: t.date, time: t.time, end: t.end_time, recur: t.repeat_days?.length ? rrule(t.repeat_days) : undefined }));

export const exportHabit = (h: Habit, from: string) =>
  Linking.openURL(eventUrl({ title: h.title, date: h.start_date && h.start_date > from ? h.start_date : from, time: h.time, recur: rrule(h.repeat_days, h.frequency, h.end_date), color: h.color }));

export const exportGoal = (g: Goal) =>
  g.due_date && Linking.openURL(eventUrl({ title: `🎯 ${g.title}`, details: g.description, date: g.due_date, color: g.color }));

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

export function buildICS(tasks: DailyTask[]) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hayati//Tasks//AR', 'CALSCALE:GREGORIAN'];
  for (const t of tasks) {
    lines.push('BEGIN:VEVENT', `UID:${t.id}@hayati`, `DTSTAMP:${now}`, `SUMMARY:${esc(t.title)}`);
    if (isTime(t.time)) {
      lines.push(`DTSTART:${stamp(t.date, t.time!)}`, `DTEND:${stamp(t.date, isTime(t.end_time) ? t.end_time! : plusHour(t.time!))}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(t.date)}`, `DTEND;VALUE=DATE:${compact(addDays(t.date, 1))}`);
    }
    if (t.repeat_days?.length) lines.push(rrule(t.repeat_days));
    lines.push(`PRIORITY:${t.priority === 'high' ? 1 : t.priority === 'low' ? 9 : 5}`, `STATUS:${t.completed ? 'COMPLETED' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// Writes text to a file and hands it to the system share sheet (a browser download on web).
export async function shareFile(name: string, content: string, mimeType: string) {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
}
