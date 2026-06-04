import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { TouchableOpacity, Text } from 'react-native';
import { initDb } from '../src/db/schema';

// Separated into its own component so useRouter runs inside the navigation tree
function SettingsButton() {
  const router = useRouter();
  return (
    <TouchableOpacity onPress={() => router.push('/settings')} style={{ marginRight: 4, padding: 4 }}>
      <Text style={{ fontSize: 22 }}>⚙️</Text>
    </TouchableOpacity>
  );
}

async function setupNotifications() {
  try {
    const { requestPermissions, createNotificationChannels, setupNotificationCategories, registerBackgroundTask, scheduleCoachingNotifications } =
      await import('../src/notifications/notificationService');
    const granted = await requestPermissions();
    await createNotificationChannels();
    setupNotificationCategories();
    if (granted) await scheduleCoachingNotifications();
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
      </Stack>
    </>
  );
}
