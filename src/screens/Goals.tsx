import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { GoalForm } from './forms';
import { useAI } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { isDate, today } from '@/lib/dates';
import { db, useEntity } from '@/lib/db';
import { removeTaskFromCalendar } from '@/lib/devicecal';
import { exportGoal } from '@/lib/gcal';
import { ExtractDataFromUploadedFile, col, pickDocument, splitGoal } from '@/lib/integrations';
import { avg, childLevel, goalProgress, grantReward, LEVELS, pct } from '@/lib/logic';
import type { Goal, GoalLevel, GoalStatus, Priority } from '@/lib/types';
import { HBars } from '@/ui/charts';
import { Badge, Btn, Card, Check, Empty, IconBtn, Loading, Progress, Row, Screen, Sheet, Tabs, Txt, confirm, notice } from '@/ui/kit';
import { useCelebrate } from '@/ui/shared';

const NEXT_STATUS: Record<GoalStatus, GoalStatus> = { not_started: 'in_progress', in_progress: 'completed', completed: 'completed', cancelled: 'not_started' };

export default function Goals() {
  const c = useTheme();
  const { t, lang } = useLang();
  const router = useRouter();
  const params = useLocalSearchParams<{ level?: string }>();
  const level = (LEVELS.includes(params.level as GoalLevel) ? params.level : 'life') as GoalLevel;
  const goals = useEntity('Goal');
  const rewards = useEntity('Reward');
  const celebrate = useCelebrate();
  const ai = useAI();
  const [form, setForm] = useState<Partial<Goal> | null>(null);
  const [formLevel, setFormLevel] = useState<GoalLevel>(level);
  const [busy, setBusy] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ parent: Goal; items: { title: string; on: boolean }[] } | null>(null);
  const [summary, setSummary] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const down = childLevel(level);
  const list = goals.items.filter((g) => g.level === level);

  const openForm = (lvl: GoalLevel, initial: Partial<Goal>) => {
    setFormLevel(lvl);
    setForm(initial);
  };

  const advance = async (g: Goal) => {
    const status = NEXT_STATUS[g.status ?? 'not_started'];
    await goals.update(g.id, { status, ...(status === 'completed' ? { progress: 100 } : {}) });
    if (status === 'completed' && g.status !== 'completed') {
      const got = await grantReward('goal', g);
      celebrate(got ? `${t.c.rewardUnlocked} ${g.reward_icon ?? '🎁'} ${g.reward_title}` : undefined);
    }
  };

  const split = async (g: Goal) => {
    if (!down) return notice(t.goals.lowest);
    setBusy(g.id);
    const items = await ai(() => splitGoal(g.title, g.description, t.level[level], t.level[down], lang));
    setBusy(null);
    if (items?.length) setProposal({ parent: g, items: items.map((title) => ({ title, on: true })) });
  };

  const approve = async () => {
    if (!proposal || !down) return;
    await db.bulkCreate('Goal', proposal.items.filter((i) => i.on).map((i) => ({ title: i.title, level: down, parent_id: proposal.parent.id, status: 'not_started' as const, progress: 0, priority: proposal.parent.priority ?? 'medium', color: proposal.parent.color })));
    if (!proposal.parent.auto_progress) await goals.update(proposal.parent.id, { auto_progress: true });
    setProposal(null);
  };

  // Everything hanging under a goal: its sub-goals at every level, and the tasks linked to any of them.
  const subtree = (g: Goal) => {
    const ids = new Set([g.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const x of goals.items) if (x.parent_id && ids.has(x.parent_id) && !ids.has(x.id)) (ids.add(x.id), (grew = true));
    }
    return ids;
  };
  const remove = async (g: Goal) => {
    const ids = subtree(g);
    const tasks = (await db.list('DailyTask')).filter((x) => x.goal_id && ids.has(x.goal_id));
    const detachOnly = async () => {
      for (const k of goals.items.filter((x) => x.parent_id === g.id)) await goals.update(k.id, { parent_id: undefined });
      await goals.remove(g.id);
    };
    const everything = async () => {
      const taskIds = new Set(tasks.map((x) => x.id));
      for (const x of tasks) await removeTaskFromCalendar(x);
      await db.removeWhere('DailyTask', (x) => taskIds.has(x.id) || (!!x.parent_id && taskIds.has(x.parent_id)));
      await db.removeWhere('Goal', (x) => ids.has(x.id));
    };
    if (ids.size === 1 && !tasks.length) return confirm(t.c.confirmDelete, detachOnly, t.c.delete, t.c.cancel);
    const msg = t.goals.deleteTree.replace('{g}', String(ids.size - 1)).replace('{t}', String(tasks.length));
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) everything();
      return;
    }
    Alert.alert(g.title, msg, [
      { text: t.c.cancel, style: 'cancel' },
      { text: t.goals.deleteOnly, onPress: detachOnly },
      { text: t.goals.deleteAll, style: 'destructive', onPress: everything },
    ]);
  };

  const importCsv = async () => {
    const doc = await pickDocument(['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '*/*']);
    if (!doc) return;
    try {
      const rows = await ExtractDataFromUploadedFile(doc.uri);
      const data = rows.map((r) => {
        const lvl = col(r, 'level', 'المستوى') as GoalLevel;
        const prio = col(r, 'priority', 'الأولوية') as Priority;
        const due = col(r, 'due_date', 'due', 'تاريخ الاستحقاق');
        return {
          title: col(r, 'title', 'العنوان', 'name'), description: col(r, 'description', 'الوصف') || undefined, level: LEVELS.includes(lvl) ? lvl : level,
          priority: ['low', 'medium', 'high'].includes(prio) ? prio : ('medium' as Priority), due_date: isDate(due) ? due : undefined, status: 'not_started' as const, progress: 0,
        };
      }).filter((g) => g.title);
      await db.bulkCreate('Goal', data);
      notice(`${t.c.imported}: ${data.length}`);
    } catch {
      notice(t.c.importFailed);
    }
  };

  return (
    <Screen>
      <Tabs options={LEVELS.map((l) => ({ value: l, label: t.level[l] }))} value={level} onChange={(l) => router.replace(`/goals/${l}` as any)} />
      <Row wrap>
        <Btn title={`+ ${t.goals.add}`} onPress={() => openForm(level, {})} style={{ flexGrow: 1 }} />
        <Btn kind="ghost" title={`🌍 ${t.goals.lifeSummary}`} onPress={() => setSummary(true)} />
        <Btn kind="ghost" title={`⬆ ${t.goals.importCsv}`} onPress={importCsv} />
      </Row>

      {goals.loading ? <Loading /> : !list.length ? <Empty icon="🎯" text={t.goals.empty} /> : list.map((g) => {
        const kids = goals.items.filter((x) => x.parent_id === g.id);
        const parent = goals.items.find((x) => x.id === g.parent_id);
        const progress = goalProgress(g, goals.items);
        const reward = rewards.items.find((r) => r.linked_id === g.id && r.type === 'goal');
        return (
          <Card key={g.id} style={{ borderStartWidth: 4, borderStartColor: g.color ?? c.primary }}>
            <Row>
              <Check on={g.status === 'completed'} onPress={() => advance(g)} />
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '600' }}>{g.title}</Txt>
                {g.description ? <Txt v="muted">{g.description}</Txt> : null}
              </View>
            </Row>
            <Row wrap gap={4}>
              <Badge text={t.goalStatus[g.status ?? 'not_started']} color={g.status === 'completed' ? c.success : undefined} />
              <Badge text={t.prio[g.priority ?? 'medium']} />
              {g.due_date ? <Badge text={`📅 ${g.due_date}`} color={g.due_date < today() && g.status !== 'completed' ? c.danger : undefined} /> : null}
              {kids.length ? <Badge text={`${kids.length} ${t.goals.children}`} color={c.primary} /> : null}
              {parent ? <Badge text={`↑ ${parent.title}`} /> : null}
            </Row>
            <Progress value={progress} color={g.color} />
            <Txt v="small">{progress}%{g.auto_progress && kids.length ? ` · ${t.goals.autoProgress}` : ''}</Txt>
            {g.reward_title ? (
              <Row>
                <Txt v="muted" style={{ flex: 1 }}>{g.reward_icon ?? '🎁'} {g.reward_title}{g.reward_description ? ` — ${g.reward_description}` : ''}</Txt>
                {reward ? reward.is_claimed ? <Badge text={`✓ ${t.c.claimed}`} color={c.success} /> : <Btn small title={t.c.claim} onPress={() => rewards.update(reward.id, { is_claimed: true, claimed_date: today() })} /> : null}
              </Row>
            ) : null}
            {kids.length ? (
              <View style={{ gap: 4 }}>
                <Btn small kind="ghost" title={`${open === g.id ? '▾' : '▸'} ${kids.length} ${t.goals.children}`} onPress={() => setOpen(open === g.id ? null : g.id)} />
                {open === g.id ? kids.map((k) => (
                  <Row key={k.id}>
                    <Txt style={{ flex: 1 }} numberOfLines={1}>• {k.title}</Txt>
                    <Txt v="small">{goalProgress(k, goals.items)}%</Txt>
                  </Row>
                )) : null}
              </View>
            ) : null}
            <Row wrap gap={2}>
              {down ? <Btn small kind="ghost" title={`🤖 ${t.c.aiSplit}`} loading={busy === g.id} onPress={() => split(g)} /> : null}
              {down ? <Btn small kind="ghost" title={`+ ${t.goals.addChild}`} onPress={() => openForm(down, { parent_id: g.id, color: g.color })} /> : null}
              {g.due_date ? <IconBtn icon="📅" label={t.c.gcal} onPress={() => exportGoal(g)} /> : null}
              <IconBtn icon="✏️" label={t.c.edit} onPress={() => openForm(level, g)} />
              <IconBtn icon="🗑" label={t.c.delete} onPress={() => remove(g)} />
            </Row>
          </Card>
        );
      })}

      <GoalForm visible={!!form} initial={form ?? undefined} level={formLevel} onClose={() => setForm(null)} />

      <Sheet visible={!!proposal} onClose={() => setProposal(null)} title={`🤖 ${t.goals.suggestions}`} footer={<Btn title={t.c.approve} disabled={!proposal?.items.some((i) => i.on)} onPress={approve} />}>
        <Txt v="muted">{proposal?.parent.title} → {down ? t.level[down] : ''}</Txt>
        {proposal?.items.map((it, i) => (
          <Row key={i}>
            <Check on={it.on} onPress={() => setProposal({ ...proposal, items: proposal.items.map((x, k) => (k === i ? { ...x, on: !x.on } : x)) })} />
            <Txt style={{ flex: 1 }}>{it.title}</Txt>
          </Row>
        ))}
      </Sheet>

      <Sheet visible={summary} onClose={() => setSummary(false)} title={`🌍 ${t.goals.lifeSummary}`}>
        {LEVELS.map((l) => {
          const at = goals.items.filter((g) => g.level === l && g.status !== 'cancelled');
          const done = at.filter((g) => g.status === 'completed').length;
          const rw = at.filter((g) => g.reward_title).length;
          return (
            <Card key={l} onPress={() => { setSummary(false); router.replace(`/goals/${l}` as any); }}>
              <Row>
                <Txt style={{ flex: 1, fontWeight: '600' }}>{t.level[l]}</Txt>
                <Badge text={`${t.goals.count}: ${at.length}`} />
                <Badge text={`🎁 ${rw}`} />
              </Row>
              <HBars data={[{ label: `${t.goals.completion} (${done}/${at.length})`, value: pct(done, at.length) }, { label: t.ana.avgProgress, value: avg(at.map((g) => goalProgress(g, goals.items))) }]} />
            </Card>
          );
        })}
      </Sheet>
    </Screen>
  );
}
