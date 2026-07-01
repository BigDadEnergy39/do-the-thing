/**
 * Notification service — uses @notifee/react-native for fully local notifications
 * with no Firebase / Google Play Services dependency (F-Droid compatible).
 *
 * Background periodic refresh still uses expo-task-manager + expo-background-fetch,
 * both of which use Android WorkManager (FCM-free).
 */

import notifee, {
  AndroidImportance,
  TriggerType,
  RepeatFrequency,
  AuthorizationStatus,
} from '@notifee/react-native';
import { getSetting, setSetting } from '../db/settings';
import { getCoachText, PERSONA_NUDGE_LEVEL, COMPLETION_ACK_THRESHOLD, HABIT_NUDGE_THRESHOLD } from '../components/CoachText';
import { localDateStr } from '../utils/date';

const BACKGROUND_TASK = 'DTT_NOTIFICATION_CHECK';

const INTENSITY_CONFIG = {
  1: { summaryCount: 0 },
  2: { summaryCount: 1 },
  3: { summaryCount: 2 },
  4: { summaryCount: 2 },
  5: { summaryCount: 2 },
};

// Stable IDs for coaching notifications — makes cancel/reschedule simple
const IDS = {
  MORNING:  'coaching-morning',
  MIDDAY_1: 'coaching-midday-1',
  MIDDAY_2: 'coaching-midday-2',
  EVENING:  'coaching-evening',
  WEEKLY:   'coaching-weekly',
};

// Returns the next timestamp (ms) for a given hour:minute, always in the future
function nextDailyTimestamp(hour, minute) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Returns the next timestamp (ms) for a given weekday + hour:minute
// weekday: 0 = Sunday, 1 = Monday, ... 6 = Saturday
function nextWeeklyTimestamp(weekday, hour, minute) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  const daysUntil = (weekday - d.getDay() + 7) % 7;
  if (daysUntil === 0 && d.getTime() <= Date.now()) {
    d.setDate(d.getDate() + 7);
  } else {
    d.setDate(d.getDate() + daysUntil);
  }
  return d.getTime();
}

export async function requestPermissions() {
  try {
    const settings = await notifee.requestPermission();
    return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
  } catch { return false; }
}

// Create every channel independently. Previously all eight shared one try/catch,
// so a single bad channel config threw and left the app with ZERO channels —
// and then every notification was silently dropped ("No Channel found"). Now a
// failure is isolated to its own channel and logged. Configs are kept to widely
// supported properties (id/name/importance + vibration) — the earlier lightColor
// and sound:'default' properties were the likely culprits for the throw.
// NOTE: no `vibration`/`vibrationPattern` here — that property throws in
// notifee's createChannel on this Android 16 build (confirmed: the three channels
// that had it were the exact three that failed to create). HIGH/MAX importance
// channels vibrate by default, so the buzz is preserved without the bad property.
const NOTIFICATION_CHANNELS = [
  { id: 'briefing',          name: 'Daily Briefing',             importance: AndroidImportance.HIGH },
  { id: 'nudge',             name: 'Task Nudges',                importance: AndroidImportance.DEFAULT },
  { id: 'summary',           name: 'Daily Summary',              importance: AndroidImportance.DEFAULT },
  { id: 'review',            name: 'Weekly Review',              importance: AndroidImportance.HIGH },
  { id: 'completion_ack',    name: 'Completion Acknowledgments', importance: AndroidImportance.DEFAULT },
  { id: 'habit_nudge',       name: 'Habit Nudges',               importance: AndroidImportance.DEFAULT },
  { id: 'deadline_reminder', name: 'Deadline Reminders',         importance: AndroidImportance.HIGH },
  { id: 'deadline_critical', name: 'Critical Overdue Alerts',    importance: AndroidImportance.MAX },
];

export async function createNotificationChannels() {
  for (const channel of NOTIFICATION_CHANNELS) {
    try {
      await notifee.createChannel(channel);
    } catch (e) {
      console.log('createChannel failed:', channel.id, e?.message);
    }
  }
}

// No-op: notifee shows foreground notifications by default
// Foreground + background event handling is wired up in app/_layout.js
export function setupNotificationCategories() {}

