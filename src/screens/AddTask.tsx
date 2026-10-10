import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prioColor, useAI } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { addDays, fmtDate, nowTime, today } from '@/lib/dates';
import { db, useEntity, useKV } from '@/lib/db';
import { CalendarStatus, calendarStatus, saveTaskToCalendar } from '@/lib/devicecal';
import { logError } from '@/lib/errlog';
import { smartTask, splitTask, suggestTasks, timeboxTask } from '@/lib/integrations';
import { parseTask } from '@/lib/nlp';
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
  const [steps, setSteps] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [picking, setPicking] = useState<'date' | 'time' | null>(null);
  const [busy, setBusy] = useState<'smart' | 'save' | 'suggest' | null>(null);
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
    setDone('');
    setTyped('');
    calendarStatus().then(setCal).catch(() => setCal(null));
  }, [visible, defaultDate, listId, goalId]);

  const openGoals = useMemo(() => goals.filter((g) => g.status !== 'completed' && g.status !== 'cancelled').slice(0, 8), [goals]);
  const dayTasks = useMemo(() => tasks.filter((x) => x.date === date && !x.parent_id && !x.completed), [tasks, date]);

  // the first whole hour from now (or from 09:00 on another day) that no task of that day sits in
  const freeTime = useMemo(() => {
    const taken = new Set(dayTasks.map((x) => x.time?.slice(0, 2)).filter(Boolean));
    let h = date === day ? Number(nowTime().slice(0, 2)) + 1 : 9;
    while (h < 22 && taken.has(pad(h))) h++;
    return h <= 22 ? `${pad(h)}:00` : undefined;
  }, [dayTasks, date, day]);

  // what the sentence itself says is shown at once, so there is no doubt about what will be saved
  const parsed = useMemo(() => {
    const first = typed.split('\n').find((l) => l.trim());
    return first ? parseTask(first, day) : null;
  }, [typed, day]);
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
    setSteps(s.steps ?? []);
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
        const p = parseTask(line, day);
        const when = p.date ?? date;
        const at = p.time ?? time;
        const length = p.minutes ?? minutes;
        const made = await db.create('DailyTask', {
          title: p.title.trim() || line, date: when, time: at, end_time: at && length ? plus(at, length) : undefined, minutes: length,
          priority: p.priority ?? prio, goal_id: goal, list_id: list, completed: false, repeat_days: [],
        });
        last = made;
        // written to the calendar now, so the confirmation below is the truth
        if (autoCal && (await saveTaskToCalendar(made).catch((e) => (logError('calendar', e), false)))) written++;
        // steps follow the task: timed one after another when it has a time, each with its own calendar entry
        if (lines.length === 1 && steps.length) await addSteps(made, steps);
        else if (autoSplit)
          (at ? timeboxTask(made.title, length ?? 60, undefined, lang).then((xs) => xs.map((x) => ({ title: x.step, minutes: x.minutes }))) : splitTask(made.title, lang))
            .then((xs) => addSteps(made, xs))
            .catch((e) => logError('auto-split', e));
      }
    } finally {
      setBusy(null);
    }
    const head = lines.length === 1 ? `${t.add.saved}: ${last?.title ?? ''}` : t.add.savedMany.replace('{n}', String(lines.length));
    const tail = !autoCal ? '' : written === lines.length ? ` · ${t.add.inCal} ${cal?.name ?? ''}` : ` · ${t.add.notInCal}`;
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
            {parsed && (parsed.date || parsed.time || parsed.priority || parsed.minutes) ? (
              <Txt v="small" color={c.primary}>
                ✨ {t.nlp.understood}: {[parsed.date && `📅 ${fmtDate(parsed.date, lang, t.c)}`, parsed.time && `🕐 ${parsed.time}`, parsed.minutes && `⏱ ${parsed.minutes}`, parsed.priority && `🚩 ${t.prio[parsed.priority]}`].filter(Boolean).join('  ')}
              </Txt>
            ) : null}
          </View>

          {steps.length ? group(t.add.steps, steps.map((s, i) => chip(`s${i}`, `${i + 1}. ${s}  ✕`, false, () => setSteps(steps.filter((_, k) => k !== i))))) : null}

          {group(t.add.when, [
            ...quickDates.map((d, i) => chip(d, dateLabels[i], date === d, () => setDate(d))),
            chip('other', quickDates.includes(date) ? t.add.otherDate : `📅 ${fmtDate(date, lang, t.c, true)}`, !quickDates.includes(date), () => setPicking('date')),
          ])}

          {group(t.add.time, [
            chip('none', t.add.noTime, !time, () => setTime(undefined)),
            ...(freeTime ? [chip('free', `${t.add.free} ${freeTime}`, time === freeTime, () => setTime(freeTime))] : []),
            ...TIMES.filter((x) => x !== freeTime).map((x) => chip(x, x, time === x, () => setTime(x))),
            chip('othertime', time && time !== freeTime && !TIMES.includes(time) ? `🕐 ${time}` : t.add.otherTime, !!time && time !== freeTime && !TIMES.includes(time), () => setPicking('time')),
          ])}

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

        <DatePickerSheet visible={picking === 'date'} value={date} onChange={(v) => v && setDate(v)} onClose={() => setPicking(null)} allowClear={false} />
        <TimePickerSheet visible={picking === 'time'} value={time} onChange={setTime} onClose={() => setPicking(null)} />
      </View>
    </Modal>
  );
}
