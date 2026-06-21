import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { TouchableOpacity, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDb } from '../src/db/schema';
import notifee, { EventType } from '@notifee/react-native';

// Separated into its own component so useRouter runs inside the navigation tree
function SettingsButton() {
  const router = useRouter();
  return (
    <TouchableOpacity onPress={() => router.push('/settings')} style={{ marginRight: 4, padding: 4 }}>
      <Text style={{ fontSize: 22 }}>⚙️</Text>
    </TouchableOpacity>
  );
}

function routeFromCoachingData(data, router) {
  if (!data) return;
  if (data.coaching === 'evening' || data.coaching === 'weekly') {
    router.push('/review');
  } else if (data.coaching === 'morning' || data.coaching === 'midday') {
    router.push('/');
  }
}

// Handles an action-button press from a notification (Mark Done / Snooze).
// Shared by the foreground and background event handlers so the behavior is
// identical regardless of app state. Defined at module level (no React scope)
// so the background handler can use it too.
async function handleNotificationAction(detail) {
  const { pressAction, notification } = detail ?? {};
  const taskId = notification?.data?.taskId;
  if (!taskId || !pressAction) return;
  try {
    const {
      completeTaskFromNotification,
      snoozeNotification,
    } = await import('../src/notifications/notificationService');
    if (pressAction.id === 'complete') {
      await completeTaskFromNotification(taskId);
      // Clear the notification the user just acted on (cancelAllForTask only
      // clears *pending* triggers, not the one already on screen).
      if (notification?.id) await notifee.cancelNotification(notification.id).catch(() => {});
    } else if (pressAction.id === 'snooze_15') {
      await snoozeNotification(taskId, notification.title ?? '', 15);
    } else if (pressAction.id === 'snooze_30') {
      await snoozeNotification(taskId, notification.title ?? '', 30);
    } else if (pressAction.id === 'snooze_60') {
      await snoozeNotification(taskId, notification.title ?? '', 60);
    }
  } catch { /* service unavailable */ }
}

// Routes notification taps to the appropriate screen (foreground + cold-start)
function NotificationHandler() {
  const router = useRouter();

  useEffect(() => {
    // App was opened from a killed state by tapping a notification
    notifee.getInitialNotification()
      .then(initial => {
        if (initial) routeFromCoachingData(initial.notification?.data, router);
      })
      .catch(() => {});

    // App is in the foreground — handle taps and action button presses
    const unsub = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS) {
        routeFromCoachingData(detail.notification?.data, router);
      } else if (type === EventType.ACTION_PRESS) {
        handleNotificationAction(detail);
      }
    });

    return () => unsub();
  }, []);

  return null;
}

async function setupNotifications() {
  try {
    const {
      requestPermissions,
      createNotificationChannels,
      setupNotificationCategories,
      registerBackgroundTask,
      scheduleCoachingNotifications,
      refreshMidayNudges,
    } = await import('../src/notifications/notificationService');
    const granted = await requestPermissions();
    await createNotificationChannels();
    setupNotificationCategories();
    if (granted) {
      await scheduleCoachingNotifications();
      refreshMidayNudges().catch(() => {});
    }
    registerBackgroundTask().catch(() => {});
  } catch (e) {
    console.log('Notifications setup skipped:', e.message);
  }
}

// Handle notification action presses (snooze, etc.) when app is in background/killed.
// Must be registered at module level, outside React components.
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS) {
    await handleNotificationAction(detail);
  }
});

export default function RootLayout() {
  useEffect(() => {
    initDb();
    setupNotifications();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#f4f6fb' },
          headerTintColor: '#1a1a2e',
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: '#f4f6fb' },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'Do The Thing',
            headerRight: () => <SettingsButton />,
          }}
        />
        <Stack.Screen name="add" options={{ title: 'New Task', presentation: 'modal' }} />
        <Stack.Screen name="task/[id]" options={{ title: 'Task Details' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="review" options={{ title: "Today's Wrap-Up" }} />
        <Stack.Screen name="all-tasks" options={{ title: 'All Tasks' }} />
      </Stack>
      <NotificationHandler />
    </SafeAreaProvider>
  );
}
