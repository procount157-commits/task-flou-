import { db } from './db';
import { autoSyncTask } from './devicecal';
import type { DailyTask } from './types';

export type StepInput = string | { title: string; minutes?: number };

const pad = (n: number) => String(n).padStart(2, '0');
const plus = (hhmm: string, m: number) => {
  const total = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + m;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
};

/**
 * Files steps under a task. When the task has a time, the steps are laid end to end from it — each with
 * its own start and length — so they can stand as their own entries in the calendar; otherwise they sit
 * on the task's day. Every step is then sent to the calendar like any other task.
 */
export async function addSteps(parent: DailyTask, steps: StepInput[]): Promise<DailyTask[]> {
  const list = steps.map((s) => (typeof s === 'string' ? { title: s, minutes: undefined } : s)).filter((s) => s.title.trim());
  if (!list.length) return [];
  // steps without a length of their own share the task's time evenly, in five-minute units
  const share = parent.minutes ? Math.max(5, Math.round(parent.minutes / list.length / 5) * 5) : 15;
  let cursor = parent.time;
  const rows = list.map((s) => {
    const minutes = s.minutes ?? share;
    const row = {
      title: s.title.trim(), date: parent.date, parent_id: parent.id, priority: parent.priority, completed: false,
      time: cursor, minutes: cursor ? minutes : undefined, end_time: cursor ? plus(cursor, minutes) : undefined,
    };
    if (cursor) cursor = plus(cursor, minutes);
    return row;
  });
  const made = await db.bulkCreate('DailyTask', rows);
  for (const x of made) await autoSyncTask(x.id);
  return made;
}
