import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import { nowTime, today } from '@/lib/dates';
import { useEntity } from '@/lib/db';
import { logError } from '@/lib/errlog';
import { InvokeLLM } from '@/lib/integrations';
import { closeHourly } from '@/lib/phonelock';
import type { ActivityLog } from '@/lib/types';
import { Btn, Card, Input, Row, Txt } from '@/ui/kit';
import { VoiceToText } from '@/ui/shared';
import { Text } from '@/ui/text';

type Turn = { role: 'ai' | 'me'; text: string };

/** The notification's four questions, asked inside the app: tap, type or speak each answer. */
export function QuickHour({ hour, onDone }: { hour?: string; onDone?: () => void }) {
  const c = useTheme();
  const { t } = useLang();
  const logs = useEntity('ActivityLog');
  const goals = useEntity('Goal').items;
  const steps = t.checkin.notif.steps;
  const [answers, setAnswers] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [reading, setReading] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const index = answers.length;
  const step = steps[index];
  const time = hour ?? nowTime();

  const answer = async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTyped('');
    const next = [...answers, clean];
    setAnswers(next);
    if (next.length < steps.length) return;

    // all four answered: file the hour first, then ask the AI for its short reading
    const dialog: Turn[] = steps.flatMap((s, i) => [{ role: 'ai' as const, text: s.q }, { role: 'me' as const, text: next[i] }]);
    let saved: ActivityLog | undefined;
    try {
      saved = await logs.create({ date: today(), time, text: next[0], dialog });
    } catch (e) {
      logError('hour-save', e);
    }
    closeHourly();
    setThinking(true);
    try {
      const goal = goals.find((g) => g.status !== 'completed' && g.status !== 'cancelled' && g.priority === 'high') ?? goals.find((g) => g.status !== 'completed');
      const out = await InvokeLLM([
        { role: 'system', content: t.checkin.notif.system },
        { role: 'user', content: dialog.map((d) => `${d.role === 'ai' ? 'Q' : 'A'}: ${d.text}`).join('\n') + (goal ? `\nTop goal: ${goal.title}` : '') },
      ], 0.5);
      setReading(out);
      if (saved) await logs.update(saved.id, { dialog: [...dialog, { role: 'ai', text: out }] });
    } catch (e) {
      setReading(t.checkin.closing);
      logError('hour-ai', e);
    } finally {
      setThinking(false);
    }
  };

  const restart = () => {
    setAnswers([]);
    setReading(null);
    onDone?.();
  };

  return (
    <Card style={{ borderColor: c.primary, gap: 12 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="small" color={c.primary}>🕐 {time}</Txt>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {steps.map((_, i) => <View key={i} style={{ width: 22, height: 5, borderRadius: 3, backgroundColor: i < index ? c.success : i === index ? c.primary : c.border }} />)}
        </View>
      </Row>
      {answers.map((a, i) => (
        <View key={i} style={{ gap: 2 }}>
          <Txt v="small">{steps[i].q}</Txt>
          <View style={{ alignSelf: 'flex-start', backgroundColor: c.soft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}><Txt>{a}</Txt></View>
        </View>
      ))}
      {step ? (
        <>
          <Text style={{ fontSize: 22, fontWeight: '700', color: c.text, textAlign: 'center' }}>{step.q}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {step.choices.map((ch) => (
              <Pressable key={ch} onPress={() => answer(ch)} accessibilityRole="button"
                style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: c.primary }}>
                <Text style={{ color: c.onPrimary, fontSize: 15 }}>{ch}</Text>
              </Pressable>
            ))}
          </View>
          {step.input ? (
            <Row>
              <View style={{ flex: 1 }}><Input value={typed} onChangeText={setTyped} placeholder={t.checkin.notif.typeLabel} onSubmitEditing={() => answer(typed)} /></View>
              <Btn small title={t.c.send} disabled={!typed.trim()} onPress={() => answer(typed)} />
              <VoiceToText compact onText={(v) => answer(v)} />
            </Row>
          ) : null}
        </>
      ) : (
        <View style={{ gap: 8 }}>
          <Txt v="sub" color={c.success}>{t.checkin.notif.doneTitle}</Txt>
          {thinking ? <Txt v="muted">{t.checkin.notif.analyzing}</Txt> : reading ? <Txt>🤖 {reading}</Txt> : null}
          <Btn kind="ghost" title={t.checkin.newSession} onPress={restart} />
        </View>
      )}
    </Card>
  );
}

/** Today's hours side by side: what was done in each one, and the gaps still to fill. */
export function DayTimeline({ from, to, onFill }: { from: string; to: string; onFill: (hour: string) => void }) {
  const c = useTheme();
  const { t } = useLang();
  const logs = useEntity('ActivityLog').items.filter((l) => l.date === today());
  const now = new Date().getHours();
  const first = Number(from.slice(0, 2));
  const last = Math.min(Number(to.slice(0, 2)), now);
  // the latest hour first, so the one that matters now is at the top
  const hours = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => last - i);
  if (!hours.length) return null;
  const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return (
    <View style={{ gap: 6 }}>
      <Txt v="sub">🗓 {t.checkin.timeline}</Txt>
      {hours.map((h) => {
        const inHour = logs.filter((l) => Number(l.time.slice(0, 2)) === h);
        const mood = inHour.flatMap((l) => l.dialog ?? []).filter((d) => d.role === 'me').map((d) => d.text);
        const filled = inHour.length > 0;
        return (
          <Pressable key={h} onPress={() => !filled && onFill(pad(h))} accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, borderStartWidth: 4, borderColor: filled ? c.success : c.border }}>
            <Txt v="small" color={filled ? c.primary : c.muted}>{pad(h)}</Txt>
            <Txt style={{ flex: 1 }} numberOfLines={1} color={filled ? c.text : c.muted}>{filled ? (mood.slice(0, 3).join(' · ') || inHour[0].text || '🎤') : `+ ${t.checkin.fill}`}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
