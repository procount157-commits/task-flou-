import { addDays, today } from './dates';
import { db, kv } from './db';
import { logError } from './errlog';
import { goalNudges } from './goalai';
import type { Translations } from './i18n';
import { goalProgress, lastMoved, nextStep, sortTasks } from './logic';
import { cancel, scheduleAt } from './notify';
import { Nudge, nudgesAvailable, scheduleNudges, setSpeakAloud } from './phonelock';

export type NudgeSettings = { goals: boolean; times: string[]; morning: boolean; morningAt: string; review: boolean; speak: boolean };
export const NUDGE_DEFAULTS: NudgeSettings = { goals: true, times: ['10:00', '19:00'], morning: true, morningAt: '07:30', review: true, speak: true };

const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`).getTime();
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);

/**
 * Books the coming week of reminders: goal and dream nudges written by the AI (two a day by default),
 * a morning brief with the day's top three tasks, and the Friday review. Runs at most once a day,
 * or straight away when `force` is set (after a settings change).
 */
export async function refreshNudges(t: Translations, lang: string, force = false) {
  const s = { ...NUDGE_DEFAULTS, ...(await kv.get<Partial<NudgeSettings>>('nudges', {})) };
  const day = today();
  if (!force && (await kv.get('nudges:day', '')) === day) return;
  setSpeakAloud(s.speak);
  const goals = await db.list('Goal');
  const tasks = await db.list('DailyTask');
  const live = goals.filter((g) => g.status !== 'completed' && g.status !== 'cancelled');
  const roots = live.filter((g) => !g.parent_id).slice(0, 6);
  const out: Nudge[] = [];

  if (s.goals && roots.length) {
    const facts = roots.map((g) => ({ goal: g, progress: goalProgress(g, goals), idleDays: daysBetween(lastMoved(g, goals), day), next: nextStep(g, goals)?.title }));
    const profile = (await db.list('UserProfile'))[0];
    let lines: string[] = [];
    try {
      lines = await goalNudges(facts, profile?.daily_intention, lang);
    } catch (e) {
      logError('nudges-ai', e);
      // without the AI the reminders still come: the goal, its next step, a line of motivation
      lines = Array.from({ length: 14 }, (_, i) => {
        const f = facts[i % facts.length];
        return `${f.goal.title} — ${f.next ? `${t.roadmap.next}: ${f.next}` : `${f.progress}%`}. ${t.quotes[i % t.quotes.length]}`;
      });
    }
    let k = 0;
    for (let d = 0; d < 7; d++)
      for (const time of s.times) {
        const line = lines[k++ % Math.max(1, lines.length)];
        if (line) out.push({ at: at(addDays(day, d), time), title: `🎯 ${t.nudge.title}`, body: line, url: 'hayati://roadmap' });
      }
  }

  if (s.morning)
    for (let d = 0; d < 7; d++) {
      const date = addDays(day, d);
      const top = sortTasks(tasks.filter((x) => x.date === date && !x.parent_id && !x.completed)).slice(0, 3);
      const body = top.length ? top.map((x, i) => `${i + 1}. ${x.title}${x.time ? ` (${x.time})` : ''}`).join('\n') : t.nudge.emptyDay;
      out.push({ at: at(date, s.morningAt), title: `☀️ ${t.nudge.morning}`, body, url: 'hayati://day' });
    }

  if (s.review) {
    // the next Friday at six in the evening
    const friday = addDays(day, (5 - new Date(`${day}T00:00:00`).getDay() + 7) % 7);
    out.push({ at: at(friday, '18:00'), title: `📋 ${t.review.title}`, body: t.nudge.review, url: 'hayati://review' });
  }

  out.sort((a, b) => a.at - b.at);
  if (nudgesAvailable) scheduleNudges(out);
  else {
    await cancel(...Array.from({ length: 60 }, (_, i) => `nudge-${i}`));
    for (const [i, n] of out.slice(0, 60).entries()) await scheduleAt(`nudge-${i}`, n.title, n.body, new Date(n.at));
  }
  await kv.set('nudges:day', day);
}
