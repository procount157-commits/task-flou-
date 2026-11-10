import * as Calendar from 'expo-calendar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';

import { prioColor } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import {
  answer, buildBrief, GOAL_CATEGORIES, interviewProgress, latest, nextQuestion, questionFor, readiness, startInterview,
  TIME_WINDOWS, weeklyCapacity, type GoalCategory, type InterviewState, type Question, type Slot,
} from '@/core/goalinterview';
import {
  buildRecords, daysBetween, feasibility, milestoneDates, scheduleRoadmap, type Issue, type Roadmap, type RoadTask, type ScheduleOptions,
} from '@/core/roadmap';
import { toMinutes } from '@/core/task';
import { addDays, fmtDate, today } from '@/lib/dates';
import { db, peek, useEntity } from '@/lib/db';
import { autoSyncTask, readDeviceEvents } from '@/lib/devicecal';
import { AI_SLOTS, aiOptions, generateRoadmap, type Revision } from '@/lib/goalcoach';
import { NoKeyError } from '@/lib/integrations';
import { scheduleAt } from '@/lib/notify';
import { HORIZONS } from '@/lib/plan';
import type { GoalInterview as GI } from '@/lib/types';
import { Badge, Btn, Card, Check, Chips, Input, Progress, Row, Screen, Section, Txt, confirm, notice } from '@/ui/kit';
import { VoiceToText } from '@/ui/shared';
import { Text, useFontFamily } from '@/ui/text';

