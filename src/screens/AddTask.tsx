import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prioColor, useAI } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { addDays, fmtDate, nowTime, today } from '@/lib/dates';
import { db, useEntity, useKV } from '@/lib/db';
import { CalendarStatus, DeviceEvent, calendarStatus, readDeviceEvents, saveTaskToCalendar } from '@/lib/devicecal';
import { capture } from '@/core/capture';
import { freeSlots } from '@/core/scheduler';
import { fromMinutes, toMinutes } from '@/core/task';
import { BreakdownEditor } from '@/ui/BreakdownEditor';
import { logError } from '@/lib/errlog';
import { Step, breakdownTask, smartTask, suggestTasks } from '@/lib/integrations';
import { addSteps } from '@/lib/steps';
import type { DailyTask, Priority, TaskList } from '@/lib/types';
import { Txt, notice } from '@/ui/kit';
import { DatePickerSheet, TimePickerSheet } from '@/ui/pickers';
import { VoiceToText } from '@/ui/shared';
import { Text, useFontFamily } from '@/ui/text';

const NO_LISTS: TaskList[] = [];
const DURATIONS = [15, 30, 45, 60, 90, 120];
const TIMES = ['09:00', '13:00', '17:00', '20:00'];
const PRIOS: (Priority | undefined)[] = ['high', 'medium', 'low', undefined];
const pad = (n: number) => String(n).padStart(2, '0');
const plus = (hhmm: string, m: number) => {
  const total = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + m;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
};

type InputHandle = { get: () => string; set: (v: string) => void };

// The text box keeps its own state, so typing re-draws this one field and nothing else on the screen.
// The rest of the screen only hears about the text after the typing pauses.
const TitleInput = memo(
  forwardRef<InputHandle, { placeholder: string; onPause: (text: string) => void }>(function TitleInput({ placeholder, onPause }, ref) {
    const c = useTheme();
    const { dir } = useLang();
    const fontFamily = useFontFamily();
    const [value, setValue] = useState('');
    useImperativeHandle(ref, () => ({ get: () => value, set: setValue }), [value]);
    useEffect(() => {
      const id = setTimeout(() => onPause(value), 350);
      return () => clearTimeout(id);
    }, [value, onPause]);
    return (
      <TextInput value={value} onChangeText={setValue} placeholder={placeholder} placeholderTextColor={c.muted} multiline autoFocus
        style={{ minHeight: 64, maxHeight: 150, backgroundColor: c.card, borderRadius: 14, borderWidth: 1.5, borderColor: c.primary, paddingHorizontal: 14, paddingVertical: 12, color: c.text, fontSize: 18, textAlign: dir === 'rtl' ? 'right' : 'left', writingDirection: dir, textAlignVertical: 'top', fontFamily }} />
    );
  }),
);

type Props = { visible: boolean; onClose: () => void; defaultDate: string; listId?: string; goalId?: string };

