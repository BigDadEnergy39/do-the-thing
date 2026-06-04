import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { getSetting } from '../db/settings';
import { getCoachText } from '../components/CoachText';
import { buildDailyList } from '../engine/scheduler';
import { getTodayCompletedTasks } from '../db/tasks';

const BACKGROUND_TASK = 'DTT_NOTIFICATION_CHECK';

// Intensity multipliers: 1=minimal, 3=default, 5=pushy
const INTENSITY_CONFIG = {
  1: { nudgeHours: [], summaryCount: 0 },
  2: { nudgeHours: [17], summaryCount: 1 },
  3: { nudgeHours: [12, 17], summaryCount: 2 },
  4: { nudgeHours: [10, 14, 17], summaryCount: 2 },
  5: { nudgeHours: [9, 11, 13, 15, 17], summaryCount: 2 },
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestPermissions() {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function createNotificationChannels() {
  await Notifications.setNotificationChannelAsync('briefing', {
    name: 'Daily Briefing',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4a90d9',
  });
  await Notifications.setNotificationChannelAsync('nudge', {
    name: 'Task Nudges',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync('summary', {
    name: 'Daily Summary',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync('review', {
    name: 'Weekly Review',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export function setupNotificationCategories() {
  Notifications.setNotificationCategoryAsync('task_reminder', [
    { identifier: 'complete', buttonTitle: 'Mark Done' },
    { identifier: 'snooze_15', buttonTitle: 'Snooze 15m' },
    { identifier: 'snooze_60', buttonTitle: 'Snooze 1h' },
  ]);
}

// ─── Schedule all recurring coaching notifications ────────────────────────────
export async function scheduleCoachingNotifications() {
  // Cancel existing coaching notifications before rescheduling
  const all = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of all) {
    if (n.content.data?.coaching) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  const intensity = parseInt(getSetting('notification_intensity') ?? '3', 10);
  const persona = getSetting('coach_persona') ?? 'coach';
  const coach = getCoachText(persona);
  const config = INTENSITY_CONFIG[intensity] ?? INTENSITY_CONFIG[3];

  // Morning briefing
  const morningTime = getSetting('morning_briefing_time') ?? '07:00';
  const [mh, mm] = morningTime.split(':').map(Number);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Do The Thing',
      body: "Here's your day — tap to see your list.",
      data: { coaching: 'morning' },
      categoryIdentifier: 'task_reminder',
    },
    trigger: { type: 'daily', hour: mh, minute: mm, channelId: 'briefing' },
  });

  // Mid-day nudges (based on intensity)
  const summaryTime1 = getSetting('summary_time_1') ?? '12:00';
  const summaryTime2 = getSetting('summary_time_2') ?? '17:00';
  const summaryTimes = [summaryTime1, summaryTime2].slice(0, config.summaryCount);
  for (const t of summaryTimes) {
    const [h, m] = t.split(':').map(Number);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Do The Thing',
        body: coach.nudge(0), // placeholder; real count set at delivery
        data: { coaching: 'midday' },
      },
      trigger: { type: 'daily', hour: h, minute: m, channelId: 'nudge' },
    });
  }

  // Evening wrap-up (15 min before bedtime)
  const bedtime = getSetting('bedtime') ?? '22:00';
  const [bh, bm] = bedtime.split(':').map(Number);
  const wrapHour = bm >= 15 ? bh : bh - 1;
  const wrapMin = bm >= 15 ? bm - 15 : bm + 45;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Day Wrap-Up',
      body: "Here's how today went — tap to review.",
      data: { coaching: 'evening' },
    },
    trigger: { type: 'daily', hour: wrapHour, minute: wrapMin, channelId: 'summary' },
  });

  // Weekly review (Sunday evening by default)
  const reviewDay = parseInt(getSetting('weekly_review_day') ?? '0', 10);
  const reviewTime = getSetting('weekly_review_time') ?? '20:00';
  const [rh, rm] = reviewTime.split(':').map(Number);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Weekly Review',
      body: "How did your week go? Tap to find out.",
      data: { coaching: 'weekly' },
    },
    trigger: { type: 'weekly', weekday: reviewDay + 1, hour: rh, minute: rm, channelId: 'review' },
  });
}

// ─── Per-task notification ────────────────────────────────────────────────────
export async function scheduleTaskNotification({ taskId, title, body, trigger, channelId = 'nudge' }) {
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { taskId },
      categoryIdentifier: 'task_reminder',
    },
    trigger: { ...trigger, channelId },
  });
}

export async function cancelAllForTask(taskId) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.content.data?.taskId === taskId) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
}

export async function snoozeNotification(taskId, title, snoozeMinutes = 15) {
  await cancelAllForTask(taskId);
  return scheduleTaskNotification({
    taskId,
    title: `(Snoozed) ${title}`,
    body: 'Reminder: this is still on your list.',
    trigger: { seconds: snoozeMinutes * 60 },
  });
}

// ─── Background task ──────────────────────────────────────────────────────────
TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundTask() {
  await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
    minimumInterval: 60 * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}
