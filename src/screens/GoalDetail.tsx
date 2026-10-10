import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { GoalForm } from './forms';
import { TaskDetail, useAI } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { addDays, fmtDate, today } from '@/lib/dates';
import { db, useEntity } from '@/lib/db';
import { autoSyncTask } from '@/lib/devicecal';
import { suggestSteps } from '@/lib/goalai';
import { goalProgress, lastMoved, money, nextStep } from '@/lib/logic';
import type { Goal } from '@/lib/types';
import { LineChart } from '@/ui/charts';
import { Badge, Btn, Card, Check, Empty, Input, Progress, Row, Screen, Section, Sheet, Txt } from '@/ui/kit';
import { useUndo } from '@/ui/shared';
import { Text } from '@/ui/text';

const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);

/** One goal as a roadmap: its number, how it moved, the next step, its milestones on a timeline. */
export default function GoalDetail() {
  const c = useTheme();
  const { t, lang, dir } = useLang();
  const router = useRouter();
  const ai = useAI();
  const undo = useUndo();
  const { id } = useLocalSearchParams<{ id: string }>();
  const goals = useEntity('Goal').items;
  const tasks = useEntity('DailyTask').items; // subscribes, so ticking a task redraws the progress
  const goal = goals.find((g) => g.id === id);
  const [editing, setEditing] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [value, setValue] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [ideas, setIdeas] = useState<{ text: string; on: boolean }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);
  if (!goal) return <Screen><Empty icon="🎯" text={t.goals.empty} /></Screen>;

  const progress = goalProgress(goal, goals);
  const kids = goals.filter((x) => x.parent_id === goal.id && x.status !== 'cancelled').sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  const linked = tasks.filter((x) => x.goal_id && (x.goal_id === goal.id || kids.some((k) => k.id === x.goal_id)) && !x.parent_id);
  const next = nextStep(goal, goals);
  const idle = daysBetween(lastMoved(goal, goals), today());
  const day = today();
  const left = goal.due_date ? daysBetween(day, goal.due_date) : null;
  // how fast it must move from here to land on the due date
  const pace = goal.target_value && left && left > 0 ? (goal.target_value - (goal.current_value ?? 0)) / Math.max(1, left / 30) : null;

  const openMeasure = () => {
    setValue(String(goal.current_value ?? ''));
    setTarget(String(goal.target_value ?? ''));
    setUnit(goal.unit ?? '');
    setMeasuring(true);
  };
  const saveMeasure = async () => {
    const v = Number(value.replace(/[^\d.-]/g, ''));
    const tg = Number(target.replace(/[^\d.-]/g, ''));
    const before = { ...goal };
    const log = [...(goal.value_log ?? []).filter((x) => x.date !== day), ...(Number.isFinite(v) ? [{ date: day, value: v }] : [])].sort((a, b) => a.date.localeCompare(b.date));
    await db.update('Goal', goal.id, { current_value: Number.isFinite(v) ? v : goal.current_value, target_value: tg > 0 ? tg : goal.target_value, unit: unit.trim() || goal.unit, value_log: log, status: tg > 0 && v >= tg ? 'completed' : goal.status === 'not_started' ? 'in_progress' : goal.status });
    setMeasuring(false);
    undo(`🎯 ${goal.title}`, () => db.restore('Goal', [before]));
  };
  const askIdeas = async () => {
    setBusy(true);
    const out = await ai(() => suggestSteps(goal, linked.filter((x) => x.completed).map((x) => x.title), lang));
    setBusy(false);
    if (out?.length) setIdeas(out.map((text) => ({ text, on: true })));
  };
  const acceptIdeas = async () => {
    const chosen = (ideas ?? []).filter((x) => x.on);
    const made = await db.bulkCreate('DailyTask', chosen.map((x, i) => ({ title: x.text, date: addDays(day, Math.floor(i / 2)), goal_id: goal.id, priority: 'high' as const, completed: false })));
    for (const x of made) autoSyncTask(x.id);
    setIdeas(null);
    undo(`➕ ${made.length}`, () => db.removeWhere('DailyTask', (x) => made.some((m) => m.id === x.id)));
  };

  const series = (goal.value_log ?? []).slice(-12).map((x) => ({ label: x.date.slice(5), value: x.value }));
  return (
    <Screen>
      <Card style={{ gap: 10, borderColor: goal.color ?? c.primary }}>
        <Row>
          <Txt v="h" style={{ flex: 1 }}>🎯 {goal.title}</Txt>
          <Btn small kind="ghost" title="✏️" onPress={() => setEditing(true)} />
        </Row>
        <Row wrap gap={6}>
          <Badge text={t.level[goal.level]} color={c.primary} />
          {goal.due_date ? <Badge text={`📅 ${fmtDate(goal.due_date, lang, t.c)}${left !== null ? ` · ${left} ${t.roadmap.daysLeft}` : ''}`} /> : null}
          {idle >= 5 ? <Badge text={`⚠️ ${t.roadmap.idle.replace('{n}', String(idle))}`} color={c.danger} /> : null}
        </Row>
        {goal.target_value ? (
          <Pressable onPress={openMeasure} accessibilityRole="button" style={{ alignItems: 'center', gap: 2 }}>
            <Text style={{ fontSize: 30, fontWeight: '700', color: c.text }}>{money(goal.current_value ?? 0)}</Text>
            <Txt v="muted">{t.roadmap.of} {money(goal.target_value)} {goal.unit ?? ''}</Txt>
          </Pressable>
        ) : null}
        <Progress value={progress} color={goal.color} height={10} />
        <Row>
          <Txt v="small" style={{ flex: 1 }}>{progress}% · {linked.filter((x) => x.completed).length}/{linked.length} {t.roadmap.tasksDone}</Txt>
          <Btn small title={goal.target_value ? `➕ ${t.roadmap.update}` : `🔢 ${t.roadmap.makeNumber}`} onPress={openMeasure} />
        </Row>
        {pace ? <Txt v="small" color={c.primary}>📈 {t.roadmap.pace.replace('{n}', money(Math.round(pace))).replace('{u}', goal.unit ?? '')}</Txt> : null}
        {series.length > 1 ? <LineChart data={series} color={goal.color ?? c.primary} /> : null}
      </Card>

      <Btn title={`✨ ${t.roadmap.breakdown}`} onPress={() => router.push(`/plan?goal=${encodeURIComponent(goal.title)}&days=${left && left > 0 ? left : 365}` as any)} style={{ paddingVertical: 15 }} />
      <Txt v="small">{t.roadmap.breakdownHint}</Txt>

      <Section title={`👣 ${t.roadmap.next}`}>
        {next ? (
          <Card onPress={() => setOpenTask(next.id)}>
            <Row>
              <Check on={false} onPress={() => db.update('DailyTask', next.id, { completed: true })} />
              <Txt style={{ flex: 1 }}>{next.title}</Txt>
              <Txt v="small">{fmtDate(next.date, lang, t.c)}{next.time ? ` ${next.time}` : ''}</Txt>
            </Row>
          </Card>
        ) : <Txt v="muted">{t.roadmap.noNext}</Txt>}
        <Btn kind="ghost" title={busy ? t.c.aiWorking : `🤖 ${t.roadmap.suggest}`} loading={busy} onPress={askIdeas} />
        {ideas ? (
          <Card style={{ gap: 8 }}>
            {ideas.map((x, i) => (
              <Row key={i} style={{ opacity: x.on ? 1 : 0.45 }}>
                <Check on={x.on} onPress={() => setIdeas(ideas.map((y, k) => (k === i ? { ...y, on: !y.on } : y)))} />
                <Txt style={{ flex: 1 }}>{x.text}</Txt>
              </Row>
            ))}
            <Row>
              <Btn style={{ flex: 1 }} title={`✓ ${t.roadmap.accept}`} disabled={!ideas.some((x) => x.on)} onPress={acceptIdeas} />
              <Btn kind="ghost" title={t.c.cancel} onPress={() => setIdeas(null)} />
            </Row>
          </Card>
        ) : null}
      </Section>

      <Section title={`🗺 ${t.roadmap.milestones}`}>
        {!kids.length ? <Txt v="muted">{t.roadmap.noMilestones}</Txt> : (
          <View style={{ gap: 0 }}>
            {kids.map((k, i) => {
              const p = goalProgress(k, goals);
              const done = p >= 100;
              return (
                <Pressable key={k.id} onPress={() => router.push(`/goal?id=${k.id}` as any)} style={{ flexDirection: 'row', gap: 10, direction: dir }}>
                  <View style={{ alignItems: 'center', width: 20 }}>
                    <View style={{ width: 14, height: 14, borderRadius: 7, marginTop: 4, backgroundColor: done ? c.success : p > 0 ? c.primary : c.border }} />
                    {i < kids.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: c.border }} /> : null}
                  </View>
                  <View style={{ flex: 1, paddingBottom: 14, gap: 3 }}>
                    <Txt style={{ fontWeight: '600', textDecorationLine: done ? 'line-through' : 'none' }}>{k.title}</Txt>
                    <Txt v="small">{k.due_date ? fmtDate(k.due_date, lang, t.c) : '—'} · {p}%</Txt>
                    <Progress value={p} height={4} color={done ? c.success : undefined} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </Section>

      {linked.length ? (
        <Section title={`✅ ${t.roadmap.linked} (${linked.length})`}>
          {linked.slice(0, 20).map((x) => (
            <Card key={x.id} onPress={() => setOpenTask(x.id)}>
              <Row>
                <Check on={!!x.completed} onPress={() => db.update('DailyTask', x.id, { completed: !x.completed })} />
                <Txt style={{ flex: 1, textDecorationLine: x.completed ? 'line-through' : 'none' }} color={x.completed ? c.muted : c.text}>{x.title}</Txt>
                <Txt v="small">{fmtDate(x.date, lang, t.c)}</Txt>
              </Row>
            </Card>
          ))}
        </Section>
      ) : null}

      <Sheet visible={measuring} onClose={() => setMeasuring(false)} title={`🔢 ${goal.title}`} footer={<Btn title={t.c.save} onPress={saveMeasure} />}>
        <Input label={t.roadmap.current} value={value} onChangeText={setValue} keyboardType="decimal-pad" suggestions={goal.current_value ? [String(goal.current_value + (goal.target_value ?? 0) * 0.01), String(goal.current_value + (goal.target_value ?? 0) * 0.05)].map((x) => String(Math.round(Number(x)))) : t.sug.bigAmounts} />
        <Input label={t.roadmap.target} value={target} onChangeText={setTarget} keyboardType="decimal-pad" suggestions={['100', '1000', '10000', '100000', '1000000']} />
        <Input label={t.roadmap.unit} value={unit} onChangeText={setUnit} suggestions={t.roadmap.units} />
      </Sheet>
      <GoalForm visible={editing} initial={goal} level={goal.level} onClose={() => setEditing(false)} />
      <TaskDetail taskId={openTask} onClose={() => setOpenTask(null)} />
    </Screen>
  );
}

/** Every top goal at a glance: progress, how long since it moved, and its next step. */
export function RoadmapHub() {
  const c = useTheme();
  const { t, lang } = useLang();
  const router = useRouter();
  const goals = useEntity('Goal').items;
  useEntity('DailyTask');
  const roots = goals.filter((g) => !g.parent_id && g.status !== 'cancelled' && g.status !== 'completed');
  const day = today();
  return (
    <Screen>
      <Btn title={t.plan.banner} onPress={() => router.push('/plan')} />
      <Row>
        <Btn kind="ghost" style={{ flex: 1 }} title={`📋 ${t.review.title}`} onPress={() => router.push('/review')} />
        <Btn kind="ghost" style={{ flex: 1 }} title={`🔺 ${t.roadmap.pyramid}`} onPress={() => router.push('/goals/life')} />
      </Row>
      {!roots.length ? <Empty icon="🎯" text={t.roadmap.empty} /> : roots.map((g) => {
        const p = goalProgress(g, goals);
        const idle = daysBetween(lastMoved(g, goals), day);
        const n = nextStep(g, goals);
        return (
          <Card key={g.id} onPress={() => router.push(`/goal?id=${g.id}` as any)} style={{ gap: 6 }}>
            <Row>
              <Txt v="sub" style={{ flex: 1 }}>{g.title}</Txt>
              <Txt v="small" color={c.primary}>{p}%</Txt>
            </Row>
            <Progress value={p} color={g.color} />
            {g.target_value ? <Txt v="small">{money(g.current_value ?? 0)} / {money(g.target_value)} {g.unit ?? ''}</Txt> : null}
            <Txt v="small">👣 {n ? `${n.title} · ${fmtDate(n.date, lang, t.c)}` : t.roadmap.noNext}</Txt>
            {idle >= 5 ? <Txt v="small" color={c.danger}>⚠️ {t.roadmap.idle.replace('{n}', String(idle))}</Txt> : null}
          </Card>
        );
      })}
    </Screen>
  );
}
