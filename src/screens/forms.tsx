import React from 'react';

import { useLang } from '@/ctx/Lang';
import { today } from '@/lib/dates';
import { useEntity } from '@/lib/db';
import { grantReward, LEVELS, parentLevel } from '@/lib/logic';
import type { DailyTask, Goal, GoalLevel, Habit } from '@/lib/types';
import { Field, FormModal } from '@/ui/Form';
import { opts } from '@/ui/kit';
import { useCelebrate } from '@/ui/shared';

type FormProps<T> = { visible: boolean; onClose: () => void; initial?: Partial<T> };

export function TaskForm({ visible, onClose, initial }: FormProps<DailyTask>) {
  const { t } = useLang();
  const tasks = useEntity('DailyTask');
  const goals = useEntity('Goal').items;
  const habits = useEntity('Habit').items;
  const content = useEntity('ContentItem').items;
  const learning = useEntity('LearningItem').items;
  const pickFrom = (xs: { id: string; title: string }[]) => xs.map((x) => ({ value: x.id, label: x.title }));
  const fields: Field[] = [
    { key: 'title', label: t.c.title, required: true, suggestions: t.sug.tasks },
    { key: 'date', label: t.c.date, type: 'date', required: true },
    { key: 'time', label: t.c.time, type: 'time' },
    { key: 'end_time', label: t.c.endTime, type: 'time' },
    { key: 'priority', label: t.c.priority, type: 'select', options: opts(t.prio) },
    { key: 'repeat_days', label: t.today.repeat, type: 'days', placeholder: t.c.none },
    ...(goals.length ? [{ key: 'goal_id', label: `🎯 ${t.c.linkGoal}`, type: 'select' as const, optional: true, options: pickFrom(goals) }] : []),
    ...(habits.length ? [{ key: 'habit_id', label: `🔥 ${t.c.linkHabit}`, type: 'select' as const, optional: true, options: pickFrom(habits) }] : []),
    ...(content.length ? [{ key: 'content_id', label: `📱 ${t.c.linkContent}`, type: 'select' as const, optional: true, options: pickFrom(content) }] : []),
    ...(learning.length ? [{ key: 'learning_id', label: `🎓 ${t.c.linkLearning}`, type: 'select' as const, optional: true, options: pickFrom(learning) }] : []),
  ];
  return (
    <FormModal visible={visible} onClose={onClose} title={initial?.id ? t.c.edit : t.today.addTask} fields={fields} history={tasks.items}
      initial={{ date: today(), priority: 'medium', repeat_days: [], ...initial }}
      onSave={async (v) => {
        if (initial?.id) await tasks.update(initial.id, v);
        else await tasks.create({ completed: false, ...v } as DailyTask);
      }} />
  );
}

export function HabitForm({ visible, onClose, initial }: FormProps<Habit>) {
  const { t } = useLang();
  const habits = useEntity('Habit');
  const goals = useEntity('Goal').items;
  const fields: Field[] = [
    { key: 'title', label: t.c.title, required: true, suggestions: t.sug.habits },
    { key: 'frequency', label: t.habits.frequency, type: 'select', options: opts(t.freq) },
    { key: 'repeat_days', label: t.today.repeat, type: 'days' },
    { key: 'time', label: t.c.time, type: 'time' },
    { key: 'target_days', label: t.habits.targetDays, type: 'number', suggestions: t.sug.days },
    { key: 'daily_count', label: t.habits.dailyCount, type: 'number', suggestions: t.sug.counts },
    { key: 'weekly_target', label: t.habits.weeklyTarget, type: 'number', suggestions: t.sug.counts },
    { key: 'start_date', label: t.c.startDate, type: 'date' },
    { key: 'end_date', label: t.c.endDate, type: 'date' },
    ...(goals.length ? [{ key: 'goal_id', label: `🎯 ${t.c.linkGoal}`, type: 'select' as const, optional: true, options: goals.map((g) => ({ value: g.id, label: g.title })) }] : []),
    { key: 'color', label: t.c.color, type: 'color' },
    { key: 'is_active', label: t.habits.active, type: 'bool' },
    { key: 'reward', label: t.c.reward, type: 'reward' },
  ];
  return (
    <FormModal visible={visible} onClose={onClose} title={initial?.id ? t.c.edit : t.habits.add} fields={fields}
      initial={{ frequency: 'daily', repeat_days: [], daily_count: 1, target_days: 21, start_date: today(), is_active: true, ...initial }}
      onSave={async (v) => {
        const data = { ...v, daily_count: Math.max(1, Math.round(v.daily_count || 1)) };
        if (initial?.id) await habits.update(initial.id, data);
        else await habits.create({ streak: 0, order: habits.items.length, ...data } as Habit);
      }} />
  );
}

