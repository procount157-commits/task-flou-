import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useLang } from '@/ctx/Lang';
import { lastDays, today } from '@/lib/dates';
import { logError } from '@/lib/errlog';
import { InvokeLLM } from '@/lib/integrations';
import { useEntity } from '@/lib/db';
import type { JournalEntry, Mood } from '@/lib/types';
import { Btn, Card, Chips, Empty, IconBtn, Input, Loading, Progress, Row, Screen, Section, Txt, confirm } from '@/ui/kit';
import { DateField } from '@/ui/pickers';
import { AudioClip, VoiceToText, useCelebrate } from '@/ui/shared';

const MOODS: { value: Mood; icon: string }[] = [
  { value: 'terrible', icon: '😫' }, { value: 'bad', icon: '😕' }, { value: 'okay', icon: '😐' }, { value: 'good', icon: '🙂' }, { value: 'great', icon: '🤩' },
];
type Draft = Pick<JournalEntry, 'mood' | 'energy' | 'content' | 'wins' | 'gratitude' | 'improvements' | 'tomorrow_focus' | 'audio_urls'>;

export default function Journal() {
  const { t } = useLang();
  const entries = useEntity('JournalEntry');
  const celebrate = useCelebrate();
  const [day, setDay] = useState(today());
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>({});
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const existing = entries.items.find((e) => e.date === day);

  useEffect(() => {
    setD(existing ? { mood: existing.mood, energy: existing.energy, content: existing.content, wins: existing.wins, gratitude: existing.gratitude, improvements: existing.improvements, tomorrow_focus: existing.tomorrow_focus, audio_urls: existing.audio_urls } : {});
    setStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, existing?.id]);

  const set = (k: keyof Draft) => (v: any) => setD((p) => ({ ...p, [k]: v }));

  const save = async () => {
    const data = {
      ...d,
      // the structured copy of the guided answers
      reflection_answers: { wins: d.wins ?? '', gratitude: d.gratitude ?? '', improvements: d.improvements ?? '', tomorrow_focus: d.tomorrow_focus ?? '' },
    };
    if (existing) await entries.update(existing.id, data);
    else await entries.create({ date: day, ...data });
    celebrate(t.journal.saved);
    setStep(0);
  };

  // Speak the day: the recording is transcribed, and the AI files it into the journal's own fields.
  const [voiceBusy, setVoiceBusy] = useState(false);
  const fromVoice = async (text: string, uri: string) => {
    if (!text.trim()) {
      setD((p) => ({ ...p, audio_urls: [...(p.audio_urls ?? []), uri] }));
      return;
    }
    setVoiceBusy(true);
    let f: Partial<Draft> = {};
    try {
      const out = await InvokeLLM(
        `${t.journal.voiceSystem}\n\n"${text}"\n\nReply ONLY with JSON: {"mood": "great|good|okay|bad|terrible", "energy": 1-5, "wins": "...", "gratitude": "...", "improvements": "...", "tomorrow_focus": "..."}`,
        0.3,
      );
      const m = out.match(/\{[\s\S]*\}/);
      const j = m ? JSON.parse(m[0]) : {};
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      f = {
        mood: MOODS.some((x) => x.value === j.mood) ? j.mood : undefined,
        energy: Number.isInteger(j.energy) && j.energy >= 1 && j.energy <= 5 ? j.energy : undefined,
        wins: str(j.wins), gratitude: str(j.gratitude), improvements: str(j.improvements), tomorrow_focus: str(j.tomorrow_focus),
      };
    } catch (e) {
      logError('journal-voice', e);
    }
    const merged: Draft = {
      ...d,
      ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)),
      content: [d.content, text.trim()].filter(Boolean).join('\n\n'),
      audio_urls: [...(d.audio_urls ?? []), uri],
    };
    setD(merged);
    const data = { ...merged, reflection_answers: { wins: merged.wins ?? '', gratitude: merged.gratitude ?? '', improvements: merged.improvements ?? '', tomorrow_focus: merged.tomorrow_focus ?? '' } };
    if (existing) await entries.update(existing.id, data);
    else await entries.create({ date: day, ...data });
    setVoiceBusy(false);
    celebrate(t.journal.saved);
  };

  const past = entries.items.filter((e) => !search.trim() || e.date.includes(search.trim())).sort((a, b) => b.date.localeCompare(a.date));
  const moodIcon = (m?: Mood) => MOODS.find((x) => x.value === m)?.icon ?? '📝';
  const steps = [
    <View key="mood" style={{ gap: 8 }}>
      <Txt v="sub">{t.journal.mood}</Txt>
      <Chips options={MOODS.map((m) => ({ value: m.value, label: `${m.icon} ${t.mood[m.value]}` }))} value={d.mood} onChange={set('mood')} />
    </View>,
    <View key="energy" style={{ gap: 8 }}>
      <Txt v="sub">{t.journal.energy}</Txt>
      <Chips options={t.energy.map((label, i) => ({ value: String(i + 1), label: `${'⚡'.repeat(i + 1)} ${label}` }))} value={d.energy ? String(d.energy) : undefined} onChange={(v) => set('energy')(Number(v))} />
    </View>,
    <View key="free" style={{ gap: 8 }}>
      <Txt v="sub">{t.journal.free}</Txt>
      <Input multiline placeholder={t.journal.freePh} value={d.content ?? ''} onChangeText={set('content')} style={{ minHeight: 120 }} suggestions={t.sug.journal} />
      <VoiceToText onText={(text, uri) => setD((p) => ({ ...p, content: [p.content, text].filter(Boolean).join(' '), audio_urls: [...(p.audio_urls ?? []), uri] }))} />
      {(d.audio_urls ?? []).map((u, i) => <AudioClip key={u} uri={u} onRemove={() => set('audio_urls')(d.audio_urls!.filter((_, k) => k !== i))} />)}
    </View>,
    <View key="guided" style={{ gap: 8 }}>
      <Input multiline label={t.journal.wins} value={d.wins ?? ''} onChangeText={set('wins')} suggestions={t.sug.wins} />
      <Input multiline label={t.journal.gratitude} value={d.gratitude ?? ''} onChangeText={set('gratitude')} suggestions={t.sug.gratitude} />
      <Input multiline label={t.journal.improve} value={d.improvements ?? ''} onChangeText={set('improvements')} suggestions={t.sug.improve} />
      <Input multiline label={t.journal.tomorrow} value={d.tomorrow_focus ?? ''} onChangeText={set('tomorrow_focus')} suggestions={t.sug.tomorrow} />
    </View>,
  ];

  return (
    <Screen>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
        {lastDays(14).reverse().map((x) => (
          <Btn key={x} small kind={x === day ? 'primary' : 'ghost'} title={`${entries.items.some((e) => e.date === x) ? '● ' : ''}${x === today() ? t.c.today : x.slice(5)}`} onPress={() => setDay(x)} />
        ))}
      </ScrollView>
      <Card style={{ gap: 10, alignItems: 'center' }}>
        <Txt v="sub" center>🎙 {t.journal.speakDay}</Txt>
        <Txt v="small" center>{t.journal.speakHint}</Txt>
        {voiceBusy ? <Txt v="muted">🤖 {t.journal.filing}</Txt> : <VoiceToText big onText={fromVoice} />}
      </Card>

      <Card>
        <Txt v="small">{day} · {t.journal.step} {step + 1} / {steps.length}</Txt>
        <Progress value={((step + 1) / steps.length) * 100} />
        {steps[step]}
        <Row>
          {step > 0 ? <Btn kind="ghost" title={t.c.back} onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
          {step < steps.length - 1
            ? <Btn title={t.c.next} onPress={() => setStep(step + 1)} disabled={step === 0 && !d.mood} style={{ flex: 2 }} />
            : <Btn title={t.c.save} onPress={save} disabled={!d.mood} style={{ flex: 2 }} />}
        </Row>
      </Card>

      <Section title={t.journal.previous}>
        <DateField value={search || undefined} onChange={(v) => setSearch(v ?? '')} />
        {entries.loading ? <Loading /> : !past.length ? <Empty icon="📔" text={t.journal.empty} /> : past.map((e) => (
          <Card key={e.id} onPress={() => setOpen(open === e.id ? null : e.id)}>
            <Row>
              <Txt style={{ flex: 1, fontWeight: '600' }}>{moodIcon(e.mood)} {e.date}</Txt>
              {e.mood ? <Txt v="small">{t.mood[e.mood]}</Txt> : null}
              <Txt v="muted">{open === e.id ? '▾' : '▸'}</Txt>
            </Row>
            {open === e.id ? (
              <View style={{ gap: 6 }}>
                {e.energy ? <Txt v="muted">{t.journal.energy}: {t.energy[e.energy - 1]}</Txt> : null}
                {e.content ? <Txt>{e.content}</Txt> : null}
                {e.wins ? <Txt v="muted">{t.journal.wins}: {e.wins}</Txt> : null}
                {e.gratitude ? <Txt v="muted">{t.journal.gratitude}: {e.gratitude}</Txt> : null}
                {e.improvements ? <Txt v="muted">{t.journal.improve}: {e.improvements}</Txt> : null}
                {e.tomorrow_focus ? <Txt v="muted">{t.journal.tomorrow}: {e.tomorrow_focus}</Txt> : null}
                {(e.audio_urls ?? []).map((u) => <AudioClip key={u} uri={u} />)}
                <Row>
                  <Btn small kind="ghost" title={t.c.edit} onPress={() => setDay(e.date)} />
                  <IconBtn icon="🗑" label={t.c.delete} onPress={() => confirm(t.c.confirmDelete, () => entries.remove(e.id), t.c.delete, t.c.cancel)} />
                </Row>
              </View>
            ) : null}
          </Card>
        ))}
      </Section>
    </Screen>
  );
}
