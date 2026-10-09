import { usePathname } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLang } from '@/ctx/Lang';
import { nowTime, today } from '@/lib/dates';
import { db } from '@/lib/db';
import { autoSyncTask } from '@/lib/devicecal';
import { logError } from '@/lib/errlog';
import { InvokeLLM } from '@/lib/integrations';
import { parseTask } from '@/lib/nlp';
import { VoiceToText, useUndo } from '@/ui/shared';

type Route = { type: 'task' | 'idea' | 'journal' | 'goal_value' | 'hour'; goal_id?: string; value?: number };

// Screens that already have their own big microphone.
const OWN_MIC = ['/checkin', '/journal'];

/** Say anything from any screen: the AI files it as a task, an idea, a journal line, a goal number or this hour's note. */
export function FloatingMic() {
  const { t, dir } = useLang();
  const undo = useUndo();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  if (OWN_MIC.includes(path)) return null;

  const route = async (text: string): Promise<Route> => {
    const goals = (await db.list('Goal')).filter((g) => g.status !== 'completed' && g.status !== 'cancelled').slice(0, 20);
    try {
      const out = await InvokeLLM(
        'Classify what the user said into one bucket. task = something to do (a reminder, an errand, an appointment). idea = an idea or thought to keep. ' +
          'journal = how their day or feelings went. goal_value = a new number for one of their measured goals (e.g. "I have saved 15000 now"). ' +
          'hour = what they were doing right now / this hour.\n' +
          `Goals: ${goals.map((g) => `${g.id}: ${g.title}${g.target_value ? ` (number, unit ${g.unit ?? ''})` : ''}`).join('; ') || 'none'}\n` +
          `Said: "${text}"\nReply ONLY with JSON: {"type": "task|idea|journal|goal_value|hour", "goal_id": "...", "value": number}`,
        0,
      );
      const m = out.match(/\{[\s\S]*\}/);
      const j = m ? JSON.parse(m[0]) : {};
      if (['task', 'idea', 'journal', 'goal_value', 'hour'].includes(j.type)) {
        if (j.type === 'goal_value' && (!goals.some((g) => g.id === j.goal_id) || !Number.isFinite(Number(j.value)))) return { type: 'task' };
        return { type: j.type, goal_id: j.goal_id, value: Number(j.value) };
      }
    } catch (e) {
      logError('mic-route', e);
    }
    return { type: 'task' };
  };

  const file = async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const r = await route(clean);
    const day = today();
    if (r.type === 'task') {
      const p = parseTask(clean, day);
      const made = await db.create('DailyTask', { title: p.title, date: p.date ?? day, time: p.time, priority: p.priority, completed: false });
      autoSyncTask(made.id);
      undo(`✅ ${t.mic.task}: ${p.title}${p.time ? ` · ${p.time}` : ''}`, () => db.remove('DailyTask', made.id));
    } else if (r.type === 'idea') {
      const made = await db.create('BrainstormIdea', { title: clean.slice(0, 80), content: clean.length > 80 ? clean : undefined, category: 'idea', tags: [], starred: false });
      undo(`💡 ${t.mic.idea}`, () => db.remove('BrainstormIdea', made.id));
    } else if (r.type === 'journal') {
      const existing = (await db.list('JournalEntry')).find((j) => j.date === day);
      if (existing) {
        await db.update('JournalEntry', existing.id, { content: [existing.content, clean].filter(Boolean).join('\n\n') });
        undo(`📔 ${t.mic.journal}`, () => db.restore('JournalEntry', [existing]));
      } else {
        const made = await db.create('JournalEntry', { date: day, content: clean });
        undo(`📔 ${t.mic.journal}`, () => db.remove('JournalEntry', made.id));
      }
    } else if (r.type === 'goal_value') {
      const g = (await db.list('Goal')).find((x) => x.id === r.goal_id)!;
      const log = [...(g.value_log ?? []).filter((x) => x.date !== day), { date: day, value: r.value! }];
      await db.update('Goal', g.id, { current_value: r.value, value_log: log });
      undo(`🎯 ${g.title}: ${r.value}`, () => db.restore('Goal', [g]));
    } else {
      const made = await db.create('ActivityLog', { date: day, time: nowTime(), text: clean, dialog: [{ role: 'ai', text: t.checkin.notif.steps[0].q }, { role: 'me', text: clean }] });
      undo(`🕐 ${t.mic.hour}`, () => db.remove('ActivityLog', made.id));
    }
  };

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', bottom: insets.bottom + 74, [dir === 'rtl' ? 'right' : 'left']: 14 }}>
      <VoiceToText fab onText={(text) => file(text)} />
    </View>
  );
}
