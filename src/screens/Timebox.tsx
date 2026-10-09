import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAI } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { db } from '@/lib/db';
import { autoSyncTask, removeTaskFromCalendar } from '@/lib/devicecal';
import { timeboxTask } from '@/lib/integrations';
import { cancel, scheduleAt } from '@/lib/notify';
import { clearLive, showLive } from '@/lib/phonelock';
import type { DailyTask } from '@/lib/types';
import { Btn, Check, Chips, Row, Txt } from '@/ui/kit';
import { Text } from '@/ui/text';

const DURATIONS = [15, 25, 30, 45, 60, 90, 120];
const toMin = (hhmm?: string) => (hhmm && /^\d\d:\d\d$/.test(hhmm) ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) : null);
const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// The task's length: its start-to-end span when both are set, otherwise an hour.
export function taskMinutes(task: DailyTask) {
  const a = toMin(task.time);
  const b = toMin(task.end_time);
  return a !== null && b !== null && b > a ? b - a : 60;
}

/** Ask the AI to cut the task into timed blocks, keep the ones the user ticks, and add them as sub-steps. */
export function TimeboxPanel({ task, steps, onRun }: { task: DailyTask; steps: DailyTask[]; onRun: () => void }) {
  const c = useTheme();
  const { t, lang } = useLang();
  const ai = useAI();
  const [total, setTotal] = useState(taskMinutes(task));
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{ minutes: number; step: string; on: boolean }[] | null>(null);
  const timed = steps.filter((s) => s.minutes);

  const ask = async () => {
    setBusy(true);
    const out = await ai(() => timeboxTask(task.title, total, task.notes, lang));
    setBusy(false);
    if (out) setPlan(out.map((x) => ({ ...x, on: true })));
  };
  const accept = async () => {
    if (!plan) return;
    const kept = plan.filter((x) => x.on);
    // replaces an earlier timed split, never the user's own hand-written sub-tasks
    const replaced = (await db.list('DailyTask')).filter((x) => x.parent_id === task.id && !!x.minutes && !x.completed);
    for (const x of replaced) await removeTaskFromCalendar(x);
    await db.removeWhere('DailyTask', (x) => x.parent_id === task.id && !!x.minutes && !x.completed);
    let at = toMin(task.time);
    const made = await db.bulkCreate('DailyTask', kept.map((x) => {
      const row = { title: x.step, minutes: x.minutes, date: task.date, time: at !== null ? toTime(at) : undefined, parent_id: task.id, priority: task.priority, completed: false };
      if (at !== null) at += x.minutes;
      return row;
    }));
    // each timed step becomes its own event in the calendar
    for (const x of made) autoSyncTask(x.id);
    setPlan(null);
  };

  return (
    <View style={{ gap: 8, backgroundColor: c.soft, borderRadius: 12, padding: 10 }}>
      <Txt style={{ fontWeight: '700' }}>⏱ {t.timebox.title}</Txt>
      <Chips scroll options={DURATIONS.map((m) => ({ value: String(m), label: `${m} ${t.timebox.min}` }))} value={String(total)} onChange={(v) => setTotal(Number(v))} />
      <Btn title={busy ? t.c.aiWorking : `🤖 ${t.timebox.split.replace('{n}', String(total))}`} loading={busy} onPress={ask} />
      {plan ? (
        <View style={{ gap: 6 }}>
          <Txt v="small">{t.timebox.pick}</Txt>
          {plan.map((x, i) => (
            <Pressable key={i} onPress={() => setPlan(plan.map((y, k) => (k === i ? { ...y, on: !y.on } : y)))} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: x.on ? 1 : 0.45 }}>
              <Check on={x.on} onPress={() => setPlan(plan.map((y, k) => (k === i ? { ...y, on: !y.on } : y)))} />
              <View style={{ minWidth: 52, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8, backgroundColor: c.card }}><Text style={{ color: c.primary, fontSize: 12, textAlign: 'center' }}>{x.minutes} {t.timebox.min}</Text></View>
              <Txt style={{ flex: 1 }}>{x.step}</Txt>
            </Pressable>
          ))}
          <Row>
            <Btn style={{ flex: 1 }} title={`✓ ${t.timebox.accept} (${plan.filter((x) => x.on).reduce((a, x) => a + x.minutes, 0)} ${t.timebox.min})`} disabled={!plan.some((x) => x.on)} onPress={accept} />
            <Btn kind="ghost" title={t.c.cancel} onPress={() => setPlan(null)} />
          </Row>
        </View>
      ) : null}
      {timed.length && !plan ? <Btn kind="primary" title={`▶️ ${t.timebox.start} (${timed.length})`} onPress={onRun} /> : null}
    </View>
  );
}

