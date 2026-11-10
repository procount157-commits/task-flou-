// Roadmap: the AI's proposal for a goal, checked, ordered and scheduled here. Pure and deterministic.
// Backward planning: outcome → milestones → workstreams → tasks → sessions. The AI proposes the structure;
// this module validates it, removes impossible dependencies, places sessions into real free time, and
// says honestly whether the deadline fits.
import { arr, num, obj, oneOf, str, type Result, parseAI } from './schema';
import { freeSlots, type Interval } from './scheduler';
import { fromMinutes } from './task';
import type { GoalBrief } from './goalinterview';

const P = ['low', 'medium', 'high'] as const;
export type Prio = (typeof P)[number];

export interface RoadTask {
  key: string;
  title: string;
  description?: string;
  why?: string;
  minutes: number;
  priority: Prio;
  milestone: string;
  workstream?: string;
  depends_on: string[];
  done_when?: string;
  /** set in the preview when the person turns a task off */
  off?: boolean;
}
export interface RoadMilestone {
  key: string;
  title: string;
  purpose?: string;
  result?: string;
  done_when?: string;
  /** estimated focused hours for the whole milestone (tasks may only be detailed for the near ones) */
  hours: number;
  depends_on: string[];
  off?: boolean;
}
export interface Risk { risk: string; probability: Prio; impact: Prio; warning?: string; prevent?: string; recover?: string; alternative?: string }
export interface SuccessCriterion { measure: string; baseline?: string; target?: string; unit?: string; evidence?: string }
export interface Roadmap {
  understanding?: string;
  why_it_fits?: string;
  first_step?: string;
  success: SuccessCriterion[];
  milestones: RoadMilestone[];
  tasks: RoadTask[];
  risks: Risk[];
  assumptions: string[];
  recommendations: string[];
}

// ── AI output contract ───────────────────────────────────────────────────
const KEY = str({ min: 1, max: 24 });
export const RoadmapSchema = obj({
  understanding: str({ optional: true, max: 600 }),
  why_it_fits: str({ optional: true, max: 800 }),
  first_step: str({ optional: true, max: 200 }),
  success: arr(obj({ measure: str({ min: 2, max: 200 }), baseline: str({ optional: true, max: 80 }), target: str({ optional: true, max: 80 }), unit: str({ optional: true, max: 30 }), evidence: str({ optional: true, max: 200 }) }), { min: 1, max: 6 }),
  milestones: arr(obj({
    key: KEY, title: str({ min: 3, max: 160 }), purpose: str({ optional: true, max: 300 }), result: str({ optional: true, max: 300 }),
    done_when: str({ optional: true, max: 300 }), hours: num({ min: 0.5, max: 2000 }), depends_on: arr(KEY, { optional: true, max: 10 }),
  }), { min: 1, max: 12 }),
  tasks: arr(obj({
    key: KEY, title: str({ min: 3, max: 160 }), description: str({ optional: true, max: 400 }), why: str({ optional: true, max: 300 }),
    minutes: num({ min: 10, max: 480, int: true }), priority: oneOf(P), milestone: KEY, workstream: str({ optional: true, max: 80 }),
    depends_on: arr(KEY, { optional: true, max: 10 }), done_when: str({ optional: true, max: 300 }),
  }), { min: 1, max: 60 }),
  risks: arr(obj({
    risk: str({ min: 3, max: 200 }), probability: oneOf(P, false), impact: oneOf(P, false), warning: str({ optional: true, max: 200 }),
    prevent: str({ optional: true, max: 300 }), recover: str({ optional: true, max: 300 }), alternative: str({ optional: true, max: 300 }),
  }), { optional: true, max: 8 }),
  assumptions: arr(str({ min: 2, max: 300 }), { optional: true, max: 10 }),
  recommendations: arr(str({ min: 2, max: 300 }), { optional: true, max: 8 }),
});

export function parseRoadmap(text: string): Result<Roadmap> {
  const r = parseAI(RoadmapSchema, text);
  if (!r.ok) return r;
  const v = r.value as any;
  return {
    ok: true,
    value: {
      understanding: v.understanding, why_it_fits: v.why_it_fits, first_step: v.first_step,
      success: v.success,
      milestones: v.milestones.map((m: any) => ({ ...m, depends_on: m.depends_on ?? [] })),
      tasks: v.tasks.map((t: any) => ({ ...t, priority: t.priority ?? 'medium', depends_on: t.depends_on ?? [] })),
      risks: (v.risks ?? []).map((x: any) => ({ ...x })),
      assumptions: v.assumptions ?? [],
      recommendations: v.recommendations ?? [],
    },
  };
}

