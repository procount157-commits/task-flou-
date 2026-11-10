import { test } from 'node:test';
import assert from 'node:assert/strict';

import { capture } from '../src/core/capture';
import { applyPatch, deriveStatus, isOverdue, migrateTask, validateTask, endOf } from '../src/core/task';
import { BreakdownSchema, GoalPlanSchema, SmartTaskSchema, extractJSON, parseAI } from '../src/core/schema';
import { backoff, drain, enqueue, memoryStore, NeedsAuthError, PermanentError, MAX_ATTEMPTS, type Op } from '../src/core/outbox';
import { freeSlots, planDay, overlaps, isoToDayInterval } from '../src/core/scheduler';
import { eventIdFor, eventToPatch, externalBusy, taskToEvent, wantsEvent } from '../src/core/gcalmap';
import { guessMapping, pageToPatch, resolve, taskToProps } from '../src/core/notionmap';
import { memoryKV, runMigrations, VERSION_KEY } from '../src/core/migrate';

const TODAY = '2026-11-10'; // a Tuesday

// ── quick capture ───────────────────────────────────────────────────────
test('capture: arabic date + time + priority', () => {
  const d = capture('اجتماع مع أحمد بكرة 5 العصر مهم', TODAY);
  assert.equal(d.title, 'اجتماع مع أحمد');
  assert.equal(d.date, '2026-11-11');
  assert.equal(d.time, '17:00');
  assert.equal(d.priority, 'high');
  assert.equal(d.inbox, false);
});
test('capture: time range sets start, end and duration', () => {
  const d = capture('مذاكرة رياضيات بكرة من 3 إلى 5 العصر', TODAY);
  assert.equal(d.time, '15:00');
  assert.equal(d.end_time, '17:00');
  assert.equal(d.minutes, 120);
  assert.match(d.title, /مذاكرة رياضيات/);
});
test('capture: english range with am/pm', () => {
  const d = capture('gym tomorrow 6-7pm', TODAY);
  assert.equal(d.date, '2026-11-11');
  assert.equal(d.time, '18:00');
  assert.equal(d.end_time, '19:00');
});
test('capture: deadline is not a scheduled day', () => {
  const d = capture('تسليم التقرير قبل الخميس', TODAY);
  assert.equal(d.due_date, '2026-11-12');
  assert.equal(d.date, undefined);
  assert.equal(d.inbox, true);
  assert.match(d.title, /تسليم التقرير/);
});
test('capture: english deadline', () => {
  const d = capture('submit tax form by friday', TODAY);
  assert.equal(d.due_date, '2026-11-13');
  assert.equal(d.date, undefined);
});
test('capture: no date → inbox, never a fake date', () => {
  const d = capture('قراءة كتاب العادات الذرية', TODAY);
  assert.equal(d.inbox, true);
  assert.equal(d.date, undefined);
  assert.equal(d.time, undefined);
});
test('capture: recurrence daily and weekly by day', () => {
  assert.equal(capture('رياضة كل يوم 7 الصبح', TODAY).recurrence?.rule, 'RRULE:FREQ=DAILY');
  const w = capture('درس انجليزي كل اثنين وخميس', TODAY);
  assert.equal(w.recurrence?.rule, 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH');
  assert.equal(capture('call mom every sunday', TODAY).recurrence?.rule, 'RRULE:FREQ=WEEKLY;BYDAY=SU');
});
test('capture: reminder offset, tags, project, duration', () => {
  const d = capture('مكالمة العميل بكرة 10 الصبح لمدة 45 دقيقة ذكرني قبل 15 دقيقة #عمل +مشروع_البيت', TODAY);
  assert.deepEqual(d.reminder_minutes, [15]);
  assert.deepEqual(d.tags, ['عمل']);
  assert.equal(d.project, 'مشروع_البيت');
  assert.equal(d.minutes, 45);
  assert.equal(d.time, '10:00');
  assert.match(d.title, /مكالمة العميل/);
});
test('capture: links to a matching goal', () => {
  const d = capture('حل 20 سؤال للتوفل', TODAY, [{ id: 'g1', title: 'التوفل' }, { id: 'g2', title: 'خسارة الوزن' }]);
  assert.equal(d.goal_id, 'g1');
});
test('capture: arabic digits and description', () => {
  const d = capture('مراجعة العقد بكرة ٤:٣٠ :: التركيز على البند السابع', TODAY);
  assert.equal(d.time, '16:30');
  assert.equal(d.description, 'التركيز على البند السابع');
});
test('capture: explicit later goes to inbox even with words', () => {
  assert.equal(capture('ترتيب المكتب لاحقاً', TODAY).inbox, true);
});

// ── task model ─────────────────────────────────────────────────────────
test('task: migrate old rows keeps every field and derives status', () => {
  const old = { id: 't1', title: 'x', date: '2026-11-10', time: '09:00', calendar_event_id: 'ev', extra: 5 } as any;
  const m = migrateTask(old, 'Asia/Dubai');
  assert.equal(m.status, 'planned');
  assert.equal(m.sync_status, 'synced');
  assert.equal(m.timezone, 'Asia/Dubai');
  assert.equal(m.extra, 5);
  assert.equal(m.schema_version, 2);
  assert.equal(migrateTask({ id: 'x', title: 'y' } as any).status, 'inbox');
  assert.equal(migrateTask({ id: 'x', title: 'y', date: '', completed: true } as any).status, 'completed');
});
test('task: patch bumps version and sets completed_at', () => {
  const t = migrateTask({ id: 't', title: 'a', date: TODAY } as any);
  const d = applyPatch(t, { completed: true }, '2026-11-10T10:00:00Z');
  assert.equal(d.status, 'completed');
  assert.equal(d.version, 2);
  assert.equal(d.completed_at, '2026-11-10T10:00:00Z');
  const u = applyPatch(d, { completed: false }, '2026-11-10T11:00:00Z');
  assert.equal(u.status, 'planned');
  assert.equal(u.completed_at, undefined);
  assert.equal(deriveStatus({ date: '', status: 'waiting' }), 'waiting');
});
test('task: validation catches bad rows', () => {
  assert.deepEqual(validateTask({ id: 'a', title: 'ok', date: TODAY, time: '09:00', end_time: '10:00' }), []);
  assert.ok(validateTask({ title: '' }).length);
  assert.ok(validateTask({ title: 'a', time: '09:00' }).includes('time needs a date'));
  assert.ok(validateTask({ title: 'a', date: TODAY, time: '10:00', end_time: '09:00' }).length);
});
test('task: overdue uses deadline first', () => {
  assert.equal(isOverdue({ id: 'a', title: 'a', date: '', due_date: '2026-11-09' }, TODAY), true);
  assert.equal(isOverdue({ id: 'a', title: 'a', date: '2026-11-09', completed: true }, TODAY), false);
  assert.equal(endOf({ time: '09:00', minutes: 90 }), '10:30');
});

// ── AI schema validation ───────────────────────────────────────────────
test('schema: extracts JSON from fenced, chatty replies', () => {
  assert.deepEqual(extractJSON('Sure! ```json\n{"a":[1,2]}\n``` hope it helps'), { a: [1, 2] });
  assert.deepEqual(extractJSON('here: [{"t":"x ] y"}] done'), [{ t: 'x ] y' }]);
});
test('schema: breakdown valid / invalid', () => {
  const ok = parseAI(BreakdownSchema, '{"steps":[{"title":"افتح الملف","minutes":10},{"title":"اكتب المقدمة","minutes":"25"}]}');
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.steps[1].minutes, 25);
  const bad = parseAI(BreakdownSchema, '{"steps":[]}');
  assert.equal(bad.ok, false);
  assert.equal(parseAI(BreakdownSchema, 'I cannot do that').ok, false);
  const range = parseAI(BreakdownSchema, '{"steps":[{"title":"x step","minutes":9999}]}');
  assert.equal(range.ok, false);
});
test('schema: smart task rejects malformed dates', () => {
  assert.equal(parseAI(SmartTaskSchema, '{"title":"a","date":"tomorrow"}').ok, false);
  const r = parseAI(SmartTaskSchema, '{"title":"a","date":"2026-11-11","time":"17:00","priority":"HIGH"}');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.priority, 'high');
});
test('schema: goal plan requires tasks', () => {
  assert.equal(parseAI(GoalPlanSchema, '{"summary":"x","tasks":[]}').ok, false);
  assert.equal(parseAI(GoalPlanSchema, '{"tasks":[{"title":"اقرأ فصل","in_days":0}]}').ok, true);
});

