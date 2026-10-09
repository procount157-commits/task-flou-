import { InvokeLLM, llmList } from './integrations';
import type { DailyTask, Goal } from './types';

const langName = (lang: string) => (lang === 'ar' ? 'Arabic' : 'English');
const measure = (g: Goal) => (g.target_value ? ` (now ${g.current_value ?? 0} of ${g.target_value}${g.unit ? ` ${g.unit}` : ''})` : '');

// Three tiny next actions for a goal, each doable today in under an hour.
export const suggestSteps = (g: Goal, done: string[], lang: string) =>
  llmList(
    `Goal: "${g.title}"${measure(g)}${g.description ? `. Context: ${g.description}` : ''}. Recently done: ${done.slice(0, 6).join('; ') || 'nothing yet'}. ` +
      'Suggest 3 tiny concrete next actions (baby steps), each doable today in under an hour, each starting with a verb, at most 8 words.',
    lang,
  );

export type Review = { summary: string; wins: string[]; slipping: string[]; next: string[] };

// The week in review: what moved, what slipped, and tasks for next week the user can accept one by one.
export async function weeklyReview(goals: { goal: Goal; progress: number; idleDays: number }[], done: DailyTask[], missed: DailyTask[], hours: string[], lang: string): Promise<Review> {
  const text = await InvokeLLM(
    [
      { role: 'system', content: `You are a candid, warm life coach writing a weekly review in ${langName(lang)}. Plain text inside JSON, no Markdown.` },
      {
        role: 'user',
        content:
          `Goals:\n${goals.map((x) => `- ${x.goal.title}${measure(x.goal)}: ${x.progress}%, idle ${x.idleDays} days`).join('\n') || 'none'}\n` +
          `Done this week (${done.length}): ${done.slice(0, 30).map((x) => x.title).join('; ') || 'none'}\n` +
          `Missed / overdue (${missed.length}): ${missed.slice(0, 20).map((x) => x.title).join('; ') || 'none'}\n` +
          `Hourly check-ins: ${hours.slice(0, 40).join(' | ') || 'none'}\n` +
          'Reply ONLY with JSON: {"summary": "3 sentences", "wins": ["..."], "slipping": ["..."], "next": ["5 concrete tasks for next week, each at most 8 words"]}',
      },
    ],
    0.4,
  );
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('bad AI reply');
  const j = JSON.parse(m[0]);
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 8) : []);
  return { summary: String(j.summary ?? '').trim(), wins: arr(j.wins), slipping: arr(j.slipping), next: arr(j.next) };
}

// A week of short reminders about the user's goals and dreams, two a day, written ahead so they can be
// delivered as notifications while the app is closed.
export async function goalNudges(goals: { goal: Goal; progress: number; idleDays: number; next?: string }[], dream: string | undefined, lang: string): Promise<string[]> {
  const text = await InvokeLLM(
    [
      {
        role: 'system',
        content:
          `You write short phone reminders in ${langName(lang)} that pull a person back to their goals and dreams. Each at most 2 short sentences, personal, concrete, ` +
          'naming one real goal and, when given, its next step or how long it has been neglected. Vary the angle: why it matters, a vivid picture of the dream achieved, ' +
          'a tiny action right now, a gentle challenge. No hashtags, no quotes marks, no Markdown.',
      },
      {
        role: 'user',
        content:
          `Goals:\n${goals.map((x) => `- ${x.goal.title}${measure(x.goal)}: ${x.progress}%${x.idleDays >= 5 ? `, untouched for ${x.idleDays} days` : ''}${x.next ? `, next step: ${x.next}` : ''}`).join('\n')}\n` +
          (dream ? `Their life vision: ${dream}\n` : '') +
          'Reply ONLY with a JSON array of 14 strings.',
      },
    ],
    0.9,
  );
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('bad AI reply');
  return (JSON.parse(m[0]) as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 14);
}
