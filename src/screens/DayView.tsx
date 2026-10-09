import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { TaskDetail, prioColor, useAI } from './taskparts';
import { useProfile } from '@/ctx/Auth';
import { useLang, useTheme } from '@/ctx/Lang';
import { addDays, fmtDate, today } from '@/lib/dates';
import { db, useEntity, useKV } from '@/lib/db';
import { DeviceEvent, autoSyncTask, readDeviceEvents } from '@/lib/devicecal';
import { Slot, arrangeDay, lengthOf, toHHMM, toMin } from '@/lib/schedule';
import type { DailyTask } from '@/lib/types';
import { Btn, Row, Sheet, Txt } from '@/ui/kit';
import { useUndo } from '@/ui/shared';
import { Text } from '@/ui/text';

// pixels per minute: zoomed in, a 5-minute step still has room for its line
const ZOOMS = [1.1, 2, 3.5, 5];
const SNAP = 15;
const GUTTER = 52;

/** One task on the grid: tap to open it, hold and drag to move it in 15-minute steps. */
function Block({ task, top, height, px, onOpen, onMove }: { task: DailyTask; top: number; height: number; px: number; onOpen: () => void; onMove: (deltaMin: number) => void }) {
  const c = useTheme();
  const { dir } = useLang();
  const dy = useSharedValue(0);
  const lifted = useSharedValue(0);
  const buzz = () => Platform.OS !== 'web' && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(() => {
      lifted.value = withTiming(1, { duration: 120 });
      runOnJS(buzz)();
    })
    .onUpdate((e) => {
      dy.value = Math.round(e.translationY / (SNAP * px)) * SNAP * px;
    })
    .onEnd(() => {
      const delta = Math.round(dy.value / px);
      if (delta) runOnJS(onMove)(delta);
    })
    .onFinalize(() => {
      dy.value = 0;
      lifted.value = withTiming(0, { duration: 120 });
    });
  const tap = Gesture.Tap().onEnd(() => runOnJS(onOpen)());
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: dy.value }, { scale: 1 + lifted.value * 0.03 }], zIndex: lifted.value ? 10 : 1, opacity: 1 - lifted.value * 0.1 }));
  const color = prioColor(c, task.priority);
  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <Animated.View style={[{ position: 'absolute', top, height: Math.max(height, 26), [dir === 'rtl' ? 'right' : 'left']: GUTTER + 4, [dir === 'rtl' ? 'left' : 'right']: 6, borderRadius: 8, backgroundColor: c.soft, borderStartWidth: 4, borderColor: color, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' }, style]}>
        <Text numberOfLines={height > 40 ? 2 : 1} style={{ color: task.completed ? c.muted : c.text, fontSize: 13, fontWeight: '600', textDecorationLine: task.completed ? 'line-through' : 'none', textAlign: dir === 'rtl' ? 'right' : 'left' }}>{task.title}</Text>
        {height > 38 ? <Text style={{ color: c.muted, fontSize: 11, textAlign: dir === 'rtl' ? 'right' : 'left' }}>{task.time}{task.end_time ? `–${task.end_time}` : ''}</Text> : null}
      </Animated.View>
    </GestureDetector>
  );
}

export default function DayView() {
  const c = useTheme();
  const { t, lang, dir } = useLang();
  const ai = useAI();
  const undo = useUndo();
  const { profile } = useProfile();
  const all = useEntity('DailyTask').items;
  const [day, setDay] = useState(today());
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Slot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const [zoom, setZoom] = useKV<number>('day:zoom', 1);
  const PX = ZOOMS[Math.min(Math.max(zoom, 0), ZOOMS.length - 1)];

  const top = useMemo(() => all.filter((x) => !x.parent_id && x.date === day), [all, day]);
  const subsOf = (id: string) => all.filter((x) => x.parent_id === id);
  const timed = top.filter((x) => toMin(x.time) !== null);
  const untimed = top.filter((x) => toMin(x.time) === null && !x.completed);

  useEffect(() => {
    let live = true;
    readDeviceEvents(day, day).then((ev) => live && setEvents(ev.filter((e) => !e.allDay && e.date === day))).catch(() => {});
    return () => {
      live = false;
    };
  }, [day]);

  // opens on the current hour (or the morning for another day)
  useEffect(() => {
    const h = day === today() ? Math.max(0, new Date().getHours() - 1) : Number((profile?.wake_time ?? '07:00').slice(0, 2));
    setTimeout(() => scroll.current?.scrollTo({ y: h * 60 * PX, animated: false }), 50);
  }, [day, profile?.wake_time, PX]);

  const move = async (task: DailyTask, delta: number) => {
    const start = toMin(task.time)!;
    const len = lengthOf(task, subsOf(task.id));
    const next = Math.max(0, Math.min(24 * 60 - SNAP, start + delta));
    const steps = subsOf(task.id).filter((x) => toMin(x.time) !== null);
    const before = [task, ...steps];
    const shift = next - start;
    await db.update('DailyTask', task.id, { time: toHHMM(next), end_time: toHHMM(next + len) });
    autoSyncTask(task.id);
    // its timed steps travel with it
    for (const x of steps) {
      await db.update('DailyTask', x.id, { time: toHHMM(toMin(x.time)! + shift) });
      autoSyncTask(x.id);
    }
    undo(`🕐 ${task.title} → ${toHHMM(next)}`, async () => {
      await db.restore('DailyTask', before);
      for (const x of before) autoSyncTask(x.id);
    });
  };

  const arrange = async () => {
    const open = top.filter((x) => !x.completed);
    if (!open.length) return;
    setBusy(true);
    const now = new Date();
    const slots = await ai(() => arrangeDay(day, open, events.map((e) => ({ title: e.title, start: e.time ?? '00:00', end: e.end ?? e.time ?? '00:00' })), profile, day === today() ? toHHMM(now.getHours() * 60 + now.getMinutes()) : null, lang));
    setBusy(false);
    if (slots?.length) setPlan(slots);
  };
  const applyPlan = async () => {
    if (!plan) return;
    const before = (await db.list('DailyTask')).filter((x) => plan.some((p) => p.id === x.id));
    for (const p of plan) {
      await db.update('DailyTask', p.id, { time: p.time, end_time: toHHMM(toMin(p.time)! + p.minutes) });
      autoSyncTask(p.id);
    }
    setPlan(null);
    undo(`🗓 ${t.day.arranged}`, async () => {
      await db.restore('DailyTask', before);
      for (const x of before) autoSyncTask(x.id);
    });
  };

  const nowMin = day === today() ? new Date().getHours() * 60 + new Date().getMinutes() : null;
  const side = dir === 'rtl' ? 'right' : 'left';
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, direction: dir }}>
      <View style={{ padding: 10, gap: 8, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
        <Row>
          <Pressable onPress={() => setDay(addDays(day, -1))} hitSlop={8} accessibilityRole="button"><Ionicons name={dir === 'rtl' ? 'chevron-forward' : 'chevron-back'} size={22} color={c.text} /></Pressable>
          <Pressable onPress={() => setDay(today())} style={{ flex: 1 }} accessibilityRole="button"><Txt v="sub" center>{fmtDate(day, lang, t.c, true)}</Txt></Pressable>
          <Pressable onPress={() => setDay(addDays(day, 1))} hitSlop={8} accessibilityRole="button"><Ionicons name={dir === 'rtl' ? 'chevron-back' : 'chevron-forward'} size={22} color={c.text} /></Pressable>
        </Row>
        <Btn title={busy ? t.c.aiWorking : `🤖 ${t.day.arrange}`} loading={busy} onPress={arrange} />
        {untimed.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Txt v="small">{t.day.noTime}:</Txt>
            {untimed.map((x) => (
              <Pressable key={x.id} onPress={() => setOpenId(x.id)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.soft, borderWidth: 1, borderColor: prioColor(c, x.priority) }}>
                <Text style={{ color: c.text, fontSize: 12 }}>{x.title}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <Row>
          <Txt v="small" style={{ flex: 1 }}>💡 {t.day.hint}</Txt>
          <Pressable onPress={() => setZoom(Math.max(0, zoom - 1))} disabled={zoom <= 0} hitSlop={6} accessibilityRole="button" accessibilityLabel="zoom out" style={{ padding: 4, opacity: zoom <= 0 ? 0.3 : 1 }}><Ionicons name="remove-circle-outline" size={24} color={c.primary} /></Pressable>
          <Pressable onPress={() => setZoom(Math.min(ZOOMS.length - 1, zoom + 1))} disabled={zoom >= ZOOMS.length - 1} hitSlop={6} accessibilityRole="button" accessibilityLabel="zoom in" style={{ padding: 4, opacity: zoom >= ZOOMS.length - 1 ? 0.3 : 1 }}><Ionicons name="add-circle-outline" size={24} color={c.primary} /></Pressable>
        </Row>
      </View>

      <ScrollView ref={scroll} contentContainerStyle={{ height: 24 * 60 * PX + 40 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <View key={h} style={{ position: 'absolute', top: h * 60 * PX, left: 0, right: 0, height: 60 * PX, borderTopWidth: 1, borderColor: c.border }}>
            <Text style={{ position: 'absolute', [side]: 6, top: 2, fontSize: 11, color: c.muted }}>{String(h).padStart(2, '0')}:00</Text>
          </View>
        ))}
        {events.map((e) => {
          const a = toMin(e.time) ?? 0;
          const b = toMin(e.end) ?? a + 30;
          return (
            <View key={e.id} style={{ position: 'absolute', top: a * PX, height: Math.max(22, (b - a) * PX), [side]: GUTTER + 4, [dir === 'rtl' ? 'left' : 'right']: 6, borderRadius: 8, backgroundColor: c.border, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>📅 {e.title}</Text>
            </View>
          );
        })}
        {timed.map((x) => {
          const a = toMin(x.time)!;
          return <Block key={`${x.id}-${x.time}-${PX}`} task={x} px={PX} top={a * PX} height={lengthOf(x, subsOf(x.id)) * PX} onOpen={() => setOpenId(x.id)} onMove={(d) => move(x, d)} />;
        })}
        {/* a task's timed steps, each at its own minute, drawn over the task's block */}
        {timed.flatMap((x) => subsOf(x.id).filter((k) => toMin(k.time) !== null).map((k) => {
          const a = toMin(k.time)!;
          return (
            <Pressable key={k.id} onPress={() => db.update('DailyTask', k.id, { completed: !k.completed })} accessibilityRole="checkbox" accessibilityState={{ checked: !!k.completed }}
              style={{ position: 'absolute', top: a * PX + 1, height: Math.max(16, (k.minutes ?? 10) * PX - 2), [side]: GUTTER + 34, [dir === 'rtl' ? 'left' : 'right']: 10, borderRadius: 6, backgroundColor: k.completed ? c.border : c.card, borderWidth: 1, borderColor: c.border, paddingHorizontal: 6, justifyContent: 'center', zIndex: 5 }}>
              <Text numberOfLines={1} style={{ fontSize: 11, color: k.completed ? c.muted : c.text, textDecorationLine: k.completed ? 'line-through' : 'none', textAlign: dir === 'rtl' ? 'right' : 'left' }}>{k.time} · {k.title}</Text>
            </Pressable>
          );
        }))}
        {nowMin !== null ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: nowMin * PX, left: 0, right: 0, height: 2, backgroundColor: c.danger }}>
            <View style={{ position: 'absolute', [side]: GUTTER - 4, top: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger }} />
          </View>
        ) : null}
      </ScrollView>

      <Sheet visible={!!plan} onClose={() => setPlan(null)} title={`🤖 ${t.day.proposal}`} footer={<Row><Btn style={{ flex: 1 }} title={`✓ ${t.day.apply}`} onPress={applyPlan} /><Btn kind="ghost" title={t.c.cancel} onPress={() => setPlan(null)} /></Row>}>
        {(plan ?? []).map((p) => {
          const x = top.find((k) => k.id === p.id);
          return x ? (
            <Row key={p.id}>
              <Txt v="small" color={c.primary}>{p.time}–{toHHMM(toMin(p.time)! + p.minutes)}</Txt>
              <Txt style={{ flex: 1 }}>{x.title}</Txt>
            </Row>
          ) : null;
        })}
      </Sheet>
      <TaskDetail taskId={openId} onClose={() => setOpenId(null)} />
    </View>
  );
}