// ── outbox ──────────────────────────────────────────────────────────────
const op = (id: string, entityId: string, type: 'upsert' | 'delete' = 'upsert') => ({ id, provider: 'google' as const, type, entity: 'task' as const, entityId });
test('outbox: coalesces repeated edits into one op', () => {
  let ops: Op[] = [];
  for (let i = 0; i < 5; i++) ops = enqueue(ops, op(`o${i}`, 't1'), 1000 + i);
  assert.equal(ops.length, 1);
  ops = enqueue(ops, op('d', 't1', 'delete'), 2000);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'delete');
  assert.equal(ops[0].createdAt, 1000);
});
test('outbox: success removes, failure retries with backoff, permanent → dead', async () => {
  const store = memoryStore();
  let t = 0;
  store.ops = enqueue(enqueue(enqueue([], op('a', 't1'), 0), op('b', 't2'), 0), op('c', 't3'), 0);
  const calls: string[] = [];
  const r = await drain(store, {
    google: async (o) => {
      calls.push(o.entityId);
      if (o.entityId === 't2') throw new Error('503');
      if (o.entityId === 't3') throw new PermanentError('400 bad');
    },
  }, () => t);
  assert.deepEqual(calls, ['t1', 't2', 't3']);
  assert.equal(r.done, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.dead, 1);
  const failed = store.ops.find((o) => o.entityId === 't2')!;
  assert.equal(failed.attempts, 1);
  assert.ok(failed.nextAt > 0);
  // not due yet → nothing runs
  const again = await drain(store, { google: async () => calls.push('x') as any }, () => t);
  assert.equal(again.done, 0);
  t = failed.nextAt;
  const later = await drain(store, { google: async () => {} }, () => t);
  assert.equal(later.done, 1);
  assert.equal(store.ops.filter((o) => o.status !== 'dead').length, 0);
});
test('outbox: auth errors block provider without burning attempts', async () => {
  const store = memoryStore(enqueue(enqueue([], op('a', 't1'), 0), op('b', 't2'), 0));
  let n = 0;
  const r = await drain(store, { google: async () => { n++; throw new NeedsAuthError('connect'); } }, () => 0);
  assert.equal(n, 1);
  assert.equal(r.waitingAuth, 1);
  assert.ok(store.ops.every((o) => o.attempts === 0));
});
test('outbox: gives up after MAX_ATTEMPTS, backoff grows and caps', async () => {
  assert.ok(backoff(2) > backoff(1));
  assert.ok(backoff(30) <= 6 * 3600_000 * 1.2);
  const store = memoryStore(enqueue([], op('a', 't1'), 0));
  for (let i = 0; i < MAX_ATTEMPTS; i++) await drain(store, { google: async () => { throw new Error('boom'); } }, () => (i + 1) * 1e9);
  assert.equal(store.ops[0].status, 'dead');
});

