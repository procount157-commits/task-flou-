// End-to-end acceptance for the goal discovery engine: interview → gate → roadmap → feasibility →
// preview edits → approved records → calendar/Notion mapping → weekly review → adaptive replan.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  answer, buildBrief, classifyGoal, detectHorizonDays, interviewProgress, isVague, latest, nextQuestion, plannedSlots,
  readiness, startInterview, weeklyCapacity, type InterviewState,
} from '../src/core/goalinterview';
import {
  buildRecords, feasibility, isGeneric, milestoneDates, orderTasks, parseRoadmap, replan, reviewWeek, scheduleRoadmap,
  validateRoadmap, type Roadmap,
} from '../src/core/roadmap';
import { taskToEvent, wantsEvent } from '../src/core/gcalmap';
import { taskToProps } from '../src/core/notionmap';

const NOW = '2026-11-10T09:00:00.000Z';
const TODAY = '2026-11-10'; // Tuesday
const GOAL = 'I want to obtain a professional certification within six months';

// a roadmap shaped like a good model reply for a CMA candidate with 6 h/week
const AI_REPLY = '```json\n' + JSON.stringify({
  understanding: 'Pass CMA Part 1 and Part 2 within six months while working full time.',
  why_it_fits: 'Short evening sessions on four days, because consistency is the main risk.',
  first_step: 'Register with IMA and book the Part 1 window',
  success: [{ measure: 'CMA Part 1 passed', target: '360/500', evidence: 'IMA score report' }, { measure: 'CMA Part 2 passed', target: '360/500' }],
  milestones: [
    { key: 'm1', title: 'Registration and study system ready', hours: 3, done_when: 'Registered, materials bought, schedule fixed' },
    { key: 'm2', title: 'Part 1 sections A–C covered with practice', hours: 60, depends_on: ['m1'] },
    { key: 'm3', title: 'Part 1 mock exams above 75%', hours: 30, depends_on: ['m2'] },
    { key: 'm4', title: 'Part 2 prepared and sat', hours: 60, depends_on: ['m3'] },
  ],
  tasks: [
    { key: 't1', title: 'Register with IMA and pay the CMA entrance fee', minutes: 45, priority: 'high', milestone: 'm1', workstream: 'Admin' },
    { key: 't2', title: 'Buy the Part 1 question bank and textbook', minutes: 30, priority: 'high', milestone: 'm1', workstream: 'Admin' },
    { key: 't3', title: 'Read Section A: external financial reporting decisions (chapters 1–2)', minutes: 100, priority: 'high', milestone: 'm2', workstream: 'Section A', depends_on: ['t2'] },
    { key: 't4', title: 'Answer 20 Section A practice questions and log mistakes', minutes: 50, priority: 'high', milestone: 'm2', workstream: 'Section A', depends_on: ['t3'] },
    { key: 't5', title: 'Study CMA', minutes: 50, priority: 'medium', milestone: 'm2', depends_on: ['t4', 'ghost'] },
  ],
  risks: [{ risk: 'Inconsistent study schedule', probability: 'high', impact: 'high', prevent: 'Fixed study days', recover: 'Recalculate remaining workload' }],
  assumptions: ['Part 1 exam window in April'],
}) + '\n```';

function interviewCMA(): InterviewState {
  let s = startInterview(GOAL, NOW);
  const say = (slot: any, a: any) => { s = answer(s, { slot, status: 'answered', ...a }, NOW); };
  // 1–2: understands the goal and asks which certification
  let q = nextQuestion(s, 'en')!;
  assert.equal(q.slot, 'outcome');
  assert.match(q.text, /certification/i);
  say('outcome', { value: 'CMA' });
  say(nextQuestion(s, 'en')!.slot, { value: 'pass' }); // success
  q = nextQuestion(s, 'en')!;
  assert.equal(q.slot, 'why'); // 4: motivation before logistics
  say('why', { picks: ['work', 'income'] });
  q = nextQuestion(s, 'en')!;
  assert.equal(q.slot, 'baseline'); // 3: current knowledge
  say('baseline', { value: 'study' });
  return s;
}

test('category and horizon come from the title, so they are never asked', () => {
  assert.equal(classifyGoal(GOAL), 'education');
  assert.equal(detectHorizonDays(GOAL), 180);
  assert.equal(detectHorizonDays('أريد الحصول على شهادة مهنية خلال ستة أشهر'), 180);
  assert.equal(detectHorizonDays('خسارة 10 كيلو خلال 3 شهور'), 90);
  assert.equal(classifyGoal('أريد أن أصبح مستقلاً مالياً'), 'financial');
  const s = startInterview(GOAL, NOW);
  assert.equal(latest(s, 'deadline')?.source, 'app');
});

