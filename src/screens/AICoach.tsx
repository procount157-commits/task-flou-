import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import { lastDays, monthKey, today } from '@/lib/dates';
import { useEntity, useKV } from '@/lib/db';
import { InvokeLLM, NoKeyError } from '@/lib/integrations';
import { goalProgress, money } from '@/lib/logic';
import { commitment, goalStats, habitStats, taskStats } from '@/lib/stats';
import type { Mood } from '@/lib/types';
import { Badge, Btn, Chips, IconBtn, Input, PomodoroBar, Row, Txt, notice } from '@/ui/kit';
import { VoiceToText } from '@/ui/shared';

type Msg = { role: 'user' | 'assistant'; content: string };
const MOOD_SCORE: Record<Mood, number> = { terrible: 1, bad: 2, okay: 3, good: 4, great: 5 };

export default function AICoach() {
  const c = useTheme();
  const { t, dir } = useLang();
  const goals = useEntity('Goal').items;
  const tasks = useEntity('DailyTask').items;
  const habits = useEntity('Habit').items;
  const logs = useEntity('HabitLog').items;
  const txs = useEntity('Transaction').items;
  const journal = useEntity('JournalEntry').items;
  const activity = useEntity('ActivityLog').items;
  const [messages, setMessages] = useKV<Msg[]>('coach:messages', []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const day = today();
  const [report] = useKV<string>(`dayreport:${day}`, '');

  // Everything the model is told about the user: plain numbers and a few named examples per area.
  const context = () => {
    const ts = taskStats(tasks);
    const gs = goalStats(goals);
    const hs = habitStats(habits, logs);
    const income = txs.filter((x) => x.type === 'income').reduce((s, x) => s + x.amount, 0);
    const expense = txs.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amount, 0);
    const byCat: Record<string, number> = {};
    for (const x of txs) if (x.type === 'expense') byCat[x.category ?? 'other'] = (byCat[x.category ?? 'other'] ?? 0) + x.amount;
    const moods = journal.filter((j) => j.mood).map((j) => MOOD_SCORE[j.mood!]);
    const week = new Set(lastDays(7));
    const pending = tasks.filter((x) => !x.parent_id && !x.completed);
    return [
      `Date: ${day}`,
      `GOALS: total ${gs.total}, completed ${gs.done}, in progress ${gs.active}, average progress ${gs.avg}%.`,
      ...gs.byLevel.filter((l) => l.count).map((l) => `  level ${l.level}: ${l.count} goals, avg ${l.value}%`),
      ...goals.slice(0, 15).map((g) => `  - "${g.title}" [${g.level}, ${g.status ?? 'not_started'}, ${goalProgress(g, goals)}%${g.due_date ? `, due ${g.due_date}` : ''}]`),
      `TASKS: total ${ts.total}, done ${ts.done} (${ts.rate}%), pending ${pending.length}, pending high-priority ${pending.filter((x) => x.priority === 'high').length}, today's completion ${ts.todayRate}%, done in last 7 days ${tasks.filter((x) => x.completed && week.has(x.date)).length}.`,
      ...pending.slice(0, 10).map((x) => `  - pending "${x.title}" [${x.priority ?? 'medium'}, ${x.date}]`),
      `HABITS: active ${hs.active}, best streak ${hs.bestStreak}, done today ${hs.doneToday}.`,
      ...habits.map((h) => `  - "${h.title}": streak ${h.streak ?? 0}, 60-day consistency ${commitment(h, logs, 60)}%, 7-day ${commitment(h, logs, 7)}%`),
      `FINANCE (SAR): income ${money(income)}, expenses ${money(expense)}, net ${money(income - expense)}, transactions ${txs.length}, this month expenses ${money(txs.filter((x) => x.type === 'expense' && monthKey(x.date) === monthKey(day)).reduce((s, x) => s + x.amount, 0))}.`,
      ...Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  - ${k}: ${money(v)}`),
      `TODAY'S HOURLY ACTIVITY LOG: ${activity.filter((a) => a.date === day).map((a) => `${a.time} ${a.text ?? '(voice note)'}`).join(' | ') || 'none'}`,
      report ? `TODAY'S ANALYSIS: ${report}` : '',
      `JOURNAL: ${journal.length} entries, average mood ${moods.length ? (moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(1) : 'n/a'} / 5.`,
    ].join('\n');
  };

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: q }];
    await setMessages(next);
    setText('');
    setBusy(true);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    let reply: string;
    try {
      reply = await InvokeLLM([{ role: 'system', content: `${t.coach.system}\n\n${context()}` }, ...next.slice(-10)]);
    } catch (e) {
      if (e instanceof NoKeyError) reply = `${t.coach.localNote}\n\n${context()}`;
      else {
        notice(String((e as Error)?.message ?? e), t.c.aiError);
        setBusy(false);
        return;
      }
    }
    await setMessages([...next, { role: 'assistant', content: reply }]);
    setBusy(false);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90} style={{ flex: 1, backgroundColor: c.bg, direction: dir }}>
      <PomodoroBar />
      <Row wrap gap={6} style={{ padding: 10 }}>
        <Badge text={`🎯 ${goals.length}`} />
        <Badge text={`🔥 ${habits.length}`} />
        <Badge text={`✅ ${tasks.filter((x) => x.date === day && !x.parent_id).length}`} />
        <Badge text={`💰 ${txs.length}`} />
        <View style={{ flex: 1 }} />
        {messages.length ? <IconBtn icon="🧹" label={t.c.delete} onPress={() => setMessages([])} /> : null}
      </Row>
      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 8, maxWidth: 900, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        {!messages.length ? (
          <>
            <Txt v="muted">🤖 {t.coach.welcome}</Txt>
            <Chips options={t.coach.quick.map((q) => ({ value: q, label: q }))} value={null} onChange={ask} />
          </>
        ) : null}
        {messages.map((m, i) => (
          <View key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: m.role === 'user' ? c.primary : c.card, borderRadius: 14, padding: 10, borderWidth: m.role === 'user' ? 0 : 1, borderColor: c.border }}>
            <Txt color={m.role === 'user' ? c.onPrimary : c.text}>{m.content}</Txt>
          </View>
        ))}
        {busy ? <Txt v="muted">🤖 {t.coach.thinking}</Txt> : null}
      </ScrollView>
      {messages.length ? (
        <View style={{ paddingHorizontal: 10 }}>
          <Chips scroll options={t.coach.quick.map((q) => ({ value: q, label: q }))} value={null} onChange={ask} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 10 }}>
        <VoiceToText compact onText={(v) => v && setText((p) => [p, v].filter(Boolean).join(' '))} />
        <View style={{ flex: 1 }}><Input placeholder={t.coach.ph} value={text} onChangeText={setText} multiline style={{ minHeight: 44, maxHeight: 120 }} /></View>
        <Btn title={t.c.send} onPress={() => ask(text)} disabled={!text.trim()} loading={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}
