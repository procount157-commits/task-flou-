import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { memo, useEffect, useMemo, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, TextInput, View } from 'react-native';

import { TaskForm } from './forms';
import { StepRunner, TimeboxPanel } from './Timebox';
import { useAuth } from '@/ctx/Auth';
import { Colors, useLang, useTheme } from '@/ctx/Lang';
import { usePomodoro } from '@/ctx/Pomodoro';
import { addDays, fmtDate, today } from '@/lib/dates';
import { db, useEntity, useKV } from '@/lib/db';
import { autoSyncTask, removeTaskFromCalendar, saveTaskToCalendar } from '@/lib/devicecal';
import { exportTask } from '@/lib/gcal';
import { NoKeyError, SendEmail, splitTask, suggestTasks } from '@/lib/integrations';
import { addPoints, POINTS } from '@/lib/logic';
import { parseTask } from '@/lib/nlp';
import type { DailyTask, Priority, TaskList } from '@/lib/types';

const NO_LISTS: TaskList[] = [];
import { logError } from '@/lib/errlog';
import { Btn, Chips, Input, Progress, Row, Sheet, Suggest, Toggle, Txt, confirm, notice, opts } from '@/ui/kit';
import { DateField, DatePickerSheet, TimeField } from '@/ui/pickers';
import { DaysPicker, VoiceToText, useCelebrate, useUndo } from '@/ui/shared';
import { Text, useFontFamily } from '@/ui/text';

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

export type PostponeTo = 'hour' | 'tonight' | 'tomorrow' | 'dayAfter' | 'nextWeek' | { date: string };
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// Where a postponed task lands: the clock moves by an hour, or the task moves to another day keeping its time.
export function postponed(task: DailyTask, to: PostponeTo): Pick<DailyTask, 'date' | 'time' | 'end_time'> {
  const day = today();
  if (to === 'hour') {
    const base = task.time && task.date === day ? new Date(`${day}T${task.time}:00`) : new Date();
    const next = new Date(Math.max(base.getTime(), Date.now()) + 60 * 60000);
    next.setMinutes(next.getMinutes() < 30 ? 0 : 30, 0, 0);
    const shift = task.time && task.end_time ? (new Date(`${day}T${task.end_time}:00`).getTime() - new Date(`${day}T${task.time}:00`).getTime()) : 0;
    return { date: ymdLocal(next), time: hhmm(next), end_time: shift > 0 ? hhmm(new Date(next.getTime() + shift)) : task.end_time };
  }
  if (to === 'tonight') return { date: day, time: '20:00', end_time: task.end_time };
  const date = typeof to === 'object' ? to.date : addDays(day, to === 'tomorrow' ? 1 : to === 'dayAfter' ? 2 : 7);
  return { date, time: task.time, end_time: task.end_time };
}
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function useTaskActions() {
  const celebrate = useCelebrate();
  const undo = useUndo();
  const { t } = useLang();
  return useMemo(() => {
    const snapshot = async (ids: Set<string>) => (await db.list('DailyTask')).filter((x) => ids.has(x.id) || (!!x.parent_id && ids.has(x.parent_id)));
    return {
      toggle: async (task: DailyTask) => {
        const done = !task.completed;
        await db.update('DailyTask', task.id, { completed: done });
        // subtasks carry no points of their own
        const pts = POINTS[task.priority ?? 'medium'];
        if (!task.parent_id) await addPoints(done ? pts : -pts);
        if (done && !task.parent_id) {
          if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          undo(`✓ ${task.title}`, async () => {
            await db.update('DailyTask', task.id, { completed: false });
            await addPoints(-pts);
          });
        }
        autoSyncTask(task.id);
      },
      remove: async (task: DailyTask) => {
        const before = await snapshot(new Set([task.id]));
        await removeTaskFromCalendar(task);
        await db.removeWhere('DailyTask', (x) => x.id === task.id || x.parent_id === task.id);
        undo(`🗑 ${task.title}`, async () => {
          await db.restore('DailyTask', before.map((x) => ({ ...x, calendar_event_id: undefined })));
          autoSyncTask(task.id);
        });
      },
      // several tasks at once; one undo puts every one of them back where it was
      postpone: async (list: DailyTask[], to: PostponeTo) => {
        const before = await snapshot(new Set(list.map((x) => x.id)));
        for (const task of list) {
          const p = postponed(task, to);
          await db.update('DailyTask', task.id, p);
          if (p.date !== task.date) for (const sub of before.filter((x) => x.parent_id === task.id)) await db.update('DailyTask', sub.id, { date: p.date });
          autoSyncTask(task.id);
        }
        undo(`📅 ${t.undo.moved.replace('{n}', String(list.length))}`, async () => {
          await db.restore('DailyTask', before);
          for (const task of list) autoSyncTask(task.id);
        });
      },
      completeMany: async (list: DailyTask[]) => {
        const before = await snapshot(new Set(list.map((x) => x.id)));
        for (const task of list) if (!task.completed) await db.update('DailyTask', task.id, { completed: true });
        await addPoints(list.filter((x) => !x.completed).reduce((a, x) => a + POINTS[x.priority ?? 'medium'], 0));
        undo(`✓ ${t.undo.done.replace('{n}', String(list.length))}`, () => db.restore('DailyTask', before));
      },
      removeMany: async (list: DailyTask[]) => {
        const ids = new Set(list.map((x) => x.id));
        const before = await snapshot(ids);
        for (const task of list) await removeTaskFromCalendar(task);
        await db.removeWhere('DailyTask', (x) => ids.has(x.id) || (!!x.parent_id && ids.has(x.parent_id)));
        undo(`🗑 ${t.undo.deleted.replace('{n}', String(list.length))}`, () => db.restore('DailyTask', before.map((x) => ({ ...x, calendar_event_id: undefined }))));
      },
    };
  }, [celebrate, undo, t]);
}

