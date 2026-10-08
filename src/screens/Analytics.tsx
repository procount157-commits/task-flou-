import React, { useState } from 'react';

import { useLang, useTheme } from '@/ctx/Lang';
import { useEntity } from '@/lib/db';
import { goalStats, habitStats, taskSeries, taskStats } from '@/lib/stats';
import { BarChart, HBars, LineChart, PieChart } from '@/ui/charts';
import { Card, Chips, Loading, Row, Screen, Stat, Tabs, Txt } from '@/ui/kit';

export default function Analytics() {
  const c = useTheme();
  const { t } = useLang();
  const tasks = useEntity('DailyTask');
  const goals = useEntity('Goal');
  const habits = useEntity('Habit');
  const logs = useEntity('HabitLog');
  const [tab, setTab] = useState<'tasks' | 'goals' | 'habits'>('tasks');
  const [range, setRange] = useState('7');

  if (tasks.loading || goals.loading || habits.loading || logs.loading) return <Screen><Loading /></Screen>;

  const ts = taskStats(tasks.items);
  const gs = goalStats(goals.items);
  const hs = habitStats(habits.items, logs.items);
  const series = taskSeries(tasks.items, Number(range));
  const statusColor = { not_started: c.muted, in_progress: c.primary, completed: c.success, cancelled: c.danger };
  const prioColor = { high: c.danger, medium: c.warn, low: c.muted };
  const none = <Txt v="muted">{t.fin.noData}</Txt>;

  return (
    <Screen>
      <Card>
        <Txt v="sub">{t.ana.overall}</Txt>
        <Txt style={{ fontSize: 40, fontWeight: '700' }}>{Math.round((ts.rate + gs.avg + hs.rate) / 3)} / 100</Txt>
        <HBars data={[{ label: t.ana.taskRate, value: ts.rate }, { label: t.ana.goalRate, value: gs.avg, color: c.success }, { label: t.ana.habitRate, value: hs.rate, color: c.warn }]} />
      </Card>

      <Tabs options={[{ value: 'tasks', label: `✅ ${t.ana.tasks}` }, { value: 'goals', label: `🎯 ${t.ana.goals}` }, { value: 'habits', label: `🔥 ${t.ana.habits}` }]} value={tab} onChange={setTab} />

      {tab === 'tasks' ? (
        <>
          <Row wrap>
            <Stat label={t.ana.totalDone} value={ts.done} />
            <Stat label={t.ana.rate} value={`${ts.rate}%`} />
            <Stat label={t.ana.highDone} value={ts.highDone} />
            <Stat label={t.ana.todayRate} value={`${ts.todayRate}%`} />
          </Row>
          <Chips options={['7', '14', '30'].map((d) => ({ value: d, label: `${d} ${t.ana.d}` }))} value={range} onChange={setRange} />
          <Card>
            <Txt v="sub">{t.ana.dailyRate}</Txt>
            <BarChart data={series.map((s) => ({ label: s.label, value: s.done, value2: s.total }))} />
          </Card>
          <Card>
            <Txt v="sub">{t.ana.rateCurve}</Txt>
            <LineChart data={series.map((s) => ({ label: s.label, value: s.rate }))} max={100} />
          </Card>
          <Card>
            <Txt v="sub">{t.ana.byPriority}</Txt>
            {ts.done ? <PieChart data={ts.byPriority.map((p) => ({ label: t.prio[p.priority], value: p.count, color: prioColor[p.priority] }))} /> : none}
          </Card>
        </>
      ) : tab === 'goals' ? (
        <>
          <Row wrap>
            <Stat label={t.ana.totalGoals} value={gs.total} />
            <Stat label={t.ana.doneGoals} value={gs.done} />
            <Stat label={t.ana.activeGoals} value={gs.active} />
            <Stat label={t.ana.avgProgress} value={`${gs.avg}%`} />
          </Row>
          <Card>
            <Txt v="sub">{t.ana.byLevel}</Txt>
            <HBars data={gs.byLevel.map((l) => ({ label: `${t.level[l.level]} (${l.count})`, value: l.value }))} />
          </Card>
          <Card>
            <Txt v="sub">{t.ana.statusDist}</Txt>
            {gs.total ? <PieChart data={gs.byStatus.map((s) => ({ label: t.goalStatus[s.status], value: s.count, color: statusColor[s.status] }))} /> : none}
          </Card>
          <Card>
            <Txt v="sub">{t.ana.top5}</Txt>
            {gs.top5.length ? <HBars data={gs.top5.map((x) => ({ label: x.goal.title, value: x.value, color: x.goal.color }))} /> : none}
          </Card>
        </>
      ) : (
        <>
          <Row wrap>
            <Stat label={t.ana.activeHabits} value={hs.active} />
            <Stat label={t.ana.daysDone} value={hs.daysDone} />
            <Stat label={t.ana.bestStreak} value={hs.bestStreak} />
            <Stat label={t.ana.habitsToday} value={hs.doneToday} />
          </Row>
          <Card>
            <Txt v="sub">{t.ana.habitActivity}</Txt>
            <LineChart data={hs.activity} max={Math.max(1, hs.active)} color={c.warn} />
          </Card>
          <Card>
            <Txt v="sub">{t.ana.commitment}</Txt>
            {hs.commitment.length ? <HBars data={hs.commitment.map((x) => ({ label: x.habit.title, value: x.value, color: x.habit.color }))} /> : none}
          </Card>
        </>
      )}
    </Screen>
  );
}