/** Full-screen walk through the timed steps: a countdown per block, a buzz and a notification when each ends. */
export function StepRunner({ task, steps, onClose }: { task: DailyTask; steps: DailyTask[]; onClose: () => void }) {
  const c = useTheme();
  const { t, dir } = useLang();
  const insets = useSafeAreaInsets();
  const queue = steps.filter((s) => s.minutes && !s.completed);
  const [index, setIndex] = useState(0);
  // the block's end as a wall-clock time, so the countdown survives the screen going off
  const [endsAt, setEndsAt] = useState(() => Date.now() + (queue[0]?.minutes ?? 0) * 60000);
  const [paused, setPaused] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const booked = useRef<string[]>([]);
  const step = queue[index];
  const left = Math.max(0, Math.round(((paused ?? endsAt) - now) / 1000));

  // a notification at the end of every remaining block, so the phone can stay in a pocket
  const book = async (from: number, start: number) => {
    await cancel(...booked.current);
    booked.current = [];
    let at = start;
    for (let k = from; k < queue.length; k++) {
      at += (k === from ? 0 : queue[k].minutes! * 60000);
      const id = `step-${queue[k].id}`;
      const next = queue[k + 1];
      await scheduleAt(id, `⏱ ${task.title}`, next ? `${t.timebox.next}: ${next.title}` : t.timebox.allDone, new Date(at));
      booked.current.push(id);
    }
  };

  // the countdown also lives in the status bar (a Live Update on Android 16, Samsung's Now Bar)
  useEffect(() => {
    if (step) showLive(`⏱ ${step.title}`, `${task.title}${queue[index + 1] ? ` · ${t.timebox.next}: ${queue[index + 1].title}` : ''}`, paused ?? endsAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, endsAt, paused]);

  useEffect(() => {
    book(0, endsAt);
    const tick = setInterval(() => setNow(Date.now()), 500);
    const sub = AppState.addEventListener('change', () => setNow(Date.now()));
    return () => {
      clearInterval(tick);
      sub.remove();
      cancel(...booked.current);
      clearLive();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advance = async () => {
    if (!step) return onClose();
    await db.update('DailyTask', step.id, { completed: true });
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const next = queue[index + 1];
    if (!next) {
      await cancel(...booked.current);
      return onClose();
    }
    const end = Date.now() + next.minutes! * 60000;
    setIndex(index + 1);
    setEndsAt(end);
    setPaused(null);
    book(index + 1, end);
  };

  // when a block runs out the runner moves on by itself
  useEffect(() => {
    if (step && paused === null && left === 0) advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left === 0]);

  const togglePause = () => {
    if (paused === null) {
      setPaused(Date.now());
      cancel(...booked.current);
    } else {
      const end = endsAt + (Date.now() - paused);
      setEndsAt(end);
      setPaused(null);
      book(index, end);
    }
  };
  const addFive = () => {
    const end = endsAt + 5 * 60000;
    setEndsAt(end);
    if (paused === null) book(index, end);
  };

  const total = (step?.minutes ?? 1) * 60;
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16, paddingHorizontal: 20, gap: 18, direction: dir }}>
        <Row>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.c.close}><Ionicons name="close" size={26} color={c.text} /></Pressable>
          <Txt v="small" style={{ flex: 1 }} center numberOfLines={1}>{task.title}</Txt>
          <Txt v="small">{Math.min(index + 1, queue.length)} / {queue.length}</Txt>
        </Row>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {queue.map((s, k) => <View key={s.id} style={{ flex: s.minutes, height: 6, borderRadius: 3, backgroundColor: k < index ? c.success : k === index ? c.primary : c.border }} />)}
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 }}>
          <Text style={{ fontSize: 76, fontWeight: '700', color: paused === null ? c.text : c.muted, fontVariant: ['tabular-nums'] }}>{mm}:{ss}</Text>
          <View style={{ width: '100%', height: 8, borderRadius: 4, backgroundColor: c.border, overflow: 'hidden' }}>
            <View style={{ width: `${100 - (left / total) * 100}%`, height: 8, backgroundColor: c.primary }} />
          </View>
          <Text style={{ fontSize: 26, fontWeight: '700', color: c.text, textAlign: 'center' }}>{step?.title ?? t.timebox.allDone}</Text>
          {queue[index + 1] ? <Txt v="muted" center>{t.timebox.next}: {queue[index + 1].title} · {queue[index + 1].minutes} {t.timebox.min}</Txt> : null}
        </View>
        <Row>
          <Btn kind="ghost" style={{ flex: 1 }} title={paused === null ? `⏸ ${t.timebox.pause}` : `▶️ ${t.timebox.resume}`} onPress={togglePause} />
          <Btn kind="ghost" style={{ flex: 1 }} title={`+5 ${t.timebox.min}`} onPress={addFive} />
        </Row>
        <Btn title={queue[index + 1] ? `✓ ${t.timebox.doneNext}` : `🏁 ${t.timebox.finish}`} onPress={advance} />
      </View>
    </Modal>
  );
}