test('1. no milestones on creation: the first thing is a question, not a plan', () => {
  const s = startInterview(GOAL, NOW);
  const q = nextQuestion(s, 'en');
  assert.ok(q);
  assert.equal(q!.slot, 'outcome');
  assert.equal(readiness(s).canGenerate, false);
});

test('interview paths differ by goal type', () => {
  const edu = plannedSlots(startInterview('CMA certification', NOW));
  const biz = plannedSlots(startInterview('Launch my online store business', NOW));
  const fit = plannedSlots(startInterview('Lose 10 kg', NOW));
  assert.ok(biz.includes('validated') && !edu.includes('validated') && !fit.includes('validated'));
  assert.ok(fit.includes('baseline_value') && !edu.includes('baseline_value'));
  // financial independence gets the "what does it mean in your situation" question
  const fin = startInterview('أريد أن أصبح مستقلاً مالياً', NOW);
  assert.match(nextQuestion(fin, 'ar')!.text, /ماذا يعني/);
});

test('vague answers trigger one follow-up; "I feel I should" asks if it is genuine', () => {
  let s = startInterview('Become better', NOW, {}, 'personal');
  s = answer(s, { slot: 'outcome', status: 'answered', value: 'better' }, NOW);
  assert.ok(isVague(latest(s, 'outcome')));
  assert.equal(nextQuestion(s, 'en')!.slot, 'outcome_detail');
  s = answer(s, { slot: 'outcome_detail', status: 'answered', value: 'Speak in front of 50 people without notes' }, NOW);
  assert.notEqual(nextQuestion(s, 'en')!.slot, 'outcome_detail');
  s = answer(s, { slot: 'success', status: 'answered', value: 'deliver' }, NOW);
  s = answer(s, { slot: 'why', status: 'answered', picks: ['should'] }, NOW);
  assert.equal(nextQuestion(s, 'en')!.slot, 'why_genuine');
});

test('5–12. time, style, resources, obstacles, then the gate; skipped and unknown answers are recorded', () => {
  let s = interviewCMA();
  const order: string[] = [];
  for (let i = 0; i < 30; i++) {
    const q = nextQuestion(s, 'en');
    if (!q) break;
    order.push(q.slot);
    if (q.slot === 'tried') s = answer(s, { slot: 'tried', status: 'skipped' }, NOW);
    else if (q.slot === 'weekly_hours') s = answer(s, { slot: 'weekly_hours', status: 'answered', value: '6', num: 6 }, NOW);
    else if (q.slot === 'deadline_fixed') s = answer(s, { slot: 'deadline_fixed', status: 'unknown' }, NOW);
    else s = answer(s, { slot: q.slot, status: 'answered', value: q.options[0]?.value ?? 'x', picks: q.multi ? [q.options[0].value] : undefined }, NOW);
  }
  assert.ok(!order.includes('deadline'), 'deadline came from the title');
  assert.ok(order.indexOf('weekly_hours') < order.indexOf('resources') || !order.includes('resources'));
  assert.equal(new Set(order).size, order.length, 'no question asked twice');
  const r = readiness(s);
  assert.equal(r.canGenerate, true);
  assert.ok(r.uncertain.includes('deadline_fixed'));
  const brief = buildBrief(s, weeklyCapacity(6, undefined, 'none'), 'en');
  assert.ok(brief.skipped.includes('tried'));
  assert.equal(brief.time.horizon_days, 180);
  assert.equal(brief.outcome, 'CMA');
});

test('the gate blocks on missing essentials and names them; stopping and resuming keeps every answer', () => {
  let s = interviewCMA();
  const r = readiness(s);
  assert.equal(r.canGenerate, false);
  assert.ok(r.missing.some((m) => m.field === 'time_capacity' && m.essential));
  // app closes: state is JSON in storage
  const resumed: InterviewState = JSON.parse(JSON.stringify(s));
  assert.equal(nextQuestion(resumed, 'en')!.slot, nextQuestion(s, 'en')!.slot);
  assert.equal(interviewProgress(resumed).done, interviewProgress(s).done);
  // changing an answer appends; the old one stays in history
  resumed.answers.push({ slot: 'outcome', status: 'answered', value: 'CPA', source: 'user', at: NOW });
  assert.equal(latest(resumed, 'outcome')!.value, 'CPA');
  assert.equal(resumed.answers.filter((a) => a.slot === 'outcome').length, 2);
});

