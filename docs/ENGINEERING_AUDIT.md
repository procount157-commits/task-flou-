# Hayati — Engineering Audit (Phase 0)

Date: 2026-11-10 · Commit audited: `0fcc86e` · Scope: `src/` (~10.9k lines TS/TSX), `modules/phone-lock` (Kotlin), CI workflows.

## 1. Architecture as found

| Area | Implementation | Assessment |
|---|---|---|
| App shell | Expo SDK 57, RN 0.86, expo-router Tabs + ~40 hidden routes | OK. Bottom bar is user-customisable but defaults to 10 items (scrolls sideways, labels truncated). |
| Storage | `src/lib/db.ts`: one AsyncStorage key per entity (`db:<Entity>`), whole array rewritten on every write, in-memory mirror, `useSyncExternalStore` | Works offline and is fast for personal data sizes (hundreds–low thousands of rows). **No schema version, no migrations, no backup before destructive changes, no write hooks.** |
| Task model | `DailyTask` with `date` (required), `time`, `end_time`, `minutes`, `parent_id`, `goal_id`, `calendar_event_id`… | **No status** (only `completed`), **no Inbox** (every task must have a date), **deadline and scheduled time are the same field**, no `version`/`updatedAt` used for conflicts, no sync status. |
| Writes | 42 direct `db.*('DailyTask')` calls across 17 files | No single repository; side-effects (calendar sync, reminders) are re-implemented per screen (20 `autoSyncTask` call sites). |
| "Google Calendar" | `src/lib/devicecal.ts` — expo-calendar writes into the phone's calendar provider; if that calendar belongs to a Google account Android syncs it later | **Not a Google API integration.** No OAuth, no account/calendar selection from Google, no free/busy, no idempotency (event ids are device-local), no retry queue. Deleted events are detected only by polling the device provider. |
| Notion | none | Missing. |
| AI | OpenAI-compatible chat (Groq → OpenRouter fallback); `smartTask`, `timeboxTask`, `llmList`, `makePlan` | Outputs parsed with ad-hoc regex `match(/\[…\]/)` + `JSON.parse` (8 sites) and **not validated against a schema**. Breakdown results are inserted directly; no editable preview, no selective approval (except Plan screen preview). |
| Quick capture | `src/lib/nlp.ts` `parseTask` (date/time/priority/duration, ar+en) | Good base. Missing: end time / ranges, deadline vs scheduled, recurrence, reminder offset, tags, project/list, goal linkage, explicit "inbox". |
| Goals | 7-level pyramid (`Goal.level`), measurable fields, `/plan` AI roadmap | Kept. Progress is partly manual; no risk / next action computed from real data in one place. |
| Notifications | expo-notifications + native Kotlin (hourly card, overlay, alarms, lock) | Strong native layer. Hourly check-in has **no quiet hours / frequency setting**. |
| Errors | 25 `catch {}` / `.catch(() => {})` sites | Several hide real failures (calendar writes, sync). Error log exists (`errlog.ts`) but not used everywhere. |
| Secrets | AI keys via `EXPO_PUBLIC_*` (inlined into the personal APK only, never committed), Telegram token in AsyncStorage | Acceptable for a single-user personal build; tokens must move to secure storage. |
| Tests | **None.** Scripts: `typecheck`, `lint`. CI emulator test takes screenshots only. | Critical gap. |

## 2. Findings (ranked)

1. **F1 – Fake-ish Google integration.** Calendar posting depends on the device calendar provider; there is no confirmation from Google that an event exists. Violates "never claim external success without confirmation".
2. **F2 – No Inbox / no status model.** A task cannot exist without a date, which forces fake dates and pollutes the calendar.
3. **F3 – Deadline = schedule.** "Finish report by Thursday" becomes an event on Thursday.
4. **F4 – No durable sync queue.** A failed calendar write is lost; repeated syncs can duplicate events (device ids, no idempotency key).
5. **F5 – AI output trusted blindly.** No runtime validation; malformed JSON silently becomes empty or partial data.
6. **F6 – Breakdown not editable.** Steps are created immediately; user cannot edit/reorder/delete before accepting.
7. **F7 – Scheduler unaware of busy time.** Free-slot suggestion uses Hayati tasks only, not external calendar events.
8. **F8 – Navigation overload.** 10-item scrolling bar; core flows (Today, Inbox, Goals, Calendar) compete with niche modules.
9. **F9 – No migrations/backups.** Any model change risks data loss.
10. **F10 – No automated tests.**
11. **F11 – Hidden errors** in sync and notification code paths.
12. **F12 – Hourly check-in has no quiet hours / frequency.**

## 3. Decisions

- **Storage: keep AsyncStorage, add a versioned migration runner with an automatic JSON backup** (`src/core/migrate.ts`, `src/lib/repo.ts`). Rationale: data sizes are small, every screen already uses the reactive `useEntity` hook, and moving 21 entities to expo-sqlite would be a rewrite of every screen with high regression risk and no user-visible gain today. The repository layer isolates storage so SQLite can be swapped in later without touching screens.
- **Pure core (`src/core/*`)** — task model, quick-capture parser, schemas/validators, outbox, scheduler, Google/Notion mappers — has no React Native imports and is unit-tested with `node --test` (Node ≥ 22 strips TS types).
- **Google Calendar: real REST API** (`https://www.googleapis.com/calendar/v3`) with an access token obtained on-device through Google Play Services `AuthorizationClient` (no client secret in the app; the Android OAuth client is identified by package name + SHA-1). Event ids are deterministic (base32hex of the task id) so retries can never create duplicates; every managed event carries `extendedProperties.private.hayatiTaskId`.
- **Device-calendar path stays as an explicit fallback** when Google API is not connected, and is migrated (device event removed, API event created) when the user connects, so no duplicates appear.
- **Notion: internal integration token** stored in `expo-secure-store` (public OAuth requires a backend holding the client secret — documented, not faked). API version `2025-09-03` (data sources).
- **Outbox**: every external write is an operation persisted in `kv:outbox`, coalesced per (provider, task), retried with exponential backoff, and only marked done when the provider returns success.

## 4. Plan → see `docs/ENGINEERING_REPORT.md` for what was implemented and verified.
