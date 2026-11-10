// Pure task model: statuses, derived state, migration of old rows. No React Native imports.

export const TASK_STATUSES = ['inbox', 'unscheduled', 'planned', 'in_progress', 'waiting', 'blocked', 'completed', 'cancelled', 'archived'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type SyncStatus = 'local' | 'pending' | 'synced' | 'error' | 'conflict';
export type TaskSource = 'manual' | 'quick_capture' | 'ai' | 'plan' | 'google' | 'notion' | 'voice' | 'repeat';

export const TASK_SCHEMA_VERSION = 2;

/** The fields every task row may carry. Mirrors `DailyTask` in lib/types.ts (kept structural so core stays RN-free). */
export interface TaskRow {
  id: string;
  title: string;
  date: string; // scheduled day, '' when not scheduled
  time?: string;
  end_time?: string;
  minutes?: number;
  completed?: boolean;
  priority?: 'low' | 'medium' | 'high';
  parent_id?: string;
  goal_id?: string;
  status?: TaskStatus;
  due_date?: string;
  description?: string;
  notes?: string;
  tags?: string[];
  project?: string;
  milestone_id?: string;
  dependencies?: string[];
  recurrence_rule?: string;
  repeat_days?: number[];
  reminder_minutes?: number[];
  timezone?: string;
  effort?: 1 | 2 | 3 | 4 | 5;
  actual_minutes?: number;
  completed_at?: string;
  source?: TaskSource;
  sync_status?: SyncStatus;
  google_event_id?: string;
  google_calendar_id?: string;
  notion_page_id?: string;
  last_synced_at?: string;
  version?: number;
  schema_version?: number;
  calendar_event_id?: string;
  created_date?: string;
  updated_date?: string;
}

const DONE: TaskStatus[] = ['completed', 'cancelled', 'archived'];
export const isClosed = (s?: TaskStatus) => !!s && DONE.includes(s);
export const isDateStr = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isTimeStr = (s?: string) => !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** The status a row should have given its fields. Explicit waiting/blocked/in_progress/cancelled/archived are kept. */
export function deriveStatus(t: Pick<TaskRow, 'status' | 'completed' | 'date' | 'time'>): TaskStatus {
  if (t.completed) return 'completed';
  if (t.status && ['in_progress', 'waiting', 'blocked', 'cancelled', 'archived'].includes(t.status)) return t.status;
  if (isDateStr(t.date)) return 'planned';
  if (t.status === 'unscheduled') return 'unscheduled';
  return 'inbox';
}

/** Migrates one row from any older shape to the current one. Never drops a field. */
export function migrateTask<T extends TaskRow>(row: T, tz?: string): T {
  if ((row.schema_version ?? 1) >= TASK_SCHEMA_VERSION) return row;
  const next: T = { ...row };
  if (typeof next.date !== 'string') next.date = '';
  next.status = deriveStatus(next);
  if (next.completed && !next.completed_at) next.completed_at = next.updated_date ?? next.created_date;
  next.version = next.version ?? 1;
  next.source = next.source ?? 'manual';
  next.sync_status = next.sync_status ?? (next.calendar_event_id ? 'synced' : 'local');
  if (tz && !next.timezone) next.timezone = tz;
  next.schema_version = TASK_SCHEMA_VERSION;
  return next;
}

/** Applies a patch the way the repository does: bumps version, keeps status consistent. */
export function applyPatch<T extends TaskRow>(row: T, patch: Partial<T>, nowIso: string): T {
  const next = { ...row, ...patch } as T;
  if ('completed' in patch) {
    next.completed_at = patch.completed ? nowIso : undefined;
    if (!patch.completed && next.status === 'completed') next.status = undefined;
  }
  if (patch.status === 'completed') next.completed = true;
  next.status = deriveStatus(next);
  next.version = (row.version ?? 1) + 1;
  next.updated_date = nowIso;
  return next;
}

/** Overdue: has a deadline or scheduled day before today and is still open. */
export function isOverdue(t: TaskRow, today: string) {
  if (t.completed || isClosed(t.status)) return false;
  const ref = t.due_date || t.date;
  return isDateStr(ref) && ref < today;
}

/** Validation for a row before it is stored. Returns human-readable problems (empty = valid). */
export function validateTask(t: Partial<TaskRow>): string[] {
  const p: string[] = [];
  if (!t.title || !t.title.trim()) p.push('title is required');
  if (t.date && !isDateStr(t.date)) p.push('date must be YYYY-MM-DD');
  if (t.due_date && !isDateStr(t.due_date)) p.push('due_date must be YYYY-MM-DD');
  if (t.time && !isTimeStr(t.time)) p.push('time must be HH:mm');
  if (t.end_time && !isTimeStr(t.end_time)) p.push('end_time must be HH:mm');
  if (t.time && !t.date) p.push('time needs a date');
  if (t.time && t.end_time && t.end_time <= t.time) p.push('end_time must be after time');
  if (t.minutes != null && (!Number.isFinite(t.minutes) || t.minutes <= 0 || t.minutes > 24 * 60)) p.push('minutes out of range');
  if (t.status && !TASK_STATUSES.includes(t.status)) p.push('unknown status');
  if (t.parent_id && t.parent_id === t.id) p.push('task cannot be its own parent');
  return p;
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const fromMinutes = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** End clock time of a timed task: end_time, else time + minutes, else time + 30. */
export function endOf(t: Pick<TaskRow, 'time' | 'end_time' | 'minutes'>): string | undefined {
  if (!isTimeStr(t.time)) return undefined;
  if (isTimeStr(t.end_time) && t.end_time! > t.time!) return t.end_time;
  return fromMinutes(Math.min(toMinutes(t.time!) + (t.minutes && t.minutes > 0 ? t.minutes : 30), 23 * 60 + 59));
}
