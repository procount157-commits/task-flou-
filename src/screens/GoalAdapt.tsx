import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import { TIME_WINDOWS } from '@/core/goalinterview';
import { daysBetween, replan, reviewWeek, type Move } from '@/core/roadmap';
import { toMinutes } from '@/core/task';
import { addDays, fmtDate, today } from '@/lib/dates';
import { db, useEntity } from '@/lib/db';
import { autoSyncTask, readDeviceEvents } from '@/lib/devicecal';
import type { Goal } from '@/lib/types';
import { Btn, Card, Chips, Row, Section, Txt, notice } from '@/ui/kit';

const S = {
  ar: {
    title: 'متابعة الهدف', week: 'هذا الأسبوع', done: 'أنجزت {d} من {p}', minutes: '{a} من {b} دقيقة', missed: 'فاتتك {n}', next: '{n} قادمة خلال ٧ أيام',
    behind: 'تأخرت قليلاً — هذا طبيعي. لن أنقل كل شيء إلى الغد؛ سأقترح توزيعاً على وقتك الحقيقي.', onTrack: 'تسير حسب الخطة 👏',
    ask: 'بناءً على ما حدث هذا الأسبوع: هل تبقي الخطة أم تعدّلها؟', keep: 'أبقِها', adjust: 'اقترح جدولاً معدّلاً',
    moves: 'التعديل المقترح', apply: 'طبّق التعديل', cancel: 'إلغاء', deadlineBad: '⚠️ بهذا الوقت لن تنتهي قبل الموعد. يمكنك تمديده أو زيادة وقتك.', applied: 'تم تحريك {n} مهمة',
    deadline: 'الموعد النهائي', extend: 'مدّد الموعد', weekly: 'وقتك الأسبوعي', why: 'تذكير بسببك', reward: 'مكافأتك عند المحطة', interview: '🧭 أعد فهم الهدف وخطط من جديد',
    nothing: 'لا مهام مفتوحة لإعادة جدولتها.', hw: 'س/أسبوع', saved: 'تم الحفظ',
  },
  en: {
    title: 'Goal follow-up', week: 'This week', done: 'Done {d} of {p}', minutes: '{a} of {b} min', missed: 'Missed {n}', next: '{n} coming in 7 days',
    behind: 'You fell a little behind — that is normal. I will not pile everything onto tomorrow; I will spread it over your real time.', onTrack: 'On track 👏',
    ask: 'Based on this week: keep the plan or adjust it?', keep: 'Keep it', adjust: 'Suggest an adjusted schedule',
    moves: 'Proposed change', apply: 'Apply', cancel: 'Cancel', deadlineBad: '⚠️ At this pace it will not finish before the deadline. You can extend it or add time.', applied: '{n} tasks moved',
    deadline: 'Deadline', extend: 'Extend deadline', weekly: 'Your weekly time', why: 'Your reason', reward: 'Your milestone reward', interview: '🧭 Re-understand the goal and plan again',
    nothing: 'No open tasks to reschedule.', hw: 'h/week', saved: 'Saved',
  },
};

