import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { GoalForm, HabitForm, TaskForm } from './forms';
import { useProfile } from '@/ctx/Auth';
import { useLang, useTheme } from '@/ctx/Lang';
import { ageFrom, today } from '@/lib/dates';
import { useEntity } from '@/lib/db';
import { openGoogleCalendar } from '@/lib/gcal';
import { avg, goalProgress, habitScheduled, logDone, pct, sortTasks } from '@/lib/logic';
import { Badge, Btn, Card, Check, Empty, Loading, Progress, Row, Screen, Section, Stat, Txt } from '@/ui/kit';
import { CalendarView, QuickAddFAB } from '@/ui/shared';

export default function Dashboard() {
  const c = useTheme();
  const { t } = useLang();
  const router = useRouter();
  const { profile } = useProfile();
  const tasks = useEntity('DailyTask');
  const habits = useEntity('Habit');
  const logs = useEntity('HabitLog').items;
  const goals = useEntity('Goal').items;
  const journal = useEntity('JournalEntry').items;
  const [form, setForm] = useState<'task' | 'habit' | 'goal' | null>(null);
  const day = today();

  const dayTasks = useMemo(() => sortTasks(tasks.items.filter((x) => x.date === day && !x.parent_id)), [tasks.items, day]);
  const doneTasks = dayTasks.filter((x) => x.completed).length;
  const dayHabits = habits.items.filter((h) => habitScheduled(h, day));
  const doneHabits = dayHabits.filter((h) => logDone(h, logs.find((l) => l.habit_id === h.id && l.date === day))).length;
  const liveGoals = goals.filter((g) => g.status !== 'cancelled');
  const avgGoals = avg(liveGoals.map((g) => goalProgress(g, goals)));
  const age = ageFrom(profile?.birth_date);
  const taskDates = useMemo(() => new Set(tasks.items.map((x) => x.date)), [tasks.items]);
  const habitDates = useMemo(() => new Set(logs.filter((l) => l.completed).map((l) => l.date)), [logs]);

  if (tasks.loading || habits.loading) return <Screen><Loading /></Screen>;

  return (
    <Screen fab={<QuickAddFAB onTask={() => setForm('task')} onHabit={() => setForm('habit')} onGoal={() => setForm('goal')} />}>
      <Card>
        <Txt v="h">{t.dash.hello} {profile?.full_name} 👋</Txt>
        {profile?.daily_intention && profile.last_intention_date === day ? <Txt v="muted">🌅 {t.intention.label}: {profile.daily_intention}</Txt> : null}
        <Row>
          <Stat label={t.dash.age} value={`${age} ${t.dash.years}`} />
          <Stat label={t.dash.yearsLeft} value={`${Math.max(0, (profile?.target_age ?? 80) - age)} ${t.dash.years}`} />
        </Row>
      </Card>

      <Section title={t.dash.goalsStrip}>
        {liveGoals.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {liveGoals.map((g) => (
              <Card key={g.id} style={{ width: 170, borderColor: g.color ?? c.border }} onPress={() => router.push(`/goals/${g.level}` as any)}>
                <Txt numberOfLines={1} style={{ fontWeight: '600' }}>{g.title}</Txt>
                <Txt v="small">{t.level[g.level]} · {goalProgress(g, goals)}%</Txt>
                <Progress value={goalProgress(g, goals)} color={g.color} />
              </Card>
            ))}
          </ScrollView>
        ) : <Txt v="muted">{t.dash.noGoals}</Txt>}
      </Section>

      <Row wrap>
        <Stat icon="✅" label={t.dash.tasksToday} value={`${doneTasks}/${dayTasks.length}`} />
        <Stat icon="🔥" label={t.dash.habitsToday} value={`${doneHabits}/${dayHabits.length}`} />
        <Stat icon="📔" label={t.dash.journal} value={journal.some((j) => j.date === day) ? t.dash.journalDone : t.dash.journalMissing} />
        <Stat icon="🎯" label={t.dash.avgGoals} value={`${avgGoals}%`} />
      </Row>

      <Section title={t.dash.recentTasks} right={<Btn small kind="ghost" title={t.c.more} onPress={() => router.push('/today')} />}>
        <Card>
          <Progress value={pct(doneTasks, dayTasks.length)} />
          {dayTasks.length ? dayTasks.slice(0, 4).map((x) => (
            <Row key={x.id}>
              <Check on={!!x.completed} onPress={() => router.push('/today')} />
              <Txt style={{ flex: 1, textDecorationLine: x.completed ? 'line-through' : 'none' }} numberOfLines={1}>{x.title}</Txt>
              {x.time ? <Txt v="small">{x.time}</Txt> : null}
            </Row>
          )) : <Empty icon="🗒" text={t.dash.noTasks} />}
        </Card>
      </Section>

      <Section title={t.dash.activeHabits}>
        <Row wrap>
          {habits.items.filter((h) => h.is_active !== false).map((h) => <Badge key={h.id} text={`🔥 ${h.title} · ${h.streak ?? 0}`} color={h.color} />)}
          {!habits.items.length ? <Txt v="muted">{t.habits.empty}</Txt> : null}
        </Row>
      </Section>

      <Section title={t.dash.calendar}>
        <CalendarView taskDates={taskDates} habitDates={habitDates} onSelect={(d) => router.push(`/today?date=${d}` as any)} />
      </Section>

      <Row>
        <Btn kind="ghost" title={`📅 ${t.dash.openGcal}`} onPress={openGoogleCalendar} style={{ flex: 1 }} />
        <Btn kind="ghost" title={`📊 ${t.dash.openAnalytics}`} onPress={() => router.push('/analytics')} style={{ flex: 1 }} />
      </Row>
      <View />

      <TaskForm visible={form === 'task'} onClose={() => setForm(null)} />
      <HabitForm visible={form === 'habit'} onClose={() => setForm(null)} />
      <GoalForm visible={form === 'goal'} onClose={() => setForm(null)} />
    </Screen>
  );
}