const TASK_ACTIONS = [
  { title: 'Mark Done', pressAction: { id: 'complete' } },
  { title: 'Snooze 15m', pressAction: { id: 'snooze_15' } },
  { title: 'Snooze 1h',  pressAction: { id: 'snooze_60' } },
];

const CRITICAL_OVERDUE_ACTIONS = [
  { title: 'Mark Done',  pressAction: { id: 'complete' } },
  { title: 'Snooze 30m', pressAction: { id: 'snooze_30' } },
];

// Schedule advance reminders + critical overdue loop for a deadline task.
// Call this after createTask or updateTask whenever due_date/due_time/due_reminders change.
export async function scheduleDeadlineReminders(task) {
  await cancelAllForTask(task.id);
  if (!task.due_date || !task.due_time) return;

  const [dy, dm, dd] = task.due_date.split('-').map(Number);
  const [dh, dmin] = task.due_time.split(':').map(Number);
  const dueMs = new Date(dy, dm - 1, dd, dh, dmin, 0, 0).getTime();

  const persona = getSetting('coach_persona') ?? 'coach';
  const coach = getCoachText(persona);

  // Advance reminders
  let reminders = [];
  try {
    reminders = task.due_reminders
      ? (typeof task.due_reminders === 'string' ? JSON.parse(task.due_reminders) : task.due_reminders)
      : [];
  } catch { /* malformed JSON — skip */ }

  for (let i = 0; i < reminders.length; i++) {
    const { amount, unit } = reminders[i];
    const offsetMs = unit === 'days'    ? amount * 86400000
                   : unit === 'hours'   ? amount * 3600000
                   :                      amount * 60000;
    const triggerMs = dueMs - offsetMs;
    if (triggerMs <= Date.now()) continue;
    try {
      await notifee.createTriggerNotification(
        {
          id: `deadline-adv-${task.id}-${i}`,
          title: 'Do The Thing',
          body: coach.taskDueReminder(task.title, Math.round(offsetMs / 60000)),
          data: { taskId: String(task.id) },
          android: { channelId: 'deadline_reminder', pressAction: { id: 'default' }, smallIcon: 'ic_notification' },
        },
        { type: TriggerType.TIMESTAMP, timestamp: triggerMs, alarmManager: { allowWhileIdle: true } }
      );
    } catch { /* unavailable */ }
  }

  // Critical overdue loop — every 30 min for 48 hours
  if (task.base_priority >= 4) {
    for (let i = 0; i < 96; i++) {
      const triggerMs = dueMs + i * 30 * 60 * 1000;
      if (triggerMs <= Date.now()) continue;
      try {
        await notifee.createTriggerNotification(
          {
            id: `deadline-ovd-${task.id}-${i}`,
            title: '⚠️ Do The Thing',
            body: coach.taskCriticalOverdue(task.title),
            data: { taskId: String(task.id) },
            android: { channelId: 'deadline_critical', actions: CRITICAL_OVERDUE_ACTIONS, pressAction: { id: 'default' }, smallIcon: 'ic_notification' },
          },
          { type: TriggerType.TIMESTAMP, timestamp: triggerMs, alarmManager: { allowWhileIdle: true } }
        );
      } catch { /* unavailable */ }
    }
  }
}

// ── Evening wrap-up content ──────────────────────────────────────────────────
// Computes the day's live counts for the wrap-up. Excludes timed_goal
// completions (those are time logs, not "done" markers) so the count matches
// what the user sees on the Today screen.
function computeEveningWrapup() {
  const { buildDailyList } = require('../engine/scheduler');
  const { getTodayCompletedTasks } = require('../db/tasks');
  const { mainItems, backlogItems, habits } = buildDailyList();
  const remaining = mainItems.length + backlogItems.length;
  const done = getTodayCompletedTasks().filter(t => t.task_type !== 'timed_goal').length;
  const missedHabits = habits.filter(h => !h.checkinResponse).map(h => h.title);
  return { done, remaining, missedHabits };
}

function eveningWrapupBody(persona) {
  const coach = getCoachText(persona);
  const { done, remaining, missedHabits } = computeEveningWrapup();
  return coach.eveningBody
    ? coach.eveningBody(done, remaining, missedHabits)
    : coach.eveningWrapup(done, remaining);
}

