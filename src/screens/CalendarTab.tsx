import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AddTask } from './AddTask';
import { TaskDetail, TaskRow, useTaskActions } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { addDays, fmtDate, parse, today } from '@/lib/dates';
import { useEntity } from '@/lib/db';
import { DeviceEvent, googleCalendarLinked, readDeviceEvents } from '@/lib/devicecal';
import { habitScheduled, logDone, sortTasks } from '@/lib/logic';
import type { DailyTask } from '@/lib/types';
import { Badge, Chips, Empty, PomodoroBar, Row, Sheet, Txt } from '@/ui/kit';
import { CalendarView } from '@/ui/shared';
import { Text } from '@/ui/text';

type ViewKey = 'month' | 'week' | 'day';
const HOURS = Array.from({ length: 19 }, (_, i) => i + 5);

// The in-app calendar: month grid, week strip or an hour-by-hour day, each showing the app's tasks
// together with whatever is already in the phone's (Google) calendar.
export default function CalendarTab() {
  const c = useTheme();
  const { t, lang, dir } = useLang();
  const tasks = useEntity('DailyTask').items;
  const habits = useEntity('Habit').items;
  const logs = useEntity('HabitLog').items;
  const { toggle } = useTaskActions();
  const router = useRouter();
  // false when tasks are being written to a calendar that never reaches Google
  const [linked, setLinked] = useState<boolean | null>(null);
  useEffect(() => {
    googleCalendarLinked().then(setLinked).catch(() => setLinked(null));
  }, []);
  const [view, setView] = useState<ViewKey>('month');
  const [day, setDay] = useState(today());
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [events, setEvents] = useState<DeviceEvent[]>([]);

  const weekStart = useMemo(() => addDays(day, -parse(day).getDay()), [day]);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const mine = useMemo(() => new Set(tasks.map((x) => x.calendar_event_id).filter(Boolean)), [tasks]);

  // phone-calendar events for the visible week, minus the ones this app wrote itself
  useEffect(() => {
    let live = true;
    readDeviceEvents(weekStart, addDays(weekStart, 6)).then((all) => live && setEvents(all.filter((e) => !mine.has(e.id))));
    return () => {
      live = false;
    };
  }, [weekStart, mine]);

  const top = useMemo(() => tasks.filter((x) => !x.parent_id), [tasks]);
  const taskDates = useMemo(() => new Set(top.map((x) => x.date)), [top]);
  const habitDates = useMemo(() => new Set(logs.filter((l) => l.completed).map((l) => l.date)), [logs]);
  const open = useCallback((x: DailyTask) => setOpenId(x.id), []);
  const tasksOn = (d: string) => sortTasks(top.filter((x) => x.date === d));
  const eventsOn = (d: string) => events.filter((e) => e.date === d).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  const row = (x: DailyTask) => {
    const subs = tasks.filter((s) => s.parent_id === x.id);
    return <TaskRow key={x.id} task={x} subDone={subs.filter((s) => s.completed).length} subTotal={subs.length} onToggle={toggle} onOpen={open} />;
  };
  const eventRow = (e: DeviceEvent) => (
    <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
      <Ionicons name="calendar" size={18} color={c.success} />
      <Txt style={{ flex: 1 }} numberOfLines={2}>{e.title}</Txt>
      <Txt v="small">{e.allDay ? t.cal.allDay : `${e.time}–${e.end}`}</Txt>
    </View>
  );
  const dayList = (d: string) => {
    const xs = tasksOn(d);
    const es = eventsOn(d);
    return xs.length || es.length ? <>{es.map(eventRow)}{xs.map(row)}</> : <Empty icon="🗓" text={t.tasks.empty} />;
  };
  const dayHabits = habits.filter((h) => habitScheduled(h, day));

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PomodoroBar />
      {linked === false ? (
        <Pressable onPress={() => router.push('/profile-settings')} accessibilityRole="button" style={{ direction: dir, margin: 10, marginBottom: 0, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.warn, backgroundColor: c.card }}>
          <Text style={{ color: c.warn, fontSize: 13, textAlign: dir === 'rtl' ? 'right' : 'left' }}>⚠️ {t.cal.notLinked}</Text>
        </Pressable>
      ) : null}
      <View style={{ direction: dir, padding: 10, gap: 8 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Chips options={(['month', 'week', 'day'] as ViewKey[]).map((k) => ({ value: k, label: t.cal.views[k] }))} value={view} onChange={setView} />
          <Row gap={2}>
            <Pressable onPress={() => setDay(addDays(day, view === 'day' ? -1 : -7))} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.c.back} style={{ padding: 6 }}><Ionicons name={dir === 'rtl' ? 'chevron-forward' : 'chevron-back'} size={20} color={c.primary} /></Pressable>
            <Pressable onPress={() => setDay(today())} accessibilityRole="button" style={{ paddingHorizontal: 8, paddingVertical: 6 }}><Text style={{ color: c.primary, fontSize: 13 }}>{t.c.today}</Text></Pressable>
            <Pressable onPress={() => setDay(addDays(day, view === 'day' ? 1 : 7))} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.c.next} style={{ padding: 6 }}><Ionicons name={dir === 'rtl' ? 'chevron-back' : 'chevron-forward'} size={20} color={c.primary} /></Pressable>
          </Row>
        </Row>
        {view !== 'month' ? (
          <Row gap={4}>
            {week.map((d) => {
              const on = d === day;
              return (
                <Pressable key={d} onPress={() => setDay(d)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={d}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: on ? c.primary : c.card, borderWidth: d === today() && !on ? 1.5 : 0, borderColor: c.primary }}>
                  <Text style={{ fontSize: 10, color: on ? c.onPrimary : c.muted }}>{t.daysShort[parse(d).getDay()]}</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: on ? c.onPrimary : c.text }}>{Number(d.slice(8))}</Text>
                  <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 2, backgroundColor: taskDates.has(d) || events.some((e) => e.date === d) ? (on ? c.onPrimary : c.primary) : 'transparent' }} />
                </Pressable>
              );
            })}
          </Row>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1, direction: dir }} contentContainerStyle={{ paddingBottom: 96 }}>
        {view === 'month' ? (
          <View style={{ paddingHorizontal: 10 }}>
            <CalendarView taskDates={taskDates} habitDates={habitDates} selected={day} onSelect={setDay} />
          </View>
        ) : null}

        {view === 'week' ? week.map((d) => (
          <View key={d}>
            <Pressable onPress={() => { setDay(d); setView('day'); }} accessibilityRole="button" style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6 }}>
              <Txt v="muted" color={d === today() ? c.primary : c.muted}>{fmtDate(d, lang, t.c, true)} · {tasksOn(d).length + eventsOn(d).length}</Txt>
            </Pressable>
            {eventsOn(d).map(eventRow)}
            {tasksOn(d).map(row)}
          </View>
        )) : null}

        {view !== 'week' ? (
          <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}>
            <Txt v="sub">{fmtDate(day, lang, t.c, true)} · {tasksOn(day).filter((x) => !x.completed).length} {t.tasks.left}</Txt>
          </View>
        ) : null}
        {view === 'month' ? dayList(day) : null}

        {view === 'day' ? (
          <>
            {/* untimed items first, then one row per hour */}
            {eventsOn(day).filter((e) => e.allDay).map(eventRow)}
            {tasksOn(day).filter((x) => !x.time).map(row)}
            {HOURS.map((h) => {
              const hh = String(h).padStart(2, '0');
              const xs = tasksOn(day).filter((x) => x.time?.startsWith(hh));
              const es = eventsOn(day).filter((e) => !e.allDay && e.time?.startsWith(hh));
              return (
                <View key={h} style={{ flexDirection: 'row', minHeight: 44, borderTopWidth: 1, borderColor: c.border }}>
                  <View style={{ width: 52, paddingTop: 6, alignItems: 'center' }}><Txt v="small">{hh}:00</Txt></View>
                  <View style={{ flex: 1 }}>{es.map(eventRow)}{xs.map(row)}</View>
                </View>
              );
            })}
          </>
        ) : null}

        {view !== 'week' && dayHabits.length ? (
          <View style={{ padding: 14, gap: 6 }}>
            <Txt v="muted">🔥 {t.nav.habits}</Txt>
            <Row wrap>
              {dayHabits.map((h) => <Badge key={h.id} text={`${logDone(h, logs.find((l) => l.habit_id === h.id && l.date === day)) ? '✓ ' : ''}${h.title}`} color={h.color} />)}
            </Row>
          </View>
        ) : null}
      </ScrollView>

      <Pressable onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel={t.today.addTask}
        style={{ position: 'absolute', bottom: 20, [dir === 'rtl' ? 'left' : 'right']: 20, width: 58, height: 58, borderRadius: 29, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', elevation: 6 }}>
        <Ionicons name="add" size={32} color={c.onPrimary} />
      </Pressable>
      <AddTask visible={adding} onClose={() => setAdding(false)} defaultDate={day} />
      <TaskDetail taskId={openId} onClose={() => setOpenId(null)} />
    </View>
  );
}
