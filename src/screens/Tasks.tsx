import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, SectionList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QuickAdd, SubRow, TaskDetail, useTaskActions } from './taskparts';
import { PostponeSheet, SwipeTask } from './taskswipe';
import { PALETTE, useLang, useTheme } from '@/ctx/Lang';
import { addDays, fmtDate, isDate, today } from '@/lib/dates';
import { db, useEntity, useKV } from '@/lib/db';
import { buildICS, shareFile } from '@/lib/gcal';
import { materializeRepeats, pick, sortTasks, tierOf } from '@/lib/logic';
import { NoTelegramError, sendTelegram } from '@/lib/telegram';
import type { DailyTask, TaskList } from '@/lib/types';
import { Btn, Empty, Input, Loading, PomodoroBar, Row, Sheet, Txt, confirm, notice } from '@/ui/kit';
import { Text } from '@/ui/text';

type Section = { key: string; title: string; danger?: boolean; data: DailyTask[] };
const SMART = [
  { key: 'today', icon: 'today-outline' },
  { key: 'tomorrow', icon: 'sunny-outline' },
  { key: 'week', icon: 'calendar-outline' },
  { key: 'all', icon: 'file-tray-full-outline' },
  { key: 'done', icon: 'checkmark-done-outline' },
] as const;
type SmartKey = (typeof SMART)[number]['key'];
const NO_LISTS: TaskList[] = [];

