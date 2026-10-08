import React, { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { QuickAdd, TaskDetail, TaskRow, useTaskActions } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { fmtDate, today } from '@/lib/dates';
import { useEntity } from '@/lib/db';
import { habitScheduled, logDone, sortTasks } from '@/lib/logic';
import type { DailyTask } from '@/lib/types';
import { Badge, Empty, PomodoroBar, Row, Txt } from '@/ui/kit';
import { CalendarView } from '@/ui/shared';

// Month grid on top, the picked day's tasks and habits underneath.
export default function CalendarTab() {
  const c = useTheme();
  const { t, lang, dir } = useLang();
  const tasks = useEntity('DailyTask').items;
  const habits = useEntity('Habit').items;
  const logs = useEntity('HabitLog').items;
  const { toggle } = useTaskActions();
  const [day, setDay] = useState(today());
  const [openId, setOpenId] = useState<string | null>(null);

  const taskDates = useMemo(() => new Set(tasks.filter((x) => !x.parent_id).map((x) => x.date)), [tasks]);
  const habitDates = useMemo(() => new Set(logs.filter((l) => l.completed).map((l) => l.date)), [logs]);
  const dayTasks = useMemo(() => sortTasks(tasks.filter((x) => x.date === day && !x.parent_id)), [tasks, day]);
  const dayHabits = habits.filter((h) => habitScheduled(h, day));
  const open = useCallback((x: DailyTask) => setOpenId(x.id), []);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90} style={{ flex: 1, backgroundColor: c.bg }}>
      <PomodoroBar />
      <ScrollView style={{ flex: 1, direction: dir }} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ padding: 12 }}>
          <CalendarView taskDates={taskDates} habitDates={habitDates} selected={day} onSelect={setDay} />
        </View>
        <View style={{ paddingHorizontal: 14, paddingBottom: 6 }}>
          <Txt v="sub">{fmtDate(day, lang, t.c, true)} · {dayTasks.filter((x) => !x.completed).length} {t.tasks.left}</Txt>
        </View>
        {dayTasks.length ? dayTasks.map((x) => {
          const subs = tasks.filter((s) => s.parent_id === x.id);
          return <TaskRow key={x.id} task={x} subDone={subs.filter((s) => s.completed).length} subTotal={subs.length} onToggle={toggle} onOpen={open} />;
        }) : <Empty icon="🗓" text={t.tasks.empty} />}
        {dayHabits.length ? (
          <View style={{ padding: 14, gap: 6 }}>
            <Txt v="muted">🔥 {t.nav.habits}</Txt>
            <Row wrap>
              {dayHabits.map((h) => <Badge key={h.id} text={`${logDone(h, logs.find((l) => l.habit_id === h.id && l.date === day)) ? '✓ ' : ''}${h.title}`} color={h.color} />)}
            </Row>
          </View>
        ) : null}
      </ScrollView>
      <View style={{ backgroundColor: c.card, borderTopWidth: 1, borderColor: c.border, padding: 10 }}>
        <QuickAdd defaultDate={day} />
      </View>
      <TaskDetail taskId={openId} onClose={() => setOpenId(null)} />
    </KeyboardAvoidingView>
  );
}
