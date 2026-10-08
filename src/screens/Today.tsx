import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { TaskForm } from './forms';
import { useAuth } from '@/ctx/Auth';
import { useLang, useTheme } from '@/ctx/Lang';
import { usePomodoro } from '@/ctx/Pomodoro';
import { isDate, today } from '@/lib/dates';
import { db, useEntity, useKV } from '@/lib/db';
import { buildICS, exportTask, shareFile } from '@/lib/gcal';
import { NoKeyError, SendEmail, splitTask } from '@/lib/integrations';
import { addPoints, materializeRepeats, pct, pick, POINTS, sortTasks, tierOf } from '@/lib/logic';
import type { DailyTask } from '@/lib/types';
import { Badge, Btn, Card, Check, Empty, IconBtn, Input, Loading, Progress, Row, Screen, Section, Sheet, Txt, confirm, notice } from '@/ui/kit';
import { useCelebrate } from '@/ui/shared';

// Shared by every "split with AI" button: explains a missing key instead of failing silently.
export function useAI() {
  const { t } = useLang();
  const router = useRouter();
  return async <T,>(run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run();
    } catch (e) {
      if (e instanceof NoKeyError) confirm(t.c.aiNeedKey, () => router.push('/profile-settings'), t.c.goSettings, t.c.cancel);
      else notice(String((e as Error)?.message ?? e), t.c.aiError);
      return undefined;
    }
  };
}

