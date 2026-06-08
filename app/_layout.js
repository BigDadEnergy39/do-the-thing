import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { TouchableOpacity, Text } from 'react-native';
import { initDb } from '../src/db/schema';
import Constants from 'expo-constants';

const IS_EXPO_GO = Constants.appOwnership === 'expo';

// Separated into its own component so useRouter runs inside the navigation tree
function SettingsButton() {
  const router = useRouter();
  return (
    <TouchableOpacity onPress={() => router.push('/settings')} style={{ marginRight: 4, padding: 4 }}>
      <Text style={{ fontSize: 22 }}>⚙️</Text>
    </TouchableOpacity>
  );
}

// Routes notification taps to the appropriate screen
function NotificationHandler() {
  const router = useRouter();
  useEffect(() => {
    if (IS_EXPO_GO) return;
    let sub;
    try {
      const Notifications = require('expo-notifications');
      sub = Notifications.addNotificationResponseReceivedListener(response => {
        const data = response.notification.request.content.data;
        if (data?.coaching === 'evening' || data?.coaching === 'weekly') {
          router.push('/review');
        } else if (data?.coaching === 'morning' || data?.coaching === 'midday') {
          router.push('/');
        }
      });
    } catch {}
    return () => sub?.remove();
  }, []);
  return null;
}

async function setupNotifications() {
  try {
    const { requestPermissions, createNotificationChannels, setupNotificationCategories, registerBackgroundTask, scheduleCoachingNotifications, refreshMidayNudges } =
      await import('../src/notifications/notificationService');
    const granted = await requestPermissions();
    await createNotificationChannels();
    setupNotificationCategories();
    if (granted) {
      await scheduleCoachingNotifications();
      refreshMidayNudges().catch(() => {});
    }
    registerBackgroundTask().catch(() => {});
  } catch (e) {
    // Notifications unavailable in this environment (e.g. Expo Go remote push restriction)
    console.log('Notifications setup skipped:', e.message);
  }
}

export default function RootLayout() {
  useEffect(() => {
    initDb();
    setupNotifications();
  }, []);

  return (
    <>
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
      </Stack>
      <NotificationHandler />
    </>
  );
}