// `level` fixes the goal's level (goal pages); without it the level is chosen in the form (quick add).
export function GoalForm({ visible, onClose, initial, level }: FormProps<Goal> & { level?: GoalLevel }) {
  const { t } = useLang();
  const goals = useEntity('Goal');
  const celebrate = useCelebrate();
  const lvl = level ?? initial?.level;
  const up = lvl && parentLevel(lvl);
  const parents = goals.items.filter((g) => (lvl ? g.level === up : true) && g.id !== initial?.id);
  const fields: Field[] = [
    { key: 'title', label: t.c.title, required: true, suggestions: t.sug.goals },
    { key: 'description', label: t.c.description, type: 'multiline', voice: true },
    ...(lvl ? [] : [{ key: 'level', label: t.goals.level, type: 'select' as const, options: opts(t.level), required: true }]),
    ...(parents.length ? [{ key: 'parent_id', label: t.goals.parent, type: 'select' as const, optional: true, options: parents.map((g) => ({ value: g.id, label: lvl ? g.title : `${g.title} · ${t.level[g.level]}` })) }] : []),
    { key: 'status', label: t.c.status, type: 'select', options: opts(t.goalStatus) },
    { key: 'priority', label: t.c.priority, type: 'select', options: opts(t.prio) },
    { key: 'progress', label: `${t.c.progress} (0-100)`, type: 'number', suggestions: t.sug.percents },
    { key: 'auto_progress', label: t.goals.autoProgress, type: 'bool' },
    { key: 'due_date', label: t.goals.dueDate, type: 'date' },
    { key: 'color', label: t.c.color, type: 'color' },
    { key: 'reward', label: t.c.reward, type: 'reward' },
  ];
  return (
    <FormModal visible={visible} onClose={onClose} title={initial?.id ? t.c.edit : t.goals.add} fields={fields}
      initial={{ level: lvl ?? 'one_week', status: 'not_started', priority: 'medium', progress: 0, ...initial }}
      onSave={async (v) => {
        const goalLevel: GoalLevel = lvl ?? v.level;
        const parent = goals.items.find((g) => g.id === v.parent_id);
        const data: Omit<Goal, 'id' | 'created_date' | 'updated_date' | 'created_by_id'> = {
          ...(v as Goal),
          level: goalLevel,
          // a parent must sit exactly one level above
          parent_id: parent && parent.level === LEVELS[LEVELS.indexOf(goalLevel) - 1] ? parent.id : undefined,
          progress: v.status === 'completed' ? 100 : Math.max(0, Math.min(100, v.progress ?? 0)),
        };
        let id = initial?.id;
        if (id) await goals.update(id, data);
        else id = (await goals.create(data)).id;
        if (data.status === 'completed' && initial?.status !== 'completed') {
          const got = await grantReward('goal', { id, ...data });
          celebrate(got ? `${t.c.rewardUnlocked} ${data.reward_icon ?? '🎁'} ${data.reward_title}` : undefined);
        }
      }} />
  );
}
