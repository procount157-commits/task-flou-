import { InvokeLLM } from './integrations';
import type { DailyTask, UserProfile } from './types';

export type Busy = { title: string; start: string; end: string };
export type Slot = { id: string; time: string; minutes: number };

export const toMin = (hhmm?: string) => (hhmm && /^\d\d:\d\d$/.test(hhmm) ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) : null);
export const toHHMM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

// A task's length: its own span, the sum of its timed steps, or half an hour.
export function lengthOf(task: DailyTask, subs: DailyTask[] = []) {
  const a = toMin(task.time);
  const b = toMin(task.end_time);
  if (a !== null && b !== null && b > a) return b - a;
  const steps = subs.reduce((n, s) => n + (s.minutes ?? 0), 0);
  return steps || 30;
}

/**
 * Asks the AI to place the day's open tasks in the free time between the phone's calendar events,
 * inside waking hours and around work hours, the important ones in the morning. Returns a start time
 * and a length for every task it placed; the caller shows them for approval before changing anything.
 */
export async function arrangeDay(date: string, tasks: DailyTask[], busy: Busy[], profile: UserProfile | null, nowHHMM: string | null, lang: string): Promise<Slot[]> {
  const wake = profile?.wake_time ?? '07:00';
  const sleep = profile?.sleep_time ?? '23:00';
  const work = profile?.work_hours_start && profile?.work_hours_end ? `${profile.work_hours_start}-${profile.work_hours_end}` : 'not set';
  const list = tasks.map((x) => `${x.id} | ${x.title} | priority ${x.priority ?? 'medium'} | ${x.time ? `now at ${x.time}` : 'no time'} | ~${lengthOf(x)} min`).join('\n');
  const text = await InvokeLLM(
    [
      {
        role: 'system',
        content:
          'You are a day planner. Place each task in a free slot. Rules: never overlap a busy block or another task; stay between wake and sleep time; ' +
          'start no earlier than the current time when one is given; put high-priority and deep work early, small errands later; leave 10 minutes between blocks; ' +
          'keep a fixed time a task already has unless it clashes. Lengths may be adjusted to 15-120 minutes when sensible.',
      },
      {
        role: 'user',
        content:
          `Date: ${date}. Wake ${wake}, sleep ${sleep}. Work hours: ${work}.${nowHHMM ? ` Current time: ${nowHHMM}.` : ''}\n` +
          `Busy (calendar):\n${busy.map((b) => `${b.start}-${b.end} ${b.title}`).join('\n') || 'none'}\n` +
          `Tasks (id | title | priority | time | length):\n${list}\n` +
          `Reply ONLY with a JSON array [{"id": "...", "time": "HH:MM", "minutes": number}] for every task that fits. Language of any text: ${lang === 'ar' ? 'Arabic' : 'English'}.`,
      },
    ],
    0.2,
  );
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('bad AI reply');
  const ids = new Set(tasks.map((x) => x.id));
  return (JSON.parse(m[0]) as any[])
    .map((x) => ({ id: String(x?.id ?? ''), time: String(x?.time ?? ''), minutes: Math.max(10, Math.min(240, Math.round(Number(x?.minutes) || 30))) }))
    .filter((x) => ids.has(x.id) && toMin(x.time) !== null)
    .sort((a, b) => a.time.localeCompare(b.time));
}