const S = {
  ar: {
    cat: { education: 'تعليم وشهادات', financial: 'مالي', business: 'مشروع', career: 'مهني', fitness: 'صحة ولياقة', personal: 'تطوير شخصي', lifestyle: 'نمط حياة' },
    intro: 'قبل أن أقسّم هدفك، أريد أن أفهمك. سؤال واحد في كل مرة، ويمكنك التوقف والعودة لاحقاً دون أن تضيع إجاباتك.',
    whyAsk: 'لماذا هذا السؤال؟', skip: 'تخطَّ', unknown: 'لا أعرف', done: '✓ تم', other: 'إجابة أخرى…', typeHere: 'اكتب أو تحدث…',
    progress: 'سؤال {a} من {b}', change: 'تعديل', answers: 'ما فهمته منك حتى الآن', skipped: 'تخطيت', notSure: 'لست متأكداً',
    gateTitle: 'هل عندي ما يكفي لبناء خطة موثوقة؟', gateOk: 'عندي ما يكفي لبناء خطة على مقاسك.', gateMissing: 'ينقصني شيء أساسي قبل التخطيط:',
    more: 'أسئلة إضافية لخطة أدق', build: 'صمّم خطتي الآن', buildAnyway: 'صمّم مع افتراضات مكتوبة',
    fields: { goal_clarity: 'وضوح الهدف', outcome_definition: 'تعريف النتيجة', deadline_clarity: 'الموعد', time_capacity: 'الوقت المتاح', current_baseline: 'نقطة البداية', resources: 'الموارد', motivation: 'الدافع', obstacles: 'العوائق', success_criteria: 'معايير النجاح' },
    calChecking: 'أفحص تقويمك لأعرف وقتك الحقيقي…', building: 'أصمم الخطة من إجاباتك…',
    calRead: 'قرأت تقويمك: {n} ساعة فارغة أسبوعياً في الوقت الذي يناسبك.', calNone: 'التقويم غير مربوط، فاعتمدت على الساعات التي ذكرتها.', calFailed: 'تعذّر قراءة التقويم، فاعتمدت على الساعات التي ذكرتها.',
    A: 'ما فهمته', B: 'ملفك لهذا الهدف', C: 'الخريطة', D: 'هل هي واقعية؟', E: 'لماذا هذه الخطة لك',
    successTitle: 'معايير النجاح (وافق عليها قبل الاعتماد)', approveSuccess: 'أوافق على معايير النجاح',
    stated: 'ذكرت', calendar: 'التقويم', usable: 'سأستخدم', hWeek: 'ساعة/أسبوع', bestTime: 'أفضل وقت', session: 'الجلسة', min: 'د',
    reasons: 'دوافعك', obstacles: 'العوائق', resources: 'مواردك', gaps: 'ما ينقصك',
    total: 'العمل الكلي', needWeek: 'تحتاج أسبوعياً', haveWeek: 'متاح لك', deadline: 'الموعد', finish: 'تنتهي تقريباً', fits: '✅ الخطة تتسع في وقتك', notFits: '⚠️ لا تتسع في وقتك الحالي. اختر حلاً:',
    extend: 'مدّد الموعد إلى {d}', reduce: 'قلّص النطاق إلى {p}٪', moreHours: 'زد وقتك إلى {h} ساعة/أسبوع', stages: 'ابدأ بمرحلة «{m}» فقط',
    risks: 'المخاطر وخطط الوقاية', prevent: 'وقاية', recover: 'عودة', assumptions: 'افتراضات', recs: 'توصيات', first: 'ابدأ بهذا',
    after: 'بعد', generic: '⚠️ مهمة عامة — عدّلها لتصبح خطوة محددة', addTask: 'أضف مهمة…', hours: 'س', sessions: 'جلسات مجدولة',
    simpler: '🪶 أبسط', ambitious: '🚀 أطموح', optimize: '🧠 حسّنها', approve: '✅ اعتمد الخطة', reject: 'ارفض الخطة', back: 'عدّل إجاباتي',
    rejectQ: 'ترفض هذه الخطة؟ لن يُحفظ شيء منها، وتبقى إجاباتك لتصميم خطة أخرى.', calChanged: 'تقويمك تغيّر منذ المعاينة: {n} جلسة تحركت. راجعها ثم اعتمد مرة أخرى.',
    saved: 'تم: {m} محطات و{t} جلسة في مهامك وتقويمك.', notion: 'نوشن غير موصول بعد، لذلك لم تُرسل إليه.', unplaced: '{n} مهمة لم تجد وقتاً فارغاً قبل نهاية الفترة.',
    projected: 'تقديري', needSuccess: 'وافق على معايير النجاح أولاً', aiFail: 'تعذّر الوصول للذكاء', priority: { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' },
  },
  en: {
    cat: { education: 'Education', financial: 'Financial', business: 'Business', career: 'Career', fitness: 'Fitness', personal: 'Personal', lifestyle: 'Lifestyle' },
    intro: 'Before I break your goal down, I want to understand you. One question at a time — you can stop and come back without losing your answers.',
    whyAsk: 'Why this question?', skip: 'Skip', unknown: "I don't know", done: '✓ Done', other: 'Another answer…', typeHere: 'Type or speak…',
    progress: 'Question {a} of {b}', change: 'Change', answers: 'What I understood so far', skipped: 'Skipped', notSure: 'Not sure',
    gateTitle: 'Do I know enough to build a reliable plan?', gateOk: 'I know enough to build a plan that fits you.', gateMissing: 'Something essential is missing before planning:',
    more: 'More questions for a sharper plan', build: 'Design my plan now', buildAnyway: 'Design with written assumptions',
    fields: { goal_clarity: 'Goal clarity', outcome_definition: 'Outcome', deadline_clarity: 'Deadline', time_capacity: 'Available time', current_baseline: 'Starting point', resources: 'Resources', motivation: 'Motivation', obstacles: 'Obstacles', success_criteria: 'Success criteria' },
    calChecking: 'Checking your calendar for your real time…', building: 'Designing the plan from your answers…',
    calRead: 'Read your calendar: {n} free hours a week in your preferred time.', calNone: 'No calendar connected, so I used the hours you gave.', calFailed: 'Could not read the calendar, so I used the hours you gave.',
    A: 'What I understood', B: 'Your profile for this goal', C: 'Roadmap', D: 'Is it realistic?', E: 'Why this plan fits you',
    successTitle: 'Success criteria (approve before saving)', approveSuccess: 'I approve these success criteria',
    stated: 'You said', calendar: 'Calendar', usable: 'Using', hWeek: 'h/week', bestTime: 'Best time', session: 'Session', min: 'm',
    reasons: 'Your reasons', obstacles: 'Obstacles', resources: 'Resources', gaps: 'Gaps',
    total: 'Total work', needWeek: 'Needed weekly', haveWeek: 'You have', deadline: 'Deadline', finish: 'Finishes around', fits: '✅ It fits your time', notFits: '⚠️ It does not fit your current time. Choose:',
    extend: 'Move the deadline to {d}', reduce: 'Reduce the scope to {p}%', moreHours: 'Raise your time to {h} h/week', stages: 'Start with "{m}" only',
    risks: 'Risks and prevention', prevent: 'Prevent', recover: 'Recover', assumptions: 'Assumptions', recs: 'Recommendations', first: 'Start with this',
    after: 'after', generic: '⚠️ Too generic — make it a specific step', addTask: 'Add a task…', hours: 'h', sessions: 'scheduled sessions',
    simpler: '🪶 Simpler', ambitious: '🚀 More ambitious', optimize: '🧠 Optimise', approve: '✅ Approve plan', reject: 'Reject plan', back: 'Edit my answers',
    rejectQ: 'Reject this plan? Nothing from it is saved; your answers stay for another design.', calChanged: 'Your calendar changed since the preview: {n} sessions moved. Review, then approve again.',
    saved: 'Done: {m} milestones and {t} sessions added to your tasks and calendar.', notion: 'Notion is not connected yet, so nothing was sent there.', unplaced: '{n} tasks found no free time in the period.',
    projected: 'estimated', needSuccess: 'Approve the success criteria first', aiFail: 'Could not reach the AI', priority: { high: 'High', medium: 'Medium', low: 'Low' },
  },
};

type Step = 'interview' | 'gate' | 'working' | 'preview';
const MINS = [15, 25, 30, 45, 50, 60, 90, 120];
const PR: RoadTask['priority'][] = ['high', 'medium', 'low'];

// The free minutes per week inside the person's window on their days, from the phone calendar and existing tasks.
async function readCapacity(window: { start: string; end: string }, days: number[], from: string): Promise<{ status: 'read' | 'none' | 'failed'; minutes?: number; busy: Record<string, { start: number; end: number }[]> }> {
  const busy: Record<string, { start: number; end: number }[]> = {};
  const to = addDays(from, 13);
  for (const t of peek('DailyTask')) {
    if (t.completed || !t.time || t.date < from || t.date > to) continue;
    const s = toMinutes(t.time);
    (busy[t.date] ??= []).push({ start: s, end: t.end_time ? toMinutes(t.end_time) : s + (t.minutes ?? 30) });
  }
  let status: 'read' | 'none' | 'failed' = 'none';
  if (Platform.OS !== 'web') {
    try {
      const perm = await Calendar.getCalendarPermissionsAsync();
      if (perm.granted) {
        const evs = await readDeviceEvents(from, to);
        for (const e of evs) if (!e.allDay && e.time) (busy[e.date] ??= []).push({ start: toMinutes(e.time), end: e.end ? Math.max(toMinutes(e.end), toMinutes(e.time) + 5) : toMinutes(e.time) + 60 });
        status = 'read';
      }
    } catch {
      status = 'failed';
    }
  }
  if (status !== 'read') return { status, busy };
  const { freeSlots } = await import('@/core/scheduler');
  let free = 0;
  const allowed = new Set(days);
  for (let i = 0; i < 14; i++) {
    const d = addDays(from, i);
    if (!allowed.has(new Date(`${d}T00:00:00`).getDay())) continue;
    free += freeSlots(busy[d] ?? [], window.start, window.end, 10).reduce((n, x) => n + x.end - x.start, 0);
  }
  return { status, minutes: Math.round(free / 2), busy };
}

export default function GoalInterview() {
  const c = useTheme();
  const { lang, t } = useLang();
  const L = S[lang === 'ar' ? 'ar' : 'en'];
  const lg = lang === 'ar' ? 'ar' : 'en';
  const router = useRouter();
  const params = useLocalSearchParams<{ goal?: string; goalId?: string; fresh?: string }>();
  const interviews = useEntity('GoalInterview');
  const goals = useEntity('Goal').items;
  const goal = params.goalId ? goals.find((g) => g.id === params.goalId) : undefined;
  const title = (goal?.title ?? params.goal ?? '').trim();
  const [rec, setRec] = useState<GI | null>(null);
  const [step, setStep] = useState<Step>('interview');
  const [editing, setEditing] = useState<Slot | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [multi, setMulti] = useState<string[]>([]);
  const [free, setFree] = useState('');
  const [numVal, setNumVal] = useState('');
  const [working, setWorking] = useState('');
  const [calNote, setCalNote] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [okSuccess, setOkSuccess] = useState(false);
  const [deadlineOverride, setDeadlineOverride] = useState<string | undefined>();
  const [weeklyOverride, setWeeklyOverride] = useState<number | undefined>();
  const [saving, setSaving] = useState(false);
  const [busyMap, setBusyMap] = useState<Record<string, { start: number; end: number }[]>>({});
  const [calMinutes, setCalMinutes] = useState<number | undefined>();
  const [calStatus, setCalStatus] = useState<'read' | 'none' | 'failed'>('none');
  const loadedAi = useRef(new Set<string>());
  const day = today();
  const start = addDays(day, 1);

  // resume the open interview for this goal, or start one; never two at once
  useEffect(() => {
    if (rec || interviews.loading || !title) return;
    const open = interviews.items.filter((x) => (params.goalId ? x.goal_id === params.goalId : x.goal_title === title) && (x.status === 'active' || x.status === 'previewing'));
    const found = params.fresh ? undefined : open.sort((a, b) => b.updated_date.localeCompare(a.updated_date))[0];
    if (found) {
      setRec(found);
      if (found.status === 'previewing' && found.draft) setStep('preview');
      if (found.calendar) setCalStatus(found.calendar);
      setCalMinutes(found.calendar_minutes);
      return;
    }
    const horizonDays = goal?.due_date && goal.due_date > day ? daysBetween(day, goal.due_date) : undefined;
    const s = startInterview(title, new Date().toISOString(), { horizonDays });
    db.create('GoalInterview', { ...s, goal_id: params.goalId, status: 'active' }).then((r) => {
      setRec(r);
      db.create('GoalActivity', { goal_id: params.goalId, interview_id: r.id, kind: 'interview_started', text: title });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviews.loading, title]);

  const state: InterviewState | null = rec;
  const save = (patch: Partial<GI>) => {
    if (!rec) return;
    const next = { ...rec, ...patch };
    setRec(next);
    db.update('GoalInterview', rec.id, patch);
  };

  const q: Question | null = useMemo(() => {
    if (!state) return null;
    if (editing) return questionFor(editing, state, lg);
    return nextQuestion(state, lg);
  }, [state, editing, lg]);
  const ready = state ? readiness(state) : null;
  const prog = state ? interviewProgress(state) : { done: 0, total: 1 };

  // goal-specific options from the AI for the questions where they matter, fetched once and kept
  useEffect(() => {
    if (!state || !q || !AI_SLOTS.includes(q.slot) || state.ai_options?.[q.slot] || loadedAi.current.has(q.slot)) return;
    loadedAi.current.add(q.slot);
    aiOptions(state, q.slot, lang).then((r) => {
      if (r) setRec((cur) => {
        if (!cur) return cur;
        const ai_options = { ...(cur.ai_options ?? {}), [q.slot]: r };
        db.update('GoalInterview', cur.id, { ai_options });
        return { ...cur, ai_options };
      });
    });
  }, [q?.slot, state, lang]);

  useEffect(() => {
    setMulti(q?.multi && state ? latest(state, q.slot)?.picks ?? [] : []);
    setFree('');
    setNumVal('');
    setShowWhy(false);
  }, [q?.slot]);

  useEffect(() => {
    if (state && !q && step === 'interview') setStep('gate');
  }, [q, state, step]);

  const give = (a: { status: 'answered' | 'skipped' | 'unknown'; value?: string; picks?: string[]; num?: number }) => {
    if (!state || !q) return;
    const next = answer(state, { slot: q.slot, ...a }, new Date().toISOString());
    setEditing(null);
    save({ answers: next.answers });
  };

  // ── roadmap ──
  const brief = useMemo(() => {
    if (!state) return null;
    const stated = latest(state, 'weekly_hours');
    const hours = weeklyOverride ? weeklyOverride / 60 : stated?.status === 'answered' ? stated.num ?? Number(stated.value) : undefined;
    return buildBrief(state, weeklyCapacity(hours, calMinutes, calStatus), lg);
  }, [state, calMinutes, calStatus, weeklyOverride, lg]);
  const draft = rec?.draft;
  const deadline = deadlineOverride ?? (brief?.time.horizon_days ? addDays(day, brief.time.horizon_days) : goal?.due_date);
  const schedOpts = (busy = busyMap): ScheduleOptions | null => brief ? {
    start, weeklyMinutes: brief.time.weekly_minutes, days: brief.time.days,
    window: brief.execution.window ?? TIME_WINDOWS.evening, sessionMinutes: brief.execution.session_minutes,
    busy: (d) => busy[d] ?? [], maxDays: 400,
  } : null;
  const sched = useMemo(() => (draft && brief ? scheduleRoadmap(draft, schedOpts()!) : null), [draft, brief, busyMap]);
  const feas = useMemo(() => (draft && brief ? feasibility(draft, brief.time.weekly_minutes, start, deadline) : null), [draft, brief, deadline]);
  const dates = useMemo(() => (draft && sched && brief ? milestoneDates(draft, sched, brief.time.weekly_minutes, start) : {}), [draft, sched, brief]);

  const design = async (revise?: Revision) => {
    if (!state || !brief) return;
    setStep('working');
    let b = brief;
    if (!revise) {
      setWorking(L.calChecking);
      const cap = await readCapacity(brief.execution.window ?? TIME_WINDOWS.evening, brief.time.days, start);
      setBusyMap(cap.busy);
      setCalStatus(cap.status);
      setCalMinutes(cap.minutes);
      const stated = latest(state, 'weekly_hours');
      b = buildBrief(state, weeklyCapacity(stated?.status === 'answered' ? stated.num ?? Number(stated.value) : undefined, cap.minutes, cap.status), lg);
      setCalNote(cap.status === 'read' ? L.calRead.replace('{n}', String(Math.round((cap.minutes ?? 0) / 6) / 10)) : cap.status === 'failed' ? L.calFailed : L.calNone);
      save({ calendar: cap.status, calendar_minutes: cap.minutes });
    }
    setWorking(L.building);
    try {
      const r = await generateRoadmap(b, lang, revise && draft ? { mode: revise, current: draft } : undefined);
      setIssues(r.issues);
      setOkSuccess(false);
      save({ draft: r.roadmap, status: 'previewing' });
      db.create('GoalActivity', { goal_id: params.goalId, interview_id: rec!.id, kind: 'plan_generated', text: revise ?? 'initial', data: { milestones: r.roadmap.milestones.length, tasks: r.roadmap.tasks.length } });
      setStep('preview');
    } catch (e) {
      notice(e instanceof NoKeyError ? t.c.aiNeedKey : String((e as Error)?.message ?? e), L.aiFail);
      setStep(draft ? 'preview' : 'gate');
    }
  };

  const edit = (fn: (r: Roadmap) => Roadmap) => draft && save({ draft: fn(JSON.parse(JSON.stringify(draft))) });
  const setTask = (key: string, patch: Partial<RoadTask>) => edit((r) => ({ ...r, tasks: r.tasks.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const moveMilestone = (i: number, d: -1 | 1) => edit((r) => {
    const j = i + d;
    if (j < 0 || j >= r.milestones.length) return r;
    [r.milestones[i], r.milestones[j]] = [r.milestones[j], r.milestones[i]];
    return r;
  });

  const reject = () => confirm(L.rejectQ, () => {
    save({ status: 'active', draft: undefined });
    db.create('GoalActivity', { goal_id: params.goalId, interview_id: rec!.id, kind: 'plan_rejected', text: title });
    setStep('gate');
  }, L.reject, t.c.cancel);

  const approve = async () => {
    if (!draft || !brief || !sched || !rec) return;
    if (!okSuccess) return notice(L.needSuccess);
    setSaving(true);
    try {
      // availability may have changed since the preview: re-read and compare before writing anything
      const cap = await readCapacity(brief.execution.window ?? TIME_WINDOWS.evening, brief.time.days, start);
      const fresh = scheduleRoadmap(draft, schedOpts(cap.busy)!);
      const moved = fresh.sessions.filter((s, i) => sched.sessions[i]?.date !== s.date || sched.sessions[i]?.time !== s.time).length;
      if (moved && cap.status === 'read' && JSON.stringify(cap.busy) !== JSON.stringify(busyMap)) {
        setBusyMap(cap.busy);
        notice(L.calChanged.replace('{n}', String(moved)));
        return;
      }
      const recs = buildRecords(draft, fresh, milestoneDates(draft, fresh, brief.time.weekly_minutes, start), lg);
      const horizon = brief.time.horizon_days ?? (deadline ? daysBetween(day, deadline) : 365);
      const h = HORIZONS.find((x) => x.days >= horizon) ?? HORIZONS[HORIZONS.length - 1];
      const top = goal ?? (await db.create('Goal', {
        title, level: h.level, status: 'in_progress', progress: 0, auto_progress: true, priority: 'high', due_date: deadline,
        description: draft.understanding, category: state!.category, interview_id: rec.id,
        target_value: brief.target_value, current_value: brief.baseline_value, unit: brief.unit,
        reward_title: brief.motivation.reward,
      }));
      if (goal) await db.update('Goal', goal.id, { auto_progress: true, status: 'in_progress', due_date: deadline ?? goal.due_date, category: state!.category, interview_id: rec.id, description: goal.description || draft.understanding, reward_title: goal.reward_title || brief.motivation.reward });
      const ms = await db.bulkCreate('Goal', recs.milestones.map((m) => ({
        title: m.title, level: h.milestone, parent_id: top.id, status: 'not_started' as const, progress: 0, priority: 'medium' as const,
        due_date: m.due_date, start_date: m.start_date, description: m.description, estimated_hours: m.hours, plan_key: m.key, reward_title: brief.motivation.reward,
      })));
      const mId = new Map(ms.map((m) => [m.plan_key!, m.id]));
      for (const m of ms) {
        const src = recs.milestones.find((x) => x.key === m.plan_key)!;
        if (src.depends_on.length) await db.update('Goal', m.id, { depends_on: src.depends_on.map((k) => mId.get(k)!).filter(Boolean) });
      }
      // tasks: each session is a task; part n waits for part n-1, and dependents wait for the last part
      const lastPart = new Map<string, string>();
      const remind = brief.execution.accountability !== 'none';
      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
      let n = 0;
      for (const x of recs.tasks) {
        const deps = x.part > 1 ? [lastPart.get(x.key)!] : x.depends_on.map((k) => lastPart.get(k)).filter(Boolean) as string[];
        const made = await db.create('DailyTask', {
          title: x.title, description: x.description, date: x.date, time: x.time, end_time: x.end_time, minutes: x.minutes,
          priority: x.priority, goal_id: mId.get(x.milestone) ?? top.id, project: x.project, plan_key: x.key, dependencies: deps.length ? deps : undefined,
          due_date: x.due_date, completed: false, status: 'planned', source: 'plan', schema_version: 2, version: 1, timezone: tz,
        });
        lastPart.set(x.key, made.id);
        autoSyncTask(made.id);
        if (remind && n < 40) {
          const when = new Date(`${x.date}T${x.time}:00`);
          when.setMinutes(when.getMinutes() - 10);
          if (when.getTime() > Date.now()) await scheduleAt(`plan-${made.id}`, `🎯 ${title}`, x.title, when);
        }
        n++;
      }
      await db.create('GoalProfile', { goal_id: top.id, interview_id: rec.id, brief, success: draft.success, risks: draft.risks, version: 1 });
      await db.create('GoalPlanVersion', { goal_id: top.id, version: 1, reason: 'initial', roadmap: draft, feasibility: feas ?? undefined });
      await db.create('GoalActivity', { goal_id: top.id, interview_id: rec.id, kind: 'plan_approved', text: title, data: { milestones: ms.length, sessions: n } });
      save({ status: 'approved', goal_id: top.id });
      notice([L.saved.replace('{m}', String(ms.length)).replace('{t}', String(n)), fresh.unplaced.length ? L.unplaced.replace('{n}', String(fresh.unplaced.length)) : '', L.notion].filter(Boolean).join('\n'));
      router.replace(`/goal?id=${top.id}` as any);
    } catch (e) {
      notice(String((e as Error)?.message ?? e), t.c.error);
    } finally {
      setSaving(false);
    }
  };

  if (!title) return <Screen><Txt v="muted">—</Txt></Screen>;
  if (!state) return <Screen><Txt v="muted">…</Txt></Screen>;

  // ── answered so far ──
  const answered = (() => {
    const seen = new Set<Slot>();
    const out: { slot: Slot; text: string }[] = [];
    for (let i = state.answers.length - 1; i >= 0; i--) {
      const a = state.answers[i];
      if (seen.has(a.slot)) continue;
      seen.add(a.slot);
      const qq = questionFor(a.slot, state, lg);
      const lab = (v: string) => qq.options.find((o) => o.value === v)?.label ?? v;
      const text = a.status === 'skipped' ? L.skipped : a.status === 'unknown' ? L.notSure : a.picks?.length ? [...a.picks.map(lab), a.value].filter(Boolean).join('، ') : a.value ? lab(a.value) : String(a.num ?? '');
      out.unshift({ slot: a.slot, text: `${qq.text.replace(/[؟?]$/, '')}: ${text}${a.source === 'app' ? ' ⓘ' : ''}` });
    }
    return out;
  })();

  const head = (
    <Card style={{ gap: 8 }}>
      <Txt v="h">🧭 {title}</Txt>
      <Chips scroll options={GOAL_CATEGORIES.map((x) => ({ value: x, label: L.cat[x] }))} value={state.category} onChange={(v) => save({ category: v as GoalCategory })} />
      {step === 'interview' ? <Txt v="small">{L.intro}</Txt> : null}
      <Progress value={Math.round((prog.done / Math.max(1, prog.total)) * 100)} height={6} />
    </Card>
  );

  if (step === 'interview' && q) {
    const pick = (v: string) => (q.multi ? setMulti((m) => (m.includes(v) ? m.filter((x) => x !== v) : [...m, v])) : give({ status: 'answered', value: v, num: q.kind === 'number' ? Number(v) : undefined }));
    return (
      <Screen>
        {head}
        {answered.length ? (
          <Section title={L.answers}>
            {answered.slice(-4).map((a) => (
              <Pressable key={a.slot} onPress={() => setEditing(a.slot)} accessibilityRole="button">
                <Txt v="small">• {a.text} <Txt v="small" color={c.primary}>✎</Txt></Txt>
              </Pressable>
            ))}
          </Section>
        ) : null}
        <Card style={{ gap: 10, borderWidth: 1, borderColor: c.primary }}>
          <Txt v="small" color={c.muted}>{L.progress.replace('{a}', String(Math.min(prog.done + 1, prog.total))).replace('{b}', String(prog.total))}</Txt>
          <Txt v="h">{q.text}</Txt>
          {q.why ? (
            <Pressable onPress={() => setShowWhy((x) => !x)} accessibilityRole="button">
              <Txt v="small" color={c.primary}>💡 {L.whyAsk}</Txt>
              {showWhy ? <Txt v="small">{q.why}</Txt> : null}
            </Pressable>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {q.options.map((o) => {
              const on = q.multi ? multi.includes(o.value) : latest(state, q.slot)?.value === o.value;
              return (
                <Pressable key={o.value} onPress={() => pick(o.value)} accessibilityRole="button"
                  style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.soft : c.card }}>
                  <Text style={{ color: on ? c.primary : c.text, fontSize: 15 }}>{o.label}{q.kind === 'number' && q.unit ? ` ${q.unit}` : ''}</Text>
                </Pressable>
              );
            })}
          </View>
          {q.kind === 'number' ? (
            <Row>
              <View style={{ flex: 1 }}><Input keyboardType="numeric" value={numVal} onChangeText={setNumVal} placeholder={q.unit ?? ''} /></View>
              <Btn small title={L.done} disabled={!Number(numVal.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))))} onPress={() => { const v = Number(numVal.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))); give({ status: 'answered', value: String(v), num: v }); }} />
            </Row>
          ) : (
            <>
              <Input placeholder={q.kind === 'text' ? L.typeHere : L.other} value={free} onChangeText={setFree} multiline={q.kind === 'text'} />
              <VoiceToText compact onText={(x) => x && setFree((f) => (f ? `${f} ${x}` : x))} />
            </>
          )}
          <Row wrap>
            {q.multi || free.trim() ? <Btn small title={L.done} disabled={!multi.length && !free.trim()} onPress={() => give({ status: 'answered', picks: q.multi ? multi : undefined, value: free.trim() || undefined })} /> : null}
            <Btn small kind="ghost" title={L.unknown} onPress={() => give({ status: 'unknown' })} />
            <Btn small kind="ghost" title={L.skip} onPress={() => give({ status: 'skipped' })} />
            {editing ? <Btn small kind="ghost" title={t.c.cancel} onPress={() => setEditing(null)} /> : null}
          </Row>
        </Card>
        {ready?.canGenerate ? <Btn kind="ghost" title={`✨ ${L.build}`} onPress={() => { setEditing(null); setStep('gate'); }} /> : null}
      </Screen>
    );
  }

  if (step === 'working') {
    return <Screen>{head}<Card><Txt>⏳ {working}</Txt></Card></Screen>;
  }

  if (step === 'gate' || !draft) {
    return (
      <Screen>
        {head}
        <Card style={{ gap: 8 }}>
          <Txt v="h">{L.gateTitle}</Txt>
          {Object.entries(ready!.fields).map(([f, v]) => (
            <View key={f} style={{ gap: 2 }}>
              <Row><Txt v="small" style={{ flex: 1 }}>{L.fields[f as keyof typeof L.fields]}</Txt><Txt v="small">{v === 100 ? '✓' : v === 0 ? '—' : '~'}</Txt></Row>
              <Progress value={v as number} height={4} color={(v as number) >= 60 ? c.primary : c.muted} />
            </View>
          ))}
          {ready!.canGenerate ? <Txt color={c.primary}>{L.gateOk}</Txt> : <Txt color={c.danger}>{L.gateMissing}</Txt>}
          {ready!.missing.map((m) => (
            <Btn key={m.slot} small kind="ghost" title={`${m.essential ? '❗' : '＋'} ${L.fields[m.field]}`} onPress={() => { setEditing(m.slot); setStep('interview'); }} />
          ))}
        </Card>
        <Btn title={`✨ ${ready!.canGenerate ? L.build : L.buildAnyway}`} disabled={!ready!.canGenerate && ready!.missing.some((m) => m.essential && m.field === 'goal_clarity')} onPress={() => design()} style={{ paddingVertical: 15 }} />
        <Btn kind="ghost" title={L.more} onPress={() => { save({ extra: true }); setStep('interview'); }} />
        <Btn kind="ghost" title={L.back} onPress={() => { setEditing('outcome'); setStep('interview'); }} />
      </Screen>
    );
  }

  // ── preview ──
  const live = draft.milestones;
  const fmt = (d?: string) => (d ? fmtDate(d, lang, t.c) : '—');
  const hrs = (m?: number) => (m == null ? '—' : String(Math.round(m / 6) / 10));
  const sessionsOf = (k: string) => sched?.sessions.filter((s) => s.key === k) ?? [];
  const issueOf = (k: string) => issues.filter((i) => i.key === k);
  return (
    <Screen>
      {head}
      {calNote ? <Txt v="small">📅 {calNote}</Txt> : null}

      <Section title={`A. ${L.A}`}>
        <Card style={{ gap: 6 }}>
          {draft.understanding ? <Txt>💡 {draft.understanding}</Txt> : null}
          {brief?.motivation.reasons.length ? <Txt v="small">❤️ {brief.motivation.reasons.join('، ')}</Txt> : null}
          <Txt v="muted">{L.successTitle}</Txt>
          {draft.success.map((s, i) => <Txt key={i} v="small">🎯 {s.measure}{s.baseline ? ` · ${s.baseline}` : ''}{s.target ? ` → ${s.target}` : ''}{s.unit ? ` ${s.unit}` : ''}{s.evidence ? ` (${s.evidence})` : ''}</Txt>)}
          <Pressable onPress={() => setOkSuccess((x) => !x)} accessibilityRole="checkbox"><Row><Check on={okSuccess} onPress={() => setOkSuccess((x) => !x)} /><Txt style={{ flex: 1 }} v="small">{L.approveSuccess}</Txt></Row></Pressable>
        </Card>
      </Section>

      <Section title={`B. ${L.B}`}>
        <Card style={{ gap: 4 }}>
          <Txt v="small">⏱ {L.stated}: {hrs(brief?.time.stated_minutes)} · {L.calendar}: {hrs(brief?.time.calendar_minutes)} · <Txt v="small" color={c.primary}>{L.usable}: {hrs(brief?.time.weekly_minutes)} {L.hWeek}</Txt></Txt>
          <Txt v="small">🌅 {L.bestTime}: {brief?.execution.window ? `${brief.execution.window.start}–${brief.execution.window.end}` : '—'} · {L.session}: {brief?.execution.session_minutes}{L.min}</Txt>
          {brief?.obstacles.length ? <Txt v="small">🧱 {L.obstacles}: {brief.obstacles.join('، ')}</Txt> : null}
          {brief?.resources.length ? <Txt v="small">📚 {L.resources}: {brief.resources.join('، ')}</Txt> : null}
          {brief?.skill_gaps.length ? <Txt v="small">🧩 {L.gaps}: {brief.skill_gaps.join('، ')}</Txt> : null}
        </Card>
      </Section>

      <Section title={`C. ${L.C}`}>
        {live.map((m, i) => {
          const ts = draft.tasks.filter((x) => x.milestone === m.key);
          const md = dates[m.key];
          return (
            <Card key={m.key} style={{ gap: 6, opacity: m.off ? 0.45 : 1 }}>
              <Row>
                <Check on={!m.off} onPress={() => edit((r) => ({ ...r, milestones: r.milestones.map((x) => (x.key === m.key ? { ...x, off: !x.off } : x)) }))} />
                <EditText value={m.title} onChange={(v) => edit((r) => ({ ...r, milestones: r.milestones.map((x) => (x.key === m.key ? { ...x, title: v } : x)) }))} bold />
                <Pressable onPress={() => moveMilestone(i, -1)} hitSlop={6}><Txt>↑</Txt></Pressable>
                <Pressable onPress={() => moveMilestone(i, 1)} hitSlop={6}><Txt>↓</Txt></Pressable>
              </Row>
              {m.purpose ? <Txt v="small">🎯 {m.purpose}</Txt> : null}
              {m.done_when ? <Txt v="small">✔︎ {m.done_when}</Txt> : null}
              <Row wrap>
                <Pressable onPress={() => edit((r) => ({ ...r, milestones: r.milestones.map((x) => (x.key === m.key ? { ...x, hours: x.hours >= 200 ? 2 : Math.round(x.hours * 1.5 + 1) } : x)) }))}>
                  <Badge text={`${m.hours} ${L.hours}`} color={c.primary} />
                </Pressable>
                {md ? <Badge text={`${fmt(md.start)} → ${fmt(md.target)}${md.projected ? ` · ${L.projected}` : ''}`} color={c.muted} /> : null}
                {m.depends_on.length ? <Txt v="small">{L.after}: {m.depends_on.map((k) => live.find((x) => x.key === k)?.title).filter(Boolean).join('، ')}</Txt> : null}
              </Row>
              {ts.map((x) => {
                const ss = sessionsOf(x.key);
                return (
                  <View key={x.key} style={{ gap: 2, paddingStart: 8, borderStartWidth: 2, borderColor: c.border, opacity: x.off ? 0.45 : 1 }}>
                    <Row>
                      <Check on={!x.off} onPress={() => setTask(x.key, { off: !x.off })} />
                      <EditText value={x.title} onChange={(v) => setTask(x.key, { title: v })} />
                      <Pressable onPress={() => setTask(x.key, { minutes: MINS.find((mm) => mm > x.minutes) ?? MINS[0] })}><Badge text={`${x.minutes}${L.min}`} color={c.primary} /></Pressable>
                      <Pressable onPress={() => setTask(x.key, { priority: PR[(PR.indexOf(x.priority) + 1) % 3] })}><Badge text={L.priority[x.priority]} color={prioColor(c, x.priority)} /></Pressable>
                    </Row>
                    {x.workstream ? <Txt v="small" color={c.muted}>📁 {x.workstream}</Txt> : null}
                    {x.why ? <Txt v="small">↳ {x.why}</Txt> : null}
                    {x.depends_on.length ? <Txt v="small" color={c.muted}>{L.after}: {x.depends_on.map((k) => draft.tasks.find((y) => y.key === k)?.title).filter(Boolean).join('، ')}</Txt> : null}
                    {ss.length && !x.off ? <Txt v="small" color={c.primary}>📅 {ss.map((s) => `${fmt(s.date)} ${s.time}`).join(' · ')}</Txt> : null}
                    {issueOf(x.key).some((iss) => iss.kind === 'generic') ? <Txt v="small" color={c.danger}>{L.generic}</Txt> : null}
                  </View>
                );
              })}
              {!m.off ? <AddTask placeholder={L.addTask} onAdd={(title2) => edit((r) => ({ ...r, tasks: [...r.tasks, { key: `u${Date.now().toString(36)}`, title: title2, minutes: brief?.execution.session_minutes ?? 30, priority: 'medium', milestone: m.key, depends_on: [] }] }))} /> : null}
            </Card>
          );
        })}
      </Section>

      {feas ? (
        <Section title={`D. ${L.D}`}>
          <Card style={{ gap: 6 }}>
            <Txt v="small">{L.total}: {hrs(feas.totalMinutes)} {L.hours} · {L.needWeek}: {hrs(feas.weeklyNeeded)} · {L.haveWeek}: {hrs(feas.weeklyAvailable)} {L.hWeek}</Txt>
            <Txt v="small">{L.deadline}: {fmt(feas.deadline)} · {L.finish}: {fmt(feas.projectedFinish)} · {sched?.sessions.length ?? 0} {L.sessions}</Txt>
            <Txt color={feas.feasible ? c.primary : c.danger}>{feas.feasible ? L.fits : L.notFits}</Txt>
            {feas.options.map((op, i) => (
              <Btn key={i} small kind="ghost"
                title={op.kind === 'extend' ? L.extend.replace('{d}', fmt(op.to)) : op.kind === 'reduce' ? L.reduce.replace('{p}', String(op.percent)) : op.kind === 'more_hours' ? L.moreHours.replace('{h}', String(op.hours)) : L.stages.replace('{m}', op.first)}
                onPress={() => {
                  if (op.kind === 'extend') setDeadlineOverride(op.to);
                  else if (op.kind === 'more_hours') setWeeklyOverride(op.hours * 60);
                  else if (op.kind === 'reduce') design('simpler');
                  else edit((r) => ({ ...r, milestones: r.milestones.map((x, k) => (k === 0 ? x : { ...x, off: true })) }));
                }} />
            ))}
            {sched?.unplaced.length ? <Txt v="small" color={c.danger}>{L.unplaced.replace('{n}', String(sched.unplaced.length))}</Txt> : null}
          </Card>
          {draft.risks.length ? (
            <Card style={{ gap: 6 }}>
              <Txt v="muted">{L.risks}</Txt>
              {draft.risks.map((r, i) => (
                <View key={i} style={{ gap: 1 }}>
                  <Txt v="small" style={{ fontWeight: '600' }}>⚠️ {r.risk} · {L.priority[r.probability]}/{L.priority[r.impact]}</Txt>
                  {r.prevent ? <Txt v="small">🛡 {L.prevent}: {r.prevent}</Txt> : null}
                  {r.recover ? <Txt v="small">↩︎ {L.recover}: {r.recover}</Txt> : null}
                </View>
              ))}
            </Card>
          ) : null}
        </Section>
      ) : null}

      <Section title={`E. ${L.E}`}>
        <Card style={{ gap: 6 }}>
          {draft.why_it_fits ? <Txt v="small">{draft.why_it_fits}</Txt> : null}
          {draft.first_step ? <Txt v="small" color={c.primary}>👣 {L.first}: {draft.first_step}</Txt> : null}
          {draft.assumptions.length ? <Txt v="small">📝 {L.assumptions}: {draft.assumptions.join(' · ')}</Txt> : null}
          {draft.recommendations.length ? <Txt v="small">💬 {L.recs}: {draft.recommendations.join(' · ')}</Txt> : null}
        </Card>
      </Section>

      <Row wrap>
        <Btn small kind="ghost" title={L.simpler} onPress={() => design('simpler')} />
        <Btn small kind="ghost" title={L.ambitious} onPress={() => design('ambitious')} />
        <Btn small kind="ghost" title={L.optimize} onPress={() => design('optimize')} />
      </Row>
      <Btn title={L.approve} loading={saving} disabled={!okSuccess} onPress={approve} style={{ paddingVertical: 15 }} />
      <Row>
        <Btn kind="ghost" style={{ flex: 1 }} title={L.back} onPress={() => { setEditing('outcome'); setStep('interview'); }} />
        <Btn kind="ghost" style={{ flex: 1 }} title={L.reject} onPress={reject} />
      </Row>
    </Screen>
  );
}

function EditText({ value, onChange, bold }: { value: string; onChange: (v: string) => void; bold?: boolean }) {
  const c = useTheme();
  const { dir } = useLang();
  const fontFamily = useFontFamily();
  const [on, setOn] = useState(false);
  const [v, setV] = useState(value);
  if (on) {
    return <TextInput autoFocus value={v} onChangeText={setV} onBlur={() => { setOn(false); if (v.trim() && v !== value) onChange(v.trim()); }} onSubmitEditing={() => { setOn(false); if (v.trim() && v !== value) onChange(v.trim()); }}
      style={{ flex: 1, color: c.text, fontSize: 15, fontFamily, textAlign: dir === 'rtl' ? 'right' : 'left', writingDirection: dir, borderBottomWidth: 1, borderColor: c.primary, paddingVertical: 2 }} />;
  }
  return (
    <Pressable style={{ flex: 1 }} onPress={() => { setV(value); setOn(true); }} accessibilityRole="button">
      <Text style={{ color: c.text, fontSize: 15, fontWeight: bold ? '700' : '400' }}>{value}</Text>
    </Pressable>
  );
}

function AddTask({ placeholder, onAdd }: { placeholder: string; onAdd: (t: string) => void }) {
  const [v, setV] = useState('');
  return <Input value={v} onChangeText={setV} placeholder={placeholder} returnKeyType="done" onSubmitEditing={() => { if (v.trim()) { onAdd(v.trim()); setV(''); } }} />;
}