type RowProps = { task: DailyTask; subDone: number; subTotal: number; showDate?: boolean; onToggle: (t: DailyTask) => void; onOpen: (t: DailyTask) => void; selecting?: boolean; selected?: boolean };

// One line per task: a round box in the priority colour, the title, and the time or date at the far end.
export const TaskRow = memo(function TaskRow({ task, subDone, subTotal, showDate, onToggle, onOpen, selecting, selected }: RowProps) {
  const c = useTheme();
  const { t, lang, dir } = useLang();
  const color = prioColor(c, task.priority);
  const late = !task.completed && task.date < today();
  const meta = [showDate || late ? fmtDate(task.date, lang, t.c) : '', task.time].filter(Boolean).join(' ');
  return (
    <Pressable onPress={() => onOpen(task)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: selected ? c.soft : c.card, borderBottomWidth: 1, borderColor: c.border }}>
      {selecting ? <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? c.primary : c.muted} /> : null}
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

const addMinutes = (hhmm: string, m: number) => {
  const total = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + m;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

function Chip({ text, color }: { text: string; color?: string }) {
  const c = useTheme();
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: c.soft, borderWidth: color ? 1 : 0, borderColor: color }}>
      <Text style={{ fontSize: 12, color: color ?? c.primary }}>{text}</Text>
    </View>
  );
}

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
  const [autoSplit, setAutoSplit] = useKV<boolean>('autosplit', true);
  const [pickDate, setPickDate] = useState(false);
  const [aiItems, setAiItems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastAdded, setLastAdded] = useState<{ title: string; date: string; time?: string } | null>(null);

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

  // what the sentence itself says (date, time, priority, length) wins over the pickers
  const parsed = useMemo(() => (title.trim() ? parseTask(title, today()) : null), [title]);
  const add = async (text: string) => {
    const p = parseTask(text, today());
    const clean = p.title.trim();
    if (!clean) return;
    const end = p.time && p.minutes ? addMinutes(p.time, p.minutes) : undefined;
    const made = await db.create('DailyTask', { title: clean, date: p.date ?? date, time: p.time, end_time: end, priority: p.priority ?? prio, completed: false, repeat_days: [], list_id: list });
    setTitle('');
    setAiItems((xs) => xs.filter((x) => x !== clean));
    autoSyncTask(made.id);
    setLastAdded({ title: clean, date: p.date ?? date, time: p.time });
    // the breakdown arrives a moment later as subtasks under the new task; a missing key just skips it
    if (autoSplit)
      splitTask(clean, lang)
        .then((steps) => db.bulkCreate('DailyTask', steps.map((s) => ({ title: s, date, parent_id: made.id, priority: prio, completed: false }))))
        .catch((e) => logError('auto-split', e));
  };

  const askAI = async () => {
    setBusy(true);
    const items = await ai(() => suggestTasks(goals.filter((g) => g.status !== 'completed' && g.status !== 'cancelled').map((g) => g.title), tasks.filter((x) => x.date === date).map((x) => x.title), lang));
    setBusy(false);
    if (items?.length) setAiItems(items);
  };

  const cycle: (Priority | undefined)[] = [undefined, 'high', 'medium', 'low'];
  const fontFamily = useFontFamily();
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
          style={{ flex: 1, backgroundColor: c.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: c.text, fontSize: 15, textAlign: dir === 'rtl' ? 'right' : 'left', writingDirection: dir, fontFamily }} />
        <VoiceToText compact onText={(v) => v && add(v)} />
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
      {parsed && (parsed.date || parsed.time || parsed.priority || parsed.minutes) ? (
        <Row wrap gap={6}>
          <Txt v="small" color={c.primary}>✨ {t.nlp.understood}:</Txt>
          {parsed.date ? <Chip text={`📅 ${fmtDate(parsed.date, lang, t.c)}`} /> : null}
          {parsed.time ? <Chip text={`🕐 ${parsed.time}${parsed.minutes ? `–${addMinutes(parsed.time, parsed.minutes)}` : ''}`} /> : null}
          {!parsed.time && parsed.minutes ? <Chip text={`⏱ ${parsed.minutes} ${t.timebox.min}`} /> : null}
          {parsed.priority ? <Chip text={`🚩 ${t.prio[parsed.priority]}`} color={prioColor(c, parsed.priority)} /> : null}
        </Row>
      ) : (
        <Txt v="small">💡 {t.nlp.hint}</Txt>
      )}
      {lastAdded ? <Txt v="small" color={c.success}>✓ {lastAdded.title} · {fmtDate(lastAdded.date, lang, t.c)}{lastAdded.time ? ` ${lastAdded.time}` : ''}</Txt> : null}
      <Toggle label={t.sug.autoSplit} value={autoSplit} onChange={setAutoSplit} />
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
  const [running, setRunning] = useState(false);

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
          {s.minutes ? <Txt v="small" color={c.primary}>{s.time ? `${s.time} · ` : ''}{s.minutes} {t.timebox.min}</Txt> : null}
          <Txt style={{ flex: 1, textDecorationLine: s.completed ? 'line-through' : 'none' }} color={s.completed ? c.muted : c.text}>{s.title}</Txt>
          <Pressable onPress={() => tasks.remove(s.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.c.delete}><Ionicons name="close" size={18} color={c.muted} /></Pressable>
        </Row>
      ))}
      <Row>
        <View style={{ flex: 1 }}><Input placeholder={t.today.addSubtask} value={sub} onChangeText={setSub} onSubmitEditing={() => addSub(sub)} /></View>
        <Btn small title={t.c.add} disabled={!sub.trim()} onPress={() => addSub(sub)} />
      </Row>
      <Btn kind="ghost" title={`🤖 ${t.c.aiSplit}`} loading={busy} onPress={aiSplit} />
      <TimeboxPanel task={task} steps={subs} onRun={() => setRunning(true)} />
      {running ? <StepRunner task={task} steps={subs} onClose={() => setRunning(false)} /> : null}

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

// A subtask shown indented under its parent in the list, ticked in place.
export const SubRow = memo(function SubRow({ task, onToggle }: { task: DailyTask; onToggle: (t: DailyTask) => void }) {
  const c = useTheme();
  const { dir } = useLang();
  return (
    <Pressable onPress={() => onToggle(task)} accessibilityRole="checkbox" accessibilityState={{ checked: !!task.completed }} accessibilityLabel={task.title}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 14, paddingStart: 48, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
      <Ionicons name={task.completed ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={task.completed ? c.muted : c.primary} />
      <Text numberOfLines={2} style={{ flex: 1, color: task.completed ? c.muted : c.text, fontSize: 13, textDecorationLine: task.completed ? 'line-through' : 'none', textAlign: dir === 'rtl' ? 'right' : 'left', writingDirection: dir }}>{task.title}</Text>
    </Pressable>
  );
});
