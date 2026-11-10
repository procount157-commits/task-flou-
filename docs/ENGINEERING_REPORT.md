# Hayati — Engineering Report (single phase: tasks · ease of use · AI)

Scope was reduced by the owner to **one phase** covering tasks, ease of use and AI. Real Google OAuth and Notion
sync were **not wired into the app** in this phase; their pure mapping/sync logic exists and is unit-tested so the
next phase only needs the auth layer.

## A. What changed
| Area | Change | Files |
|---|---|---|
| Task model | Statuses (inbox … archived), deadline `due_date` separate from scheduled `date`, description, tags, reminders, effort, source, version. `date: ''` = Inbox. | `src/core/task.ts`, `src/lib/types.ts` |
| Migration | Old tasks migrated once on load; raw JSON copied to `backup:v1:db:DailyTask` first. No field is dropped. | `src/lib/db.ts`, `src/core/migrate.ts` |
| Quick capture | Arabic/English: date, time, **ranges** (من 3 إلى 5 / 6-7pm), duration, priority, **deadline** (قبل/بحلول/by/due), **recurrence** (كل يوم / كل اثنين وخميس / every sunday), **reminder** (ذكرني قبل 15 دقيقة), #tags, +project, goal link, «لاحقاً» → Inbox. Live "understood" line. | `src/core/capture.ts`, `src/screens/AddTask.tsx` |
| Inbox | New smart list «📥 الوارد»; undated tasks never go to the calendar (an existing event is removed). Overdue uses deadline first. | `Tasks.tsx`, `taskparts.tsx`, `devicecal.ts` |
| Deadline chips | ⏳ none / today / tomorrow / +3 days / next week in the add screen; shown on rows. | `AddTask.tsx` |
| Free time | "First free slot" now avoids phone-calendar events and existing tasks, and fits the chosen length. | `AddTask.tsx`, `src/core/scheduler.ts` |
| AI validation | Every smart-task / breakdown reply passes a runtime schema; malformed replies are rejected with a visible error (one automatic retry for breakdown). | `src/core/schema.ts`, `src/lib/integrations.ts` |
| Editable breakdown | AI steps open in an editor: rename, minutes, ↑↓ reorder, delete, add, «اقتراح آخر» (regenerate), then accept. In Add Task and Task Detail. | `src/ui/BreakdownEditor.tsx` |
| AI day plan | The AI's schedule is checked: blocks over calendar events, overlapping, in the past or for unknown tasks are dropped; the rest is placed by the deterministic scheduler. | `DayView.tsx` |
| Navigation | Bottom bar: اليوم · المهام · الأهداف · التقويم · المزيد (one-time reset; user edits kept afterwards). | `src/ui/NavBar.tsx` |

## B. Ready but not connected (next phase)
- `src/core/outbox.ts` — durable queue, coalescing, backoff, permanent/auth errors.
- `src/core/gcalmap.ts` — deterministic Google event ids, all-day vs timed, `hayatiTaskId` private property, move/delete → patch/unschedule, external events as busy.
- `src/core/notionmap.ts` — schema-based mapping, only mapped props written, conflict policy, "Hayati Tasks" database body.

## C. Tests
| Kind | Result |
|---|---|
| Unit (`npm test`, 37 tests: capture, model, migration, schemas, outbox, scheduler, Google & Notion mapping) | **Passed 37 / Failed 0** |
| Type check (`tsc --noEmit`) | **Passed** |
| Android bundle (`expo export`) | **Passed** |
| Emulator journeys A–C (`.github/device-test.sh`) | see run result below |
| Google Calendar API / Notion live calls | **Not run — requires credentials (not in this phase)** |
| Sound, vibration, lock screen on a real phone | **Requires device** |

## D. Known limits
- Calendar writes still go through the phone's calendar (Google account on the phone syncs them); confirmation means "written to the phone calendar", not "confirmed by Google".
- Recurrence from quick capture maps to weekly `repeat_days`; monthly rules are parsed but stored only as text in the parser output.
