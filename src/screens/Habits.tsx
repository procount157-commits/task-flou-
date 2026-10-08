import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { HabitForm } from './forms';
import { useLang, useTheme } from '@/ctx/Lang';
import { lastDays, today } from '@/lib/dates';
import { db, useEntity } from '@/lib/db';
import { exportHabit } from '@/lib/gcal';
import { calcStreak, grantReward, habitScheduled, logDone, pct } from '@/lib/logic';
import type { Habit } from '@/lib/types';
import { DragArea, Draggable, DropZone } from '@/ui/drag';
import { Badge, Btn, Card, Check, Empty, IconBtn, Loading, Progress, Row, Screen, Sheet, Txt } from '@/ui/kit';
import { useCelebrate } from '@/ui/shared';

export default function Habits() {
  const c = useTheme();
  const { t } = useLang();
  const habits = useEntity('Habit');
  const logs = useEntity('HabitLog');
  const rewards = useEntity('Reward');
  const celebrate = useCelebrate();
  const [form, setForm] = useState<Partial<Habit> | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const day = today();
  const week = lastDays(7);

  const ordered = useMemo(() => [...habits.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [habits.items]);

  // A missed day resets the streak, so stored streaks are re-derived from the logs whenever either changes.
  useEffect(() => {
    if (habits.loading || logs.loading) return;
    for (const h of habits.items) {
      const s = calcStreak(h, logs.items);
      if (s !== (h.streak ?? 0)) habits.update(h.id, { streak: s });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habits.items, logs.items, habits.loading, logs.loading]);

  const templates: Partial<Habit>[] = [
    { title: `🏃 ${t.habits.tpl.exercise}`, target_days: 30 },
    { title: `📚 ${t.habits.tpl.reading}`, target_days: 21 },
    { title: `💧 ${t.habits.tpl.water}`, daily_count: 3 },
    { title: `🧘 ${t.habits.tpl.meditation}`, time: '06:30' },
    { title: `✍️ ${t.habits.tpl.journal}`, time: '21:00' },
    { title: `😴 ${t.habits.tpl.sleep}`, time: '23:00' },
    { title: `📵 ${t.habits.tpl.noPhone}` },
  ];

  const tap = async (h: Habit) => {
    const need = h.daily_count || 1;
    const log = logs.items.find((l) => l.habit_id === h.id && l.date === day);
    const count = (log?.count ?? (log?.completed ? need : 0)) >= need ? 0 : (log?.count ?? 0) + 1;
    const completed = count >= need;
    if (log) await logs.update(log.id, { count, completed });
    else await logs.create({ habit_id: h.id, date: day, count, completed });
    if (!completed) return;
    const streak = calcStreak(h, await db.list('HabitLog'));
    const reached = !!h.target_days && streak >= h.target_days;
    const got = reached && (await grantReward('habit', h));
    celebrate(got ? `${t.c.rewardUnlocked} ${h.reward_icon ?? '🎁'} ${h.reward_title}` : undefined);
  };

  const remove = async (id: string) => {
    await habits.remove(id);
    await db.removeWhere('HabitLog', (l) => l.habit_id === id);
  };

  const drop = async (h: Habit, zone: string) => {
    if (zone === 'delete') return remove(h.id);
    if (!zone.startsWith('item:')) return;
    const ids = ordered.map((x) => x.id).filter((id) => id !== h.id);
    ids.splice(ids.indexOf(zone.slice(5)), 0, h.id);
    await Promise.all(ids.map((id, order) => habits.update(id, { order })));
  };

  const clone = ({ id, created_date, updated_date, created_by_id, ...h }: Habit) =>
    habits.create({ ...h, title: `${h.title} ${t.c.copySuffix}`, streak: 0, order: habits.items.length, start_date: day });

  return (
    <DragArea>
      <Screen>
        <Row>
          <Btn title={`+ ${t.habits.add}`} onPress={() => setForm({})} style={{ flex: 1 }} />
          <Btn kind="ghost" title={`📋 ${t.habits.templates}`} onPress={() => setShowTemplates(true)} style={{ flex: 1 }} />
        </Row>
        {habits.loading ? <Loading /> : !ordered.length ? <Empty icon="🔥" text={t.habits.empty} /> : ordered.map((h) => {
          const scheduled = habitScheduled(h, day);
          const need = h.daily_count || 1;
          const log = logs.items.find((l) => l.habit_id === h.id && l.date === day);
          const done = logDone(h, log);
          const streak = h.streak ?? 0;
          const reward = rewards.items.find((r) => r.linked_id === h.id && r.type === 'habit');
          return (
            <DropZone key={h.id} id={`item:${h.id}`}>
              <Draggable selfZone={`item:${h.id}`} onDrop={(z) => drop(h, z)}>
                <Card style={{ borderStartWidth: 4, borderStartColor: h.color ?? c.primary }}>
                  <Row>
                    <Check round on={done} disabled={!scheduled} onPress={() => tap(h)} />
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontWeight: '600' }}>{h.title}</Txt>
                      <Row wrap gap={4}>
                        <Badge text={`🔥 ${streak} ${t.habits.streak}`} />
                        {need > 1 ? <Badge text={`${log?.count ?? 0}/${need}`} /> : null}
                        {h.time ? <Badge text={`⏰ ${h.time}`} /> : null}
                        {h.is_active === false ? <Badge text={t.habits.paused} color={c.muted} /> : !scheduled ? <Badge text={t.habits.notToday} color={c.muted} /> : null}
                      </Row>
                    </View>
                  </Row>
                  {h.target_days ? (
                    <View style={{ gap: 3 }}>
                      <Progress value={pct(Math.min(streak, h.target_days), h.target_days)} color={h.color} />
                      <Txt v="small">{Math.min(streak, h.target_days)}/{h.target_days} {t.c.days}</Txt>
                    </View>
                  ) : null}
                  <Row gap={5}>
                    <Txt v="small">{t.habits.last7}</Txt>
                    {week.map((d) => {
                      const ok = logDone(h, logs.items.find((l) => l.habit_id === h.id && l.date === d));
                      return <View key={d} accessibilityLabel={`${d} ${ok ? t.c.completed : t.c.pending}`} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: ok ? c.success : c.track }} />;
                    })}
                  </Row>
                  {h.reward_title ? (
                    <Row>
                      <Txt v="muted" style={{ flex: 1 }}>{h.reward_icon ?? '🎁'} {h.reward_title}{h.reward_description ? ` — ${h.reward_description}` : ''}</Txt>
                      {reward ? reward.is_claimed ? <Badge text={`✓ ${t.c.claimed}`} color={c.success} /> : <Btn small title={t.c.claim} onPress={() => rewards.update(reward.id, { is_claimed: true, claimed_date: day })} /> : null}
                    </Row>
                  ) : null}
                  <Row gap={2}>
                    <Btn small kind="ghost" title={`📅 ${t.habits.exportGcal}`} onPress={() => exportHabit(h, day)} />
                    <IconBtn icon="📄" label={t.c.copy} onPress={() => clone(h)} />
                    <IconBtn icon="✏️" label={t.c.edit} onPress={() => setForm(h)} />
                    <IconBtn icon="🗑" label={t.c.delete} onPress={() => remove(h.id)} />
                  </Row>
                </Card>
              </Draggable>
            </DropZone>
          );
        })}
        <HabitForm visible={!!form} initial={form ?? undefined} onClose={() => setForm(null)} />
        <Sheet visible={showTemplates} onClose={() => setShowTemplates(false)} title={t.habits.templates}>
          {templates.map((tp) => (
            <Card key={tp.title} onPress={async () => {
              await habits.create({ title: tp.title!, frequency: 'daily', repeat_days: [], daily_count: 1, start_date: day, is_active: true, streak: 0, order: habits.items.length, ...tp });
              setShowTemplates(false);
            }}>
              <Txt style={{ fontWeight: '600' }}>{tp.title}</Txt>
              <Txt v="small">{[t.freq.daily, tp.target_days && `${tp.target_days} ${t.c.days}`, tp.daily_count && `${tp.daily_count}×`, tp.time].filter(Boolean).join(' · ')}</Txt>
            </Card>
          ))}
        </Sheet>
      </Screen>
    </DragArea>
  );
}