// The add-task screen: one field to type or speak into, then everything else is a tap.
export function AddTask({ visible, onClose, defaultDate, listId, goalId }: Props) {
  const c = useTheme();
  const { t, lang, dir } = useLang();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ai = useAI();
  const tasks = useEntity('DailyTask').items;
  const goals = useEntity('Goal').items;
  const [lists] = useKV<TaskList[]>('lists', NO_LISTS);
  const [autoSplit, setAutoSplit] = useKV<boolean>('autosplit', true);
  const [autoCal, setAutoCal] = useKV<boolean>('gcal:auto', true);
  const input = useRef<InputHandle>(null);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState<string | undefined>();
  const [minutes, setMinutes] = useState<number | undefined>();
  const [prio, setPrio] = useState<Priority | undefined>();
  const [goal, setGoal] = useState<string | undefined>(goalId);
  const [list, setList] = useState<string | undefined>(listId);
  const [steps, setSteps] = useState<Step[]>([]);
  const [due, setDue] = useState<string | undefined>();
  const [bdErr, setBdErr] = useState('');
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [typed, setTyped] = useState('');
  const [picking, setPicking] = useState<'date' | 'time' | null>(null);
  const [busy, setBusy] = useState<'smart' | 'save' | 'suggest' | 'split' | null>(null);
  const [done, setDone] = useState('');
  const [cal, setCal] = useState<CalendarStatus | null | undefined>(undefined);
  const [aiItems, setAiItems] = useState<string[]>([]);
  const day = today();

  // a fresh form every time the screen opens
  useEffect(() => {
    if (!visible) return;
    setDate(defaultDate);
    setTime(undefined);
    setMinutes(undefined);
    setPrio(undefined);
    setGoal(goalId);
    setList(listId);
    setSteps([]);
    setDue(undefined);
    setBdErr('');
    setDone('');
    setTyped('');
    calendarStatus().then(setCal).catch(() => setCal(null));
  }, [visible, defaultDate, listId, goalId]);

  const openGoals = useMemo(() => goals.filter((g) => g.status !== 'completed' && g.status !== 'cancelled').slice(0, 8), [goals]);
  const dayTasks = useMemo(() => tasks.filter((x) => x.date === date && !x.parent_id && !x.completed), [tasks, date]);

  // the phone calendar's own events of that day count as busy, so a suggested time never sits on a meeting
  useEffect(() => {
    if (!visible || !date) return setEvents([]);
    readDeviceEvents(date, date).then(setEvents).catch((e) => (logError('calendar-read', e), setEvents([])));
  }, [visible, date]);
  // the first gap long enough for the task, after now, between 08:00 and 22:00, around tasks and calendar events
  const freeTime = useMemo(() => {
    if (!date) return undefined;
    const busyIv = [
      ...dayTasks.filter((x) => x.time).map((x) => ({ start: toMinutes(x.time!), end: toMinutes(x.time!) + (x.minutes ?? 30) })),
      ...events.filter((e) => e.date === date).map((e) => (e.allDay ? null : { start: toMinutes(e.time ?? '00:00'), end: e.end ? toMinutes(e.end) : toMinutes(e.time ?? '00:00') + 60 })).filter((x): x is { start: number; end: number } => !!x),
    ];
    const need = minutes ?? 30;
    const gaps = freeSlots(busyIv, '08:00', '22:00', 5, date === day ? nowTime() : undefined);
    const g = gaps.map((x) => ({ start: Math.ceil(x.start / 15) * 15, end: x.end })).find((x) => x.end - x.start >= need);
    return g ? fromMinutes(g.start) : undefined;
  }, [dayTasks, events, date, day, minutes]);

  // what the sentence itself says is shown at once, so there is no doubt about what will be saved
  const parsed = useMemo(() => {
    const first = typed.split('\n').find((l) => l.trim());
    return first ? capture(first, day, openGoals) : null;
  }, [typed, day, openGoals]);
  const onPause = useCallback((text: string) => setTyped(text), []);

  const suggestions = useMemo(() => {
    if (!visible) return [];
    const freq = new Map<string, number>();
    for (const x of tasks) if (!x.parent_id) freq.set(x.title, (freq.get(x.title) ?? 0) + 1);
    const onDay = new Set(dayTasks.map((x) => x.title));
    const mine = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return [...new Set([...aiItems, ...mine, ...t.sug.tasks])].filter((s) => !onDay.has(s)).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, aiItems, dayTasks.length]);

  const fill = (text: string) => {
    input.current?.set(text);
    setTyped(text);
    setSteps([]);
  };

  const arrange = async () => {
    const text = (input.current?.get() ?? '').split('\n').find((l) => l.trim());
    if (!text) return notice(t.add.empty);
    setBusy('smart');
    const s = await ai(() => smartTask(text, { today: day, now: nowTime(), date, busy: dayTasks.filter((x) => x.time).map((x) => `${x.time} ${x.title}`), goals: openGoals.map((g) => g.title) }, lang));
    setBusy(null);
    if (!s) return;
    if (s.title) fill(s.title);
    if (s.date && s.date >= day) setDate(s.date);
    if (s.time) setTime(s.time);
    if (s.minutes) setMinutes(s.minutes);
    if (s.priority) setPrio(s.priority);
    const linked = s.goal && openGoals.find((g) => g.title === s.goal);
    if (linked) setGoal(linked.id);
    const n = s.steps?.length ?? 0;
    setSteps((s.steps ?? []).map((title) => ({ title, minutes: s.minutes && n ? Math.max(5, Math.round(s.minutes / n / 5) * 5) : 15 })));
  };

  // AI steps shown in an editor first; nothing is saved until the task is saved
  const split = async (again = false) => {
    const text = (input.current?.get() ?? '').split('\n').find((l) => l.trim());
    if (!text) return notice(t.add.empty);
    setBusy('split');
    setBdErr('');
    const title = capture(text, day).title;
    const xs = await ai(() => breakdownTask(title, { total: minutes ?? parsed?.minutes, avoid: again ? steps.map((x) => x.title) : undefined }, lang));
    setBusy(null);
    if (xs?.length) setSteps(xs);
    else setBdErr(t.bd.invalid);
  };

  const suggest = async () => {
    setBusy('suggest');
    const items = await ai(() => suggestTasks(openGoals.map((g) => g.title), dayTasks.map((x) => x.title), lang));
    setBusy(null);
    if (items?.length) setAiItems(items);
  };

  const save = async (keepOpen: boolean) => {
    const lines = (input.current?.get() ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return notice(t.add.empty);
    setBusy('save');
    let written = 0;
    let last: DailyTask | undefined;
    try {
      for (const line of lines) {
        // a date, time or priority said in the sentence wins over the chips
        const p = capture(line, day, openGoals);
        // the sentence wins over the chips; «لاحقاً» or an Inbox chip keeps it off the calendar
        const when = p.inbox && !p.understood.includes('date') ? (p.understood.includes('deadline') || /لاحق|later|inbox|بدون موعد|الوارد|someday/i.test(line) ? '' : date) : p.date ?? date;
        const at = when ? p.time ?? time : undefined;
        const length = p.minutes ?? minutes ?? (lines.length === 1 && steps.length ? steps.reduce((n, x) => n + (x.minutes ?? 0), 0) || undefined : undefined);
        const days = p.recurrence?.freq === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : p.recurrence?.days ?? [];
        const made = await db.create('DailyTask', {
          title: p.title.trim() || line, date: when, time: at, end_time: p.end_time ?? (at && length ? plus(at, length) : undefined), minutes: length,
          priority: p.priority ?? prio, goal_id: p.goal_id ?? goal, list_id: list, completed: false, repeat_days: days,
          due_date: p.due_date ?? due, description: p.description, tags: p.tags.length ? p.tags : undefined, reminder_minutes: p.reminder_minutes,
          effort: p.effort, status: when ? 'planned' : 'inbox', source: 'quick_capture', schema_version: 2, version: 1,
        });
        last = made;
        // written to the calendar now, so the confirmation below is the truth
        if (autoCal && made.date && (await saveTaskToCalendar(made).catch((e) => (logError('calendar', e), false)))) written++;
        // steps follow the task: timed one after another when it has a time, each with its own calendar entry
        if (lines.length === 1 && steps.length) await addSteps(made, steps);
        else if (autoSplit)
          breakdownTask(made.title, { total: at ? length ?? 60 : undefined }, lang)
            .then((xs) => addSteps(made, xs))
            .catch((e) => logError('auto-split', e));
      }
    } finally {
      setBusy(null);
    }
    const head = lines.length === 1 ? `${t.add.saved}: ${last?.title ?? ''}` : t.add.savedMany.replace('{n}', String(lines.length));
    const dated = lines.length - (last && !last.date && lines.length === 1 ? 1 : 0);
    const tail = !autoCal || !dated ? (last && !last.date ? ` · 📥 ${t.tasks.inbox}` : '') : written === dated ? ` · ${t.add.inCal} ${cal?.name ?? ''}` : ` · ${t.add.notInCal}`;
    if (!keepOpen) return onClose();
    setDone(head + tail);
    fill('');
    setTime(undefined);
    setMinutes(undefined);
    setAiItems((xs) => xs.filter((x) => !lines.includes(x)));
  };

  const chip = (key: string, label: string, on: boolean, press: () => void, color?: string) => (
    <Pressable key={key} onPress={press} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: on ? color ?? c.primary : c.card, borderWidth: 1, borderColor: on ? color ?? c.primary : c.border }}>
      <Text style={{ color: on ? '#fff' : color ?? c.text, fontSize: 14, fontWeight: on ? '700' : '400' }}>{label}</Text>
    </Pressable>
  );
  const group = (title: string, children: React.ReactNode) => (
    <View style={{ gap: 8 }}>
      <Txt v="muted">{title}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
  const quickDates = [day, addDays(day, 1), addDays(day, 2), addDays(day, 7)];
  const dateLabels = [t.c.today, t.c.tomorrow, t.add.afterTomorrow, t.add.nextWeek];
  const calLine = cal === undefined ? '' : !autoCal ? t.add.calOff : !cal ? t.add.calNone : cal.google ? `${t.add.calTo} ${cal.name}` : t.add.calNotGoogle;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg, direction: dir, paddingTop: insets.top }}>
        {/* the save buttons live at the top, where the keyboard can never cover them */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 56, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.c.close} style={{ padding: 4 }}><Ionicons name="close" size={26} color={c.text} /></Pressable>
          <Txt v="sub" style={{ flex: 1 }}>{t.add.title}</Txt>
          <Pressable onPress={() => save(true)} disabled={busy === 'save'} accessibilityRole="button" style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.primary }}>
            <Text style={{ color: c.primary, fontSize: 14 }}>{t.add.saveMore}</Text>
          </Pressable>
          <Pressable onPress={() => save(false)} disabled={busy === 'save'} accessibilityRole="button" style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: c.primary, opacity: busy === 'save' ? 0.5 : 1 }}>
            <Text style={{ color: c.onPrimary, fontSize: 15, fontWeight: '700' }}>{t.add.save}</Text>
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 14, gap: 16, paddingBottom: insets.bottom + 300 }}>
          {done ? <Txt color={c.success}>{done}</Txt> : null}

          <View style={{ gap: 8 }}>
            <TitleInput ref={input} placeholder={t.add.what} onPause={onPause} />
            <Txt v="small">{t.add.multi}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <VoiceToText onText={(v) => v && fill(v)} />
              <Pressable onPress={arrange} disabled={!!busy} accessibilityRole="button" style={{ flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: c.onPrimary, fontSize: 15, fontWeight: '700' }}>{busy === 'smart' ? t.add.smartBusy : t.add.smart}</Text>
              </Pressable>
            </View>
            <Txt v="small">{t.add.smartHint}</Txt>
            {parsed && parsed.understood.length ? (
              <Txt v="small" color={c.primary}>
                ✨ {t.nlp.understood}: {[
                  parsed.date && `📅 ${fmtDate(parsed.date, lang, t.c)}`, parsed.time && `🕐 ${parsed.time}${parsed.end_time ? `–${parsed.end_time}` : ''}`, parsed.minutes && `⏱ ${parsed.minutes}`,
                  parsed.priority && `🚩 ${t.prio[parsed.priority]}`, parsed.due_date && `⏳ ${fmtDate(parsed.due_date, lang, t.c)}`, parsed.recurrence && `🔁 ${parsed.recurrence.freq}`,
                  parsed.reminder_minutes && `⏰ ${parsed.reminder_minutes[0]}`, parsed.tags.length && parsed.tags.map((x) => `#${x}`).join(' '), parsed.project && `+${parsed.project}`,
                  parsed.goal_id && `🎯 ${openGoals.find((g) => g.id === parsed.goal_id)?.title ?? ''}`, !parsed.date && parsed.inbox && '📥',
                ].filter(Boolean).join('  ')}
              </Txt>
            ) : null}
            <Pressable onPress={() => split(false)} disabled={!!busy} accessibilityRole="button" style={{ paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.primary, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
              <Text style={{ color: c.primary, fontSize: 15, fontWeight: '700' }}>{busy === 'split' ? t.c.aiWorking : t.bd.make}</Text>
            </Pressable>
          </View>

          {steps.length || bdErr ? <BreakdownEditor steps={steps} onChange={setSteps} onRegenerate={() => split(true)} busy={busy === 'split'} error={bdErr} /> : null}

          {group(t.add.when, [
            chip('inbox', t.cap.inbox, !date, () => { setDate(''); setTime(undefined); }),
            ...quickDates.map((d, i) => chip(d, dateLabels[i], date === d, () => setDate(d))),
            chip('other', !date || quickDates.includes(date) ? t.add.otherDate : `📅 ${fmtDate(date, lang, t.c, true)}`, !!date && !quickDates.includes(date), () => setPicking('date')),
          ])}

          {group(t.due.label, [
            chip('nodue', t.due.none, !due, () => setDue(undefined)),
            ...[[day, t.c.today], [addDays(day, 1), t.c.tomorrow], [addDays(day, 3), t.due.in3], [addDays(day, 7), t.add.nextWeek]].map(([d, l]) => chip(`due${d}`, `⏳ ${l}`, due === d, () => setDue(due === d ? undefined : d), c.warn)),
          ])}

          {date ? group(t.add.time, [
            chip('none', t.add.noTime, !time, () => setTime(undefined)),
            ...(freeTime ? [chip('free', `${t.add.free} ${freeTime}`, time === freeTime, () => setTime(freeTime))] : []),
            ...TIMES.filter((x) => x !== freeTime).map((x) => chip(x, x, time === x, () => setTime(x))),
            chip('othertime', time && time !== freeTime && !TIMES.includes(time) ? `🕐 ${time}` : t.add.otherTime, !!time && time !== freeTime && !TIMES.includes(time), () => setPicking('time')),
          ]) : null}
          {date && events.length ? <Txt v="small">📅 {t.cap.busyNote}</Txt> : null}

          {group(t.add.duration, DURATIONS.map((m) => chip(String(m), String(m), minutes === m, () => setMinutes(minutes === m ? undefined : m))))}

          {group(t.add.priority, PRIOS.map((p) => chip(p ?? 'none', p ? t.prio[p] : t.tasks.noPrio, prio === p, () => setPrio(p), prioColor(c, p))))}

          {openGoals.length ? group(t.add.goal, openGoals.map((g) => chip(g.id, g.title, goal === g.id, () => setGoal(goal === g.id ? undefined : g.id)))) : null}

          {lists.length ? group(t.add.list, [chip('inbox', `📥 ${t.tasks.inbox}`, !list, () => setList(undefined)), ...lists.map((l) => chip(l.id, l.name, list === l.id, () => setList(l.id), l.color))]) : null}

          <View style={{ gap: 8 }}>
            {chip('split', `${autoSplit ? '✓ ' : ''}${t.add.split}`, autoSplit, () => setAutoSplit(!autoSplit))}
            {calLine ? (
              <Pressable accessibilityRole="button" onPress={() => (cal?.google ? setAutoCal(!autoCal) : !autoCal ? setAutoCal(true) : (onClose(), router.push('/profile-settings')))}
                style={{ padding: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: autoCal && cal?.google ? c.success : c.warn }}>
                <Text style={{ color: autoCal && cal?.google ? c.success : c.warn, fontSize: 14 }}>{autoCal && cal?.google ? '✓ ' : ''}{calLine}</Text>
              </Pressable>
            ) : null}
          </View>

          {group(t.add.suggestions, [
            chip('ai', busy === 'suggest' ? t.c.aiWorking : t.sug.suggestAI, true, suggest),
            ...suggestions.map((s) => chip(`sg:${s}`, s, false, () => fill(s))),
          ])}
        </ScrollView>

        <DatePickerSheet visible={picking === 'date'} value={date || day} onChange={(v) => v && setDate(v)} onClose={() => setPicking(null)} allowClear={false} />
        <TimePickerSheet visible={picking === 'time'} value={time} onChange={setTime} onClose={() => setPicking(null)} />
      </View>
    </Modal>
  );
}
