/**
 * Notification service — uses require() inside functions rather than top-level
 * import so Metro doesn't load expo-notifications at bundle time.
 * This allows the app to run in Expo Go (which blocks remote push setup)
 * without crashing. Local scheduled notifications still work in dev builds.
 */

import Constants from 'expo-constants';
import { getSetting } from '../db/settings';
import { getCoachText } from '../components/CoachText';

// Expo Go blocks push notification setup since SDK 53.
// We detect it here and skip all notification calls entirely,
// so no errors appear during development. Everything works in a real build.
const IS_EXPO_GO = Constants.appOwnership === 'expo';

function getNotifications() {
  if (IS_EXPO_GO) return null;
  try { return require('expo-notifications'); } catch { return null; }
}

function getTaskManager() {
  if (IS_EXPO_GO) return null;
  try { return require('expo-task-manager'); } catch { return null; }
}

function getBackgroundFetch() {
  if (IS_EXPO_GO) return null;
  try { return require('expo-background-fetch'); } catch { return null; }
}

const BACKGROUND_TASK = 'DTT_NOTIFICATION_CHECK';

const INTENSITY_CONFIG = {
  1: { summaryCount: 0 },
  2: { summaryCount: 1 },
  3: { summaryCount: 2 },
  4: { summaryCount: 2 },
  5: { summaryCount: 2 },
};

export async function requestPermissions() {
  const Notifications = getNotifications();
  if (!Notifications) return false;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch { return false; }
}

export async function createNotificationChannels() {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
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
  } catch { /* unavailable */ }
}

export function setupNotificationCategories() {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    Notifications.setNotificationCategoryAsync('task_reminder', [
      { identifier: 'complete', buttonTitle: 'Mark Done' },
      { identifier: 'snooze_15', buttonTitle: 'Snooze 15m' },
      { identifier: 'snooze_60', buttonTitle: 'Snooze 1h' },
    ]);
  } catch { /* unavailable */ }
}

export async function scheduleCoachingNotifications() {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
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

    const summaryTime1 = getSetting('summary_time_1') ?? '12:00';
    const summaryTime2 = getSetting('summary_time_2') ?? '17:00';
    const summaryTimes = [summaryTime1, summaryTime2].slice(0, config.summaryCount);
    for (const t of summaryTimes) {
      const [h, m] = t.split(':').map(Number);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Do The Thing',
          body: coach.nudge(0),
          data: { coaching: 'midday' },
        },
        trigger: { type: 'daily', hour: h, minute: m, channelId: 'nudge' },
      });
    }

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
  } catch (e) {
    console.log('scheduleCoachingNotifications skipped:', e.message);
  }
}

export async function scheduleTaskNotification({ taskId, title, body, trigger, channelId = 'nudge' }) {
  const Notifications = getNotifications();
  if (!Notifications) return null;
  try {
    return Notifications.scheduleNotificationAsync({
      content: { title, body, data: { taskId }, categoryIdentifier: 'task_reminder' },
      trigger: { ...trigger, channelId },
    });
  } catch { return null; }
}

export async function cancelAllForTask(taskId) {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.content.data?.taskId === taskId) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
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
    trigger: { seconds: snoozeMinutes * 60 },
  });
}

export async function registerBackgroundTask() {
  const TaskManager = getTaskManager();
  const BackgroundFetch = getBackgroundFetch();
  if (!TaskManager || !BackgroundFetch) return;
  try {
    TaskManager.defineTask(BACKGROUND_TASK, async () => {
      return BackgroundFetch.BackgroundFetchResult.NewData;
    });
    await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
      minimumInterval: 60 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch { /* unavailable */ }
}