// ── validation ───────────────────────────────────────────────────────────
const GENERIC = [
  /^(?:اعمل|العمل|اشتغل|استمر|تابع|واصل|حاول|ابذل)\s+(?:على|في)?\s*(?:الهدف|هدفك|التعلم|المذاكرة|الدراسة|التقدم)?\s*$/,
  /^(?:استمر|واصل|تابع)\s+(?:في\s+)?(?:التعلم|المذاكرة|الدراسة|العمل)/,
  /^(?:حقق|احرز)\s+تقدم/,
  /^(?:ذاكر|ادرس)\s+\S+$/,
  /^(?:work on|continue|keep|make progress|try harder|study|learn)\b(?:\s+\w+){0,2}$/i,
];
/** A title like "Study CMA" or "استمر في التعلم" says nothing about what to do today. */
export const isGeneric = (title: string) => GENERIC.some((re) => re.test(title.trim()));

export type Issue = { key: string; kind: 'generic' | 'unknown_dependency' | 'cycle' | 'orphan' | 'duplicate' | 'too_long'; detail?: string };

/**
 * Makes the AI's roadmap internally consistent: unique keys, tasks attached to a real milestone,
 * dependencies that exist and contain no cycles, task lengths that fit a session limit. Returns the
 * cleaned roadmap and what was changed, so the preview can show it.
 */
export function validateRoadmap(input: Roadmap, o: { maxTaskMinutes?: number } = {}): { roadmap: Roadmap; issues: Issue[] } {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const milestones = input.milestones.filter((m) => {
    if (seen.has(m.key)) return issues.push({ key: m.key, kind: 'duplicate' }), false;
    seen.add(m.key);
    return true;
  });
  const mKeys = new Set(milestones.map((m) => m.key));
  for (const m of milestones) {
    const bad = m.depends_on.filter((d) => !mKeys.has(d) || d === m.key);
    if (bad.length) issues.push({ key: m.key, kind: 'unknown_dependency', detail: bad.join(',') });
    m.depends_on = m.depends_on.filter((d) => mKeys.has(d) && d !== m.key);
  }
  const tSeen = new Set<string>();
  const tasks = input.tasks.filter((t) => {
    if (tSeen.has(t.key) || mKeys.has(t.key)) return issues.push({ key: t.key, kind: 'duplicate' }), false;
    tSeen.add(t.key);
    return true;
  }).map((t) => ({ ...t }));
  const max = o.maxTaskMinutes ?? 240;
  for (const t of tasks) {
    if (!mKeys.has(t.milestone)) {
      issues.push({ key: t.key, kind: 'orphan', detail: t.milestone });
      t.milestone = milestones[0].key;
    }
    const bad = t.depends_on.filter((d) => !tSeen.has(d) || d === t.key);
    if (bad.length) issues.push({ key: t.key, kind: 'unknown_dependency', detail: bad.join(',') });
    t.depends_on = t.depends_on.filter((d) => tSeen.has(d) && d !== t.key);
    if (isGeneric(t.title)) issues.push({ key: t.key, kind: 'generic' });
    if (t.minutes > max) issues.push({ key: t.key, kind: 'too_long', detail: String(t.minutes) });
  }
  // break dependency cycles: an edge that closes a loop is dropped (and reported)
  const breakCycles = <T extends { key: string; depends_on: string[] }>(items: T[]) => {
    const byKey = new Map(items.map((x) => [x.key, x]));
    const state = new Map<string, 1 | 2>();
    const visit = (k: string) => {
      state.set(k, 1);
      const x = byKey.get(k)!;
      for (const d of [...x.depends_on]) {
        if (state.get(d) === 1) {
          x.depends_on = x.depends_on.filter((y) => y !== d);
          issues.push({ key: k, kind: 'cycle', detail: d });
        } else if (!state.has(d)) visit(d);
      }
      state.set(k, 2);
    };
    for (const x of items) if (!state.has(x.key)) visit(x.key);
  };
  breakCycles(milestones);
  breakCycles(tasks);
  return { roadmap: { ...input, milestones, tasks }, issues };
}