export default function Tasks() {
  const c = useTheme();
  const { t, lang, dir } = useLang();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ date?: string; add?: string }>();
  const tasks = useEntity('DailyTask');
  const goals = useEntity('Goal').items;
  const [points] = useKV('points', 0);
  const [lists, setLists] = useKV<TaskList[]>('lists', NO_LISTS);
  const { toggle, postpone, completeMany, removeMany } = useTaskActions();
  // long-press starts selecting; the bar on top then acts on every selected task
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selecting = selected.size > 0;
  const [postponing, setPostponing] = useState<DailyTask[] | null>(null);
  const select = useCallback((x: DailyTask) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(x.id)) n.delete(x.id);
    else n.add(x.id);
    return n;
  }), []);
  const askPostpone = useCallback((x: DailyTask) => setPostponing([x]), []);
  // a smart list key, or "list:<id>" for one of the user's own lists
  const [list, setList] = useState<string>('today');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [panel, setPanel] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newList, setNewList] = useState<string | null>(null);
  const [push, setPush] = useState('');
  const day = today();
  const focusDate = isDate(params.date) ? params.date! : null;
  const custom = list.startsWith('list:') ? lists.find((l) => l.id === list.slice(5)) : undefined;

  useEffect(() => {
    materializeRepeats(day);
  }, [day]);
  // the widget's + button opens straight onto the add sheet
  useEffect(() => {
    if (params.add) {
      setAdding(true);
      router.setParams({ add: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.add]);

  const subsOf = useMemo(() => {
    const m = new Map<string, DailyTask[]>();
    for (const x of tasks.items) if (x.parent_id) m.set(x.parent_id, [...(m.get(x.parent_id) ?? []), x]);
    return m;
  }, [tasks.items]);

  const top = useMemo(() => tasks.items.filter((x) => !x.parent_id), [tasks.items]);

  const sections = useMemo<Section[]>(() => {
    const scope = custom ? top.filter((x) => x.list_id === custom.id) : top;
    const open = scope.filter((x) => !x.completed);
    const overdue: Section = { key: 'overdue', title: t.tasks.overdue, danger: true, data: sortTasks(open.filter((x) => x.date < day)) };
    const on = (d: string): Section => ({ key: d, title: fmtDate(d, lang, t.c, true), data: sortTasks(open.filter((x) => x.date === d)) });
    const done = (xs: DailyTask[]): Section => ({ key: 'done', title: `${t.tasks.completed} (${xs.length})`, data: showDone ? xs : [] });
    const upcoming = () => [...new Set(open.filter((x) => x.date >= day).map((x) => x.date))].sort().map(on);
    let out: Section[];
    if (focusDate) out = [on(focusDate), done(scope.filter((x) => x.completed && x.date === focusDate))];
    else if (custom) out = [overdue, ...upcoming(), done(scope.filter((x) => x.completed).slice(-60).reverse())];
    else if (list === 'today') out = [overdue, on(day), done(scope.filter((x) => x.completed && x.date === day))];
    else if (list === 'tomorrow') out = [on(addDays(day, 1)), done(scope.filter((x) => x.completed && x.date === addDays(day, 1)))];
    else if (list === 'week') out = [overdue, ...Array.from({ length: 7 }, (_, i) => on(addDays(day, i)))];
    else if (list === 'all') out = [overdue, ...upcoming()];
    else out = [{ key: 'alldone', title: t.tasks.completed, data: scope.filter((x) => x.completed).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 150) }];
    return out.filter((s) => s.data.length || (s.key === 'done' && s.title !== `${t.tasks.completed} (0)`));
  }, [top, list, custom, day, focusDate, showDone, lang, t]);

  const counts = useMemo(() => {
    const open = top.filter((x) => !x.completed);
    const m: Record<string, number> = {
      today: open.filter((x) => x.date <= day).length,
      tomorrow: open.filter((x) => x.date === addDays(day, 1)).length,
      week: open.filter((x) => x.date <= addDays(day, 6)).length,
      all: open.length,
      done: top.length - open.length,
    };
    for (const l of lists) m[`list:${l.id}`] = open.filter((x) => x.list_id === l.id).length;
    return m;
  }, [top, lists, day]);

  const openCount = sections.filter((s) => s.key !== 'done' && s.key !== 'alldone').reduce((n, s) => n + s.data.length, 0);
  const highPending = top.some((x) => x.priority === 'high' && !x.completed && x.date <= day);
  const tier = tierOf(points);
  const weekly = useMemo(() => goals.filter((g) => g.level === 'one_week' && g.status !== 'completed' && g.status !== 'cancelled').map((g) => g.title), [goals]);
  const open = useCallback((x: DailyTask) => setOpenId(x.id), []);
  const overdueList = useMemo(() => top.filter((x) => !x.completed && x.date < day), [top, day]);
  const chosen = () => top.filter((x) => selected.has(x.id));
  // the overdue tasks dealt out over the next seven days, most important first, one or two a day
  const spreadOverdue = async () => {
    const order = sortTasks(overdueList);
    for (let i = 0; i < order.length; i++) await postpone([order[i]], { date: addDays(day, i % 7) });
  };
  // moves the one selected task up or down among the open tasks of its own day
  const reorder = async (by: number) => {
    const [id] = [...selected];
    const task = top.find((x) => x.id === id);
    if (!task) return;
    const peers = sortTasks(top.filter((x) => x.date === task.date && !x.completed));
    const i = peers.findIndex((x) => x.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= peers.length) return;
    [peers[i], peers[j]] = [peers[j], peers[i]];
    for (const [k, x] of peers.entries()) if (x.order !== k) await db.update('DailyTask', x.id, { order: k });
  };
  const title = focusDate ? fmtDate(focusDate, lang, t.c, true) : custom ? custom.name : t.tasks.lists[(SMART.some((s) => s.key === list) ? list : 'today') as SmartKey];
  const choose = (key: string) => {
    setList(key);
    setPanel(false);
    if (focusDate) router.setParams({ date: '' });
  };
  const exportDay = () => {
    const xs = sections.flatMap((s) => s.data);
    if (xs.length) shareFile(`tasks-${focusDate ?? day}.ics`, buildICS(xs), 'text/calendar');
  };
  const sendPlan = async () => {
    const xs = sections.filter((x) => x.key !== 'done' && x.key !== 'alldone').flatMap((x) => x.data);
    try {
      await sendTelegram(`📋 ${t.tg.plan} — ${title}\n` + (xs.map((x) => `${x.priority === 'high' ? '🔴' : x.priority === 'medium' ? '🟠' : '⚪️'} ${x.title}${x.time ? ' ' + x.time : ''}`).join('\n') || '—'));
      notice(t.tg.sent);
    } catch (e) {
      notice(e instanceof NoTelegramError ? t.tg.missing : String((e as Error).message));
    }
  };
  const createList = async () => {
    const name = (newList ?? '').trim();
    if (!name) return;
    const l = { id: Date.now().toString(36), name, color: PALETTE[lists.length % PALETTE.length] };
    await setLists([...lists, l]);
    setNewList(null);
    choose(`list:${l.id}`);
  };
  const deleteList = (l: TaskList) =>
    confirm(t.c.confirmDelete, async () => {
      // the list's tasks fall back to the inbox rather than disappearing with it
      for (const x of tasks.items.filter((k) => k.list_id === l.id)) await db.update('DailyTask', x.id, { list_id: undefined });
      await setLists(lists.filter((k) => k.id !== l.id));
      if (list === `list:${l.id}`) setList('today');
    }, t.c.delete, t.c.cancel);

  const item = (key: string, icon: keyof typeof Ionicons.glyphMap, label: string, color: string, onLong?: () => void) => (
    <Pressable key={key} onPress={() => choose(key)} onLongPress={onLong} accessibilityRole="button" accessibilityState={{ selected: list === key }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: list === key && !focusDate ? c.soft : 'transparent', borderRadius: 10 }}>
      <Ionicons name={icon} size={20} color={color} />
      <Txt style={{ flex: 1 }}>{label}</Txt>
      {counts[key] ? <Txt v="small">{counts[key]}</Txt> : null}
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ backgroundColor: c.card, paddingTop: insets.top, borderBottomWidth: 1, borderColor: c.border }}>
        <View style={{ direction: dir, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 54 }}>
          <Pressable onPress={() => setPanel(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.tasks.smart}><Ionicons name="menu" size={25} color={c.text} /></Pressable>
          <View style={{ flex: 1 }}>
            <Txt v="h" numberOfLines={1}>{title}</Txt>
          </View>
          <Txt v="small">{tier.icon} {points}</Txt>
          <Pressable onPress={() => router.push('/search')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.search.title}><Ionicons name="search-outline" size={20} color={c.muted} /></Pressable>
          <Pressable onPress={() => router.push('/day')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.day.title}><Ionicons name="time-outline" size={21} color={c.muted} /></Pressable>
          <Pressable onPress={() => router.push('/matrix')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.tasks.matrix}><Ionicons name="grid-outline" size={20} color={c.muted} /></Pressable>
          <Pressable onPress={sendPlan} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.tg.sendPlan}><Ionicons name="paper-plane-outline" size={20} color={c.muted} /></Pressable>
          <Pressable onPress={exportDay} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.today.exportIcs}><Ionicons name="share-outline" size={21} color={c.muted} /></Pressable>
        </View>
      </View>
      <PomodoroBar />

      {selecting ? (
        <View style={{ direction: dir, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: c.primary }}>
          <Pressable onPress={() => setSelected(new Set())} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.c.cancel}><Ionicons name="close" size={22} color={c.onPrimary} /></Pressable>
          <Text style={{ flex: 1, color: c.onPrimary, fontSize: 15, fontWeight: '700' }}>{t.swipe.selected.replace('{n}', String(selected.size))}</Text>
          {selected.size === 1 ? (
            <>
              <Pressable onPress={() => reorder(-1)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t.swipe.up} style={{ padding: 4 }}><Ionicons name="arrow-up" size={21} color={c.onPrimary} /></Pressable>
              <Pressable onPress={() => reorder(1)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t.swipe.down} style={{ padding: 4 }}><Ionicons name="arrow-down" size={21} color={c.onPrimary} /></Pressable>
            </>
          ) : null}
          <Pressable onPress={() => setSelected(new Set(sections.filter((x) => x.key !== 'done').flatMap((x) => x.data.map((d) => d.id))))} hitSlop={6} accessibilityRole="button" style={{ padding: 4 }}><Text style={{ color: c.onPrimary, fontSize: 13 }}>{t.swipe.all}</Text></Pressable>
          <Pressable onPress={() => { completeMany(chosen()); setSelected(new Set()); }} hitSlop={6} accessibilityRole="button" accessibilityLabel={t.swipe.complete} style={{ padding: 4 }}><Ionicons name="checkmark-done" size={22} color={c.onPrimary} /></Pressable>
          <Pressable onPress={() => setPostponing(chosen())} hitSlop={6} accessibilityRole="button" accessibilityLabel={t.swipe.postpone} style={{ padding: 4 }}><Ionicons name="time-outline" size={22} color={c.onPrimary} /></Pressable>
          <Pressable onPress={() => { removeMany(chosen()); setSelected(new Set()); }} hitSlop={6} accessibilityRole="button" accessibilityLabel={t.swipe.remove} style={{ padding: 4 }}><Ionicons name="trash-outline" size={21} color={c.onPrimary} /></Pressable>
        </View>
      ) : null}

      {overdueList.length && !focusDate && !selecting && (list === 'today' || list === 'week' || list === 'all') ? (
        <View style={{ direction: dir, margin: 10, marginBottom: 0, padding: 10, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.danger, gap: 8 }}>
          <Text style={{ color: c.danger, fontSize: 14, fontWeight: '700', textAlign: dir === 'rtl' ? 'right' : 'left' }}>⏰ {t.swipe.overdue.replace('{n}', String(overdueList.length))}</Text>
          <Row>
            <Btn small style={{ flex: 1 }} title={t.swipe.toToday} onPress={() => postpone(overdueList, { date: day })} />
            <Btn small kind="ghost" style={{ flex: 1 }} title={t.swipe.spread} onPress={spreadOverdue} />
          </Row>
        </View>
      ) : null}

      <Pressable onPress={() => router.push('/plan')} accessibilityRole="button"
        style={{ direction: dir, margin: 10, marginBottom: 0, backgroundColor: c.primary, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="sparkles" size={18} color={c.onPrimary} />
        <Text style={{ color: c.onPrimary, fontSize: 14, flex: 1, textAlign: dir === 'rtl' ? 'right' : 'left' }}>{t.plan.banner}</Text>
        <Ionicons name={dir === 'rtl' ? 'chevron-back' : 'chevron-forward'} size={18} color={c.onPrimary} />
      </Pressable>

      {highPending && list === 'today' && !focusDate ? (
        <Pressable onPress={() => setPush(pick(t.pushes))} accessibilityRole="button" style={{ direction: dir, margin: 10, marginBottom: 0, backgroundColor: c.card, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: c.danger, gap: 4 }}>
          <Text style={{ color: c.danger, fontSize: 13, textAlign: dir === 'rtl' ? 'right' : 'left' }}>⚠️ {t.today.highAlert} — 💪 {t.today.motivate}</Text>
          {push ? <Txt>{push}</Txt> : null}
        </Pressable>
      ) : null}

      {tasks.loading ? <Loading /> : (
        <SectionList
          style={{ flex: 1, direction: dir }}
          sections={sections}
          keyExtractor={(x) => x.id}
          stickySectionHeadersEnabled={false}
          initialNumToRender={14}
          maxToRenderPerBatch={12}
          windowSize={9}
          removeClippedSubviews
          renderItem={({ item: x }) => {
            const subs = subsOf.get(x.id) ?? [];
            return (
              <View>
                <SwipeTask task={x} subDone={subs.filter((s) => s.completed).length} subTotal={subs.length} showDate={list === 'done' || !!custom} onToggle={toggle} onOpen={open}
                  selecting={selecting} selected={selected.has(x.id)} onSelect={select} onPostpone={askPostpone} />
                {!x.completed ? subs.map((s) => <SubRow key={s.id} task={s} onToggle={toggle} />) : null}
              </View>
            );
          }}
          renderSectionHeader={({ section }) =>
            section.key === 'done' ? (
              <Pressable onPress={() => setShowDone((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showDone }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 6 }}>
                <Ionicons name={showDone ? 'chevron-down' : dir === 'rtl' ? 'chevron-back' : 'chevron-forward'} size={14} color={c.muted} />
                <Txt v="muted">{section.title}</Txt>
              </Pressable>
            ) : (
              <View style={{ paddingHorizontal: 14, paddingTop: 16, paddingBottom: 6 }}>
                <Txt v="muted" color={section.danger ? c.danger : c.muted}>{section.title} · {section.data.length}</Txt>
              </View>
            )
          }
          ListEmptyComponent={<Empty icon="🌤" text={t.tasks.empty} />}
          ListFooterComponent={<View style={{ height: 90 }}>{!openCount && sections.length ? <Empty icon="🌤" text={t.tasks.empty} /> : null}</View>}
        />
      )}

      {list !== 'done' ? (
        <Pressable onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel={t.today.addTask}
          style={{ position: 'absolute', bottom: 20, [dir === 'rtl' ? 'left' : 'right']: 20, width: 58, height: 58, borderRadius: 29, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }}>
          <Ionicons name="add" size={32} color={c.onPrimary} />
        </Pressable>
      ) : null}

      <PostponeSheet visible={!!postponing} onClose={() => setPostponing(null)} onPick={(to) => { if (postponing) postpone(postponing, to); setSelected(new Set()); }} />

      <Sheet visible={adding} onClose={() => setAdding(false)} title={t.today.addTask}>
        <QuickAdd defaultDate={focusDate ?? (list === 'tomorrow' ? addDays(day, 1) : day)} extraSuggestions={weekly} listId={custom?.id} />
      </Sheet>

      {/* the lists drawer, sliding in from the reading-start edge */}
      <Modal visible={panel} transparent animationType="fade" onRequestClose={() => setPanel(false)}>
        <View style={{ flex: 1, flexDirection: 'row', direction: dir, backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View style={{ width: '80%', maxWidth: 340, backgroundColor: c.card, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10 }}>
            <ScrollView contentContainerStyle={{ padding: 8, gap: 2 }}>
              <Txt v="small" style={{ paddingHorizontal: 16, paddingVertical: 6 }}>{t.tasks.smart}</Txt>
              {SMART.map((s) => item(s.key, s.icon, t.tasks.lists[s.key], c.primary))}
              <Txt v="small" style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>{t.tasks.myLists}</Txt>
              {lists.map((l) => item(`list:${l.id}`, 'list', l.name, l.color, () => deleteList(l)))}
              {newList === null ? (
                <Pressable onPress={() => setNewList('')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 }}>
                  <Ionicons name="add" size={20} color={c.primary} />
                  <Txt color={c.primary}>{t.tasks.newList}</Txt>
                </Pressable>
              ) : (
                <View style={{ padding: 10, gap: 8 }}>
                  <Input placeholder={t.tasks.listName} value={newList} onChangeText={setNewList} suggestions={t.tasks.listSug.filter((x) => !lists.some((l) => l.name === x))} onSubmitEditing={createList} />
                  <Row>
                    <Btn small kind="ghost" title={t.c.cancel} onPress={() => setNewList(null)} style={{ flex: 1 }} />
                    <Btn small title={t.c.add} disabled={!newList.trim()} onPress={createList} style={{ flex: 1 }} />
                  </Row>
                </View>
              )}
            </ScrollView>
          </View>
          <Pressable style={{ flex: 1 }} onPress={() => setPanel(false)} accessibilityLabel={t.c.close} />
        </View>
      </Modal>

      <TaskDetail taskId={openId} onClose={() => setOpenId(null)} />
    </View>
  );
}
