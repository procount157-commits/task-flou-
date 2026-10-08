import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useAI } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { nowTime, today } from '@/lib/dates';
import { db, kv, useEntity, useKV } from '@/lib/db';
import { GenerateSpeech, InvokeLLM } from '@/lib/integrations';
import { CHECKIN_DEFAULTS, CheckinSettings, scheduleCheckins } from '@/lib/notify';
import { NoTelegramError, sendTelegram } from '@/lib/telegram';
import type { ActivityLog } from '@/lib/types';
import { Btn, Card, Empty, IconBtn, Input, Row, Screen, Section, Suggest, Toggle, Txt, notice } from '@/ui/kit';
import { TimeField } from '@/ui/pickers';
import { AudioClip, VoiceToText } from '@/ui/shared';

type Turn = { role: 'ai' | 'me'; text: string };
// three spoken answers per hour: what I am doing, the fear behind it, what comes next
const TURNS = 3;
// model instructions, not interface text: one job per reply keeps the three questions in order
const STEPS = [
  'Ask exactly ONE short question about the fear or the real motive behind what they just said they are doing. Do not ask about the next hour yet.',
  'Ask exactly ONE short question: what will they do in the next hour, and does it serve one specific goal of theirs? Name that goal.',
  'Do NOT ask anything. Give a three-sentence summary: whether they are moving toward their goals, the fear that surfaced, and one concrete step for the next hour.',
];

