import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '../src/components/theme';
import { getSetting } from '../src/db/settings';
import { getCoachText } from '../src/components/CoachText';
import { getTodayCompletedTasks, getTodayTimedSeconds, getWeekTimedSeconds } from '../src/db/tasks';
import { buildDailyList } from '../src/engine/scheduler';

export default function ReviewScreen() {
  const router = useRouter();
  const persona = getSetting('coach_persona') ?? 'coach';
  const coach = getCoachText(persona);

  const { completed, remaining, timedWithProgress } = useMemo(() => {
    const completed = getTodayCompletedTasks();
    const { mainItems, backlogItems, timedGoals } = buildDailyList();
    const remaining = [...mainItems, ...backlogItems];
    const timedWithProgress = timedGoals.map(t => ({
      ...t,
      loggedSeconds: t.goal_reset === 'weekly' ? getWeekTimedSeconds(t.id) : getTodayTimedSeconds(t.id),
      goalSeconds: (t.goal_minutes ?? 0) * 60,
    }));
    return { completed, remaining, timedWithProgress };
  }, []);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.dateText}>{today}</Text>
      <Text style={styles.coachMessage}>
        {coach.eveningWrapup(completed.length, remaining.length)}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Completed{'  '}
          <Text style={styles.sectionCount}>{completed.length}</Text>
        </Text>
        {completed.length === 0 ? (
          <Text style={styles.emptyNote}>Nothing completed today.</Text>
        ) : (
          completed.map(t => (
            <View key={t.id} style={styles.row}>
              <Text style={styles.checkmark}>✓</Text>
              <Text style={styles.taskTitle}>{t.title}</Text>
            </View>
          ))
        )}
      </View>

      {remaining.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Carrying Forward{'  '}
            <Text style={styles.sectionCount}>{remaining.length}</Text>
          </Text>
          {remaining.map(t => (
            <TouchableOpacity
              key={t.id}
              style={styles.row}
              onPress={() => router.push(`/task/${t.id}`)}
              activeOpacity={0.7}
            >
              <Text style={styles.bullet}>·</Text>
              <Text style={styles.taskTitle}>{t.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {timedWithProgress.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Goals</Text>
          {timedWithProgress.map(t => {
            const pct = t.goalSeconds > 0 ? Math.min(t.loggedSeconds / t.goalSeconds, 1) : 0;
            const logged = Math.round(t.loggedSeconds / 60);
            const goal = t.goal_minutes ?? 0;
            const periodLabel = t.goal_reset === 'weekly' ? 'this week' : 'today';
            return (
              <View key={t.id} style={styles.goalRow}>
                <View style={styles.goalHeader}>
                  <Text style={styles.taskTitle}>{t.title}</Text>
                  <Text style={styles.goalTime}>{logged}/{goal}m {periodLabel}</Text>
                </View>
                <View style={styles.progressBg}>
                  <View style={[
                    styles.progressFill,
                    { width: `${pct * 100}%`, backgroundColor: pct >= 1 ? COLORS.success : COLORS.primary },
                  ]} />
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingTop: 12 },
  dateText: { fontSize: 13, color: COLORS.subtext, marginBottom: 6 },
  coachMessage: { fontSize: 16, color: COLORS.text, fontWeight: '500', lineHeight: 24, marginBottom: 28 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: COLORS.subtext, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  sectionCount: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  emptyNote: { fontSize: 14, color: COLORS.subtext, fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
  checkmark: { fontSize: 14, color: COLORS.success, marginTop: 2, width: 18 },
  bullet: { fontSize: 20, color: COLORS.subtext, lineHeight: 22, width: 18 },
  taskTitle: { fontSize: 15, color: COLORS.text, flex: 1, lineHeight: 22 },
  goalRow: { marginBottom: 14 },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  goalTime: { fontSize: 12, color: COLORS.subtext },
  progressBg: { height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
});
