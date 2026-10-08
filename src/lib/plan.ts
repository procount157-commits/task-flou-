import { InvokeLLM } from './integrations';
import type { GoalLevel, Priority } from './types';

export type PlanTask = { title: string; in_days: number; time?: string; priority: Priority; steps: string[]; repeat_days?: number[] };
export type Plan = { summary: string; milestones: { title: string; in_days: number }[]; tasks: PlanTask[] };

// How far the goal reaches, and the pyramid levels its goal and its milestones land on.
export const HORIZONS: { days: number; level: GoalLevel; milestone: GoalLevel }[] = [
  { days: 90, level: 'three_months', milestone: 'one_month' },
  { days: 365, level: 'one_year', milestone: 'three_months' },
  { days: 1095, level: 'three_years', milestone: 'one_year' },
  { days: 3650, level: 'ten_years', milestone: 'three_years' },
];

const PRIOS: Priority[] = ['high', 'medium', 'low'];
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// Turns one goal into milestones across its horizon and dated, concrete tasks for the next 30 days.
export async function makePlan(goal: string, horizonDays: number, otherGoals: string[], lang: string): Promise<Plan> {
  const language = lang === 'ar' ? 'Arabic' : 'English';
  const text = await InvokeLLM(
    [
      {
        role: 'system',
        content:
          'You are a strategic planner who turns a big goal into an executable plan. Be concrete and realistic: every task is a single action a person can finish in one sitting, ' +
          'starting with a verb, at most 8 words. Spread tasks over the next 30 days, put the most important ones first, and include a few weekly recurring tasks where repetition matters. ' +
          'Money is in UAE dirhams unless the goal names another currency.',
      },
      {
        role: 'user',
        content:
          `Goal: "${goal}". Horizon: ${horizonDays} days.` +
          (otherGoals.length ? ` The person's other goals: ${otherGoals.slice(0, 6).join('; ')}.` : '') +
          `\nReply ONLY with a JSON object, all text in ${language}:\n` +
          '{"summary": "two sentences on the strategy", ' +
          '"milestones": [{"title": "measurable checkpoint", "in_days": number}] (4 to 6 checkpoints before the goal itself, never the goal itself), ' +
          '"tasks": [{"title": "...", "in_days": 0-30, "time": "HH:MM", "priority": "high|medium|low", "steps": ["2 to 4 short sub-steps"], "repeat_days": [0-6 weekdays, Sunday=0] or []}] (10 to 14 tasks)}',
      },
    ],
    0.5,
  );
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('bad AI reply');
  const raw = JSON.parse(m[0]);
  const milestones = (Array.isArray(raw.milestones) ? raw.milestones : [])
    .map((x: any) => ({ title: str(x?.title), in_days: clampInt(x?.in_days, 1, horizonDays, horizonDays) }))
    .filter((x: { title: string }) => x.title)
    .slice(0, 8);
  const tasks: PlanTask[] = (Array.isArray(raw.tasks) ? raw.tasks : [])
    .map((x: any) => ({
      title: str(x?.title),
      in_days: clampInt(x?.in_days, 0, 30, 0),
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(str(x?.time)) ? str(x?.time) : undefined,
      priority: PRIOS.includes(x?.priority) ? x.priority : 'medium',
      steps: (Array.isArray(x?.steps) ? x.steps : []).map(str).filter(Boolean).slice(0, 5),
      repeat_days: (Array.isArray(x?.repeat_days) ? x.repeat_days : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6),
    }))
    .filter((x: PlanTask) => x.title)
    .slice(0, 20);
  if (!tasks.length) throw new Error('bad AI reply');
  return { summary: str(raw.summary), milestones, tasks };
}