// ── scheduler ───────────────────────────────────────────────────────────
test('scheduler: free slots respect busy time and buffers', () => {
  const s = freeSlots([{ start: 600, end: 660 }], '09:00', '12:00', 10);
  assert.deepEqual(s, [{ start: 540, end: 590 }, { start: 670, end: 720 }]);
});
test('scheduler: never overlaps busy; deterministic; reports what did not fit', () => {
  const busy = [{ start: 540, end: 600 }, { start: 720, end: 780 }];
  const tasks = [
    { id: 'a', minutes: 60, priority: 'low' as const },
    { id: 'b', minutes: 90, priority: 'high' as const },
    { id: 'c', minutes: 30, due_date: '2026-11-10' },
    { id: 'd', minutes: 600 },
  ];
  const r1 = planDay(tasks, busy, { dayStart: '09:00', dayEnd: '15:00' });
  const r2 = planDay(tasks, busy, { dayStart: '09:00', dayEnd: '15:00' });
  assert.deepEqual(r1, r2);
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  for (const p of r1.placed) assert.equal(overlaps({ start: toMin(p.time), end: toMin(p.end_time) }, busy), false);
  assert.equal(r1.placed[0].id, 'c'); // deadline first
  assert.ok(r1.unplaced.find((u) => u.id === 'd'));
  // placed tasks don't overlap each other
  const iv = r1.placed.map((p) => ({ start: toMin(p.time), end: toMin(p.end_time) }));
  iv.forEach((x, i) => assert.equal(overlaps(x, iv.filter((_, j) => j !== i)), false));
});
test('scheduler: notBefore skips the past', () => {
  const r = planDay([{ id: 'a', minutes: 30 }], [], { dayStart: '08:00', dayEnd: '22:00', notBefore: '13:07' });
  assert.equal(r.placed[0].time, '13:10');
});
test('scheduler: iso → day interval with timezone offset', () => {
  assert.deepEqual(isoToDayInterval('2026-11-10T06:00:00Z', '2026-11-10T07:30:00Z', '2026-11-10', 240), { start: 600, end: 690 });
});

