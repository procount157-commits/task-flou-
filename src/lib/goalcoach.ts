// AI side of the goal planner. Three separate operations, each validated before use:
//  1. goal-specific options for one interview question (never decides the flow),
//  2. a roadmap from a complete brief (only after the readiness gate),
//  3. a revision of that roadmap on request (simpler / more ambitious / optimise).
// Nothing here writes data; the screen saves only what the person approves.
import { arr, obj, parseAI, str } from '../core/schema';
import type { GoalBrief, InterviewState, Slot } from '../core/goalinterview';
import { briefForPrompt, parseRoadmap, validateRoadmap, type Issue, type Roadmap } from '../core/roadmap';
import { InvokeLLM } from './integrations';

const OptionsSchema = obj({ question: str({ optional: true, max: 220 }), options: arr(str({ min: 1, max: 60 }), { min: 2, max: 8 }) });

const ASK: Partial<Record<Slot, string>> = {
  success: 'the concrete evidence that would prove this exact goal is achieved (official result, score, number, delivered thing)',
  baseline: 'realistic starting levels a person could be at for this exact goal',
  resources: 'the specific resources, materials or tools this exact goal normally needs',
  skill_gaps: 'the specific skills or topics this exact goal requires that people often find hard',
  obstacles: 'the most common real obstacles people face with this exact goal',
};
export const AI_SLOTS = Object.keys(ASK) as Slot[];

/** Options tailored to the goal the person named (e.g. the actual parts of CMA). Undefined on failure: the static options stay. */
export async function aiOptions(s: InterviewState, slot: Slot, lang: string): Promise<{ question?: string; options: string[] } | undefined> {
  const what = ASK[slot];
  if (!what) return undefined;
  const language = lang === 'ar' ? 'Arabic' : 'English';
  const known = s.answers.filter((a) => a.status === 'answered').slice(-8).map((a) => `${a.slot}: ${a.picks?.join(', ') ?? a.value ?? a.num}`).join('; ');
  try {
    const text = await InvokeLLM([
      { role: 'system', content: 'You help a goal-planning interview. You never plan; you only list answer options for one question. Options are short (max 6 words), specific to the goal, mutually distinct, and never invent facts about the person.' },
      { role: 'user', content: `Goal: "${s.goal_title}" (${s.category}). Known so far: ${known || 'nothing'}.\nList ${what}. Also write the question itself in one friendly sentence.\nReply ONLY with JSON in ${language}: {"question": "...", "options": ["...", "..."]} (4 to 6 options).` },
    ], 0.4);
    const r = parseAI(OptionsSchema, text);
    return r.ok ? { question: r.value.question, options: (r.value.options ?? []).filter(Boolean) as string[] } : undefined;
  } catch {
    return undefined;
  }
}

const RULES = [
  'Plan backwards from the desired outcome: outcome → milestones → workstreams → tasks.',
  'The number of milestones depends on this goal; never pad to a fixed count. Each milestone must contribute directly to the outcome and have clear completion criteria.',
  'Estimate realistic focused hours for every milestone ("hours"). Do not shrink estimates to make the deadline fit — the app checks feasibility itself.',
  'Detail tasks only for the first milestone or two (about the next 4–6 weeks at the stated weekly time). Later milestones keep their hours; their tasks are made when they get closer.',
  'Every task is one precise action a person can do in one sitting, starting with a verb, with a visible result (e.g. "Answer 20 practice questions on Section A and log mistakes"). Never "study X", "work on the goal", "continue learning", "make progress".',
  'Task minutes match the person\'s session length; a longer task is fine, the app splits it into sessions.',
  'Use dependencies (keys) where order truly matters: prerequisites, skills and resources before the work that needs them; market validation before building or paid marketing when the market is not validated.',
  'Use the person\'s answers: baseline decides how much foundation is needed; obstacles and past stopping reasons each get a risk with prevention and recovery; motivation shapes milestone size (small wins vs big milestones).',
  'Never use guilt, fear or shame. Never invent personal facts. Put every guess you had to make in "assumptions".',
  'Money is in UAE dirhams unless the goal names another currency.',
];

const SHAPE =
  '{"understanding": "what you understood, 1–2 sentences", "why_it_fits": "why this plan matches these answers", "first_step": "the single first action", ' +
  '"success": [{"measure": "...", "baseline": "...", "target": "...", "unit": "...", "evidence": "..."}], ' +
  '"milestones": [{"key": "m1", "title": "...", "purpose": "...", "result": "...", "done_when": "...", "hours": number, "depends_on": ["m0"]}], ' +
  '"tasks": [{"key": "t1", "title": "...", "description": "...", "why": "...", "minutes": number, "priority": "high|medium|low", "milestone": "m1", "workstream": "...", "depends_on": ["t0"], "done_when": "..."}], ' +
  '"risks": [{"risk": "...", "probability": "low|medium|high", "impact": "low|medium|high", "warning": "...", "prevent": "...", "recover": "...", "alternative": "..."}], ' +
  '"assumptions": ["..."], "recommendations": ["..."]}';

export type Revision = 'simpler' | 'ambitious' | 'optimize';
const REVISE: Record<Revision, string> = {
  simpler: 'Make the plan simpler: fewer milestones and tasks, keep only what moves the outcome most, smaller first steps.',
  ambitious: 'Make the plan more ambitious within the same weekly time: stretch targets and deeper practice, but stay realistic.',
  optimize: 'Optimise the plan: remove duplication, fix ordering and dependencies, make every task more precise, and balance the workload.',
};

/** The planner. Validated against the roadmap contract, repaired once if the reply is malformed. */
export async function generateRoadmap(brief: GoalBrief, lang: string, revise?: { mode: Revision; current: Roadmap }): Promise<{ roadmap: Roadmap; issues: Issue[] }> {
  const language = lang === 'ar' ? 'Arabic' : 'English';
  const msgs = [
    { role: 'system' as const, content: `You are a strategic goal planner, project manager and behavioural coach in one. Rules:\n- ${RULES.join('\n- ')}` },
    {
      role: 'user' as const,
      content:
        `What the person told us (structured; fields they skipped or did not know are listed in "unknown"/"skipped"):\n${JSON.stringify(briefForPrompt(brief))}\n` +
        (revise ? `\nCurrent plan:\n${JSON.stringify(revise.current)}\n${REVISE[revise.mode]}\n` : '') +
        `\nReply ONLY with one JSON object, all text in ${language}:\n${SHAPE}`,
    },
  ];
  let text = await InvokeLLM(msgs, 0.4);
  let r = parseRoadmap(text);
  if (!r.ok) {
    text = await InvokeLLM([...msgs, { role: 'assistant', content: text.slice(0, 4000) }, { role: 'user', content: `That reply did not match the format: ${r.errors.slice(0, 6).join('; ')}. Reply again with the corrected JSON only.` }], 0.2);
    r = parseRoadmap(text);
  }
  if (!r.ok) throw new Error(lang === 'ar' ? 'رد الذكاء لم يطابق شكل الخطة المطلوب. جرّب مرة أخرى.' : 'The AI reply did not match the plan format. Try again.');
  return validateRoadmap(r.value, { maxTaskMinutes: Math.max(240, brief.execution.session_minutes * 4) });
}
