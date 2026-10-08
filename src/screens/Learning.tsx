import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import { db, useEntity } from '@/lib/db';
import { pct } from '@/lib/logic';
import type { LearningField, LearningItem, LearningStatus, LearningTask } from '@/lib/types';
import { DragArea, Draggable } from '@/ui/drag';
import { FormModal } from '@/ui/Form';
import { Badge, Btn, Card, Check, Empty, IconBtn, Input, Loading, Progress, Row, Screen, Stat, Txt, confirm, opts } from '@/ui/kit';

const FIELD_ICONS = ['💻', '🎨', '📣', '📊', '🗣', '🧠', '💼', '🔬', '🎵', '📚'];
const STATUSES: LearningStatus[] = ['wishlist', 'in_progress', 'completed', 'paused'];

export function itemProgress(item: LearningItem, tasks: LearningTask[]) {
  const mine = tasks.filter((x) => x.learning_item_id === item.id);
  if (item.status === 'completed') return 100;
  if (mine.length) return pct(mine.filter((x) => x.completed).length, mine.length);
  if (item.total_lessons) return Math.min(100, pct(item.completed_lessons ?? 0, item.total_lessons));
  return Math.min(100, Math.max(0, item.progress_percent ?? 0));
}

export default function Learning() {
  const c = useTheme();
  const { t } = useLang();
  const params = useLocalSearchParams<{ filter?: string }>();
  const filter = STATUSES.includes(params.filter as LearningStatus) ? (params.filter as LearningStatus) : null;
  const fields = useEntity('LearningField');
  const items = useEntity('LearningItem');
  const tasks = useEntity('LearningTask');
  const goals = useEntity('Goal').items;
  const habits = useEntity('Habit').items;
  const ideas = useEntity('BrainstormIdea').items;
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [fieldForm, setFieldForm] = useState<Partial<LearningField> | null>(null);
  const [itemForm, setItemForm] = useState<Partial<LearningItem> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [newTask, setNewTask] = useState('');

  useEffect(() => setFieldId(null), [filter]);

  const field = fields.items.find((f) => f.id === fieldId);
  const removeItem = async (id: string) => {
    await items.remove(id);
    await db.removeWhere('LearningTask', (x) => x.learning_item_id === id);
  };
  const removeField = async (id: string) => {
    // items survive their field: they move to "no field"
    for (const it of items.items.filter((x) => x.field_id === id)) await items.update(it.id, { field_id: undefined });
    await fields.remove(id);
  };
  const addTask = async (item: LearningItem) => {
    if (!newTask.trim()) return;
    await tasks.create({ title: newTask.trim(), learning_item_id: item.id, completed: false, priority: 'medium' });
    setNewTask('');
  };

  const itemCard = (it: LearningItem) => {
    const mine = tasks.items.filter((x) => x.learning_item_id === it.id);
    const progress = itemProgress(it, tasks.items);
    const linked = [
      it.goal_id && `🎯 ${goals.find((g) => g.id === it.goal_id)?.title ?? ''}`,
      it.habit_id && `🔥 ${habits.find((h) => h.id === it.habit_id)?.title ?? ''}`,
      it.brainstorm_id && `💡 ${ideas.find((i) => i.id === it.brainstorm_id)?.title ?? ''}`,
    ].filter(Boolean) as string[];
    return (
      <Card key={it.id}>
        <Row style={{ alignItems: 'flex-start' }}>
          {it.cover_url ? <Image source={{ uri: it.cover_url }} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: c.track }} contentFit="cover" /> : null}
          <View style={{ flex: 1, gap: 4 }}>
            <Txt style={{ fontWeight: '600' }}>{it.title}</Txt>
            <Row wrap gap={4}>
              <Badge text={t.learnType[it.type ?? 'course']} />
              <Badge text={t.learnStatus[it.status ?? 'wishlist']} color={it.status === 'completed' ? c.success : it.status === 'in_progress' ? c.primary : c.muted} />
              {it.platform ? <Badge text={it.platform} /> : null}
              {linked.map((l) => <Badge key={l} text={l} />)}
              {(it.tags ?? []).map((tag) => <Badge key={tag} text={`#${tag}`} />)}
            </Row>
          </View>
          <IconBtn icon={it.is_starred ? '⭐' : '☆'} label={t.c.star} onPress={() => items.update(it.id, { is_starred: !it.is_starred })} />
        </Row>
        <Progress value={progress} />
        <Txt v="small">{progress}%{it.total_lessons ? ` · ${it.completed_lessons ?? 0}/${it.total_lessons}` : ''}{it.attachments?.length ? ` · 📎 ${it.attachments.length}` : ''}</Txt>
        {it.notes ? <Txt v="muted">{it.notes}</Txt> : null}
        <Row wrap gap={2}>
          {it.source_url ? <Btn small kind="ghost" title={`🔗 ${t.learn.openSource}`} onPress={() => Linking.openURL(it.source_url!)} /> : null}
          <Btn small kind="ghost" title={`${open === it.id ? '▾' : '▸'} ${t.learn.tasks} (${mine.filter((x) => x.completed).length}/${mine.length})`} onPress={() => { setOpen(open === it.id ? null : it.id); setNewTask(''); }} />
          <IconBtn icon="✏️" label={t.c.edit} onPress={() => setItemForm(it)} />
          <IconBtn icon="🗑" label={t.c.delete} onPress={() => confirm(t.c.confirmDelete, () => removeItem(it.id), t.c.delete, t.c.cancel)} />
        </Row>
        {open === it.id ? (
          <View style={{ gap: 6 }}>
            {mine.map((x) => (
              <Row key={x.id}>
                <Check on={!!x.completed} onPress={() => tasks.update(x.id, { completed: !x.completed })} />
                <Txt style={{ flex: 1, textDecorationLine: x.completed ? 'line-through' : 'none' }}>{x.title}</Txt>
                <IconBtn icon="✕" label={t.c.delete} onPress={() => tasks.remove(x.id)} />
              </Row>
            ))}
            <Row>
              <View style={{ flex: 1 }}><Input placeholder={t.learn.addTask} value={newTask} onChangeText={setNewTask} onSubmitEditing={() => addTask(it)} /></View>
              <Btn small title={t.c.add} disabled={!newTask.trim()} onPress={() => addTask(it)} />
            </Row>
          </View>
        ) : null}
      </Card>
    );
  };

  const sortItems = (xs: LearningItem[]) => [...xs].sort((a, b) => Number(!!b.is_starred) - Number(!!a.is_starred) || b.created_date.localeCompare(a.created_date));
  const loose = items.items.filter((x) => !x.field_id || !fields.items.some((f) => f.id === x.field_id));
  const pickFrom = (xs: { id: string; title: string }[]) => xs.map((x) => ({ value: x.id, label: x.title }));

  let body: React.ReactNode;
  if (fields.loading || items.loading) body = <Loading />;
  else if (filter) {
    const list = sortItems(items.items.filter((x) => (x.status ?? 'wishlist') === filter));
    body = (
      <>
        <Txt v="sub">{t.learnStatus[filter]}</Txt>
        <Btn title={`+ ${t.learn.addItem}`} onPress={() => setItemForm({ status: filter })} />
        {list.length ? list.map(itemCard) : <Empty icon="🎓" text={t.learn.emptyItems} />}
      </>
    );
  } else if (fieldId) {
    const list = sortItems(fieldId === 'none' ? loose : items.items.filter((x) => x.field_id === fieldId));
    body = (
      <>
        <Row>
          <Btn small kind="ghost" title={`‹ ${t.nav.fields}`} onPress={() => setFieldId(null)} />
          <Txt v="sub" style={{ flex: 1 }}>{field ? `${field.icon ?? '📁'} ${field.title}` : t.learn.unassigned}</Txt>
        </Row>
        {field?.description ? <Txt v="muted">{field.description}</Txt> : null}
        <Btn title={`+ ${t.learn.addItem}`} onPress={() => setItemForm({ field_id: field?.id })} />
        {list.length ? list.map(itemCard) : <Empty icon="🎓" text={t.learn.emptyItems} />}
      </>
    );
  } else {
    body = (
      <>
        <Row wrap>
          <Stat label={t.learn.statFields} value={fields.items.length} />
          <Stat label={t.learn.statCourses} value={items.items.length} />
          <Stat label={t.learn.statProgress} value={items.items.filter((x) => x.status === 'in_progress').length} />
          <Stat label={t.learn.statDone} value={items.items.filter((x) => x.status === 'completed').length} />
        </Row>
        <Row>
          <Btn title={`+ ${t.learn.addField}`} onPress={() => setFieldForm({})} style={{ flex: 1 }} />
          <Btn kind="ghost" title={`+ ${t.learn.addItem}`} onPress={() => setItemForm({})} style={{ flex: 1 }} />
        </Row>
        {!fields.items.length && !loose.length ? <Empty icon="🎓" text={t.learn.emptyFields} /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {fields.items.map((f) => {
            const mine = items.items.filter((x) => x.field_id === f.id);
            return (
              <Draggable key={f.id} style={{ flexGrow: 1, flexBasis: '45%' }} onDrop={(z) => { if (z === 'delete') removeField(f.id); }}>
                <Card style={{ borderTopWidth: 4, borderTopColor: f.color ?? c.primary }} onPress={() => setFieldId(f.id)}>
                  <Txt style={{ fontWeight: '600' }}>{f.icon ?? '📁'} {f.title}</Txt>
                  <Txt v="small">{mine.length} {t.learn.courses} · {mine.filter((x) => x.status === 'in_progress').length} {t.learn.active}</Txt>
                  <Row gap={2}>
                    <IconBtn icon="✏️" label={t.c.edit} onPress={() => setFieldForm(f)} />
                    <IconBtn icon="🗑" label={t.c.delete} onPress={() => confirm(t.c.confirmDelete, () => removeField(f.id), t.c.delete, t.c.cancel)} />
                  </Row>
                </Card>
              </Draggable>
            );
          })}
        </View>
        {loose.length ? (
          <Card onPress={() => setFieldId('none')}>
            <Txt style={{ fontWeight: '600' }}>📂 {t.learn.unassigned}</Txt>
            <Txt v="small">{loose.length} {t.learn.courses}</Txt>
          </Card>
        ) : null}
      </>
    );
  }

  return (
    <DragArea>
      <Screen>
        {body}
        <FormModal visible={!!fieldForm} title={fieldForm?.id ? t.c.edit : t.learn.addField} initial={{ is_active: true, icon: '💻', ...fieldForm }} onClose={() => setFieldForm(null)}
          fields={[
            { key: 'title', label: t.c.title, required: true, suggestions: t.sug.fields },
            { key: 'description', label: t.c.description, type: 'multiline' },
            { key: 'icon', label: t.c.icon, type: 'icon', icons: FIELD_ICONS },
            { key: 'color', label: t.c.color, type: 'color' },
            ...(goals.length ? [{ key: 'goal_id', label: `🎯 ${t.c.linkGoal}`, type: 'select' as const, optional: true, options: pickFrom(goals) }] : []),
            { key: 'is_active', label: t.habits.active, type: 'bool' },
          ]}
          onSave={async (v) => { if (fieldForm?.id) await fields.update(fieldForm.id, v); else await fields.create(v as LearningField); }} />
        <FormModal visible={!!itemForm} history={items.items} title={itemForm?.id ? t.c.edit : t.learn.addItem} initial={{ type: 'course', status: 'wishlist', attachments: [], ...itemForm }} onClose={() => setItemForm(null)}
          fields={[
            { key: 'title', label: t.c.title, required: true },
            { key: 'type', label: t.c.type, type: 'select', options: opts(t.learnType) },
            { key: 'status', label: t.c.status, type: 'select', options: opts(t.learnStatus) },
            ...(fields.items.length ? [{ key: 'field_id', label: t.learn.field, type: 'select' as const, optional: true, options: pickFrom(fields.items) }] : []),
            { key: 'platform', label: t.learn.platform, suggestions: t.sug.platforms },
            { key: 'source_url', label: t.learn.url, placeholder: 'https://' },
            { key: 'cover_url', label: t.learn.cover, type: 'image' },
            { key: 'total_lessons', label: t.learn.totalLessons, type: 'number', suggestions: t.sug.lessons },
            { key: 'completed_lessons', label: t.learn.doneLessons, type: 'number', suggestions: ['0', ...t.sug.lessons] },
            { key: 'progress_percent', label: t.learn.progressPct, type: 'number', suggestions: t.sug.percents },
            { key: 'notes', label: t.c.notes, type: 'multiline' },
            { key: 'tags', label: t.c.tags, type: 'tags' },
            { key: 'attachments', label: t.c.attachments, type: 'files' },
            ...(goals.length ? [{ key: 'goal_id', label: `🎯 ${t.c.linkGoal}`, type: 'select' as const, optional: true, options: pickFrom(goals) }] : []),
            ...(habits.length ? [{ key: 'habit_id', label: `🔥 ${t.c.linkHabit}`, type: 'select' as const, optional: true, options: pickFrom(habits) }] : []),
            ...(ideas.length ? [{ key: 'brainstorm_id', label: `💡 ${t.c.linkBrainstorm}`, type: 'select' as const, optional: true, options: pickFrom(ideas) }] : []),
            { key: 'is_starred', label: t.c.star, type: 'bool' },
          ]}
          onSave={async (v) => { if (itemForm?.id) await items.update(itemForm.id, v); else await items.create(v as LearningItem); }} />
      </Screen>
    </DragArea>
  );
}