/** Weekly review + adaptive replanning for a goal planned through the interview. Changes apply only on approval. */
export function GoalAdapt({ goal, ids }: { goal: Goal; ids: Set<string> }) {
  const c = useTheme();
  const { lang, t } = useLang();
  const L = S[lang === 'ar' ? 'ar' : 'en'];
  const router = useRouter();
  const tasks = useEntity('DailyTask').items;
  const profiles = useEntity('GoalProfile').items;
  const profile = profiles.filter((p) => p.goal_id === goal.id).sort((a, b) => b.version - a.version)[0];
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [deadlineOk, setDeadlineOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const day = today();
  const mine = useMemo(() => tasks.filter((x) => x.goal_id && ids.has(x.goal_id) && !x.parent_id && x.date), [tasks, ids]);
  const week = useMemo(() => reviewWeek(mine.map((x) => ({ ...x, priority: x.priority })), day), [mine, day]);
  const fmt = (d?: string) => (d ? fmtDate(d, lang, t.c) : '—');

  const propose = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const b = profile.brief;
      const from = addDays(day, 1);
      const to = addDays(from, 60);
      const open = mine.filter((x) => !x.completed && (x.date < from || x.date <= to));
      if (!open.length) return notice(L.nothing);
      const openIds = new Set(open.map((x) => x.id));
      const busyMap: Record<string, { start: number; end: number }[]> = {};
      for (const x of tasks) if (!x.completed && x.time && !openIds.has(x.id) && x.date >= from) (busyMap[x.date] ??= []).push({ start: toMinutes(x.time), end: x.end_time ? toMinutes(x.end_time) : toMinutes(x.time) + (x.minutes ?? 30) });
      for (const e of await readDeviceEvents(from, to)) if (!e.allDay && e.time) (busyMap[e.date] ??= []).push({ start: toMinutes(e.time), end: e.end ? toMinutes(e.end) : toMinutes(e.time) + 60 });
      const r = replan(open.map((x) => ({ ...x, priority: x.priority })), {
        start: from, weeklyMinutes: b.time.weekly_minutes, days: b.time.days, window: b.execution.window ?? TIME_WINDOWS.evening,
        sessionMinutes: b.execution.session_minutes, busy: (d) => busyMap[d] ?? [], deadline: goal.due_date, maxDays: 400,
      });
      setMoves(r.moves);
      setDeadlineOk(r.deadlineOk);
      await db.create('GoalActivity', { goal_id: goal.id, kind: 'review', text: `done ${week.done}/${week.planned}, missed ${week.missed}`, data: { ...week, missedTasks: undefined } });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!moves) return;
    for (const m of moves) {
      await db.update('DailyTask', m.id, { date: m.to, time: m.time, end_time: m.end_time });
      autoSyncTask(m.id);
    }
    await db.create('GoalActivity', { goal_id: goal.id, kind: 'replan_applied', text: `${moves.length}`, data: { moves } });
    notice(L.applied.replace('{n}', String(moves.length)));
    setMoves(null);
  };

  const setDeadline = async (days: number) => {
    const next = addDays(goal.due_date && goal.due_date > day ? goal.due_date : day, days);
    await db.update('Goal', goal.id, { due_date: next });
    await db.create('GoalActivity', { goal_id: goal.id, kind: 'deadline_changed', text: `${goal.due_date ?? '-'} → ${next}` });
    setDeadlineOk(true);
    notice(L.saved);
  };
  const setWeekly = async (hours: number) => {
    if (!profile) return;
    const brief = { ...profile.brief, time: { ...profile.brief.time, weekly_minutes: hours * 60, stated_minutes: hours * 60 } };
    await db.create('GoalProfile', { goal_id: goal.id, interview_id: profile.interview_id, brief, success: profile.success, risks: profile.risks, version: profile.version + 1 });
    notice(L.saved);
  };

  return (
    <Section title={`📈 ${L.title}`}>
      {profile?.brief.motivation.reasons.length ? <Card><Txt v="small">❤️ {L.why}: {profile.brief.motivation.reasons.join('، ')}</Txt>{goal.reward_title ? <Txt v="small">🎁 {L.reward}: {goal.reward_title}</Txt> : null}</Card> : null}
      {profile ? (
        <Card style={{ gap: 6 }}>
          <Txt v="muted">{L.week}</Txt>
          <Row wrap>
            <Txt v="small">✅ {L.done.replace('{d}', String(week.done)).replace('{p}', String(week.planned))}</Txt>
            <Txt v="small">⏱ {L.minutes.replace('{a}', String(week.minutesDone)).replace('{b}', String(week.minutesPlanned))}</Txt>
            {week.missed ? <Txt v="small" color={c.danger}>⏰ {L.missed.replace('{n}', String(week.missed))}</Txt> : null}
            <Txt v="small">📅 {L.next.replace('{n}', String(week.next7))}</Txt>
          </Row>
          <Txt v="small" color={week.behind ? c.danger : c.primary}>{week.behind ? L.behind : L.onTrack}</Txt>
          <Txt v="small">{L.ask}</Txt>
          <Row>
            <Btn small kind="ghost" style={{ flex: 1 }} title={L.keep} onPress={() => db.create('GoalActivity', { goal_id: goal.id, kind: 'review', text: 'keep' }).then(() => notice(L.saved))} />
            <Btn small style={{ flex: 1 }} title={L.adjust} loading={busy} onPress={propose} />
          </Row>
          {moves ? (
            <View style={{ gap: 4 }}>
              <Txt v="muted">{L.moves} ({moves.length})</Txt>
              {moves.slice(0, 12).map((m) => <Txt key={m.id} v="small">• {m.title}: {fmt(m.from)} → {fmt(m.to)} {m.time}</Txt>)}
              {!deadlineOk ? <Txt v="small" color={c.danger}>{L.deadlineBad}</Txt> : null}
              <Row>
                <Btn small style={{ flex: 1 }} title={L.apply} disabled={!moves.length} onPress={apply} />
                <Btn small kind="ghost" style={{ flex: 1 }} title={L.cancel} onPress={() => setMoves(null)} />
              </Row>
            </View>
          ) : null}
          <Txt v="small">{L.deadline}: {fmt(goal.due_date)}{goal.due_date ? ` (${daysBetween(day, goal.due_date)}d)` : ''}</Txt>
          <Chips options={[{ value: '14', label: '+2w' }, { value: '30', label: '+1m' }, { value: '90', label: '+3m' }]} value={null} onChange={(v) => setDeadline(Number(v))} />
          <Txt v="small">{L.weekly}: {Math.round(profile.brief.time.weekly_minutes / 6) / 10} {L.hw}</Txt>
          <Chips options={['2', '4', '6', '8', '10', '15'].map((h) => ({ value: h, label: h }))} value={String(Math.round(profile.brief.time.weekly_minutes / 60))} onChange={(v) => setWeekly(Number(v))} />
        </Card>
      ) : null}
      <Btn kind="ghost" title={L.interview} onPress={() => router.push(`/interview?goalId=${goal.id}&fresh=1` as any)} />
    </Section>
  );
}