test('6. capacity: the calendar can only lower what the person said; no calendar or a failed read falls back honestly', () => {
  assert.equal(weeklyCapacity(10, 360, 'read').usableMinutes, 360);
  assert.equal(weeklyCapacity(10, 360, 'read').limitedBy, 'calendar');
  assert.equal(weeklyCapacity(4, 900, 'read').usableMinutes, 240);
  const none = weeklyCapacity(6, undefined, 'none');
  assert.equal(none.usableMinutes, 360);
  assert.equal(none.calendar, 'none');
  const failed = weeklyCapacity(6, 999, 'failed');
  assert.equal(failed.usableMinutes, 360, 'a failed read is not trusted');
  assert.equal(weeklyCapacity(undefined, undefined, 'none').limitedBy, 'default');
});

test('14–17. the roadmap reply is validated; generic tasks and broken dependencies are caught', () => {
  const p = parseRoadmap(AI_REPLY);
  assert.ok(p.ok);
  const { roadmap, issues } = validateRoadmap((p as any).value);
  assert.ok(issues.some((i) => i.key === 't5' && i.kind === 'generic'));
  assert.ok(issues.some((i) => i.key === 't5' && i.kind === 'unknown_dependency'));
  assert.deepEqual(roadmap.tasks.find((t) => t.key === 't5')!.depends_on, ['t4']);
  assert.ok(isGeneric('Study CMA') && isGeneric('استمر في التعلم') && !isGeneric('Answer 20 Section A practice questions'));
  assert.equal(parseRoadmap('{"milestones": []}').ok, false);
  // a cycle is broken, not looped on
  const cyc = validateRoadmap({ ...roadmap, tasks: [{ ...roadmap.tasks[0], depends_on: ['t2'] }, { ...roadmap.tasks[1], depends_on: ['t1'] }] });
  assert.ok(cyc.issues.some((i) => i.kind === 'cycle'));
  assert.equal(orderTasks(cyc.roadmap).length, 2);
});

test('18. scheduling respects dependencies, weekly capacity, allowed days, session length and calendar events', () => {
  const r = validateRoadmap((parseRoadmap(AI_REPLY) as any).value).roadmap;
  const busy = (d: string) => (d === '2026-11-11' ? [{ start: 18 * 60, end: 20 * 60 }] : []);
  const s = scheduleRoadmap(r, { start: TODAY, weeklyMinutes: 360, days: [0, 1, 2, 3], window: { start: '18:00', end: '22:00' }, sessionMinutes: 50, busy });
  assert.equal(s.unplaced.length, 0);
  const at = (k: string) => s.sessions.filter((x) => x.key === k);
  // t3 is 100 min with 50-min sessions → two parts on different days
  assert.equal(at('t3').length, 2);
  assert.notEqual(at('t3')[0].date, at('t3')[1].date);
  // dependencies: t3 after t2, t4 after the last part of t3
  assert.ok(at('t3')[0].date > at('t2')[0].date);
  assert.ok(at('t4')[0].date > at('t3')[1].date);
  for (const x of s.sessions) {
    assert.ok([0, 1, 2, 3].includes(new Date(`${x.date}T00:00:00Z`).getUTCDay()), `allowed day ${x.date}`);
    assert.ok(x.time >= '18:00' && x.end_time <= '22:00');
    if (x.date === '2026-11-11') assert.ok(x.time >= '20:10', 'never over a calendar event');
  }
  for (const m of Object.values(s.weeklyLoad)) assert.ok(m <= 360);
});

test('13. feasibility: six months is checked against real capacity, with alternatives when it does not fit', () => {
  const r = validateRoadmap((parseRoadmap(AI_REPLY) as any).value).roadmap;
  const ok = feasibility(r, 600, TODAY, '2027-05-09');
  assert.equal(ok.feasible, true);
  // unrealistic: 2 h/week for ~153 h of work
  const bad = feasibility(r, 120, TODAY, '2027-05-09');
  assert.equal(bad.feasible, false);
  assert.deepEqual(bad.options.map((x) => x.kind), ['extend', 'reduce', 'more_hours', 'stages']);
  const ext = bad.options[0] as { kind: 'extend'; to: string };
  assert.ok(ext.to > '2027-05-09');
  // the user changes the deadline halfway: recomputed from the new date
  const later = feasibility(r, 120, TODAY, ext.to);
  assert.equal(later.feasible, true);
});

