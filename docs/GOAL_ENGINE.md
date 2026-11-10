# Hayati — Goal discovery & decomposition engine

## Why plans were random (root cause)
`src/lib/plan.ts › makePlan(goal, horizonDays, otherGoals)` was the only input to the planner: **the goal's title
and a horizon chip**. The prompt fixed the shape ("4 to 6 checkpoints", "10 to 14 tasks", "spread over the next
30 days"), so every goal got the same skeleton filled with generic actions. `GoalDetail › ✨ breakdown` opened
`/plan?goal=…` and `Plan.tsx` called `makePlan` immediately on mount — no question was ever asked, the person's
time/baseline/motivation never reached the model, nothing was checked against capacity, and a dependent task could
land before its prerequisite.

## What replaces it
| Step | Where | Notes |
|---|---|---|
| Interview (one question at a time, chips first, skip / "I don't know", "why this question?") | `src/core/goalinterview.ts`, `src/screens/GoalInterview.tsx` | 7 category paths (education, financial, business, career, fitness, personal, lifestyle). Follow-ups open only when needed: vague outcome → detail; "I feel I should" → genuine?; "tried and stopped" → what stopped you. |
| Already-known answers are not asked | `startInterview` | Horizon from the title ("within six months" / «خلال ستة أشهر») or the goal's due date. |
| AI only tailors options | `src/lib/goalcoach.ts › aiOptions` | For success, baseline, resources, skill gaps, obstacles — e.g. the real parts of the named certificate. The flow and the gate stay deterministic. Static options remain as a fallback. |
| Resume after restart | `GoalInterview` entity | Answers are appended (history kept, never overwritten); the draft roadmap with the person's edits is stored too. |
| Readiness gate | `readiness()` | Field-level completeness only for fields on that goal's path; "I don't know" is recorded uncertainty. Missing essentials are named with a button that asks exactly that question. |
| Capacity | `weeklyCapacity()` + `readCapacity()` | The phone calendar (and existing timed tasks) inside the preferred window on the chosen days can only **lower** the hours stated. No calendar / failed read → stated hours, and the preview says so. |
| Roadmap (separate AI operation) | `generateRoadmap()` → `parseRoadmap()` → `validateRoadmap()` | Runtime-validated contract; one repair retry. Backward planning, milestone count by goal, hours per milestone, tasks detailed only for the near milestones, dependencies by key. Generic titles ("Study CMA") are flagged; unknown dependencies removed; cycles broken. |
| Scheduling | `scheduleRoadmap()` | Dependency order, weekly capacity, allowed days, window, busy time, session length (a long task is split into sessions on different days). |
| Feasibility | `feasibility()` | Total effort vs. weekly time vs. deadline. When it does not fit: extend to a computed date, reduce scope %, raise hours, or start with the first stage — never a fictional schedule. |
| Editable preview A–E | `GoalInterview.tsx` | Understanding + success criteria (must be approved), profile, roadmap (rename, minutes, priority, on/off, reorder milestones, add tasks), feasibility + risks, why-it-fits / assumptions. Simpler / more ambitious / optimise regenerate from the same brief. |
| Approval | `approve()` | Re-reads the calendar first; if sessions moved, shows it and asks again. Only kept items become records. Milestone deadline (`due_date`) is stored apart from the work session (`date`/`time`). Calendar writes use the existing engine (`autoSyncTask`). |
| Follow-up | `src/screens/GoalAdapt.tsx` | Weekly numbers from real completions; "keep or adjust?"; a replan proposal at real capacity (missed work is spread, not piled on tomorrow) shown as a diff and applied only on approval; deadline / weekly-time changes recorded. |

## Data model (reused where possible)
- New entities: `GoalInterview` (with its answers = GoalInterviewAnswer), `GoalProfile` (brief: motivation profile,
  time capacity, execution preferences; success criteria; risk assessment; versioned), `GoalPlanVersion`,
  `GoalActivity` (audit history, including reviews = GoalReview).
- Milestones are child `Goal`s (new fields `purpose`, `done_when`, `start_date`, `estimated_hours`, `depends_on`,
  `plan_key`) so the existing pyramid, progress roll-up and goal pages keep working.
- Projects / workstreams = `DailyTask.project`; dependencies = `DailyTask.dependencies` (task ids); `plan_key`
  links a task back to the approved roadmap.
- User → Goal → GoalInterview → GoalProfile → milestone Goals → DailyTasks → calendar events (`calendar_event_id`).
  Notion page ids already exist on the task model; Notion is not connected yet.

## Tests (`npm test`, tests/goals.test.ts — 14 scenarios)
Certification-in-six-months acceptance (no plan on creation, asks which certificate, knowledge, motivation, time,
style, resources, obstacles, success; gate; feasibility; dependencies; preview edits; only approved records;
Google event + Notion property mapping), plus: skipped / unknown answers, deadline changed halfway, unrealistic
goal, no calendar, failed calendar, stop and resume, rejected plan writes nothing, availability change, two people
with the same goal get different plans. Emulator journey D in `.github/device-test.sh` runs the real screens.

## Known limits
- Google Calendar is reached through the phone calendar (as before); Notion is not connected — the preview and the
  approval message say so.
- The AI estimates milestone hours; the app checks them against capacity but cannot verify the estimate itself.
- Tasks for later milestones are generated when you plan again from the goal page (rolling plan), not up front.
