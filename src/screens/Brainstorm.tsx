import React, { useState } from 'react';
import { View } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import { useEntity } from '@/lib/db';
import type { BrainCategory, BrainstormIdea } from '@/lib/types';
import { FormModal } from '@/ui/Form';
import { Badge, Btn, Card, Chips, Empty, IconBtn, Input, Loading, Row, Screen, Stat, Txt, confirm, opts } from '@/ui/kit';
import { AudioClip, VoiceToText } from '@/ui/shared';

const ICONS: Record<BrainCategory, string> = { idea: '💡', project: '🚀', problem: '⚠️', opportunity: '🌟', note: '📝' };

export default function Brainstorm() {
  const c = useTheme();
  const { t } = useLang();
  const ideas = useEntity('BrainstormIdea');
  const [quick, setQuick] = useState('');
  const [filter, setFilter] = useState<'all' | BrainCategory>('all');
  const [form, setForm] = useState<Partial<BrainstormIdea> | null>(null);

  const capture = async (text: string, audio_url?: string) => {
    const clean = text.trim();
    if (!clean && !audio_url) return;
    await ideas.create({ title: clean ? clean.slice(0, 80) : `🎤 ${new Date().toLocaleString()}`, content: clean.length > 80 ? clean : undefined, category: 'idea', tags: [], starred: false, audio_url });
    setQuick('');
  };

  const list = ideas.items
    .filter((i) => filter === 'all' || (i.category ?? 'idea') === filter)
    .sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || b.created_date.localeCompare(a.created_date));

  return (
    <Screen>
      <Card>
        <Input placeholder={t.brain.quickPh} value={quick} onChangeText={setQuick} multiline onSubmitEditing={() => capture(quick)} />
        <Row>
          <Btn title={t.c.save} disabled={!quick.trim()} onPress={() => capture(quick)} style={{ flex: 1 }} />
          <VoiceToText onText={(text, uri) => capture(text, uri)} />
        </Row>
      </Card>

      <Row wrap>
        <Stat icon="💡" label={t.brain.total} value={ideas.items.length} />
        <Stat icon="🚀" label={t.brain.projects} value={ideas.items.filter((i) => i.category === 'project').length} />
        <Stat icon="🌟" label={t.brain.opportunities} value={ideas.items.filter((i) => i.category === 'opportunity').length} />
      </Row>

      <Chips scroll options={[{ value: 'all' as const, label: t.c.all }, ...opts(t.brainCat)]} value={filter} onChange={setFilter} />

      {ideas.loading ? <Loading /> : !list.length ? <Empty icon="💡" text={t.brain.empty} /> : list.map((i) => (
        <Card key={i.id}>
          <Row>
            <IconBtn icon={i.starred ? '⭐' : '☆'} label={t.c.star} onPress={() => ideas.update(i.id, { starred: !i.starred })} />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: '600' }}>{ICONS[i.category ?? 'idea']} {i.title}</Txt>
              {i.content ? <Txt v="muted">{i.content}</Txt> : null}
            </View>
            <IconBtn icon="✏️" label={t.c.edit} onPress={() => setForm(i)} />
            <IconBtn icon="🗑" label={t.c.delete} onPress={() => confirm(t.c.confirmDelete, () => ideas.remove(i.id), t.c.delete, t.c.cancel)} />
          </Row>
          <Row wrap gap={4}>
            <Badge text={t.brainCat[i.category ?? 'idea']} color={c.primary} />
            {(i.tags ?? []).map((tag) => <Badge key={tag} text={`#${tag}`} />)}
          </Row>
          {i.audio_url ? <AudioClip uri={i.audio_url} /> : null}
        </Card>
      ))}

      <FormModal visible={!!form} title={t.brain.details} initial={form ?? undefined} onClose={() => setForm(null)}
        fields={[
          { key: 'title', label: t.c.title, required: true },
          { key: 'category', label: t.c.category, type: 'select', options: opts(t.brainCat) },
          { key: 'content', label: t.brain.details, type: 'multiline', voice: true },
          { key: 'tags', label: t.c.tags, type: 'tags' },
          { key: 'starred', label: t.c.star, type: 'bool' },
        ]}
        onSave={async (v) => { if (form?.id) await ideas.update(form.id, v); }} />
    </Screen>
  );
}
