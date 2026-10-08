import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { TaskForm } from './forms';
import { useAuth } from '@/ctx/Auth';
import { Colors, useLang, useTheme } from '@/ctx/Lang';
import { usePomodoro } from '@/ctx/Pomodoro';
import { fmtDate, today } from '@/lib/dates';
import { db, useEntity, useKV } from '@/lib/db';
import { autoSyncTask, removeTaskFromCalendar, saveTaskToCalendar } from '@/lib/devicecal';
import { exportTask } from '@/lib/gcal';
import { NoKeyError, SendEmail, splitTask, suggestTasks } from '@/lib/integrations';
import { addPoints, POINTS } from '@/lib/logic';
import type { DailyTask, Priority, TaskList } from '@/lib/types';

const NO_LISTS: TaskList[] = [];
import { Btn, Chips, Input, Progress, Row, Sheet, Suggest, Txt, confirm, notice, opts } from '@/ui/kit';
import { DateField, DatePickerSheet, TimeField } from '@/ui/pickers';
import { DaysPicker, useCelebrate } from '@/ui/shared';

export const prioColor = (c: Colors, p?: Priority) => (p === 'high' ? c.danger : p === 'medium' ? c.warn : p === 'low' ? c.primary : c.muted);

// Shared by every "ask the AI" button: explains a missing key instead of failing silently.
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

export function useTaskActions() {
  const celebrate = useCelebrate();
  return useMemo(
    () => ({
      toggle: async (task: DailyTask) => {
        const done = !task.completed;
        await db.update('DailyTask', task.id, { completed: done });
        // subtasks carry no points of their own
        if (!task.parent_id) await addPoints(done ? POINTS[task.priority ?? 'medium'] : -POINTS[task.priority ?? 'medium']);
        if (done && !task.parent_id) celebrate(undefined, 2200);
      },
      remove: async (task: DailyTask) => {
        await removeTaskFromCalendar(task);
        await db.removeWhere('DailyTask', (x) => x.id === task.id || x.parent_id === task.id);
      },
    }),
    [celebrate],
  );
}

type RowProps = { task: DailyTask; subDone: number; subTotal: number; showDate?: boolean; onToggle: (t: DailyTask) => void; onOpen: (t: DailyTask) => void };

// One line per task: a round box in the priority colour, the title, and the time or date at the far end.
export const TaskRow = memo(function TaskRow({ task, subDone, subTotal, showDate, onToggle, onOpen }: RowProps) {
  const c = useTheme();
  const { t, lang, dir } = useLang();
  const color = prioColor(c, task.priority);
  const late = !task.completed && task.date < today();
  const meta = [showDate || late ? fmtDate(task.date, lang, t.c) : '', task.time].filter(Boolean).join(' ');
  return (
    <Pressable onPress={() => onOpen(task)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
      <Pressable onPress={() => onToggle(task)} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: !!task.completed }} accessibilityLabel={task.title}
        style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: task.completed ? c.muted : color, backgroundColor: task.completed ? c.muted : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {task.completed ? <Ionicons name="checkmark" size={15} color={c.card} /> : null}
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ color: task.completed ? c.muted : c.text, fontSize: 15, textDecorationLine: task.completed ? 'line-through' : 'none', textAlign: dir === 'rtl' ? 'right' : 'left', writingDirection: dir }}>{task.title}</Text>
        {subTotal || task.repeat_days?.length || task.goal_id || task.habit_id ? (
          <Row gap={8}>
            {subTotal ? <Row gap={3}><Ionicons name="list-outline" size={12} color={c.muted} /><Txt v="small">{subDone}/{subTotal}</Txt></Row> : null}
            {task.repeat_days?.length || task.repeat_source_id ? <Ionicons name="repeat" size={12} color={c.muted} /> : null}
            {task.goal_id ? <Txt v="small">🎯</Txt> : null}
            {task.habit_id ? <Txt v="small">🔥</Txt> : null}
            {task.content_id ? <Txt v="small">📱</Txt> : null}
            {task.learning_id ? <Txt v="small">🎓</Txt> : null}
          </Row>
        ) : null}
      </View>
      {meta ? <Txt v="small" color={late ? c.danger : c.muted}>{meta}</Txt> : null}
    </Pressable>
  );
});