// ── Morning briefing content ─────────────────────────────────────────────────
// Live count of what's on the plate today (open items + critical titles), so the
// scheduled briefing matches the in-app card instead of a hardcoded zero.
function computeMorningBriefing() {
  const { buildDailyList } = require('../engine/scheduler');
  const { mainItems, backlogItems } = buildDailyList();
  const allItems = [...mainItems, ...backlogItems];
  const criticalTitles = allItems.filter(t => t.effectivePriority >= 4).map(t => t.title);
  return { count: allItems.length, criticalTitles };
}

function morningBriefingBody(persona) {
  const coach = getCoachText(persona);
  const { count, criticalTitles } = computeMorningBriefing();
  return coach.morningBody
    ? coach.morningBody(count, criticalTitles)
    : coach.morningBriefing(count);
}

export async function scheduleCoachingNotifications() {
  try {
    // Cancel existing coaching notifications by stable ID
    await Promise.all(Object.values(IDS).map(id =>
      notifee.cancelTriggerNotification(id).catch(() => {})
    ));

    const intensity   = parseInt(getSetting('notification_intensity') ?? '3', 10);
    const persona     = getSetting('coach_persona') ?? 'coach';
    const coach       = getCoachText(persona);
    const config      = INTENSITY_CONFIG[intensity] ?? INTENSITY_CONFIG[3];
    const nudgeLevel  = PERSONA_NUDGE_LEVEL[persona] ?? 0;

    // ── Morning briefing ─────────────────────────────────────────────────────
    // The background task fires the real content-rich version near this time.
    // This scheduled alarm is a fallback tap-trigger in case the background task
    // doesn't run (e.g. first boot before WorkManager is registered).
    const morningTime = getSetting('morning_briefing_time') ?? '07:00';
    const [mh, mm] = morningTime.split(':').map(Number);
    await notifee.createTriggerNotification(
      {
        id: IDS.MORNING,
        title: 'Do The Thing',
        body: morningBriefingBody(persona),
        data: { coaching: 'morning' },
        android: { channelId: 'briefing', pressAction: { id: 'default' }, smallIcon: 'ic_notification' },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: nextDailyTimestamp(mh, mm),
        repeatFrequency: RepeatFrequency.DAILY,
        alarmManager: { allowWhileIdle: true },
      }
    );

    // ── Mid-day check-ins (coach / hype only) ────────────────────────────────
    // Delegated to refreshMidayNudges (single source of truth) so they carry the
    // live task count instead of a hardcoded zero, and the persona gate / slot
    // count live in one place. Refreshed again as the app is used.
    await refreshMidayNudges();

    // ── Evening wrap-up ───────────────────────────────────────────────────────
    // Background task fires the real content-rich version. This is the fallback.
    // Wrap-up fires at the Bedtime setting (no offset — keeps it predictable).
    const bedtime  = getSetting('bedtime') ?? '22:00';
    const [bh, bm] = bedtime.split(':').map(Number);
    await notifee.createTriggerNotification(
      {
        id: IDS.EVENING,
        title: 'Day Wrap-Up',
        body: eveningWrapupBody(persona),
        data: { coaching: 'evening' },
        android: { channelId: 'summary', pressAction: { id: 'default' }, smallIcon: 'ic_notification' },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: nextDailyTimestamp(bh, bm),
        repeatFrequency: RepeatFrequency.DAILY,
        alarmManager: { allowWhileIdle: true },
      }
    );

    // ── Weekly review (Sunday by default) ────────────────────────────────────
    const reviewDay  = parseInt(getSetting('weekly_review_day') ?? '0', 10);
    const reviewTime = getSetting('weekly_review_time') ?? '20:00';
    const [rh, rm] = reviewTime.split(':').map(Number);
    await notifee.createTriggerNotification(
      {
        id: IDS.WEEKLY,
        title: 'Weekly Review',
        body: "How did your week go? Tap to find out.",
        data: { coaching: 'weekly' },
        android: {
          channelId: 'review',
          pressAction: { id: 'default' },
          smallIcon: 'ic_notification',
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: nextWeeklyTimestamp(reviewDay, rh, rm),
        repeatFrequency: RepeatFrequency.WEEKLY,
        alarmManager: { allowWhileIdle: true },
      }
    );
  } catch (e) {
    console.log('scheduleCoachingNotifications skipped:', e.message);
  }
}

export async function scheduleTaskNotification({ taskId, title, body, triggerTimestamp, channelId = 'nudge' }) {
  try {
    return await notifee.createTriggerNotification(
      {
        title,
        body,
        data: { taskId: String(taskId) },
        android: {
          channelId,
          actions: TASK_ACTIONS,
          pressAction: { id: 'default' },
          smallIcon: 'ic_notification',
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: triggerTimestamp,
        alarmManager: { allowWhileIdle: true },
      }
    );
  } catch { return null; }
}

export async function cancelAllForTask(taskId) {
  try {
    const triggers = await notifee.getTriggerNotifications();
    for (const { notification } of triggers) {
      if (notification.data?.taskId === String(taskId)) {
        await notifee.cancelTriggerNotification(notification.id);
      }
    }
  } catch { /* unavailable */ }
}

// Mark a task complete in response to a notification "Mark Done" action.
// Records the completion (same effect as the in-app check) and cancels any
// pending alarms for the task — critically, this stops the critical-overdue
// loop, which otherwise keeps firing every 30 min because the action button
// had no handler. Called from both the foreground and background event handlers.
export async function completeTaskFromNotification(taskId) {
  try {
    const { recordCompletion } = require('../db/tasks');
    recordCompletion(Number(taskId));
  } catch { /* db unavailable */ }
  await cancelAllForTask(taskId);
}

export async function snoozeNotification(taskId, title, snoozeMinutes = 15) {
  await cancelAllForTask(taskId);
  const persona = getSetting('coach_persona') ?? 'coach';
  const coach = getCoachText(persona);
  const cleanTitle = title.replace(/^\(Snoozed\)\s*/, '').replace(/^⚠️\s*/, '');
  return scheduleTaskNotification({
    taskId,
    title: 'Do The Thing',
    body: coach.taskDueReminder(cleanTitle, snoozeMinutes),
    triggerTimestamp: Date.now() + snoozeMinutes * 60 * 1000,
  });
}

// Completion acknowledgements are now shown as an in-app toast (see
// completionAckMessage + the Toast component), not a system notification — you're
// already in the app when checking things off, so a notification you'd have to
// clear was just extra work. The 'completion_ack' channel is retained (harmless)
// in case a future notification-based ack is wanted.

// Check for habits not completed today and fire nudges for coach/hype personas.
// daysMissedMap: { [taskId]: daysMissed } — computed by caller from DB.
export async function fireHabitNudges(missedHabits) {
  try {
    const persona = getSetting('coach_persona') ?? 'coach';
    const threshold = HABIT_NUDGE_THRESHOLD[persona] ?? Infinity;
    const coach = getCoachText(persona);
    for (const { title, daysMissed } of missedHabits) {
      if (daysMissed < threshold) continue;
      const body = coach.habitNudge(title, daysMissed);
      if (!body) continue;
      await notifee.displayNotification({
        title: 'Do The Thing',
        body,
        android: { channelId: 'habit_nudge', pressAction: { id: 'default' }, smallIcon: 'ic_notification' },
      });
    }
  } catch { /* unavailable */ }
}

// Refreshes mid-day nudge text to reflect current task count + critical items
async function rescheduleMidayNudges(taskCount, criticalTasks = []) {
  try {
    await notifee.cancelTriggerNotification(IDS.MIDDAY_1).catch(() => {});
    await notifee.cancelTriggerNotification(IDS.MIDDAY_2).catch(() => {});

    const intensity = parseInt(getSetting('notification_intensity') ?? '3', 10);
    const persona   = getSetting('coach_persona') ?? 'coach';
    const coach     = getCoachText(persona);
    const config    = INTENSITY_CONFIG[intensity] ?? INTENSITY_CONFIG[3];
    const nudgeLevel = PERSONA_NUDGE_LEVEL[persona] ?? 0;

    // Mid-day check-ins are coach/hype only: hype gets up to summaryCount, coach gets one,
    // quieter personas get none. (Both IDs are already cancelled above.)
    const slotCount = nudgeLevel >= 3 ? config.summaryCount : (nudgeLevel >= 2 ? 1 : 0);
    if (slotCount === 0) return;

    let body = coach.nudge(taskCount);
    if (criticalTasks.length > 0) {
      const shown = criticalTasks.slice(0, 2);
      const extra = criticalTasks.length - shown.length;
      const names = shown.map(t => t.title).join(', ');
      body += extra > 0
        ? `\nStill open: ${names}, +${extra} more`
        : `\nStill open: ${names}`;
    }

    const summaryTime1 = getSetting('summary_time_1') ?? '12:00';
    const summaryTime2 = getSetting('summary_time_2') ?? '17:00';
    const summarySlots = [
      { id: IDS.MIDDAY_1, time: summaryTime1 },
      { id: IDS.MIDDAY_2, time: summaryTime2 },
    ].slice(0, slotCount);

    for (const { id, time } of summarySlots) {
      const [h, m] = time.split(':').map(Number);
      await notifee.createTriggerNotification(
        {
          id,
          title: 'Do The Thing',
          body,
          data: { coaching: 'midday' },
          android: {
            channelId: 'nudge',
            pressAction: { id: 'default' },
            smallIcon: 'ic_notification',
          },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp: nextDailyTimestamp(h, m),
          repeatFrequency: RepeatFrequency.DAILY,
          alarmManager: { allowWhileIdle: true },
        }
      );
    }
  } catch (e) {
    console.log('rescheduleMidayNudges error:', e.message);
  }
}

export async function refreshMidayNudges() {
  try {
    const { buildDailyList } = require('../engine/scheduler');
    const { mainItems, backlogItems } = buildDailyList();
    const allRemaining = [...mainItems, ...backlogItems];
    const criticalTasks = allRemaining.filter(t => t.effectivePriority >= 4);
    await rescheduleMidayNudges(allRemaining.length, criticalTasks);
  } catch (e) {
    console.log('refreshMidayNudges error:', e.message);
  }
}

// Reschedules the bedtime wrap-up with the day's current counts. Called as the
// app is used, so the notification reflects real completions even when the
// background task doesn't fire near bedtime (Android throttles it). Scheduled
// for all personas, matching scheduleCoachingNotifications.
export async function refreshEveningWrapup() {
  try {
    await notifee.cancelTriggerNotification(IDS.EVENING).catch(() => {});
    const persona  = getSetting('coach_persona') ?? 'coach';
    const bedtime  = getSetting('bedtime') ?? '22:00';
    const [bh, bm] = bedtime.split(':').map(Number);
    await notifee.createTriggerNotification(
      {
        id: IDS.EVENING,
        title: 'Day Wrap-Up',
        body: eveningWrapupBody(persona),
        data: { coaching: 'evening' },
        android: { channelId: 'summary', pressAction: { id: 'default' }, smallIcon: 'ic_notification' },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: nextDailyTimestamp(bh, bm),
        repeatFrequency: RepeatFrequency.DAILY,
        alarmManager: { allowWhileIdle: true },
      }
    );
  } catch (e) {
    console.log('refreshEveningWrapup error:', e.message);
  }
}

// Reschedules the morning briefing with the current task count, so it reflects
// the real plate even when the background task doesn't fire (Android throttles
// it). Scheduled for all personas, matching scheduleCoachingNotifications.
export async function refreshMorningBriefing() {
  try {
    await notifee.cancelTriggerNotification(IDS.MORNING).catch(() => {});
    const persona     = getSetting('coach_persona') ?? 'coach';
    const morningTime = getSetting('morning_briefing_time') ?? '07:00';
    const [mh, mm]    = morningTime.split(':').map(Number);
    await notifee.createTriggerNotification(
      {
        id: IDS.MORNING,
        title: 'Do The Thing',
        body: morningBriefingBody(persona),
        data: { coaching: 'morning' },
        android: { channelId: 'briefing', pressAction: { id: 'default' }, smallIcon: 'ic_notification' },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: nextDailyTimestamp(mh, mm),
        repeatFrequency: RepeatFrequency.DAILY,
        alarmManager: { allowWhileIdle: true },
      }
    );
  } catch (e) {
    console.log('refreshMorningBriefing error:', e.message);
  }
}

// Fire morning briefing with live task data. Deduped — only fires once per calendar day.
async function fireMorningBriefing() {
  try {
    const today = localDateStr();
    if (getSetting('last_morning_briefing_date') === today) return;

    const persona    = getSetting('coach_persona') ?? 'coach';
    const nudgeLevel = PERSONA_NUDGE_LEVEL[persona] ?? 0;
    if (nudgeLevel === 0) return;

    const body = morningBriefingBody(persona);

    await notifee.displayNotification({
      id: IDS.MORNING,
      title: 'Do The Thing',
      body,
      data: { coaching: 'morning' },
      android: { channelId: 'briefing', pressAction: { id: 'default' }, smallIcon: 'ic_notification' },
    });
    setSetting('last_morning_briefing_date', today);
  } catch (e) {
    console.log('fireMorningBriefing error:', e.message);
  }
}

// Fire evening wrap-up with live task + habit data. Deduped — only fires once per calendar day.
async function fireEveningWrapup() {
  try {
    const today = localDateStr();
    if (getSetting('last_evening_wrapup_date') === today) return;

    const persona    = getSetting('coach_persona') ?? 'coach';
    const nudgeLevel = PERSONA_NUDGE_LEVEL[persona] ?? 0;
    if (nudgeLevel === 0) return;

    const coach = getCoachText(persona);
    const { done, remaining, missedHabits } = computeEveningWrapup();
    const body  = coach.eveningBody
      ? coach.eveningBody(done, remaining, missedHabits)
      : coach.eveningWrapup(done, remaining);

    await notifee.displayNotification({
      id: IDS.EVENING,
      title: 'Do The Thing',
      body,
      data: { coaching: 'evening' },
      android: { channelId: 'summary', pressAction: { id: 'default' }, smallIcon: 'ic_notification' },
    });
    setSetting('last_evening_wrapup_date', today);

    // Fire habit nudges alongside the evening wrap-up for coach/hype
    if (missedHabits.length > 0) {
      await fireHabitNudges(missedHabits.map(title => ({ title, daysMissed: 1 })));
    }
  } catch (e) {
    console.log('fireEveningWrapup error:', e.message);
  }
}

// Returns true if current time is within `windowMinutes` of the target HH:MM string
function isNearTime(timeStr, windowMinutes = 20) {
  const [th, tm] = timeStr.split(':').map(Number);
  const now     = new Date();
  const targetMs = new Date(now).setHours(th, tm, 0, 0);
  return Math.abs(now.getTime() - targetMs) <= windowMinutes * 60 * 1000;
}

// Background task uses expo-task-manager + expo-background-fetch
// Both rely on Android WorkManager — no Google Play Services required
export async function registerBackgroundTask() {
  const TaskManager     = (() => { try { return require('expo-task-manager');    } catch { return null; } })();
  const BackgroundFetch = (() => { try { return require('expo-background-fetch'); } catch { return null; } })();
  if (!TaskManager || !BackgroundFetch) return;
  try {
    TaskManager.defineTask(BACKGROUND_TASK, async () => {
      try {
        const morningTime = getSetting('morning_briefing_time') ?? '07:00';
        const eveningTime = getSetting('bedtime') ?? '22:00'; // wrap-up fires at bedtime

        if (isNearTime(morningTime)) await fireMorningBriefing();
        if (isNearTime(eveningTime)) await fireEveningWrapup();

        // Daily auto-backup (runs whenever background task fires, deduped by date)
        const { saveAutoBackup } = require('../db/backup');
        await saveAutoBackup().catch(() => {});
      } catch (e) {
        console.log('Background task error:', e.message);
      }
      return BackgroundFetch.BackgroundFetchResult.NewData;
    });
    await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
      minimumInterval: 15 * 60, // 15 min — keeps us within one window of target times
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch { /* unavailable */ }
}