/** Tasks in an order that respects dependencies, milestone order, then priority. Stable for equal input. */
export function orderTasks(r: Roadmap): RoadTask[] {
  const mIndex = new Map(r.milestones.map((m, i) => [m.key, i]));
  const live = r.tasks.filter((t) => !t.off && !r.milestones.find((m) => m.key === t.milestone)?.off);
  const liveKeys = new Set(live.map((t) => t.key));
  const pr = { high: 0, medium: 1, low: 2 };
  const rank = (t: RoadTask) => [mIndex.get(t.milestone) ?? 99, pr[t.priority], r.tasks.indexOf(t)];
  const cmp = (a: RoadTask, b: RoadTask) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  const done = new Set<string>();
  const out: RoadTask[] = [];
  const pending = [...live].sort(cmp);
  while (pending.length) {
    const i = pending.findIndex((t) => t.depends_on.every((d) => done.has(d) || !liveKeys.has(d)));
    const t = pending.splice(i < 0 ? 0 : i, 1)[0];
    done.add(t.key);
    out.push(t);
  }
  return out;
}

// ── scheduling into real time ────────────────────────────────────────────
export type Session = { key: string; part: number; parts: number; date: string; time: string; end_time: string; minutes: number };
export interface ScheduleOptions {
  start: string; // first day that may hold a session (YYYY-MM-DD)
  weeklyMinutes: number;
  days: number[]; // weekdays allowed, Sunday = 0
  window: { start: string; end: string };
  sessionMinutes: number;
  /** busy time on a day (calendar events + existing tasks), minutes since midnight */
  busy?: (date: string) => Interval[];
  /** stop looking after this many days */
  maxDays?: number;
  buffer?: number;
}
export interface ScheduleResult { sessions: Session[]; unplaced: string[]; finish?: string; weeklyLoad: Record<string, number> }

const dayAdd = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** Sunday-based week key, so weekly capacity is counted per calendar week. */
export const weekOf = (d: string) => dayAdd(d, -weekdayOf(d));
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * Places every live task, in dependency order, into free time inside the preferred window on allowed days,
 * never exceeding the weekly capacity and never putting a task on the same day as (or before) a task it
 * depends on. A task longer than the person's session is split into sessions on separate days.
 */
export function scheduleRoadmap(r: Roadmap, o: ScheduleOptions): ScheduleResult {
  const order = orderTasks(r);
  const maxDays = o.maxDays ?? 730;
  const allowed = new Set(o.days.length ? o.days : [0, 1, 2, 3, 4, 5, 6]);
  const perDayCap = Math.max(o.sessionMinutes, Math.ceil(o.weeklyMinutes / Math.max(1, allowed.size)) + 15);
  const used = new Map<string, Interval[]>(); // date → blocks this plan already took
  const load: Record<string, number> = {}; // week → minutes
  const dayLoad = new Map<string, number>();
  const finishOf = new Map<string, string>(); // task key → last session date
  const sessions: Session[] = [];
  const unplaced: string[] = [];
  const last = dayAdd(o.start, maxDays);
  for (const t of order) {
    const sessionLen = Math.max(15, o.sessionMinutes);
    const parts = Math.max(1, Math.ceil(t.minutes / Math.max(sessionLen, 15)));
    const each = Math.ceil(t.minutes / parts / 5) * 5;
    // a dependent task starts the day after everything it waits for
    let from = o.start;
    for (const d of t.depends_on) { const f = finishOf.get(d); if (f && f >= from) from = dayAdd(f, 1); }
    let placedParts = 0;
    let day = from;
    while (placedParts < parts && day <= last) {
      const wk = weekOf(day);
      const room = o.weeklyMinutes - (load[wk] ?? 0);
      if (allowed.has(weekdayOf(day)) && room >= each && (dayLoad.get(day) ?? 0) + each <= perDayCap) {
        const busy = [...(o.busy?.(day) ?? []), ...(used.get(day) ?? [])];
        const slot = freeSlots(busy, o.window.start, o.window.end, o.buffer ?? 10).find((x) => x.end - Math.ceil(x.start / 5) * 5 >= each);
        if (slot) {
          const s = Math.ceil(slot.start / 5) * 5;
          sessions.push({ key: t.key, part: placedParts + 1, parts, date: day, time: fromMinutes(s), end_time: fromMinutes(s + each), minutes: each });
          used.set(day, [...(used.get(day) ?? []), { start: s, end: s + each }]);
          load[wk] = (load[wk] ?? 0) + each;
          dayLoad.set(day, (dayLoad.get(day) ?? 0) + each);
          placedParts++;
          finishOf.set(t.key, day);
          // the next part of a split task goes on another day
          day = dayAdd(day, 1);
          continue;
        }
      }
      day = dayAdd(day, 1);
    }
    if (placedParts < parts) unplaced.push(t.key);
  }
  const finish = sessions.length ? sessions.map((s) => s.date).sort()[sessions.length - 1] : undefined;
  return { sessions, unplaced, finish, weeklyLoad: load };
}

