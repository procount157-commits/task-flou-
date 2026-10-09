import React, { useState } from 'react';

import { useAI } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { addDays, lastDays, today } from '@/lib/dates';
import { db, useEntity, useKV } from '@/lib/db';
import { autoSyncTask } from '@/lib/devicecal';
import { Review as ReviewData, weeklyReview } from '@/lib/goalai';
import { goalProgress, lastMoved } from '@/lib/logic';
import { Btn, Card, Check, Row, Screen, Section, Txt } from '@/ui/kit';
import { useUndo } from '@/ui/shared';

const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);

/** The week in review, written by the AI, with next week's tasks to accept one by one. */
export default function Review() {
  const c = useTheme();
  const { t, lang } = useLang();
  const ai = useAI();
  const undo = useUndo();
  const goals = useEntity('Goal').items;
  const tasks = useEntity('DailyTask').items;
  const logs = useEntity('ActivityLog').items;
  const day = today();
  const week = lastDays(7, day);
  const [saved, setSaved] = useKV<{ week: string; review: ReviewData } | null>('review:last', null);
  const [picks, setPicks] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const review = saved?.review ?? null;

  const run = async () => {
    setBusy(true);
    const live = goals.filter((g) => !g.parent_id && g.status !== 'completed' && g.status !== 'cancelled');
    const done = tasks.filter((x) => !x.parent_id && x.completed && week.includes(x.date));
    const missed = tasks.filter((x) => !x.parent_id && !x.completed && x.date < day && x.date >= week[0]);
    const hours = logs.filter((l) => week.includes(l.date)).map((l) => `${l.date.slice(5)} ${l.time} ${(l.dialog ?? []).filter((d) => d.role === 'me').map((d) => d.text).join('/') || l.text || ''}`);
    const out = await ai(() => weeklyReview(live.map((g) => ({ goal: g, progress: goalProgress(g, goals), idleDays: daysBetween(lastMoved(g, goals), day) })), done, missed, hours, lang));
    setBusy(false);
    if (out) {
      await setSaved({ week: day, review: out });
      setPicks(out.next.map(() => true));
    }
  };
  const accept = async () => {
    if (!review) return;
    const chosen = review.next.filter((_, i) => picks[i] ?? true);
    // next week's tasks are dealt one a day from tomorrow
    const made = await db.bulkCreate('DailyTask', chosen.map((title, i) => ({ title, date: addDays(day, 1 + i), priority: 'high' as const, completed: false })));
    for (const x of made) autoSyncTask(x.id);
    undo(`➕ ${made.length}`, () => db.removeWhere('DailyTask', (x) => made.some((m) => m.id === x.id)));
    setPicks(review.next.map(() => false));
  };

  // the week in numbers, straight from the data: focus time, finish rate, and what the hours went to
  const sessions = useEntity('PomodoroSession').items.filter((x) => week.includes(x.date));
  const focusMin = sessions.reduce((n, x) => n + (x.focus_minutes ?? 0) * Math.max(1, x.sessions_completed ?? 1), 0);
  const weekLogs = logs.filter((l) => week.includes(l.date));
  const answers = (k: number) => weekLogs.map((l) => (l.dialog ?? []).filter((d) => d.role === 'me')[k]?.text).filter((x): x is string => !!x);
  const tally = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const doing = tally(answers(0)).slice(0, 6);
  const distracted = answers(1).filter((x) => /مشتت|distract/i.test(x)).length;
  const far = answers(2).filter((x) => /بعيد|far/i.test(x)).length;
  const doneCount = tasks.filter((x) => !x.parent_id && x.completed && week.includes(x.date)).length;
  const plannedCount = tasks.filter((x) => !x.parent_id && week.includes(x.date)).length;
  return (
    <Screen>
      <Card style={{ gap: 6 }}>
        <Txt v="h">📋 {t.review.title}</Txt>
        <Txt v="muted">{t.review.stats.replace('{d}', String(doneCount)).replace('{p}', String(plannedCount)).replace('{h}', String(logs.filter((l) => week.includes(l.date)).length))}</Txt>
        <Btn title={busy ? t.c.aiWorking : `🤖 ${review ? t.review.again : t.review.run}`} loading={busy} onPress={run} />
        {saved ? <Txt v="small">{t.review.from} {saved.week}</Txt> : null}
      </Card>
      <Card style={{ gap: 8 }}>
        <Txt v="sub">📊 {t.review.numbers}</Txt>
        <Row wrap>
          <Txt style={{ flex: 1 }}>✅ {plannedCount ? Math.round((doneCount / plannedCount) * 100) : 0}% {t.review.rate}</Txt>
          <Txt style={{ flex: 1 }}>⏱ {Math.floor(focusMin / 60)}h {focusMin % 60}m {t.review.focus}</Txt>
        </Row>
        <Row wrap>
          <Txt style={{ flex: 1 }} color={distracted ? c.danger : c.text}>😵 {distracted}/{weekLogs.length} {t.review.distracted}</Txt>
          <Txt style={{ flex: 1 }} color={far ? c.danger : c.text}>🔴 {far}/{weekLogs.length} {t.review.far}</Txt>
        </Row>
        {doing.length ? <Txt v="small">{t.review.went}: {doing.map(([k, n]) => `${k} ×${n}`).join(' · ')}</Txt> : null}
      </Card>
      {review ? (
        <>
          <Card><Txt>{review.summary}</Txt></Card>
          {review.wins.length ? <Section title={`🏆 ${t.review.wins}`}>{review.wins.map((x, i) => <Txt key={i}>• {x}</Txt>)}</Section> : null}
          {review.slipping.length ? <Section title={`⚠️ ${t.review.slipping}`}>{review.slipping.map((x, i) => <Txt key={i} color={c.danger}>• {x}</Txt>)}</Section> : null}
          <Section title={`🗓 ${t.review.next}`}>
            {review.next.map((x, i) => (
              <Row key={i} style={{ opacity: picks[i] ?? true ? 1 : 0.45 }}>
                <Check on={picks[i] ?? true} onPress={() => setPicks(review.next.map((_, k) => (k === i ? !(picks[k] ?? true) : picks[k] ?? true)))} />
                <Txt style={{ flex: 1 }}>{x}</Txt>
              </Row>
            ))}
            <Btn title={`✓ ${t.review.accept}`} disabled={!review.next.some((_, i) => picks[i] ?? true)} onPress={accept} />
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
