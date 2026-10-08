import React from 'react';

import { useLang, useTheme } from '@/ctx/Lang';
import { useEntity } from '@/lib/db';
import { goalStats, habitStats, taskSeries } from '@/lib/stats';
import { BarChart, HBars, PieChart } from '@/ui/charts';
import { Card, Loading, Screen, Txt } from '@/ui/kit';

export default function ProgressPage() {
  const c = useTheme();
  const { t } = useLang();
  const tasks = useEntity('DailyTask');
  const goals = useEntity('Goal');
  const habits = useEntity('Habit');
  const logs = useEntity('HabitLog');
  if (tasks.loading || goals.loading || habits.loading || logs.loading) return <Screen><Loading /></Screen>;

  const gs = goalStats(goals.items);
  const hs = habitStats(habits.items, logs.items);
  const statusColor = { not_started: c.muted, in_progress: c.primary, completed: c.success, cancelled: c.danger };

  return (
    <Screen>
      <Card>
        <Txt v="sub">🎯 {t.ana.byLevel}</Txt>
        <HBars data={gs.byLevel.map((l) => ({ label: `${t.level[l.level]} (${l.count})`, value: l.value }))} />
      </Card>
      <Card>
        <Txt v="sub">🔥 {t.ana.habitActivity}</Txt>
        <BarChart data={hs.activity.map((a) => ({ ...a, color: c.warn }))} max={Math.max(1, hs.active)} />
      </Card>
      <Card>
        <Txt v="sub">{t.ana.statusDist}</Txt>
        {gs.total ? <PieChart data={gs.byStatus.map((s) => ({ label: t.goalStatus[s.status], value: s.count, color: statusColor[s.status] }))} /> : <Txt v="muted">{t.fin.noData}</Txt>}
      </Card>
      <Card>
        <Txt v="sub">✅ {t.ana.taskActivity}</Txt>
        <Txt v="small">{t.ana.doneVsTotal}</Txt>
        <BarChart data={taskSeries(tasks.items, 14).map((s) => ({ label: s.label, value: s.done, value2: s.total, color: c.success }))} />
      </Card>
    </Screen>
  );
}