// ── feasibility ─────────────────────────────────────────────────────────
export interface Feasibility {
  totalMinutes: number;
  weeklyNeeded?: number;
  weeklyAvailable: number;
  weeksAvailable?: number;
  weeksNeeded: number;
  projectedFinish: string;
  deadline?: string;
  feasible: boolean;
  /** alternatives when it does not fit: never a fictional schedule */
  options: ({ kind: 'extend'; to: string } | { kind: 'reduce'; percent: number } | { kind: 'more_hours'; hours: number } | { kind: 'stages'; first: string })[];
}

/** Total effort = the milestones' estimated hours (live ones), at least the detailed tasks they hold. */
export function totalMinutes(r: Roadmap) {
  let sum = 0;
  for (const m of r.milestones) {
    if (m.off) continue;
    const detailed = r.tasks.filter((t) => t.milestone === m.key && !t.off).reduce((n, t) => n + t.minutes, 0);
    sum += Math.max(Math.round(m.hours * 60), detailed);
  }
  return sum;
}

export function feasibility(r: Roadmap, weeklyMinutes: number, start: string, deadline?: string): Feasibility {
  const total = totalMinutes(r);
  const wk = Math.max(1, weeklyMinutes);
  const weeksNeeded = Math.ceil(total / wk);
  const projectedFinish = dayAdd(start, weeksNeeded * 7);
  if (!deadline) return { totalMinutes: total, weeklyAvailable: wk, weeksNeeded, projectedFinish, feasible: true, options: [] };
  const weeksAvailable = Math.max(0.5, daysBetween(start, deadline) / 7);
  const weeklyNeeded = Math.ceil(total / weeksAvailable);
  const feasible = weeklyNeeded <= wk;
  const options: Feasibility['options'] = [];
  if (!feasible) {
    options.push({ kind: 'extend', to: projectedFinish });
    options.push({ kind: 'reduce', percent: Math.max(5, Math.floor((wk * weeksAvailable * 100) / total)) });
    options.push({ kind: 'more_hours', hours: Math.ceil(weeklyNeeded / 60) });
    const first = r.milestones.find((m) => !m.off);
    if (first) options.push({ kind: 'stages', first: first.title });
  }
  return { totalMinutes: total, weeklyNeeded, weeklyAvailable: wk, weeksAvailable: Math.round(weeksAvailable * 10) / 10, weeksNeeded, projectedFinish, deadline, feasible, options };
}

/**
 * Milestone target dates: the last session of their detailed tasks, or — for milestones whose tasks are
 * not detailed yet — projected forward from the previous one by their hours at the weekly capacity.
 */
export function milestoneDates(r: Roadmap, sched: ScheduleResult, weeklyMinutes: number, start: string) {
  const out: Record<string, { start: string; target: string; projected: boolean }> = {};
  let cursor = start;
  for (const m of r.milestones) {
    if (m.off) continue;
    const ss = sched.sessions.filter((s) => r.tasks.find((t) => t.key === s.key)?.milestone === m.key).map((s) => s.date).sort();
    if (ss.length) {
      out[m.key] = { start: ss[0], target: ss[ss.length - 1], projected: false };
      cursor = dayAdd(ss[ss.length - 1], 1);
    } else {
      const days = Math.max(1, Math.ceil((m.hours * 60) / Math.max(1, weeklyMinutes) * 7));
      out[m.key] = { start: cursor, target: dayAdd(cursor, days), projected: true };
      cursor = dayAdd(cursor, days + 1);
    }
  }
  return out;
}

// ── records the approved plan becomes ────────────────────────────────────
export type MilestoneRecord = { key: string; title: string; description: string; start_date: string; due_date: string; hours: number; depends_on: string[] };
export type TaskRecord = {
  key: string; part: number; parts: number; title: string; description: string; date: string; time: string; end_time: string; minutes: number;
  priority: Prio; milestone: string; project?: string; depends_on: string[]; due_date: string;
};

