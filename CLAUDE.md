# Do The Thing

Personal coaching task manager app built with Expo + React Native, targeting **Android only**.

## What it does
A dynamic personal coach that surfaces what matters daily — not a static list, but an active coach that helps maintain focus. 5 coach personas, full notification cadence, 7 task types.

## Stack
- Expo SDK ~56 with expo-router (file-based navigation)
- `expo-sqlite` — local persistence
- `react-native-notify-kit` (source-built, drop-in notifee fork) for local scheduled notifications (no FCM/Firebase) + `expo-task-manager` + `expo-background-fetch` for background refresh (WorkManager)
- No external backend — fully local

## Publishing target — F-Droid (hard requirement)
The end goal is publication on **F-Droid**. Every change must keep the app F-Droid-eligible:
- **License:** GPL-3.0-or-later. `LICENSE` holds the verbatim GPL-3.0 text. Set the copyright holder in source headers / a future README before submitting.
- **No proprietary dependencies:** no Google Play Services, Firebase/FCM, Crashlytics, AdMob, or any closed-source SDK. Notifications are local via react-native-notify-kit; background work uses WorkManager. Before adding ANY dependency, confirm it's FOSS and FCM-free, and flag it if not.
- **No anti-features:** no analytics, ads, tracking, or telemetry. The app is fully offline with no account or cloud sync.
- **Clean manifest:** `android/app/src/main/AndroidManifest.xml` is kept free of orphaned Firebase/expo-updates meta-data and unnecessary sensitive permissions (e.g. `SYSTEM_ALERT_WINDOW` was removed). Don't reintroduce them via stray prebuilds.
- **Listing metadata:** lives in `fastlane/metadata/android/en-US/` (title, short/full description, changelogs, images). Bump a new `changelogs/<versionCode>.txt` each release. Screenshots still need to be added under `images/`.
- **Build everything from source (no prebuilt AARs):** Expo SDK 56 consumes many modules
  (expo-router, expo-font, expo-file-system, …) as *precompiled* AARs by default, which F-Droid
  rejects. `package.json` → `expo.autolinking.buildFromSource: [".*"]` forces every Expo module to
  compile from source instead. Don't remove it. (Same reason we use react-native-notify-kit over
  @notifee/react-native, whose core was prebuilt-only.)
- **Reproducibility:** prefer deterministic builds; avoid pulling remote resources at build time. `expo.modules.updates` (OTA) is disabled and unlinked — keep it that way.

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
- Daily cadence: morning briefing, 2x mid-day check-ins, evening wrap-up (fires AT bedtime), Sunday weekly review

## Coaching voice — tier model
Evening/wrap-up copy is driven by a single `wrapupTier(done, remaining)` helper in
`src/components/CoachText.js`. **Thresholds live only in that helper** — personas
supply voice per tier, never their own percentage checks. Extend this when tiering
other nudges (morning/midday) rather than scattering ad-hoc cutoffs.

Denominator = the day's surfaced tasks (`done + still-open`). Habits and timed
goals are tracked separately and don't count. Cutoffs are inclusive.

| Completion | Tier | Meaning |
|---|---|---|
| 100% | `clean` | Clean sweep — reserved for everything done |
| ≥80% | `almost` | Almost got them all |
| ≥50% | `half` | Solid progress |
| ≥30% | `some` | Made progress |
| >0% | `low` | A little done — get more tomorrow |
| 0% (tasks left) | `none` | Nudge to start |
| empty list | `empty` | Nothing was scheduled |

"Just the Facts" persona stays neutral (raw numbers, no tier editorializing).
The wrap-up's live counts are kept fresh via `refreshEveningWrapup()` (called on
app refresh) so the bedtime notification never fires stale "0 done" numbers.

## Time & dates — local only (hard requirement)
From the user's perspective **local time is the only time that matters.** Anything that
shows the wrong day/time, fires early/late, or drops due to a UTC-vs-local mismatch reads
as the app being broken — even once. "Self-consistent UTC" is not an acceptable excuse.

- Internal storage may be UTC (SQLite `datetime('now')`), but every user-perceived moment
  — what fires, when, and what date/time is displayed — must be **local**.
- Use the helpers in `src/utils/date.js`: `localDateStr` (local "today" key), `parseLocalDay`
  (date-only string → local midnight), `parseUtcStamp` (UTC datetime string → correct instant
  for local display).
- **Never** use `new Date(dbString)` directly for display, or `toISOString().slice(0,10)` as a
  day key — both leak UTC. Treat any such leak as a bug to fix now, not defer.

## Deferred (Phase 2 — do not scope in)
- Google Calendar integration
- Garmin watch integration
- Multi-user / family sync with cloud backend

## Run commands
```
npm install --legacy-peer-deps
npx expo run:android
```
Requires Android device or emulator connected via USB or an Android emulator running.
`expo run:android` compiles the native Android code locally (bare workflow — no Expo Go).
First run takes longer; subsequent runs are incremental.
Read versioned Expo docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

## Notifications
Uses `react-native-notify-kit` for fully local scheduled notifications — no Firebase/FCM dependency.
This keeps the app F-Droid compatible. (It's a drop-in, API-compatible fork of
`@notifee/react-native` that compiles its native core from source; upstream notifee ships that
core only as a prebuilt AAR, which F-Droid rejects.) `expo-task-manager` + `expo-background-fetch` are retained
for background refresh (they use Android WorkManager, which is also FCM-free).
