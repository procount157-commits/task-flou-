import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import { useEntity } from '@/lib/db';
import type { ContentItem, ContentPlatform, ContentStatus, ContentType } from '@/lib/types';
import { DragArea, Draggable, DropZone } from '@/ui/drag';
import { FormModal } from '@/ui/Form';
import { Badge, Btn, Card, Empty, IconBtn, Loading, Row, Screen, Txt, confirm, opts } from '@/ui/kit';

const PLATFORMS: { key: ContentPlatform; icon: string }[] = [
  { key: 'instagram', icon: '📸' }, { key: 'youtube', icon: '▶️' }, { key: 'tiktok', icon: '🎵' }, { key: 'twitter', icon: '🐦' },
  { key: 'linkedin', icon: '💼' }, { key: 'blog', icon: '✍️' }, { key: 'podcast', icon: '🎙' }, { key: 'other', icon: '📦' },
];
const TYPES: ContentType[] = ['idea', 'script', 'post', 'article', 'video', 'image', 'link', 'template'];
const FLOW: ContentStatus[] = ['idea', 'draft', 'ready', 'scheduled', 'published'];
const TAB_TYPE: Record<string, ContentType> = { scripts: 'script', ideas: 'idea', links: 'link' };

export default function Content() {
  const c = useTheme();
  const { t } = useLang();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab = params.tab && ['planner', 'scripts', 'ideas', 'links'].includes(params.tab) ? params.tab : null;
  const content = useEntity('ContentItem');
  const goals = useEntity('Goal').items;
  const habits = useEntity('Habit').items;
  const ideas = useEntity('BrainstormIdea').items;
  const [platform, setPlatform] = useState<ContentPlatform | null>(null);
  const [form, setForm] = useState<Partial<ContentItem> | null>(null);

  useEffect(() => setPlatform(null), [tab]);

  const advance = (it: ContentItem) => {
    const i = FLOW.indexOf(it.status ?? 'idea');
    if (i < FLOW.length - 1) content.update(it.id, { status: FLOW[i + 1] });
  };
  const pickFrom = (xs: { id: string; title: string }[]) => xs.map((x) => ({ value: x.id, label: x.title }));

  const card = (it: ContentItem, compact = false) => (
    <Card>
      <Row>
        <IconBtn icon={it.is_starred ? '⭐' : '☆'} label={t.c.star} onPress={() => content.update(it.id, { is_starred: !it.is_starred })} />
        <Txt style={{ flex: 1, fontWeight: '600' }} numberOfLines={2}>{it.title}</Txt>
      </Row>
      {it.media_url ? <Image source={{ uri: it.media_url }} style={{ width: '100%', height: compact ? 80 : 140, borderRadius: 8, backgroundColor: c.track }} contentFit="cover" /> : null}
      {it.description ? <Txt v="muted" numberOfLines={compact ? 2 : undefined}>{it.description}</Txt> : null}
      {!compact && it.content_body ? <Txt numberOfLines={6}>{it.content_body}</Txt> : null}
      <Row wrap gap={4}>
        <Badge text={t.contentStatus[it.status ?? 'idea']} color={it.status === 'published' ? c.success : c.primary} />
        {!compact ? <Badge text={`${t.platform[it.platform ?? 'other']} · ${t.contentType[it.type ?? 'idea']}`} /> : null}
        {it.scheduled_date ? <Badge text={`📅 ${it.scheduled_date}`} /> : null}
        {(it.tags ?? []).map((tag) => <Badge key={tag} text={`#${tag}`} />)}
      </Row>
      <Row wrap gap={2}>
        {it.status !== 'published' ? <Btn small kind="ghost" title={`→ ${t.contentStatus[FLOW[FLOW.indexOf(it.status ?? 'idea') + 1]]}`} onPress={() => advance(it)} /> : null}
        {it.external_link ? <IconBtn icon="🔗" label={t.c.externalLink} onPress={() => Linking.openURL(it.external_link!)} /> : null}
        <IconBtn icon="✏️" label={t.c.edit} onPress={() => setForm(it)} />
        <IconBtn icon="🗑" label={t.c.delete} onPress={() => confirm(t.c.confirmDelete, () => content.remove(it.id), t.c.delete, t.c.cancel)} />
      </Row>
    </Card>
  );

  let body: React.ReactNode;
  let scroll = true;
  if (content.loading) body = <Loading />;
  else if (tab) {
    const list = tab === 'planner'
      ? content.items.filter((x) => x.scheduled_date).sort((a, b) => a.scheduled_date!.localeCompare(b.scheduled_date!))
      : content.items.filter((x) => (x.type ?? 'idea') === TAB_TYPE[tab]);
    body = (
      <>
        <Txt v="sub">{t.nav[tab as 'planner' | 'scripts' | 'ideas' | 'links']}</Txt>
        <Btn title={`+ ${t.cont.add}`} onPress={() => setForm(tab === 'planner' ? { status: 'scheduled' } : { type: TAB_TYPE[tab] })} />
        {list.length ? list.map((it) => <View key={it.id}>{card(it)}</View>) : <Empty icon="📱" text={tab === 'planner' ? t.cont.plannerEmpty : t.cont.empty} />}
      </>
    );
  } else if (platform) {
    scroll = false;
    const mine = content.items.filter((x) => (x.platform ?? 'other') === platform);
    body = (
      <>
        <Row>
          <Btn small kind="ghost" title={`‹ ${t.cont.allPlatforms}`} onPress={() => setPlatform(null)} />
          <Txt v="sub" style={{ flex: 1 }}>{PLATFORMS.find((p) => p.key === platform)?.icon} {t.platform[platform]}</Txt>
          <Btn small title={`+ ${t.cont.add}`} onPress={() => setForm({ platform })} />
        </Row>
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ gap: 10 }}>
          {TYPES.map((type) => {
            const col = mine.filter((x) => (x.type ?? 'idea') === type);
            return (
              <DropZone key={type} id={`col:${type}`} style={{ width: 250, backgroundColor: c.soft, borderRadius: 12, padding: 8 }}>
                <Row style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
                  <Txt style={{ fontWeight: '700' }}>{t.contentType[type]}</Txt>
                  <Badge text={String(col.length)} />
                </Row>
                <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 100 }}>
                  {col.map((it) => (
                    <Draggable key={it.id} selfZone={`col:${type}`} onDrop={(z) => {
                      if (z === 'delete') content.remove(it.id);
                      else if (z.startsWith('col:')) content.update(it.id, { type: z.slice(4) as ContentType });
                    }}>
                      {card(it, true)}
                    </Draggable>
                  ))}
                  <Btn small kind="ghost" title="+" onPress={() => setForm({ platform, type })} />
                </ScrollView>
              </DropZone>
            );
          })}
        </ScrollView>
      </>
    );
  } else {
    body = (
      <>
        <Btn title={`+ ${t.cont.add}`} onPress={() => setForm({})} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {PLATFORMS.map((p) => {
            const mine = content.items.filter((x) => (x.platform ?? 'other') === p.key);
            return (
              <Card key={p.key} style={{ flexGrow: 1, flexBasis: '45%' }} onPress={() => setPlatform(p.key)}>
                <Txt style={{ fontWeight: '600' }}>{p.icon} {t.platform[p.key]}</Txt>
                <Txt v="small">{mine.length} {t.cont.items} · {mine.filter((x) => x.status === 'published').length} {t.cont.published}</Txt>
              </Card>
            );
          })}
        </View>
      </>
    );
  }

  return (
    <DragArea>
      <Screen scroll={scroll}>
        {body}
        <FormModal visible={!!form} title={form?.id ? t.c.edit : t.cont.add} initial={{ type: 'idea', platform: 'other', status: 'idea', ...form }} onClose={() => setForm(null)}
          fields={[
            { key: 'title', label: t.c.title, required: true },
            { key: 'description', label: t.c.description, type: 'multiline' },
            { key: 'type', label: t.c.type, type: 'select', options: opts(t.contentType) },
            { key: 'platform', label: t.cont.platform, type: 'select', options: opts(t.platform) },
            { key: 'status', label: t.c.status, type: 'select', options: opts(t.contentStatus) },
            { key: 'content_body', label: t.cont.body, type: 'multiline', voice: true },
            { key: 'media_url', label: t.cont.media, type: 'image' },
            { key: 'external_link', label: t.c.externalLink, placeholder: 'https://' },
            { key: 'scheduled_date', label: t.cont.scheduled, type: 'date' },
            { key: 'tags', label: t.c.tags, type: 'tags' },
            ...(goals.length ? [{ key: 'goal_id', label: `🎯 ${t.c.linkGoal}`, type: 'select' as const, optional: true, options: pickFrom(goals) }] : []),
            ...(habits.length ? [{ key: 'habit_id', label: `🔥 ${t.c.linkHabit}`, type: 'select' as const, optional: true, options: pickFrom(habits) }] : []),
            ...(ideas.length ? [{ key: 'brainstorm_id', label: `💡 ${t.c.linkBrainstorm}`, type: 'select' as const, optional: true, options: pickFrom(ideas) }] : []),
            { key: 'is_starred', label: t.c.star, type: 'bool' },
          ]}
          onSave={async (v) => { if (form?.id) await content.update(form.id, v); else await content.create(v as ContentItem); }} />
      </Screen>
    </DragArea>
  );
}