// ── Google Calendar mapping ─────────────────────────────────────────────
test('gcal: event id is deterministic base32hex', () => {
  const a = eventIdFor('abc-123');
  assert.equal(a, eventIdFor('abc-123'));
  assert.notEqual(a, eventIdFor('abc-124'));
  assert.match(a, /^[0-9a-v]{5,1024}$/);
});
test('gcal: date-only task → all-day event, no invented time', () => {
  const ev = taskToEvent({ id: 't', title: 'تقرير', date: '2026-11-12' }, 'Asia/Dubai');
  assert.deepEqual(ev.start, { date: '2026-11-12' });
  assert.deepEqual(ev.end, { date: '2026-11-13' });
  assert.equal(ev.extendedProperties?.private?.hayatiTaskId, 't');
});
test('gcal: timed task uses duration and timezone; subtask title carries parent', () => {
  const ev = taskToEvent({ id: 's', title: 'خطوة 1', date: '2026-11-12', time: '09:00', minutes: 25, reminder_minutes: [5] }, 'Asia/Dubai', 'التقرير');
  assert.equal(ev.start?.dateTime, '2026-11-12T09:00:00');
  assert.equal(ev.end?.dateTime, '2026-11-12T09:25:00');
  assert.equal(ev.start?.timeZone, 'Asia/Dubai');
  assert.equal(ev.summary, 'خطوة 1 · التقرير');
  assert.deepEqual(ev.reminders?.overrides, [{ method: 'popup', minutes: 5 }]);
});
test('gcal: inbox/closed/subtask rules', () => {
  assert.equal(wantsEvent({ id: 'a', title: 'a', date: '' }, { subtasks: true }), false);
  assert.equal(wantsEvent({ id: 'a', title: 'a', date: TODAY, completed: true }, { subtasks: true }), false);
  assert.equal(wantsEvent({ id: 'a', title: 'a', date: TODAY, parent_id: 'p' }, { subtasks: false }), false);
  assert.equal(wantsEvent({ id: 'a', title: 'a', date: TODAY, parent_id: 'p' }, { subtasks: true }), true);
});
test('gcal: moved / deleted event updates or unschedules the task', () => {
  const t = { id: 't', title: 'x', date: '2026-11-12', time: '09:00', minutes: 30 };
  assert.deepEqual(eventToPatch({ start: { dateTime: '2026-11-13T10:00:00+04:00' }, end: { dateTime: '2026-11-13T11:00:00+04:00' }, summary: 'x' }, t), { date: '2026-11-13', time: '10:00', end_time: '11:00', minutes: 60 });
  assert.equal(eventToPatch({ status: 'cancelled' }, t), 'unschedule');
  assert.equal(eventToPatch({ start: { dateTime: '2026-11-12T09:00:00+04:00' }, end: { dateTime: '2026-11-12T09:30:00+04:00' }, summary: 'x' }, t), null);
});
test('gcal: external events are busy, managed ones are not', () => {
  assert.ok(externalBusy({ summary: 'dentist', start: { dateTime: 'a' }, end: { dateTime: 'b' } }));
  assert.equal(externalBusy({ start: { dateTime: 'a' }, end: { dateTime: 'b' }, extendedProperties: { private: { hayatiTaskId: 't' } } }), null);
  assert.equal(externalBusy({ start: { dateTime: 'a' }, end: { dateTime: 'b' }, transparency: 'transparent' }), null);
});

