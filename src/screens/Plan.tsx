import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { prioColor, useAI } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { addDays, fmtDate, today } from '@/lib/dates';
import { autoSyncTask } from '@/lib/devicecal';
import { db, useEntity } from '@/lib/db';
import { scheduleAt } from '@/lib/notify';
import { addSteps } from '@/lib/steps';
import { HORIZONS, Plan as PlanData, makePlan } from '@/lib/plan';
import { Badge, Btn, Card, Check, Chips, Input, Row, Screen, Section, Txt, notice } from '@/ui/kit';
import { VoiceToText } from '@/ui/shared';

// Goal → AI plan → one tap puts the goal, its milestones and 30 days of dated tasks (with sub-steps,
// reminders and calendar entries) into the app.
export default function Plan() {
  const c = useTheme();
  const { t, lang } = useLang();
  const router = useRouter();
  const ai = useAI();
  const goals = useEntity('Goal').items;
  const [goal, setGoal] = useState('');
  const [horizon, setHorizon] = useState(365);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [offM, setOffM] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const day = today();
  const open = goals.filter((g) => g.status !== 'completed' && g.status !== 'cancelled');
  // opened from a goal's page: the goal is already written and the plan is asked for at once
  const params = useLocalSearchParams<{ goal?: string; days?: string }>();
  useEffect(() => {
    if (!params.goal) return;
    setGoal(params.goal);
    const days = Number(params.days);
    const h = HORIZONS.find((x) => x.days >= days) ?? HORIZONS[HORIZONS.length - 1];
    if (days > 0) setHorizon(h.days);
    make(params.goal, days > 0 ? h.days : horizon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.goal]);
  // each task belongs to the first stage that ends on or after its day
  const stages = useMemo(() => {
    if (!plan) return [];
    const ms = plan.milestones.map((m, i) => ({ ...m, i })).filter((m) => m.title !== goal.trim()).sort((a, b) => a.in_days - b.in_days);
    const stageOf = (d: number) => ms.find((m) => m.in_days >= d) ?? ms[ms.length - 1];
    const groups = ms.map((m) => ({ m, tasks: plan.tasks.map((x, i) => ({ x, i })).filter(({ x }) => stageOf(x.in_days)?.i === m.i) }));
    const loose = plan.tasks.map((x, i) => ({ x, i })).filter(({ x }) => !stageOf(x.in_days));
    return loose.length ? [...groups, { m: null, tasks: loose }] : groups;
  }, [plan, goal]);

  const make = async (text = goal, days = horizon) => {
    if (!text.trim()) return;
    setBusy(true);
    setPlan(null);
    const p = await ai(() => makePlan(text.trim(), days, open.map((g) => g.title).filter((x) => x !== text.trim()), lang));
    setBusy(false);
    if (p) {
      setPlan(p);
      setOff(new Set());
      setOffM(new Set());
    }
  };

  const approve = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      const h = HORIZONS.find((x) => x.days === horizon) ?? HORIZONS[1];
      const existing = open.find((g) => g.title === goal.trim());
      const top = existing ?? (await db.create('Goal', { title: goal.trim(), level: h.level, status: 'in_progress', progress: 0, auto_progress: true, priority: 'high', due_date: addDays(day, horizon), description: plan.summary }));
      // the goal itself is already the top of the pyramid, so a milestone that just repeats it is dropped
      const stageGoals = await db.bulkCreate('Goal', plan.milestones.filter((m, i) => !offM.has(i) && m.title !== top.title).map((m) => ({ title: m.title, level: h.milestone, parent_id: top.id, status: 'not_started' as const, progress: 0, priority: 'medium' as const, due_date: addDays(day, m.in_days) })));
      let count = 0;
      for (const [i, x] of plan.tasks.entries()) {
        if (off.has(i)) continue;
        const date = addDays(day, x.in_days);
        // the task hangs under its stage, so finishing tasks moves the stage and the stage moves the goal
        const stage = stageGoals.filter((g) => g.due_date && g.due_date >= date).sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0];
        const made = await db.create('DailyTask', { title: x.title, date, time: x.time, minutes: x.time ? 60 : undefined, priority: x.priority, goal_id: stage?.id ?? top.id, completed: false, repeat_days: x.repeat_days?.length ? x.repeat_days : undefined });
        autoSyncTask(made.id);
        if (x.steps.length) await addSteps(made, x.steps);
        if (x.time) {
          const [hh, mm] = x.time.split(':').map(Number);
          const when = new Date(`${date}T00:00:00`);
          when.setHours(hh, mm, 0, 0);
          await scheduleAt(`plan-${made.id}`, `🎯 ${goal.trim()}`, x.title, when);
        }
        count++;
      }
      notice(t.plan.added.replace('{n}', String(count)));
      setPlan(null);
      setGoal('');
      router.navigate('/');
    } catch (e) {
      notice(String((e as Error)?.message ?? e), t.c.error);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (i: number) => setOff((s) => {
    const n = new Set(s);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    return n;
  });

  return (
    <Screen>
      <Card>
        <Txt v="h">🎯 {t.plan.ask}</Txt>
        <Input placeholder={t.plan.goalPh} value={goal} onChangeText={setGoal} multiline suggestions={[...new Set([...open.map((g) => g.title).slice(0, 4), ...t.plan.examples])]} />
        <VoiceToText onText={(text) => text && setGoal(text)} />
        <Txt v="small">{t.plan.horizon}</Txt>
        <Chips options={HORIZONS.map((h) => ({ value: String(h.days), label: t.level[h.level] }))} value={String(horizon)} onChange={(v) => setHorizon(Number(v))} />
        <Btn title={busy ? t.c.aiWorking : `🤖 ${t.plan.make}`} loading={busy} disabled={!goal.trim()} onPress={() => make()} />
      </Card>

      {plan ? (
        <>
          {plan.summary ? <Card><Txt>💡 {plan.summary}</Txt></Card> : null}
          {stages.map(({ m, tasks: group }, k) => (
            <Section key={k} title={m ? `🏁 ${k + 1}. ${m.title}` : `✅ ${t.plan.tasks}`}
              right={m ? <Row><Badge text={fmtDate(addDays(day, m.in_days), lang, t.c)} color={c.primary} /><Check on={!offM.has(m.i)} onPress={() => setOffM((s) => { const n = new Set(s); if (n.has(m.i)) n.delete(m.i); else n.add(m.i); return n; })} /></Row> : undefined}>
              {!group.length ? <Txt v="small">—</Txt> : group.map(({ x, i }) => (
                <Card key={i} onPress={() => toggle(i)} style={{ opacity: off.has(i) ? 0.45 : 1 }}>
                  <Row>
                    <Check on={!off.has(i)} onPress={() => toggle(i)} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt style={{ fontWeight: '600' }}>{x.title}</Txt>
                      <Txt v="small">{fmtDate(addDays(day, x.in_days), lang, t.c)}{x.time ? ` · ${x.time}` : ''}{x.repeat_days?.length ? ` · 🔁 ${t.plan.weekly}` : ''}</Txt>
                      {x.steps.map((st, n) => <Txt key={n} v="small">• {st}</Txt>)}
                    </View>
                    <Badge text={t.prio[x.priority]} color={prioColor(c, x.priority)} />
                  </Row>
                </Card>
              ))}
            </Section>
          ))}
          <Btn title={`➕ ${t.plan.addAll}`} loading={saving} disabled={off.size === plan.tasks.length} onPress={approve} />
          <Btn kind="ghost" title={`🔄 ${t.plan.again}`} disabled={busy} onPress={() => make()} />
        </>
      ) : null}
    </Screen>
  );
}
