import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useAI } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { nowTime, today } from '@/lib/dates';
import { db, useEntity, useKV } from '@/lib/db';
import { InvokeLLM } from '@/lib/integrations';
import { CHECKIN_DEFAULTS, CheckinSettings, scheduleCheckins } from '@/lib/notify';
import { NoTelegramError, sendTelegram } from '@/lib/telegram';
import { Btn, Card, Empty, IconBtn, Input, Row, Screen, Section, Suggest, Toggle, Txt, notice } from '@/ui/kit';
import { TimeField } from '@/ui/pickers';
import { AudioClip, VoiceToText } from '@/ui/shared';

// The hourly "what were you doing?" log: answer by voice or one tap, then let the AI break the day down.
export default function Checkin() {
  const c = useTheme();
  const { t } = useLang();
  const router = useRouter();
  const ai = useAI();
  const logs = useEntity('ActivityLog');
  const tasks = useEntity('DailyTask').items;
  const [settings, setSettings] = useKV<CheckinSettings>('checkin', CHECKIN_DEFAULTS);
  const day = today();
  const [report, setReport] = useKV<string>(`dayreport:${day}`, '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = logs.items.filter((l) => l.date === day).sort((a, b) => a.time.localeCompare(b.time));

  const add = async (value: string, audio_url?: string) => {
    if (!value.trim() && !audio_url) return;
    await logs.create({ date: day, time: nowTime(), text: value.trim() || undefined, audio_url });
    setText('');
  };
  const apply = async (next: CheckinSettings) => {
    await setSettings(next);
    await scheduleCheckins(next, t.checkin.question);
  };
  const summary = () => mine.map((l) => `${l.time} — ${l.text ?? '🎤'}`).join('\n');

  const analyze = async () => {
    if (!mine.length) return notice(t.checkin.needLogs);
    setBusy(true);
    const done = tasks.filter((x) => x.date === day && x.completed && !x.parent_id).map((x) => x.title);
    const pending = tasks.filter((x) => x.date === day && !x.completed && !x.parent_id).map((x) => x.title);
    const out = await ai(() => InvokeLLM([{ role: 'system', content: t.checkin.system }, { role: 'user', content: `${day}\n${summary()}\n\nDone tasks: ${done.join('; ') || '-'}\nUnfinished tasks: ${pending.join('; ') || '-'}` }], 0.4));
    setBusy(false);
    if (out) await setReport(out);
  };

  const toJournal = async () => {
    if (!mine.length) return notice(t.checkin.needLogs);
    const content = [summary(), report].filter(Boolean).join('\n\n');
    const existing = (await db.list('JournalEntry')).find((j) => j.date === day);
    if (existing) await db.update('JournalEntry', existing.id, { content: [existing.content, content].filter(Boolean).join('\n\n') });
    else await db.create('JournalEntry', { date: day, mood: 'okay', content, audio_urls: mine.map((l) => l.audio_url).filter(Boolean) as string[] });
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
      <Card style={{ alignItems: 'stretch' }}>
        <Txt v="h" center>🎙 {t.checkin.question}</Txt>
        <VoiceToText onText={(v, uri) => add(v, uri)} />
        <Suggest items={t.checkin.quick} onPick={(v) => add(v)} />
        <Row>
          <View style={{ flex: 1 }}><Input value={text} onChangeText={setText} placeholder={t.c.notes} onSubmitEditing={() => add(text)} /></View>
          <Btn small title={t.c.add} disabled={!text.trim()} onPress={() => add(text)} />
        </Row>
      </Card>

      <Section title={`${t.checkin.log} · ${day}`}>
        {!mine.length ? <Empty icon="🕐" text={t.checkin.empty} /> : (
          <Card>
            {mine.map((l) => (
              <Row key={l.id}>
                <Txt v="small" color={c.primary}>{l.time}</Txt>
                <Txt style={{ flex: 1 }}>{l.text ?? '🎤'}</Txt>
                {l.audio_url ? <AudioClip uri={l.audio_url} /> : null}
                <IconBtn icon="✕" label={t.c.delete} onPress={() => logs.remove(l.id)} />
              </Row>
            ))}
          </Card>
        )}
      </Section>

      <Btn title={t.checkin.analyze} loading={busy} onPress={analyze} />
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
        <Row>
          <View style={{ flex: 1 }}><TimeField label={t.checkin.from} value={settings.from} allowClear={false} onChange={(v) => v && apply({ ...settings, from: v })} /></View>
          <View style={{ flex: 1 }}><TimeField label={t.checkin.to} value={settings.to} allowClear={false} onChange={(v) => v && apply({ ...settings, to: v })} /></View>
        </Row>
      </Card>
    </Screen>
  );
}