// The hourly session: a voice answer to "what are you doing?", then a short Socratic exchange about
// fears and goals that ends with a verdict on whether the next hour serves them.
export default function Checkin() {
  const c = useTheme();
  const { t, lang } = useLang();
  const router = useRouter();
  const params = useLocalSearchParams<{ auto?: string }>();
  const ai = useAI();
  const logs = useEntity('ActivityLog');
  const tasks = useEntity('DailyTask').items;
  const goals = useEntity('Goal').items;
  const [settings, setSettings] = useKV<CheckinSettings>('checkin', CHECKIN_DEFAULTS);
  const [speak, setSpeak] = useKV<boolean>('checkin:speak', true);
  const day = today();
  const [report, setReport] = useKV<string>(`dayreport:${day}`, '');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const logId = useRef<string | null>(null);
  const audio = useRef<string[]>([]);
  const mine = logs.items.filter((l) => l.date === day).sort((a, b) => a.time.localeCompare(b.time));
  const answered = turns.filter((x) => x.role === 'me').length;
  const finished = answered >= TURNS && !busy;
  const question = [...turns].reverse().find((x) => x.role === 'ai')?.text ?? t.checkin.now;

  const say = (text: string) => speak && GenerateSpeech(text, lang);

  const reset = () => {
    logId.current = null;
    audio.current = [];
    setTurns([]);
  };

  // Goals, today's earlier answers and unfinished tasks: what the coach needs to name a real goal.
  const context = () =>
    [
      `Time now: ${nowTime()} on ${day}.`,
      `User's goals: ${goals.filter((g) => g.status !== 'completed' && g.status !== 'cancelled').map((g) => `${g.title} (${g.level})`).join('; ') || 'none recorded yet'}.`,
      `Earlier today: ${mine.map((l) => `${l.time} ${l.text ?? ''}`).join(' | ') || 'nothing yet'}.`,
      `Unfinished tasks today: ${tasks.filter((x) => x.date === day && !x.completed && !x.parent_id).map((x) => x.title).join('; ') || 'none'}.`,
    ].join('\n');

  const answer = async (text: string, uri?: string) => {
    if (finished || busy || (!text.trim() && !uri)) return;
    const said = text.trim() || t.checkin.voiceOnly;
    const next: Turn[] = [...(turns.length ? turns : [{ role: 'ai' as const, text: t.checkin.now }]), { role: 'me', text: said }];
    if (uri) audio.current = [...audio.current, uri];
    setTurns(next);
    setBusy(true);
    const n = next.filter((x) => x.role === 'me').length;

    // the answer is saved before the AI is asked, so nothing spoken is lost if the network fails
    const data: Partial<ActivityLog> = { dialog: next, audio_urls: audio.current, audio_url: audio.current[0] };
    if (logId.current) await logs.update(logId.current, data);
    else logId.current = (await logs.create({ date: day, time: nowTime(), text: said, ...data })).id;

    let reply: string | undefined;
    try {
      reply = await InvokeLLM(
        [
          { role: 'system', content: `${t.checkin.coach}\n\n${context()}\n\nYOUR TASK FOR THIS REPLY (number ${n} of ${TURNS}): ${STEPS[n - 1]}` },
          ...next.map((x) => ({ role: x.role === 'ai' ? ('assistant' as const) : ('user' as const), content: x.text })),
        ],
        0.8,
      );
    } catch {
      // no key or no network: fall back to the built-in questions so the session still happens
    }
    reply ||= n >= TURNS ? t.checkin.closing : t.checkin.bank[(new Date().getHours() * 3 + n) % t.checkin.bank.length];
    const full: Turn[] = [...next, { role: 'ai', text: reply }];
    setTurns(full);
    setBusy(false);
    await logs.update(logId.current!, { dialog: full });
    say(reply);
  };

  // opened from the hourly notification: read the question out
  useEffect(() => {
    if (params.auto) say(t.checkin.now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.auto]);

  const apply = async (next: CheckinSettings) => {
    await setSettings(next);
    await scheduleCheckins(next, t.checkin.now, t.checkin.bank);
    await kv.set('sched:checkin', JSON.stringify([next, t.checkin.now]));
  };
  const summary = () => mine.map((l) => `${l.time} — ${(l.dialog ?? []).filter((d) => d.role === 'me').map((d) => d.text).join(' / ') || l.text || '🎤'}`).join('\n');

  const analyze = async () => {
    if (!mine.length) return notice(t.checkin.needLogs);
    setAnalyzing(true);
    const done = tasks.filter((x) => x.date === day && x.completed && !x.parent_id).map((x) => x.title);
    const pending = tasks.filter((x) => x.date === day && !x.completed && !x.parent_id).map((x) => x.title);
    const out = await ai(() => InvokeLLM([{ role: 'system', content: t.checkin.system }, { role: 'user', content: `${day}\n${summary()}\n\nDone tasks: ${done.join('; ') || '-'}\nUnfinished tasks: ${pending.join('; ') || '-'}` }], 0.4));
    setAnalyzing(false);
    if (out) await setReport(out);
  };

  const toJournal = async () => {
    if (!mine.length) return notice(t.checkin.needLogs);
    const content = [summary(), report].filter(Boolean).join('\n\n');
    const existing = (await db.list('JournalEntry')).find((j) => j.date === day);
    if (existing) await db.update('JournalEntry', existing.id, { content: [existing.content, content].filter(Boolean).join('\n\n') });
    else await db.create('JournalEntry', { date: day, mood: 'okay', content, audio_urls: mine.flatMap((l) => l.audio_urls ?? []) });
    notice(t.checkin.journalDone);
  };

  const toTelegram = async () => {
    try {
      await sendTelegram(`${t.checkin.log} ${day}\n${summary()}${report ? `\n\n${t.checkin.report}\n${report}` : ''}`);
      notice(t.tg.sent);
    } catch (e) {
      notice(e instanceof NoTelegramError ? t.tg.missing : String((e as Error).message));
    }
  };

  return (
    <Screen>
      <Card style={{ borderColor: c.primary, gap: 12 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="small">{nowTime()} · {t.checkin.turn} {Math.min(answered + 1, TURNS)}/{TURNS}</Txt>
          {turns.length ? <Btn small kind="ghost" title={t.checkin.newSession} onPress={reset} /> : null}
        </Row>
        {turns.slice(0, -1).map((x, i) => (
          <View key={i} style={{ alignSelf: x.role === 'me' ? 'flex-end' : 'flex-start', maxWidth: '90%', backgroundColor: x.role === 'me' ? c.soft : 'transparent', borderRadius: 12, padding: x.role === 'me' ? 8 : 0 }}>
            <Txt v={x.role === 'me' ? 'body' : 'muted'}>{x.text}</Txt>
          </View>
        ))}
        {busy ? <Txt v="muted" center>🤔 {t.checkin.thinking}</Txt> : <Txt v="h" center>{question}</Txt>}
        {finished ? (
          <Txt v="muted" center color={c.success}>✓ {t.checkin.done}</Txt>
        ) : (
          <>
            <VoiceToText big autoStart={!!params.auto} onText={(v, uri) => answer(v, uri)} />
            {!turns.length ? <Suggest items={t.checkin.quick} onPick={(v) => answer(v)} /> : null}
            <Row>
              <View style={{ flex: 1 }}><Input value={typed} onChangeText={setTyped} placeholder={t.c.notes} onSubmitEditing={() => { answer(typed); setTyped(''); }} /></View>
              <Btn small kind="ghost" title={t.c.send} disabled={!typed.trim()} onPress={() => { answer(typed); setTyped(''); }} />
              <Btn small kind="ghost" title={t.checkin.hear} onPress={() => GenerateSpeech(question, lang)} />
            </Row>
          </>
        )}
      </Card>

      <Section title={`${t.checkin.log} · ${day}`}>
        {!mine.length ? <Empty icon="🕐" text={t.checkin.empty} /> : mine.map((l) => (
          <Card key={l.id} onPress={() => setOpen(open === l.id ? null : l.id)}>
            <Row>
              <Txt v="small" color={c.primary}>{l.time}</Txt>
              <Txt style={{ flex: 1 }} numberOfLines={open === l.id ? undefined : 1}>{l.text ?? '🎤'}</Txt>
              <IconBtn icon="✕" label={t.c.delete} onPress={() => logs.remove(l.id)} />
            </Row>
            {open === l.id ? (
              <View style={{ gap: 6 }}>
                {(l.dialog ?? []).slice(2).map((d, i) => <Txt key={i} v={d.role === 'ai' ? 'muted' : 'body'}>{d.role === 'ai' ? '🤖 ' : '🗣 '}{d.text}</Txt>)}
                {(l.audio_urls ?? (l.audio_url ? [l.audio_url] : [])).map((u) => <AudioClip key={u} uri={u} />)}
              </View>
            ) : null}
          </Card>
        ))}
      </Section>

      <Btn title={t.checkin.analyze} loading={analyzing} onPress={analyze} />
      {report ? (
        <Card style={{ borderColor: c.primary }}>
          <Txt v="sub">{t.checkin.report}</Txt>
          <Txt>{report}</Txt>
        </Card>
      ) : null}
      <Row wrap>
        <Btn kind="ghost" title={t.checkin.discuss} onPress={() => router.push('/ai-coach')} style={{ flexGrow: 1 }} />
        <Btn kind="ghost" title={t.checkin.toJournal} onPress={toJournal} style={{ flexGrow: 1 }} />
        <Btn kind="ghost" title={t.checkin.toTelegram} onPress={toTelegram} style={{ flexGrow: 1 }} />
      </Row>

      <Card>
        <Toggle label={`🔔 ${t.checkin.enable}`} value={settings.enabled} onChange={(enabled) => apply({ ...settings, enabled })} />
        <Toggle label={`🔊 ${t.checkin.speak}`} value={speak} onChange={setSpeak} />
        <Row>
          <View style={{ flex: 1 }}><TimeField label={t.checkin.from} value={settings.from} allowClear={false} onChange={(v) => v && apply({ ...settings, from: v })} /></View>
          <View style={{ flex: 1 }}><TimeField label={t.checkin.to} value={settings.to} allowClear={false} onChange={(v) => v && apply({ ...settings, to: v })} /></View>
        </Row>
      </Card>
    </Screen>
  );
}