/** Only what the person kept (not turned off) becomes a record. Milestone deadlines stay separate from sessions. */
export function buildRecords(r: Roadmap, sched: ScheduleResult, dates: ReturnType<typeof milestoneDates>, lang: 'ar' | 'en') {
  const L = lang === 'ar' ? { why: 'لماذا', done: 'تنتهي عندما', purpose: 'الهدف من المرحلة', result: 'النتيجة' } : { why: 'Why', done: 'Done when', purpose: 'Purpose', result: 'Result' };
  const milestones: MilestoneRecord[] = r.milestones.filter((m) => !m.off && dates[m.key]).map((m) => ({
    key: m.key, title: m.title, hours: m.hours, depends_on: m.depends_on,
    description: [m.purpose && `${L.purpose}: ${m.purpose}`, m.result && `${L.result}: ${m.result}`, m.done_when && `${L.done}: ${m.done_when}`].filter(Boolean).join('\n'),
    start_date: dates[m.key].start, due_date: dates[m.key].target,
  }));
  const tasks: TaskRecord[] = sched.sessions.map((s) => {
    const t = r.tasks.find((x) => x.key === s.key)!;
    return {
      key: s.key, part: s.part, parts: s.parts,
      title: s.parts > 1 ? `${t.title} (${s.part}/${s.parts})` : t.title,
      description: [t.description, t.why && `${L.why}: ${t.why}`, t.done_when && `${L.done}: ${t.done_when}`].filter(Boolean).join('\n'),
      date: s.date, time: s.time, end_time: s.end_time, minutes: s.minutes, priority: t.priority,
      milestone: t.milestone, project: t.workstream, depends_on: t.depends_on, due_date: dates[t.milestone]?.target ?? s.date,
    };
  });
  return { milestones, tasks };
}

// ── after approval: weekly review and adaptive replanning ────────────────
export type TrackedTask = { id: string; title: string; date: string; time?: string; minutes?: number; actual_minutes?: number; completed?: boolean; completed_at?: string; dependencies?: string[]; priority?: Prio; plan_key?: string };
export interface WeekReview { from: string; to: string; planned: number; done: number; missed: number; minutesPlanned: number; minutesDone: number; doneRatio: number; behind: boolean; missedTasks: TrackedTask[]; next7: number }

/** Real numbers from the week's tasks — nothing inferred from time passing. */
export function reviewWeek(tasks: TrackedTask[], today: string): WeekReview {
  const from = dayAdd(today, -6);
  const inWeek = tasks.filter((t) => t.date >= from && t.date <= today);
  const done = inWeek.filter((t) => t.completed);
  const missedTasks = inWeek.filter((t) => !t.completed && t.date < today);
  const minutesPlanned = inWeek.reduce((n, t) => n + (t.minutes ?? 0), 0);
  const minutesDone = done.reduce((n, t) => n + (t.actual_minutes ?? t.minutes ?? 0), 0);
  const doneRatio = inWeek.length ? done.length / inWeek.length : 1;
  const next7 = tasks.filter((t) => !t.completed && t.date > today && t.date <= dayAdd(today, 7)).length;
  return { from, to: today, planned: inWeek.length, done: done.length, missed: missedTasks.length, minutesPlanned, minutesDone, doneRatio, behind: missedTasks.length >= 2 || (inWeek.length >= 3 && doneRatio < 0.6), missedTasks, next7 };
}

export type Move = { id: string; title: string; from: string; to: string; time: string; end_time: string };
/**
 * A proposed new schedule for every open task from tomorrow on, at the person's real capacity — so missed
 * work is spread out instead of piled onto tomorrow. Returns the moves and whether the deadline still holds.
 */
export function replan(open: TrackedTask[], o: ScheduleOptions & { deadline?: string }): { moves: Move[]; unplaced: string[]; finish?: string; deadlineOk: boolean } {
  const ids = new Set(open.map((t) => t.id));
  const pseudo: Roadmap = {
    success: [{ measure: '-' }], risks: [], assumptions: [], recommendations: [],
    milestones: [{ key: 'm', title: 'all', hours: 0, depends_on: [] }],
    tasks: open.filter((t) => !t.completed).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '')).map((t) => ({
      key: t.id, title: t.title, minutes: Math.max(10, t.minutes ?? 30), priority: t.priority ?? 'medium', milestone: 'm',
      depends_on: (t.dependencies ?? []).filter((d) => ids.has(d)),
    })),
  };
  // do not split already-planned tasks: each keeps one session
  const s = scheduleRoadmap(pseudo, { ...o, sessionMinutes: Math.max(o.sessionMinutes, ...pseudo.tasks.map((t) => t.minutes)) });
  const moves: Move[] = [];
  for (const x of s.sessions) {
    const t = open.find((y) => y.id === x.key)!;
    if (t.date !== x.date || t.time !== x.time) moves.push({ id: t.id, title: t.title, from: t.date, to: x.date, time: x.time, end_time: x.end_time });
  }
  return { moves, unplaced: s.unplaced, finish: s.finish, deadlineOk: !o.deadline || !s.finish || s.finish <= o.deadline };
}

/** The structured context the planner prompt is written from (also stored with the plan version). */
export function briefForPrompt(b: GoalBrief) {
  const strip = (x: any): any => (Array.isArray(x) ? (x.length ? x : undefined) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, strip(v)]).filter(([, v]) => v !== undefined && v !== '')) : x);
  return strip(b);
}
