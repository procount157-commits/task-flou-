import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { prioColor, useAI } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { addDays, fmtDate, today } from '@/lib/dates';
import { autoSyncTask } from '@/lib/devicecal';
import { db, useEntity } from '@/lib/db';
import { scheduleAt } from '@/lib/notify';
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
  const [saving, setSaving] = useState(false);
  const day = today();
  const open = goals.filter((g) => g.status !== 'completed' && g.status !== 'cancelled');

  const make = async () => {
    if (!goal.trim()) return;
    setBusy(true);
    setPlan(null);
    const p = await ai(() => makePlan(goal.trim(), horizon, open.map((g) => g.title).filter((x) => x !== goal.trim()), lang));
    setBusy(false);
    if (p) {
      setPlan(p);
      setOff(new Set());
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
      await db.bulkCreate('Goal', plan.milestones.filter((m) => m.title !== top.title).map((m) => ({ title: m.title, level: h.milestone, parent_id: top.id, status: 'not_started' as const, progress: 0, priority: 'medium' as const, due_date: addDays(day, m.in_days) })));
      let count = 0;
      for (const [i, x] of plan.tasks.entries()) {
        if (off.has(i)) continue;
        const date = addDays(day, x.in_days);
        const made = await db.create('DailyTask', { title: x.title, date, time: x.time, priority: x.priority, goal_id: top.id, completed: false, repeat_days: x.repeat_days?.length ? x.repeat_days : undefined });
        if (x.steps.length) await db.bulkCreate('DailyTask', x.steps.map((s) => ({ title: s, date, parent_id: made.id, priority: x.priority, completed: false })));
        if (x.time) {
          const [hh, mm] = x.time.split(':').map(Number);
          const when = new Date(`${date}T00:00:00`);
          when.setHours(hh, mm, 0, 0);
          await scheduleAt(`plan-${made.id}`, `🎯 ${goal.trim()}`, x.title, when);
        }
        autoSyncTask(made.id);
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
        <Btn title={busy ? t.c.aiWorking : `🤖 ${t.plan.make}`} loading={busy} disabled={!goal.trim()} onPress={make} />
      </Card>

      {plan ? (
        <>
          {plan.summary ? <Card><Txt>💡 {plan.summary}</Txt></Card> : null}
          <Section title={`🏁 ${t.plan.milestones}`}>
            {plan.milestones.filter((m) => m.title !== goal.trim()).map((m, i) => (
              <Row key={i}><Badge text={fmtDate(addDays(day, m.in_days), lang, t.c)} color={c.primary} /><Txt style={{ flex: 1 }}>{m.title}</Txt></Row>
            ))}
          </Section>
          <Section title={`✅ ${t.plan.tasks} (${plan.tasks.length - off.size})`}>
            {plan.tasks.map((x, i) => (
              <Card key={i} onPress={() => toggle(i)} style={{ opacity: off.has(i) ? 0.45 : 1 }}>
                <Row>
                  <Check on={!off.has(i)} onPress={() => toggle(i)} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt style={{ fontWeight: '600' }}>{x.title}</Txt>
                    <Txt v="small">{fmtDate(addDays(day, x.in_days), lang, t.c)}{x.time ? ` · ${x.time}` : ''}{x.repeat_days?.length ? ` · 🔁 ${t.plan.weekly}` : ''}</Txt>
                    {x.steps.map((s, k) => <Txt key={k} v="small">• {s}</Txt>)}
                  </View>
                  <Badge text={t.prio[x.priority]} color={prioColor(c, x.priority)} />
                </Row>
              </Card>
            ))}
          </Section>
          <Btn title={`➕ ${t.plan.addAll}`} loading={saving} disabled={off.size === plan.tasks.length} onPress={approve} />
          <Btn kind="ghost" title={`🔄 ${t.plan.again}`} disabled={busy} onPress={make} />
        </>
      ) : null}
    </Screen>
  );
}
