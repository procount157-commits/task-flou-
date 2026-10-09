import type { Translations } from './i18n';
import { addDays, today, weekday } from './dates';
import { db, kv, peek } from './db';
import type { DailyTask, Goal, GoalLevel, Habit, HabitLog, Priority } from './types';

export const LEVELS: GoalLevel[] = ['life', 'ten_years', 'three_years', 'one_year', 'three_months', 'one_month', 'one_week'];
export const childLevel = (l: GoalLevel): GoalLevel | undefined => LEVELS[LEVELS.indexOf(l) + 1];
export const parentLevel = (l: GoalLevel): GoalLevel | undefined => LEVELS[LEVELS.indexOf(l) - 1];

export const POINTS: Record<Priority, number> = { high: 30, medium: 20, low: 10 };
export const TIERS = [
  { min: 0, icon: '🌱' },
  { min: 100, icon: '⚡' },
  { min: 300, icon: '🌟' },
  { min: 600, icon: '🏆' },
  { min: 1000, icon: '👑' },
];
export const tierOf = (points: number) => {
  let i = 0;
  TIERS.forEach((t, k) => points >= t.min && (i = k));
  return { index: i, icon: TIERS[i].icon, next: TIERS[i + 1]?.min };
};
export const addPoints = async (delta: number) => kv.set('points', Math.max(0, (await kv.get('points', 0)) + delta));

const PRIO_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
export const sortTasks = (tasks: DailyTask[]) =>
  [...tasks].sort(
    (a, b) =>
      Number(!!a.completed) - Number(!!b.completed) ||
      // a hand-set order (moved with the arrows) comes before the automatic one
      (a.order ?? 1e9) - (b.order ?? 1e9) ||
      PRIO_RANK[a.priority ?? 'medium'] - PRIO_RANK[b.priority ?? 'medium'] ||
      (a.time ?? '99:99').localeCompare(b.time ?? '99:99'),
  );

// Repeating tasks are templates: each scheduled day gets its own copy so completion is tracked per day.
export async function materializeRepeats(date: string) {
  const tasks = await db.list('DailyTask');
  const wd = weekday(date);
  const due = tasks.filter(
    (t) => !t.parent_id && !t.repeat_source_id && t.repeat_days?.includes(wd) && t.date < date &&
      !tasks.some((x) => x.repeat_source_id === t.id && x.date === date),
  );
  if (due.length)
    await db.bulkCreate('DailyTask', due.map(({ id, created_date, updated_date, created_by_id, ...t }) => ({
      ...t, date, completed: false, reminder_sent: false, calendar_event_id: undefined, repeat_source_id: id,
    })));
}

export const habitScheduled = (h: Habit, date: string) =>
  h.is_active !== false &&
  (!h.start_date || date >= h.start_date) &&
  (!h.end_date || date <= h.end_date) &&
  (!h.repeat_days?.length || h.repeat_days.includes(weekday(date)));

export const logDone = (h: Habit, log?: HabitLog) => !!log && (log.completed || (log.count ?? 0) >= (h.daily_count || 1));

// Consecutive scheduled days completed, counting back from today; an unfinished today does not break the run.
export function calcStreak(h: Habit, logs: HabitLog[], upto = today()) {
  const byDate = new Map(logs.filter((l) => l.habit_id === h.id).map((l) => [l.date, l]));
  let streak = 0;
  let d = upto;
  for (let i = 0; i < 3650; i++, d = addDays(d, -1)) {
    if (h.start_date && d < h.start_date) break;
    if (!habitScheduled({ ...h, is_active: true }, d)) continue;
    if (logDone(h, byDate.get(d))) streak++;
    else if (d !== upto) break;
  }
  return streak;
}

// How far a goal is: a measured goal by its number; otherwise its sub-goals and the tasks linked to it
// (finished out of all), so ticking a task moves the goal and every goal above it.
export function goalProgress(g: Goal, all: Goal[], depth = 0): number {
  if (g.status === 'completed') return 100;
  if (g.target_value && g.target_value > 0) return clamp(((g.current_value ?? 0) / g.target_value) * 100);
  const kids = all.filter((x) => x.parent_id === g.id && x.status !== 'cancelled');
  const linked = peek('DailyTask').filter((x) => x.goal_id === g.id && !x.parent_id);
  const parts: number[] = [];
  if (kids.length && depth < 8 && (g.auto_progress || linked.length)) parts.push(...kids.map((k) => goalProgress(k, all, depth + 1)));
  if (linked.length) parts.push((linked.filter((x) => x.completed).length / linked.length) * 100);
  if (parts.length) return clamp(parts.reduce((a, b) => a + b, 0) / parts.length);
  return clamp(g.progress ?? 0);
}
const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

// The last day anything moved on a goal or below it: its number, a finished task, an edit.
export function lastMoved(g: Goal, all: Goal[]): string {
  const ids = new Set([g.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of all) if (x.parent_id && ids.has(x.parent_id) && !ids.has(x.id)) (ids.add(x.id), (grew = true));
  }
  const dates = [
    ...all.filter((x) => ids.has(x.id)).flatMap((x) => [x.updated_date.slice(0, 10), ...(x.value_log ?? []).map((v) => v.date)]),
    ...peek('DailyTask').filter((x) => x.goal_id && ids.has(x.goal_id) && x.completed).map((x) => x.updated_date.slice(0, 10)),
  ];
  return dates.sort().pop() ?? g.created_date.slice(0, 10);
}

// The next open task for a goal or anything under it: soonest date first, then the hand-set order.
export function nextStep(g: Goal, all: Goal[]): DailyTask | undefined {
  const ids = new Set([g.id, ...all.filter((x) => x.parent_id === g.id).map((x) => x.id)]);
  return [...peek('DailyTask')].filter((x) => x.goal_id && ids.has(x.goal_id) && !x.completed && !x.parent_id)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.order ?? 1e9) - (b.order ?? 1e9) || (a.time ?? '99').localeCompare(b.time ?? '99'))[0];
}

export const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
export const money = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US');

// A reward becomes claimable once its goal is completed or its habit reaches the target streak.
export async function grantReward(type: 'goal' | 'habit', src: { id: string; reward_title?: string; reward_icon?: string; reward_description?: string }) {
  if (!src.reward_title) return false;
  const rewards = await db.list('Reward');
  if (rewards.some((r) => r.linked_id === src.id && r.type === type)) return false;
  await db.create('Reward', { title: src.reward_title, icon: src.reward_icon, description: src.reward_description, type, linked_id: src.id, is_claimed: false });
  return true;
}

// The texts drawn on the hourly card: the fixed questions, the rotating deep ones, quotes, and the top open goal.
export function hourlyCard(t: Translations, goals: Goal[]) {
  const open = goals.filter((g) => g.status !== 'completed' && g.status !== 'cancelled');
  const top = open.find((g) => g.priority === 'high') ?? open[0];
  const n = t.checkin.notif;
  return {
    title: t.checkin.cardTitle, lines: t.checkin.cardLines, questions: t.checkin.bank, quotes: t.quotes, goal: top?.title, tap: t.checkin.cardTap,
    steps: n.steps, typeLabel: n.typeLabel, replyLabel: n.replyLabel, voiceLabel: n.voiceLabel, doneTitle: n.doneTitle, analyzing: n.analyzing, system: n.system,
  };
}