test('19–21. preview edits: only kept items become records; milestone deadlines differ from work sessions', () => {
  const r: Roadmap = validateRoadmap((parseRoadmap(AI_REPLY) as any).value).roadmap;
  r.tasks.find((t) => t.key === 't5')!.off = true; // user removes the generic task
  r.tasks.find((t) => t.key === 't1')!.title = 'Register with IMA (student rate)'; // user edits
  const sched = scheduleRoadmap(r, { start: TODAY, weeklyMinutes: 360, days: [0, 1, 2, 3, 4], window: { start: '19:00', end: '22:00' }, sessionMinutes: 50 });
  const dates = milestoneDates(r, sched, 360, TODAY);
  const rec = buildRecords(r, sched, dates, 'en');
  assert.ok(!rec.tasks.some((t) => t.key === 't5'));
  assert.ok(rec.tasks.some((t) => t.title === 'Register with IMA (student rate)'));
  assert.equal(rec.milestones.length, 4);
  assert.equal(dates.m3.projected, true, 'undetailed milestones are projected, not invented');
  const t3 = rec.tasks.find((t) => t.key === 't3')!;
  assert.notEqual(t3.due_date, t3.date, 'milestone deadline is not the work session');
  // rejecting the plan writes nothing: records only exist when built on approval
  assert.equal(rec.tasks.length, sched.sessions.length);
});

test('22–23. approved scheduled tasks map to Google events and Notion properties through the existing mappers', () => {
  const r = validateRoadmap((parseRoadmap(AI_REPLY) as any).value).roadmap;
  const sched = scheduleRoadmap(r, { start: TODAY, weeklyMinutes: 360, days: [0, 1, 2, 3, 4], window: { start: '19:00', end: '22:00' }, sessionMinutes: 50 });
  const rec = buildRecords(r, sched, milestoneDates(r, sched, 360, TODAY), 'en');
  const row = { id: 'abc', ...rec.tasks[0], completed: false, status: 'planned' as const };
  assert.ok(wantsEvent(row, { subtasks: true }));
  const ev = taskToEvent(row, 'Asia/Dubai');
  assert.equal(ev.start?.dateTime, `${row.date}T${row.time}:00`);
  const props = taskToProps(row, { title: 'Name', due: 'Date' } as any, [{ name: 'Name', type: 'title' }, { name: 'Date', type: 'date' }] as any);
  assert.ok((props as any).Name.title[0].text.content.length > 3);
  assert.equal((props as any).Date.date.start, row.due_date, 'Notion gets the milestone deadline, not the session');
});

test('24–25. weekly review uses real completions; replanning spreads missed work instead of piling it on tomorrow', () => {
  const tasks = [
    { id: 'a', title: 'A', date: '2026-11-05', minutes: 50, completed: true },
    { id: 'b', title: 'B', date: '2026-11-06', minutes: 50 },
    { id: 'c', title: 'C', date: '2026-11-08', minutes: 50 },
    { id: 'd', title: 'D', date: '2026-11-09', minutes: 50, dependencies: ['c'] },
    { id: 'e', title: 'E', date: '2026-11-12', minutes: 50 },
  ];
  const w = reviewWeek(tasks, TODAY);
  assert.equal(w.done, 1);
  assert.equal(w.missed, 3);
  assert.equal(w.behind, true);
  const open = tasks.filter((t) => !t.completed);
  const p = replan(open, { start: '2026-11-11', weeklyMinutes: 120, days: [0, 1, 2, 3, 4, 5, 6], window: { start: '19:00', end: '22:00' }, sessionMinutes: 50, deadline: '2026-11-13' });
  const tomorrow = p.moves.filter((m) => m.to === '2026-11-11').length;
  assert.ok(tomorrow <= 2, 'not everything lands on tomorrow');
  const dTo = p.moves.find((m) => m.id === 'd')!.to;
  const cTo = p.moves.find((m) => m.id === 'c')!.to;
  assert.ok(dTo > cTo, 'dependency kept');
  assert.equal(p.deadlineOk, false, 'says honestly the old deadline no longer holds');
});

test('changing availability changes the plan; two people with the same goal get different schedules', () => {
  const r = validateRoadmap((parseRoadmap(AI_REPLY) as any).value).roadmap;
  const a = scheduleRoadmap(r, { start: TODAY, weeklyMinutes: 900, days: [0, 1, 2, 3, 4, 5, 6], window: { start: '06:00', end: '12:00' }, sessionMinutes: 120 });
  const b = scheduleRoadmap(r, { start: TODAY, weeklyMinutes: 300, days: [5, 6], window: { start: '19:00', end: '22:00' }, sessionMinutes: 25 });
  assert.ok(a.sessions.length < b.sessions.length, 'short sessions split work more');
  assert.ok(a.finish! < b.finish!);
});
