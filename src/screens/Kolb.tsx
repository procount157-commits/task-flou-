import React, { useState } from 'react';
import { View } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import { isDate, today } from '@/lib/dates';
import { useEntity } from '@/lib/db';
import type { KolbSession } from '@/lib/types';
import { Badge, Btn, Card, Empty, IconBtn, Input, Loading, Row, Screen, Sheet, Tabs, Toggle, Txt, confirm } from '@/ui/kit';
import { DateField } from '@/ui/pickers';
import { AudioClip, VoiceToText } from '@/ui/shared';

const PREFIXES = ['exp_', 'ref_', 'abs_', 'act_'];
const STAGE_ICONS = ['🧪', '🔍', '🧠', '🚀'];

export default function Kolb() {
  const c = useTheme();
  const { t } = useLang();
  const sessions = useEntity('KolbSession');
  const [draft, setDraft] = useState<Partial<KolbSession> | null>(null);
  const [stage, setStage] = useState('0');
  const [viewing, setViewing] = useState<KolbSession | null>(null);
  const [error, setError] = useState('');
  const q = t.kolb.q as Record<string, string>;
  const fieldsOf = (i: number) => Object.keys(q).filter((k) => k.startsWith(PREFIXES[i]));

  const save = async () => {
    if (!draft?.title?.trim() || !isDate(draft.date)) return setError(!draft?.title?.trim() ? t.c.required : t.c.invalidDate);
    const { id, created_date, updated_date, created_by_id, ...data } = draft as KolbSession;
    if (id) await sessions.update(id, data);
    else await sessions.create({ ...data, title: data.title.trim() });
    setDraft(null);
  };

  const list = [...sessions.items].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Screen>
      <Row wrap>
        {t.kolb.stages.map((s, i) => (
          <Card key={s} style={{ flexGrow: 1, flexBasis: '45%', gap: 2 }}>
            <Txt style={{ fontWeight: '600' }}>{STAGE_ICONS[i]} {i + 1}. {s}</Txt>
            <Txt v="small">{t.kolb.intro[i]}</Txt>
          </Card>
        ))}
      </Row>
      <Btn title={`+ ${t.kolb.add}`} onPress={() => { setStage('0'); setError(''); setDraft({ date: today(), is_followup: false, audio_urls: [] }); }} />

      {sessions.loading ? <Loading /> : !list.length ? <Empty icon="🔄" text={t.kolb.empty} /> : list.map((s) => (
        <Card key={s.id}>
          <Row>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: '600' }}>{s.title}</Txt>
              <Txt v="small">{s.date}</Txt>
            </View>
            <Badge text={s.is_followup ? t.kolb.followup : t.kolb.new} color={s.is_followup ? c.warn : c.primary} />
          </Row>
          <Row>
            <Btn small kind="ghost" title={`👁 ${t.c.view}`} onPress={() => setViewing(s)} />
            <IconBtn icon="✏️" label={t.c.edit} onPress={() => { setStage('0'); setError(''); setDraft(s); }} />
            <IconBtn icon="🗑" label={t.c.delete} onPress={() => confirm(t.c.confirmDelete, () => sessions.remove(s.id), t.c.delete, t.c.cancel)} />
          </Row>
        </Card>
      ))}

      <Sheet visible={!!draft} onClose={() => setDraft(null)} title={draft?.id ? t.c.edit : t.kolb.add} footer={
        <Row>
          {Number(stage) < 3 ? <Btn kind="ghost" title={`${t.c.next} ›`} onPress={() => setStage(String(Number(stage) + 1))} style={{ flex: 1 }} /> : null}
          <Btn title={t.c.save} onPress={save} style={{ flex: 2 }} />
        </Row>
      }>
        {draft ? (
          <>
            <Input label={`${t.c.title} *`} value={draft.title ?? ''} onChangeText={(title) => setDraft({ ...draft, title })} />
            <DateField label={`${t.c.date} *`} value={draft.date} onChange={(date) => setDraft({ ...draft, date })} allowClear={false} />
            {error ? <Txt v="small" color={c.danger}>{error}</Txt> : null}
            <Toggle label={t.kolb.isFollowup} value={!!draft.is_followup} onChange={(is_followup) => setDraft({ ...draft, is_followup })} />
            <Tabs options={t.kolb.stages.map((s, i) => ({ value: String(i), label: `${i + 1}. ${s}` }))} value={stage} onChange={setStage} />
            {fieldsOf(Number(stage)).map((k) => (
              <View key={k} style={{ gap: 4 }}>
                <Input multiline label={q[k]} value={draft[k] ?? ''} onChangeText={(v) => setDraft({ ...draft, [k]: v })} style={{ minHeight: 48 }} suggestions={t.sug.kolb} />
                <Row><VoiceToText onText={(text) => text && setDraft((d) => (d ? { ...d, [k]: [d[k], text].filter(Boolean).join(' ') } : d))} /></Row>
              </View>
            ))}
            <Txt v="muted">🎙 {t.kolb.recordings}</Txt>
            {(draft.audio_urls ?? []).map((u: string, i: number) => <AudioClip key={u} uri={u} onRemove={() => setDraft({ ...draft, audio_urls: draft.audio_urls!.filter((_: string, k: number) => k !== i) })} />)}
            <VoiceToText onText={(_text, uri) => setDraft((d) => (d ? { ...d, audio_urls: [...(d.audio_urls ?? []), uri] } : d))} />
          </>
        ) : null}
      </Sheet>

      <Sheet visible={!!viewing} onClose={() => setViewing(null)} title={viewing?.title}>
        {viewing ? (
          <>
            <Txt v="muted">{viewing.date} · {viewing.is_followup ? t.kolb.followup : t.kolb.new}</Txt>
            {t.kolb.stages.map((s, i) => {
              const filled = fieldsOf(i).filter((k) => String(viewing[k] ?? '').trim());
              if (!filled.length) return null;
              return (
                <Card key={s}>
                  <Txt v="sub">{STAGE_ICONS[i]} {t.kolb.stage} {i + 1}: {s}</Txt>
                  {filled.map((k) => (
                    <View key={k}>
                      <Txt v="small">{q[k]}</Txt>
                      <Txt>{viewing[k]}</Txt>
                    </View>
                  ))}
                </Card>
              );
            })}
            {(viewing.audio_urls ?? []).length ? <Txt v="muted">🎙 {t.kolb.recordings}</Txt> : null}
            {(viewing.audio_urls ?? []).map((u: string) => <AudioClip key={u} uri={u} />)}
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
