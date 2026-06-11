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
import { getSetting } from '../db/settings';
import { getCoachText } from '../components/CoachText';

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

export async function createNotificationChannels() {
  try {
    await notifee.createChannel({
      id: 'briefing',
      name: 'Daily Briefing',
      importance: AndroidImportance.HIGH,
      vibration: true,
      vibrationPattern: [0, 250, 250, 250],
      lights: true,
      lightColor: '#4a90d9',
    });
    await notifee.createChannel({
      id: 'nudge',
      name: 'Task Nudges',
      importance: AndroidImportance.DEFAULT,
    });
    await notifee.createChannel({
      id: 'summary',
      name: 'Daily Summary',
      importance: AndroidImportance.DEFAULT,
    });
    await notifee.createChannel({
      id: 'review',
      name: 'Weekly Review',
      importance: AndroidImportance.HIGH,
    });
  } catch { /* unavailable */ }
}

// No-op: notifee shows foreground notifications by default
// Foreground + background event handling is wired up in app/_layout.js
export function setupNotificationCategories() {}

const TASK_ACTIONS = [
  { title: 'Mark Done', pressAction: { id: 'complete' } },
  { title: 'Snooze 15m', pressAction: { id: 'snooze_15' } },
  { title: 'Snooze 1h',  pressAction: { id: 'snooze_60' } },
];

export async function scheduleCoachingNotifications() {
  try {
    // Cancel existing coaching notifications by stable ID
    await Promise.all(Object.values(IDS).map(id =>
      notifee.cancelTriggerNotification(id).catch(() => {})
    ));

    const intensity = parseInt(getSetting('notification_intensity') ?? '3', 10);
    const persona   = getSetting('coach_persona') ?? 'coach';
    const coach     = getCoachText(persona);
    const config    = INTENSITY_CONFIG[intensity] ?? INTENSITY_CONFIG[3];

    // ── Morning briefing ──────────────────────────────────────────────────────
    const morningTime = getSetting('morning_briefing_time') ?? '07:00';
    const [mh, mm] = morningTime.split(':').map(Number);
    await notifee.createTriggerNotification(
      {
        id: IDS.MORNING,
        title: 'Do The Thing',
        body: "Here's your day — tap to see your list.",
        data: { coaching: 'morning' },
        android: {
          channelId: 'briefing',
          pressAction: { id: 'default' },
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: nextDailyTimestamp(mh, mm),
        repeatFrequency: RepeatFrequency.DAILY,
        alarmManager: { allowWhileIdle: true },
      }
    );

    // ── Mid-day check-ins ─────────────────────────────────────────────────────
    const summaryTime1 = getSetting('summary_time_1') ?? '12:00';
    const summaryTime2 = getSetting('summary_time_2') ?? '17:00';
    const summarySlots = [
      { id: IDS.MIDDAY_1, time: summaryTime1 },
      { id: IDS.MIDDAY_2, time: summaryTime2 },
    ].slice(0, config.summaryCount);

    for (const { id, time } of summarySlots) {
      const [h, m] = time.split(':').map(Number);
      await notifee.createTriggerNotification(
        {
          id,
          title: 'Do The Thing',
          body: coach.nudge(0),
          data: { coaching: 'midday' },
          android: {
            channelId: 'nudge',
            actions: TASK_ACTIONS,
            pressAction: { id: 'default' },
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

    // ── Evening wrap-up ───────────────────────────────────────────────────────
    const bedtime = getSetting('bedtime') ?? '22:00';
    const [bh, bm] = bedtime.split(':').map(Number);
    const wrapHour = bm >= 15 ? bh : bh - 1;
    const wrapMin  = bm >= 15 ? bm - 15 : bm + 45;
    await notifee.createTriggerNotification(
      {
        id: IDS.EVENING,
        title: 'Day Wrap-Up',
        body: "Here's how today went — tap to review.",
        data: { coaching: 'evening' },
        android: {
          channelId: 'summary',
          pressAction: { id: 'default' },
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: nextDailyTimestamp(wrapHour, wrapMin),
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

export async function snoozeNotification(taskId, title, snoozeMinutes = 15) {
  await cancelAllForTask(taskId);
  return scheduleTaskNotification({
    taskId,
    title: `(Snoozed) ${title}`,
    body: 'Reminder: this is still on your list.',
    triggerTimestamp: Date.now() + snoozeMinutes * 60 * 1000,
  });
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
    ].slice(0, config.summaryCount);

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

// Background task uses expo-task-manager + expo-background-fetch
// Both rely on Android WorkManager — no Google Play Services required
export async function registerBackgroundTask() {
  const TaskManager   = (() => { try { return require('expo-task-manager');    } catch { return null; } })();
  const BackgroundFetch = (() => { try { return require('expo-background-fetch'); } catch { return null; } })();
  if (!TaskManager || !BackgroundFetch) return;
  try {
    TaskManager.defineTask(BACKGROUND_TASK, async () => {
      try {
        const hour = new Date().getHours();
        if (hour >= 6 && hour < 9) {
          await refreshMidayNudges();
        }
        // Daily auto-backup (runs whenever background task fires, deduped by date)
        const { saveAutoBackup } = require('../db/backup');
        await saveAutoBackup().catch(() => {});
      } catch (e) {
        console.log('Background task error:', e.message);
      }
      return BackgroundFetch.BackgroundFetchResult.NewData;
    });
    await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
      minimumInterval: 60 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch { /* unavailable */ }
}