export default function Today() {
  const c = useTheme();
  const { t, lang } = useLang();
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string }>();
  const day = isDate(params.date) ? params.date! : today();
  const { user } = useAuth();
  const tasks = useEntity('DailyTask');
  const goals = useEntity('Goal').items;
  const habits = useEntity('Habit').items;
  const content = useEntity('ContentItem').items;
  const learning = useEntity('LearningItem').items;
  const [points] = useKV('points', 0);
  const celebrate = useCelebrate();
  const pomodoro = usePomodoro();
  const ai = useAI();
  const [form, setForm] = useState<Partial<DailyTask> | null>(null);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [subTitle, setSubTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [push, setPush] = useState('');
  const [openGoal, setOpenGoal] = useState<string | null>(null);

  useEffect(() => {
    materializeRepeats(day);
  }, [day]);

  const dayTasks = useMemo(() => sortTasks(tasks.items.filter((x) => x.date === day && !x.parent_id)), [tasks.items, day]);
  const subsOf = (id: string) => tasks.items.filter((x) => x.parent_id === id);
  const tier = tierOf(points);
  const highPending = dayTasks.some((x) => x.priority === 'high' && !x.completed);
  const weekly = goals.filter((g) => g.level === 'one_week' && g.status !== 'cancelled');
  const splitting = tasks.items.find((x) => x.id === splitId);

  const toggle = async (task: DailyTask) => {
    const done = !task.completed;
    await tasks.update(task.id, { completed: done });
    // subtasks carry no points of their own
    if (!task.parent_id) await addPoints(done ? POINTS[task.priority ?? 'medium'] : -POINTS[task.priority ?? 'medium']);
    if (done) celebrate(undefined, 4000);
  };

  const remove = (task: DailyTask) =>
    confirm(t.c.confirmDelete, async () => {
      await db.removeWhere('DailyTask', (x) => x.id === task.id || x.parent_id === task.id);
    }, t.c.delete, t.c.cancel);

  const addSub = async (parent: DailyTask, title: string) => {
    if (title.trim()) await tasks.create({ title: title.trim(), date: parent.date, parent_id: parent.id, priority: parent.priority, completed: false });
  };

  const aiSplit = async (task: DailyTask) => {
    setBusy(task.id);
    const steps = await ai(() => splitTask(task.title, lang));
    if (steps?.length) await db.bulkCreate('DailyTask', steps.map((title) => ({ title, date: task.date, parent_id: task.id, priority: task.priority, completed: false })));
    setBusy(null);
  };

  const remind = async (task: DailyTask) => {
    if (!user?.email) return notice(t.today.noEmail);
    await SendEmail({ to: user.email, subject: `${t.today.reminderSubject}: ${task.title}`, body: `${task.title}\n${task.date}${task.time ? ' ' + task.time : ''}\n${t.c.priority}: ${t.prio[task.priority ?? 'medium']}` });
    await tasks.update(task.id, { reminder_sent: true });
  };

  const links = (x: DailyTask) => [
    x.goal_id && `🎯 ${goals.find((g) => g.id === x.goal_id)?.title ?? ''}`,
    x.habit_id && `🔥 ${habits.find((h) => h.id === x.habit_id)?.title ?? ''}`,
    x.content_id && `📱 ${content.find((i) => i.id === x.content_id)?.title ?? ''}`,
    x.learning_id && `🎓 ${learning.find((i) => i.id === x.learning_id)?.title ?? ''}`,
  ].filter(Boolean) as string[];

  const card = (x: DailyTask) => {
    const subs = subsOf(x.id);
    const subDone = subs.filter((s) => s.completed).length;
    return (
      <Card key={x.id} style={{ borderStartWidth: 4, borderStartColor: x.priority === 'high' ? c.danger : x.priority === 'low' ? c.muted : c.warn }}>
        <Row>
          <Check on={!!x.completed} onPress={() => toggle(x)} />
          <View style={{ flex: 1 }}>
            <Txt style={{ fontWeight: '600', textDecorationLine: x.completed ? 'line-through' : 'none' }}>{x.title}</Txt>
            <Txt v="small">{[x.time && `${x.time}${x.end_time ? '–' + x.end_time : ''}`, t.prio[x.priority ?? 'medium'], `+${POINTS[x.priority ?? 'medium']}`].filter(Boolean).join(' · ')}</Txt>
          </View>
        </Row>
        {links(x).length || x.repeat_days?.length || x.repeat_source_id ? (
          <Row wrap gap={4}>
            {links(x).map((l) => <Badge key={l} text={l} />)}
            {(x.repeat_days ?? []).map((d) => <Badge key={d} text={t.daysShort[d]} color={c.primary} />)}
            {x.reminder_sent ? <Badge text="✉️" /> : null}
          </Row>
        ) : null}
        {subs.length ? (
          <View style={{ gap: 6, paddingStart: 14 }}>
            <Progress value={pct(subDone, subs.length)} height={6} />
            {subs.map((s) => (
              <Row key={s.id}>
                <Check on={!!s.completed} onPress={() => toggle(s)} />
                <Txt style={{ flex: 1, textDecorationLine: s.completed ? 'line-through' : 'none' }}>{s.title}</Txt>
                <IconBtn icon="✕" label={t.c.delete} onPress={() => tasks.remove(s.id)} />
              </Row>
            ))}
          </View>
        ) : null}
        <Row wrap gap={2}>
          <Btn small kind="ghost" title={`✂️ ${t.today.split}`} onPress={() => setSplitId(x.id)} />
          <Btn small kind="ghost" title={`🤖 ${t.c.aiSplit}`} loading={busy === x.id} onPress={() => aiSplit(x)} />
          <IconBtn icon="📅" label={t.c.gcal} onPress={() => exportTask(x)} />
          <IconBtn icon="✉️" label={t.today.remind} onPress={() => remind(x)} />
          <IconBtn icon="⏱" label={t.today.pomodoro} onPress={() => { pomodoro.startSession({ taskId: x.id, taskTitle: x.title, subTasks: subs.filter((s) => !s.completed).map((s) => s.title) }); router.push('/pomodoro'); }} />
          <IconBtn icon="✏️" label={t.c.edit} onPress={() => setForm(x)} />
          <IconBtn icon="🗑" label={t.c.delete} onPress={() => remove(x)} />
        </Row>
      </Card>
    );
  };

  return (
    <Screen>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="sub">{tier.icon} {t.today.tiers[tier.index]}</Txt>
          <Txt v="sub">{points} {t.today.points}</Txt>
        </Row>
        {tier.next ? (
          <>
            <Progress value={pct(points - [0, 100, 300, 600, 1000][tier.index], tier.next - [0, 100, 300, 600, 1000][tier.index])} />
            <Txt v="small">{tier.next - points} {t.today.points} {t.today.nextTier}</Txt>
          </>
        ) : null}
      </Card>

      {highPending ? (
        <Card style={{ borderColor: c.danger }}>
          <Txt color={c.danger}>⚠️ {t.today.highAlert}</Txt>
          {push ? <Txt>{push}</Txt> : null}
          <Btn small title={`💪 ${t.today.motivate}`} onPress={() => setPush(pick(t.pushes))} />
        </Card>
      ) : null}

      <Section title={`${t.nav.today} · ${day}`} right={
        <Row>
          <Btn small kind="ghost" title={t.today.exportIcs} disabled={!dayTasks.length} onPress={() => shareFile(`tasks-${day}.ics`, buildICS(dayTasks), 'text/calendar')} />
          <Btn small title={`+ ${t.today.addTask}`} onPress={() => setForm({ date: day })} />
        </Row>
      }>
        {tasks.loading ? <Loading /> : dayTasks.length ? dayTasks.map(card) : <Empty icon="🗒" text={t.today.empty} />}
      </Section>

      <Section title={`🎯 ${t.today.weeklyGoals}`}>
        {weekly.length ? weekly.map((g) => {
          const linked = tasks.items.filter((x) => x.goal_id === g.id && !x.parent_id);
          return (
            <Card key={g.id} onPress={() => setOpenGoal(openGoal === g.id ? null : g.id)}>
              <Row>
                <Txt style={{ flex: 1, fontWeight: '600' }}>{g.title}</Txt>
                <Badge text={`${linked.filter((x) => x.completed).length}/${linked.length}`} />
                <Txt v="muted">{openGoal === g.id ? '▾' : '▸'}</Txt>
              </Row>
              {openGoal === g.id ? (
                <View style={{ gap: 6 }}>
                  <Txt v="small">{t.today.linkedTasks}</Txt>
                  {linked.map((x) => (
                    <Row key={x.id}>
                      <Check on={!!x.completed} onPress={() => toggle(x)} />
                      <Txt style={{ flex: 1 }}>{x.title}</Txt>
                      <Txt v="small">{x.date}</Txt>
                    </Row>
                  ))}
                  <Btn small kind="ghost" title={`+ ${t.today.addLinked}`} onPress={() => setForm({ date: day, goal_id: g.id })} />
                </View>
              ) : null}
            </Card>
          );
        }) : <Txt v="muted">{t.today.noWeekly}</Txt>}
      </Section>

      <TaskForm visible={!!form} initial={form ?? undefined} onClose={() => setForm(null)} />

      <Sheet visible={!!splitting} onClose={() => setSplitId(null)} title={`✂️ ${t.today.subtasks}: ${splitting?.title ?? ''}`}>
        {splitting ? subsOf(splitting.id).map((s) => (
          <Row key={s.id}>
            <Check on={!!s.completed} onPress={() => toggle(s)} />
            <Txt style={{ flex: 1 }}>{s.title}</Txt>
            <IconBtn icon="✕" label={t.c.delete} onPress={() => tasks.remove(s.id)} />
          </Row>
        )) : null}
        <Row>
          <View style={{ flex: 1 }}><Input placeholder={t.today.addSubtask} value={subTitle} onChangeText={setSubTitle} onSubmitEditing={() => splitting && addSub(splitting, subTitle).then(() => setSubTitle(''))} /></View>
          <Btn title={t.c.add} disabled={!subTitle.trim()} onPress={() => splitting && addSub(splitting, subTitle).then(() => setSubTitle(''))} />
        </Row>
        <Btn kind="ghost" title={`🤖 ${t.c.aiSplit}`} loading={busy === splitting?.id} onPress={() => splitting && aiSplit(splitting)} />
      </Sheet>
    </Screen>
  );
}