// The bar pinned above the tab bar: suggestions to tap, or a title to type, plus date and priority.
export function QuickAdd({ defaultDate, extraSuggestions = [], listId }: { defaultDate: string; extraSuggestions?: string[]; listId?: string }) {
  const c = useTheme();
  const { t, lang, dir } = useLang();
  const ai = useAI();
  const tasks = useEntity('DailyTask').items;
  const goals = useEntity('Goal').items;
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [prio, setPrio] = useState<Priority | undefined>(undefined);
  const [lists] = useKV<TaskList[]>('lists', NO_LISTS);
  const [list, setList] = useState<string | undefined>(listId);
  const [pickDate, setPickDate] = useState(false);
  const [aiItems, setAiItems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDate(defaultDate), [defaultDate]);
  useEffect(() => setList(listId), [listId]);

  // most-used titles first, then the ready-made list; anything already on that day is left out
  const suggestions = useMemo(() => {
    const freq = new Map<string, number>();
    for (const x of tasks) if (!x.parent_id) freq.set(x.title, (freq.get(x.title) ?? 0) + 1);
    const onDay = new Set(tasks.filter((x) => x.date === date).map((x) => x.title));
    const mine = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return [...new Set([...aiItems, ...extraSuggestions, ...mine, ...t.sug.tasks])].filter((s) => !onDay.has(s)).slice(0, 14);
  }, [tasks, date, aiItems, extraSuggestions, t]);

  const add = async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const made = await db.create('DailyTask', { title: clean, date, priority: prio, completed: false, repeat_days: [], list_id: list });
    setTitle('');
    setAiItems((xs) => xs.filter((x) => x !== clean));
    autoSyncTask(made.id);
  };

  const askAI = async () => {
    setBusy(true);
    const items = await ai(() => suggestTasks(goals.filter((g) => g.status !== 'completed' && g.status !== 'cancelled').map((g) => g.title), tasks.filter((x) => x.date === date).map((x) => x.title), lang));
    setBusy(false);
    if (items?.length) setAiItems(items);
  };

  const cycle: (Priority | undefined)[] = [undefined, 'high', 'medium', 'low'];
  return (
    <View style={{ gap: 10, direction: dir }}>
      {lists.length ? <Chips scroll options={[{ value: '', label: `📥 ${t.tasks.inbox}` }, ...lists.map((l) => ({ value: l.id, label: l.name }))]} value={list ?? ''} onChange={(v) => setList(v || undefined)} /> : null}
      <Row gap={6}>
        <Pressable onPress={askAI} disabled={busy} accessibilityRole="button" accessibilityLabel={t.sug.suggestAI} style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: c.primary, opacity: busy ? 0.5 : 1 }}>
          <Text style={{ color: c.onPrimary, fontSize: 13 }}>{busy ? t.c.aiWorking : t.sug.suggestAI}</Text>
        </Pressable>
        {aiItems.length > 1 ? (
          <Pressable onPress={async () => { for (const x of aiItems) await add(x); }} accessibilityRole="button" style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: c.success }}>
            <Text style={{ color: '#fff', fontSize: 13 }}>{t.sug.addAll} ({aiItems.length})</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}><Suggest items={suggestions} onPick={add} /></View>
      </Row>
      <Row gap={6}>
        <TextInput value={title} onChangeText={setTitle} placeholder={t.tasks.addTitle} placeholderTextColor={c.muted} onSubmitEditing={() => add(title)} submitBehavior="submit" returnKeyType="done"
          style={{ flex: 1, backgroundColor: c.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: c.text, fontSize: 15, textAlign: dir === 'rtl' ? 'right' : 'left', writingDirection: dir }} />
        <Pressable onPress={() => setPickDate(true)} accessibilityRole="button" accessibilityLabel={t.c.pickDate} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 10, backgroundColor: c.soft }}>
          <Ionicons name="calendar-outline" size={17} color={c.primary} />
          <Text style={{ color: c.primary, fontSize: 12 }}>{fmtDate(date, lang, t.c)}</Text>
        </Pressable>
        <Pressable onPress={() => setPrio(cycle[(cycle.indexOf(prio) + 1) % 4])} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${t.c.priority}: ${prio ? t.prio[prio] : t.tasks.noPrio}`} style={{ padding: 8 }}>
          <Ionicons name={prio ? 'flag' : 'flag-outline'} size={19} color={prioColor(c, prio)} />
        </Pressable>
        <Pressable onPress={() => add(title)} disabled={!title.trim()} hitSlop={6} accessibilityRole="button" accessibilityLabel={t.c.add} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', opacity: title.trim() ? 1 : 0.4 }}>
          <Ionicons name="arrow-up" size={20} color={c.onPrimary} />
        </Pressable>
      </Row>
      <DatePickerSheet visible={pickDate} value={date} onChange={(v) => setDate(v ?? defaultDate)} onClose={() => setPickDate(false)} allowClear={false} />
    </View>
  );
}

// Everything about one task, edited in place: each change is saved as it is made.
export function TaskDetail({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const c = useTheme();
  const { t, lang } = useLang();
  const router = useRouter();
  const { user } = useAuth();
  const ai = useAI();
  const pomodoro = usePomodoro();
  const { toggle, remove } = useTaskActions();
  const tasks = useEntity('DailyTask');
  const task = tasks.items.find((x) => x.id === taskId);
  const subs = tasks.items.filter((x) => x.parent_id === taskId);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [sub, setSub] = useState('');
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    setTitle(task?.title ?? '');
    setNotes(task?.notes ?? '');
    setSub('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  if (!task) return <Sheet visible={false} onClose={onClose} />;
  const patch = async (p: Partial<DailyTask>) => {
    await tasks.update(task.id, p);
    if ('date' in p || 'time' in p || 'end_time' in p || 'title' in p) autoSyncTask(task.id);
  };
  // straight into the phone's calendar; the web link is only the fallback
  const toCalendar = async () => {
    const ok = await saveTaskToCalendar(task).catch(() => false);
    if (ok) notice(t.cal.added);
    else exportTask(task);
  };
  const saveText = () => {
    if (title.trim() && (title.trim() !== task.title || notes !== (task.notes ?? ''))) patch({ title: title.trim(), notes });
  };
  const close = () => {
    saveText();
    onClose();
  };
  const addSub = async (text: string) => {
    if (!text.trim()) return;
    await tasks.create({ title: text.trim(), date: task.date, parent_id: task.id, priority: task.priority, completed: false });
    setSub('');
  };
  const aiSplit = async () => {
    setBusy(true);
    const steps = await ai(() => splitTask(task.title, lang));
    if (steps?.length) await db.bulkCreate('DailyTask', steps.map((s) => ({ title: s, date: task.date, parent_id: task.id, priority: task.priority, completed: false })));
    setBusy(false);
  };
  const remind = async () => {
    await SendEmail({ to: user?.email ?? '', subject: `${t.today.reminderSubject}: ${task.title}`, body: `${task.title}\n${task.date}${task.time ? ' ' + task.time : ''}\n${t.c.priority}: ${t.prio[task.priority ?? 'medium']}` });
    patch({ reminder_sent: true });
  };
  const action = (icon: keyof typeof Ionicons.glyphMap, label: string, run: () => void, color = c.primary) => (
    <Pressable key={label} onPress={run} accessibilityRole="button" style={{ alignItems: 'center', gap: 3, flex: 1, paddingVertical: 6 }}>
      <Ionicons name={icon} size={21} color={color} />
      <Text style={{ color: c.muted, fontSize: 11, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
  const subDone = subs.filter((s) => s.completed).length;

  return (
    <Sheet visible onClose={close} title={task.completed ? `✓ ${t.c.completed}` : fmtDate(task.date, lang, t.c, true)}>
      <Input value={title} onChangeText={setTitle} onBlur={saveText} multiline style={{ minHeight: 44, fontSize: 17, fontWeight: '600' }} />
      <Row>
        <View style={{ flex: 1 }}><DateField value={task.date} onChange={(v) => v && patch({ date: v })} allowClear={false} /></View>
        <View style={{ flex: 1 }}><TimeField value={task.time} onChange={(v) => patch({ time: v })} /></View>
      </Row>
      <Chips options={[...opts(t.prio).reverse(), { value: '' as const, label: t.tasks.noPrio }]} value={task.priority ?? ''} onChange={(p) => patch({ priority: p || undefined })} />

      <Txt v="muted">{t.today.subtasks}{subs.length ? ` · ${subDone}/${subs.length}` : ''}</Txt>
      {subs.length ? <Progress value={(subDone / subs.length) * 100} height={5} /> : null}
      {subs.map((s) => (
        <Row key={s.id}>
          <Pressable onPress={() => toggle(s)} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: !!s.completed }} accessibilityLabel={s.title}>
            <Ionicons name={s.completed ? 'checkbox' : 'square-outline'} size={22} color={s.completed ? c.muted : c.primary} />
          </Pressable>
          <Txt style={{ flex: 1, textDecorationLine: s.completed ? 'line-through' : 'none' }} color={s.completed ? c.muted : c.text}>{s.title}</Txt>
          <Pressable onPress={() => tasks.remove(s.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.c.delete}><Ionicons name="close" size={18} color={c.muted} /></Pressable>
        </Row>
      ))}
      <Row>
        <View style={{ flex: 1 }}><Input placeholder={t.today.addSubtask} value={sub} onChangeText={setSub} onSubmitEditing={() => addSub(sub)} /></View>
        <Btn small title={t.c.add} disabled={!sub.trim()} onPress={() => addSub(sub)} />
      </Row>
      <Btn kind="ghost" title={`🤖 ${t.c.aiSplit}`} loading={busy} onPress={aiSplit} />

      <Txt v="muted">{t.today.repeat}</Txt>
      <DaysPicker value={task.repeat_days ?? []} onChange={(repeat_days) => patch({ repeat_days })} emptyLabel={t.c.none} />
      <TimeField label={t.c.endTime} value={task.end_time} onChange={(v) => patch({ end_time: v })} />
      <Input label={t.tasks.notes} value={notes} onChangeText={setNotes} onBlur={saveText} multiline />

      <Row gap={0}>
        {action('timer-outline', t.today.pomodoro, () => { close(); pomodoro.startSession({ taskId: task.id, taskTitle: task.title, subTasks: subs.filter((s) => !s.completed).map((s) => s.title) }); router.push('/pomodoro'); })}
        {action(task.calendar_event_id ? 'calendar' : 'calendar-outline', t.c.gcal, toCalendar)}
        {action('mail-outline', t.today.remind, remind)}
        {action('link-outline', t.tasks.moreOptions, () => setFull(true))}
        {action('trash-outline', t.c.delete, () => confirm(t.c.confirmDelete, () => { onClose(); remove(task); }, t.c.delete, t.c.cancel), c.danger)}
      </Row>
      <Btn title={task.completed ? t.c.pending : `✓ ${t.c.done}`} kind={task.completed ? 'ghost' : 'primary'} onPress={() => { toggle(task); close(); }} />
      <TaskForm visible={full} initial={task} onClose={() => setFull(false)} />
    </Sheet>
  );
}
