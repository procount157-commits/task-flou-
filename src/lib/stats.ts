import { lastDays, today } from './dates';
import { avg, goalProgress, habitScheduled, LEVELS, logDone, pct } from './logic';
import type { DailyTask, Goal, Habit, HabitLog } from './types';

const top = (tasks: DailyTask[]) => tasks.filter((t) => !t.parent_id);

export function taskSeries(tasks: DailyTask[], days: number) {
  const all = top(tasks);
  return lastDays(days).map((d) => {
    const on = all.filter((t) => t.date === d);
    const done = on.filter((t) => t.completed).length;
    return { date: d, label: d.slice(8), total: on.length, done, rate: pct(done, on.length) };
  });
}

export function taskStats(tasks: DailyTask[]) {
  const all = top(tasks);
  const done = all.filter((t) => t.completed);
  const day = all.filter((t) => t.date === today());
  return {
    total: all.length,
    done: done.length,
    rate: pct(done.length, all.length),
    highDone: done.filter((t) => t.priority === 'high').length,
    todayRate: pct(day.filter((t) => t.completed).length, day.length),
    byPriority: (['high', 'medium', 'low'] as const).map((p) => ({ priority: p, count: done.filter((t) => (t.priority ?? 'medium') === p).length })),
  };
}

export function goalStats(goals: Goal[]) {
  const live = goals.filter((g) => g.status !== 'cancelled');
  return {
    total: goals.length,
    done: goals.filter((g) => g.status === 'completed').length,
    active: goals.filter((g) => g.status === 'in_progress').length,
    avg: avg(live.map((g) => goalProgress(g, goals))),
    byLevel: LEVELS.map((l) => ({ level: l, value: avg(live.filter((g) => g.level === l).map((g) => goalProgress(g, goals))), count: live.filter((g) => g.level === l).length })),
    byStatus: (['not_started', 'in_progress', 'completed', 'cancelled'] as const).map((s) => ({ status: s, count: goals.filter((g) => (g.status ?? 'not_started') === s).length })),
    top5: [...live].map((g) => ({ goal: g, value: goalProgress(g, goals) })).sort((a, b) => b.value - a.value).slice(0, 5),
  };
}

// Share of a habit's scheduled days in the window that were completed.
export function commitment(h: Habit, logs: HabitLog[], days: number) {
  const mine = new Map(logs.filter((l) => l.habit_id === h.id).map((l) => [l.date, l]));
  const due = lastDays(days).filter((d) => habitScheduled({ ...h, is_active: true }, d));
  return pct(due.filter((d) => logDone(h, mine.get(d))).length, due.length);
}

export function habitStats(habits: Habit[], logs: HabitLog[]) {
  const active = habits.filter((h) => h.is_active !== false);
  const day = today();
  const doneOn = (d: string) => active.filter((h) => logDone(h, logs.find((l) => l.habit_id === h.id && l.date === d))).length;
  return {
    active: active.length,
    daysDone: logs.filter((l) => l.completed).length,
    bestStreak: Math.max(0, ...habits.map((h) => h.streak ?? 0)),
    doneToday: doneOn(day),
    activity: lastDays(14).map((d) => ({ label: d.slice(8), value: doneOn(d) })),
    commitment: active.map((h) => ({ habit: h, value: commitment(h, logs, 30) })),
    rate: avg(active.map((h) => commitment(h, logs, 30))),
  };
}
