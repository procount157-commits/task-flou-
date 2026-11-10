// Deterministic, busy-aware scheduler. Never places a block over a busy interval.
import { toMinutes, fromMinutes } from './task';

export type Interval = { start: number; end: number }; // minutes since midnight, end exclusive
export type Busy = Interval & { source: 'hayati' | 'external'; title?: string };
export type ToPlace = { id: string; minutes: number; priority?: 'low' | 'medium' | 'high'; due_date?: string; earliest?: string };
export type Placement = { id: string; time: string; end_time: string; minutes: number };
export type PlanResult = { placed: Placement[]; unplaced: { id: string; reason: 'no_room' | 'too_long' }[] };

const PRI = { high: 0, medium: 1, low: 2 } as const;

export function merge(list: Interval[]): Interval[] {
  const s = list.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

/** Free gaps inside [dayStart, dayEnd) after removing busy time (+ buffer on both sides of every busy block). */
export function freeSlots(busy: Interval[], dayStart: string, dayEnd: string, buffer = 0, notBefore?: string): Interval[] {
  let from = toMinutes(dayStart);
  if (notBefore) from = Math.max(from, toMinutes(notBefore));
  const to = toMinutes(dayEnd);
  const b = merge(busy.map((x) => ({ start: x.start - buffer, end: x.end + buffer })));
  const out: Interval[] = [];
  let cur = from;
  for (const x of b) {
    if (x.end <= cur) continue;
    if (x.start >= to) break;
    if (x.start > cur) out.push({ start: cur, end: Math.min(x.start, to) });
    cur = Math.max(cur, x.end);
  }
  if (cur < to) out.push({ start: cur, end: to });
  return out.filter((x) => x.end - x.start >= 5);
}

/** Rounds a start up to the next 5-minute mark. */
const roundUp = (n: number) => Math.ceil(n / 5) * 5;

/**
 * Places tasks first by deadline, then priority, then length (longest first), each in the earliest gap that fits.
 * Same input → same output.
 */
export function planDay(tasks: ToPlace[], busy: Interval[], o: { dayStart: string; dayEnd: string; buffer?: number; notBefore?: string }): PlanResult {
  const busyNow: Interval[] = busy.map((x) => ({ start: x.start, end: x.end }));
  const order = [...tasks].sort(
    (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || PRI[a.priority ?? 'medium'] - PRI[b.priority ?? 'medium'] || b.minutes - a.minutes || a.id.localeCompare(b.id),
  );
  const res: PlanResult = { placed: [], unplaced: [] };
  const span = toMinutes(o.dayEnd) - toMinutes(o.dayStart);
  for (const t of order) {
    const need = Math.max(5, Math.round(t.minutes));
    if (need > span) {
      res.unplaced.push({ id: t.id, reason: 'too_long' });
      continue;
    }
    const gaps = freeSlots(busyNow, o.dayStart, o.dayEnd, o.buffer ?? 0, t.earliest && o.notBefore ? (t.earliest > o.notBefore ? t.earliest : o.notBefore) : (t.earliest ?? o.notBefore));
    const gap = gaps.map((g) => ({ start: roundUp(g.start), end: g.end })).find((g) => g.end - g.start >= need);
    if (!gap) {
      res.unplaced.push({ id: t.id, reason: 'no_room' });
      continue;
    }
    res.placed.push({ id: t.id, time: fromMinutes(gap.start), end_time: fromMinutes(gap.start + need), minutes: need });
    busyNow.push({ start: gap.start, end: gap.start + need });
  }
  return res;
}

/** True when [start,end) overlaps any busy block. */
export const overlaps = (x: Interval, busy: Interval[]) => busy.some((b) => x.start < b.end && b.start < x.end);

/** Busy intervals of one day from Google freeBusy/events (ISO strings) converted to local minutes. */
export function isoToDayInterval(startIso: string, endIso: string, day: string, tzOffsetMin: number): Interval | null {
  const dayStart = Date.parse(`${day}T00:00:00Z`) - tzOffsetMin * 60_000;
  const s = (Date.parse(startIso) - dayStart) / 60_000;
  const e = (Date.parse(endIso) - dayStart) / 60_000;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= 0 || s >= 1440) return null;
  return { start: Math.max(0, Math.round(s)), end: Math.min(1440, Math.round(e)) };
}