// ── Notion mapping ──────────────────────────────────────────────────────
const schema = [
  { id: '1', name: 'Name', type: 'title' },
  { id: '2', name: 'Status', type: 'status', options: ['Not started', 'In progress', 'Done'] },
  { id: '3', name: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'] },
  { id: '4', name: 'Due date', type: 'date' },
  { id: '5', name: 'Owner', type: 'people' },
];
test('notion: guesses mapping only from compatible props', () => {
  const m = guessMapping(schema)!;
  assert.equal(m.title, 'Name');
  assert.equal(m.status, 'Status');
  assert.equal(m.priority, 'Priority');
  assert.equal(m.due, 'Due date');
  assert.equal(guessMapping([{ id: 'x', name: 'a', type: 'rich_text' }]), null);
});
test('notion: task → props writes only mapped props; round-trips', () => {
  const m = guessMapping(schema)!;
  const props = taskToProps({ id: 't', title: 'اكتب', date: '2026-11-12', completed: true, priority: 'high' }, m, schema) as any;
  assert.deepEqual(Object.keys(props).sort(), ['Due date', 'Name', 'Priority', 'Status']);
  assert.equal(props.Status.status.name, 'Done');
  const back = pageToPatch({ properties: { Name: { title: [{ plain_text: 'اكتب' }] }, Status: { status: { name: 'Done' } }, Priority: { select: { name: 'High' } }, 'Due date': { date: { start: '2026-11-12' } } } }, m);
  assert.equal(back.completed, true);
  assert.equal(back.priority, 'high');
  assert.equal(back.due_date, '2026-11-12');
});
test('notion: conflict policy', () => {
  assert.deepEqual(resolve({ updatedAt: '2026-11-10T10:00' }, { updatedAt: '2026-11-09' }, '2026-11-09T12:00'), { winner: 'local', conflict: false });
  assert.deepEqual(resolve({ updatedAt: '2026-11-10T10:00' }, { updatedAt: '2026-11-10T11:00' }, '2026-11-09'), { winner: 'remote', conflict: true });
  assert.equal(resolve({ updatedAt: 'a' }, { updatedAt: 'a' }, 'z').winner, 'none');
});

// ── migrations ──────────────────────────────────────────────────────────
test('migrate: backs up before change, runs once, resumes after failure', async () => {
  const kvs = memoryKV({ 'db:DailyTask': JSON.stringify([{ id: '1', title: 'a', date: TODAY }]) });
  const migs = [
    { version: 2, name: 'tasks-v2', run: async (read: any, write: any) => write('db:DailyTask', (await read('db:DailyTask')).map((r: any) => migrateTask(r))) },
    { version: 3, name: 'broken', run: async () => { throw new Error('nope'); } },
  ];
  const r = await runMigrations(kvs, ['db:DailyTask'], migs);
  assert.equal(r.to, 2);
  assert.ok(r.error);
  assert.equal(kvs.data[VERSION_KEY], '2');
  assert.ok(kvs.data['backup:v1:db:DailyTask'].includes('"title":"a"'));
  assert.equal(JSON.parse(kvs.data['db:DailyTask'])[0].status, 'planned');
  const again = await runMigrations(kvs, ['db:DailyTask'], migs.slice(0, 1));
  assert.deepEqual(again.ran, []);
});
