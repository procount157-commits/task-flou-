import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';

import { TaskDetail } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { fmtDate } from '@/lib/dates';
import { useEntity } from '@/lib/db';
import { Card, Empty, Input, Row, Screen, Section, Txt } from '@/ui/kit';

type Hit = { key: string; icon: string; title: string; sub?: string; open: () => void };

// Arabic letters that are often typed interchangeably, folded so «مكتبه» finds «مكتبة».
const fold = (s: string) =>
  s.toLowerCase().replace(/[أإآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْ]/g, '');

/** One box that searches tasks, goals, journal, ideas, content, learning and hourly notes. */
export default function Search() {
  const c = useTheme();
  const { t, lang } = useLang();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [openTask, setOpenTask] = useState<string | null>(null);
  const tasks = useEntity('DailyTask').items;
  const goals = useEntity('Goal').items;
  const journal = useEntity('JournalEntry').items;
  const ideas = useEntity('BrainstormIdea').items;
  const content = useEntity('ContentItem').items;
  const learning = useEntity('LearningItem').items;
  const logs = useEntity('ActivityLog').items;

  const groups = useMemo(() => {
    const needle = fold(q.trim());
    if (needle.length < 2) return [];
    const has = (...xs: (string | undefined)[]) => xs.some((x) => x && fold(x).includes(needle));
    const g: { title: string; hits: Hit[] }[] = [
      { title: t.nav.tasks, hits: tasks.filter((x) => has(x.title, x.notes)).slice(0, 30).map((x) => ({ key: x.id, icon: x.completed ? '✅' : '⬜️', title: x.title, sub: fmtDate(x.date, lang, t.c) + (x.time ? ` ${x.time}` : ''), open: () => setOpenTask(x.parent_id ?? x.id) })) },
      { title: t.nav.goals, hits: goals.filter((x) => has(x.title, x.description)).map((x) => ({ key: x.id, icon: '🎯', title: x.title, sub: t.level[x.level], open: () => router.push(`/goal?id=${x.id}` as any) })) },
      { title: t.nav.journal, hits: journal.filter((x) => has(x.content, x.wins, x.gratitude, x.improvements, x.tomorrow_focus)).map((x) => ({ key: x.id, icon: '📔', title: (x.content ?? x.wins ?? '').slice(0, 80), sub: x.date, open: () => router.push('/journal') })) },
      { title: t.nav.brainstorm, hits: ideas.filter((x) => has(x.title, x.content, ...(x.tags ?? []))).map((x) => ({ key: x.id, icon: '💡', title: x.title, sub: x.content?.slice(0, 60), open: () => router.push('/brainstorm') })) },
      { title: t.nav.content, hits: content.filter((x) => has(x.title, x.description)).map((x) => ({ key: x.id, icon: '📱', title: x.title, open: () => router.push('/content') })) },
      { title: t.nav.learning, hits: learning.filter((x) => has(x.title, x.platform)).map((x) => ({ key: x.id, icon: '🎓', title: x.title, open: () => router.push('/learning') })) },
      { title: t.checkin.tab, hits: logs.filter((x) => has(x.text, ...(x.dialog ?? []).map((d) => d.text))).slice(0, 30).map((x) => ({ key: x.id, icon: '🕐', title: x.text || (x.dialog ?? []).find((d) => d.role === 'me')?.text || '🎤', sub: `${x.date} ${x.time}`, open: () => router.push('/checkin') })) },
    ];
    return g.filter((x) => x.hits.length);
  }, [q, tasks, goals, journal, ideas, content, learning, logs, t, lang, router]);

  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  return (
    <Screen>
      <Input placeholder={`🔎 ${t.search.ph}`} value={q} onChangeText={setQ} autoFocus />
      {q.trim().length >= 2 ? <Txt v="small">{t.search.found.replace('{n}', String(total))}</Txt> : <Txt v="small">{t.search.hint}</Txt>}
      {q.trim().length >= 2 && !total ? <Empty icon="🔎" text={t.search.none} /> : null}
      {groups.map((g) => (
        <Section key={g.title} title={`${g.title} (${g.hits.length})`}>
          {g.hits.map((h) => (
            <Card key={h.key} onPress={h.open}>
              <Row>
                <Txt>{h.icon}</Txt>
                <Txt style={{ flex: 1 }} numberOfLines={2}>{h.title}</Txt>
                {h.sub ? <Txt v="small" color={c.muted}>{h.sub}</Txt> : null}
              </Row>
            </Card>
          ))}
        </Section>
      ))}
      <TaskDetail taskId={openTask} onClose={() => setOpenTask(null)} />
    </Screen>
  );
}
