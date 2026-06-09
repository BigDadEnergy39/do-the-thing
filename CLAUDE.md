# Do The Thing

Personal coaching task manager app built with Expo + React Native, targeting **Android only**.

## What it does
A dynamic personal coach that surfaces what matters daily — not a static list, but an active coach that helps maintain focus. 5 coach personas, full notification cadence, 6 task types.

## Stack
- Expo SDK ~56 with expo-router (file-based navigation)
- `expo-sqlite` — local persistence
- `expo-notifications` + `expo-task-manager` + `expo-background-fetch`
- No external backend — fully local

## File layout
- `app/_layout.js` — root nav, DB init, notification setup
- `app/index.js` — Today dashboard (main, timed goals, habits, backlog, completed sections)
- `app/add.js` — Add/edit task (all 7 task types including habit)
- `app/all-tasks.js` — Browse all active tasks grouped by type, searchable, tap to edit
- `app/review.js` — Evening wrap-up / weekly review screen
- `app/settings.js` — Coach persona, notification intensity, timing, categories
- `app/task/[id].js` — Task detail + completion history
- `src/db/schema.js` — SQLite schema + migrations
- `src/db/tasks.js` — Task CRUD, completions, timed sessions; timezone-safe helpers
- `src/db/habits.js` — Habit check-in CRUD, streak calculation
- `src/db/categories.js` — Category CRUD
- `src/db/settings.js` — Key-value settings store
- `src/engine/scheduler.js` — Daily list builder, two-factor sort, auto-hide, escalation
- `src/hooks/useDailyList.js` — React hook wrapping buildDailyList for the Today screen
- `src/components/CoachText.js` — 5 coach personas
- `src/components/TaskCard.js` — Standard task card with priority chip/tint
- `src/components/TimedGoalCard.js` — Timer card with progress bar
- `src/components/HabitCard.js` — Habit check-in card (Kept/Mostly/Didn't + streak)
- `src/components/FastCapture.js` — Quick-add modal
- `src/notifications/notificationService.js` — Full coaching notification cadence

## 7 Task Types
- **unscheduled** — one-time to-do, no date, auto-escalates; hidden permanently after first completion
- **deadline** — due date + optional time, priority escalation as date approaches
- **recurring** — weekly/daily/interval; persistent or non-persistent; resets from actual completion date
- **randomized** — random window (e.g. 2–4 weeks), persistent toggle
- **date_anchor** — annual dates (birthdays), lead-time reminders
- **timed_goal** — built-in timer, daily or weekly accumulation, no cap
- **habit** — daily behavior check-in (Kept/Mostly/Didn't) per time window; streak tracking

## Key design decisions
- Two-factor sort: urgency (time pressure) + importance (priority) scored independently
- Priority ceiling per task: auto-escalation never exceeds user-set cap
- Auto-hide stale recurring tasks after N consecutive skips
- Backlog section: collapsed, holds low-priority/no-urgency items
- Timed goals always visible in own section; weekly goals show weekly total
- Interval recurring tasks reset clock from actual completion date
- Snoozed tasks stay in their priority position (not demoted)
- 5 coach personas: Just the Facts, Steady Hand, Mentor, Coach, Hype Person
- Notification intensity slider (1–5) controls nudge frequency
- Daily cadence: morning briefing, 2x mid-day check-ins, evening wrap-up, Sunday weekly review

## Deferred (Phase 2 — do not scope in)
- Google Calendar integration
- Garmin watch integration
- Multi-user / family sync with cloud backend

## Run commands
```
npm install
npx expo start --android
```
Requires Android device or emulator. Read versioned Expo docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.
