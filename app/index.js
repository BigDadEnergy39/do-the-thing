import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, SectionList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useDailyList } from '../src/hooks/useDailyList';
import { TaskCard } from '../src/components/TaskCard';
import { TimedGoalCard } from '../src/components/TimedGoalCard';
import { FastCapture } from '../src/components/FastCapture';
import { COLORS } from '../src/components/theme';
import { getSetting } from '../src/db/settings';
import { getCoachText } from '../src/components/CoachText';

export default function TodayScreen() {
  const router = useRouter();
  const { mainItems, backlogItems, timedGoals, loading, refresh } = useDailyList();
  const [completedIds, setCompletedIds] = useState(new Set());
  const [backlogExpanded, setBacklogExpanded] = useState(false);
  const [fastCaptureVisible, setFastCaptureVisible] = useState(false);

  const persona = getSetting('coach_persona') ?? 'coach';
  const coach = getCoachText(persona);

  const visibleMain = mainItems.filter(i => !completedIds.has(i.id));
  const visibleBacklog = backlogItems.filter(i => !completedIds.has(i.id));
  const totalRemaining = visibleMain.length + visibleBacklog.length;

  const handleComplete = (taskId) => {
    setCompletedIds(prev => new Set([...prev, taskId]));
    setTimeout(refresh, 400);
  };

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const isEmpty = totalRemaining === 0 && timedGoals.length === 0;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={COLORS.primary} />
        }
      >
        {/* Date + coach nudge */}
        <View style={styles.header}>
          <Text style={styles.dateText}>{today}</Text>
          {!loading && totalRemaining > 0 && (
            <Text style={styles.coachNudge}>{coach.morningBriefing(totalRemaining)}</Text>
          )}
        </View>

        {/* Empty state */}
        {isEmpty && !loading && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>✓</Text>
            <Text style={styles.emptyTitle}>{coach.allClear()}</Text>
          </View>
        )}

        {/* Main task list */}
        {visibleMain.map(item => (
          item.has_timer
            ? <TimedGoalCard
                key={item.id}
                task={item}
                onComplete={handleComplete}
                onPress={(t) => router.push(`/task/${t.id}`)}
              />
            : <TaskCard
                key={item.id}
                task={item}
                onComplete={handleComplete}
                onPress={(t) => router.push(`/task/${t.id}`)}
              />
        ))}

        {/* Timed goals section */}
        {timedGoals.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Goals</Text>
            </View>
            {timedGoals.map(item => (
              <TimedGoalCard
                key={item.id}
                task={item}
                onPress={(t) => router.push(`/task/${t.id}`)}
              />
            ))}
          </View>
        )}

        {/* Backlog section */}
        {visibleBacklog.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => setBacklogExpanded(e => !e)}
              activeOpacity={0.7}
            >
              <Text style={styles.sectionTitle}>Backlog</Text>
              <Text style={styles.sectionCount}>{visibleBacklog.length}</Text>
              <Text style={styles.sectionChevron}>
                {backlogExpanded ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>
            {backlogExpanded && visibleBacklog.map(item => (
              item.has_timer
                ? <TimedGoalCard
                    key={item.id}
                    task={item}
                    onComplete={handleComplete}
                    onPress={(t) => router.push(`/task/${t.id}`)}
                  />
                : <TaskCard
                    key={item.id}
                    task={item}
                    onComplete={handleComplete}
                    onPress={(t) => router.push(`/task/${t.id}`)}
                  />
            ))}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB row: fast capture (left) + full add (right) */}
      <View style={styles.fabRow}>
        <TouchableOpacity
          style={styles.fabSecondary}
          onPress={() => setFastCaptureVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.fabSecondaryText}>⚡</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/add')}
          activeOpacity={0.8}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      </View>

      <FastCapture
        visible={fastCaptureVisible}
        onClose={() => setFastCaptureVisible(false)}
        onSaved={refresh}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingTop: 8, paddingBottom: 120 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  dateText: { fontSize: 14, color: COLORS.subtext, marginBottom: 4 },
  coachNudge: { fontSize: 15, color: COLORS.text, fontWeight: '500', lineHeight: 22 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 12, color: COLORS.success },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text, textAlign: 'center', paddingHorizontal: 32 },
  section: { marginTop: 8 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 10, gap: 8,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: COLORS.subtext,
    textTransform: 'uppercase', letterSpacing: 0.8, flex: 1,
  },
  sectionCount: { fontSize: 12, color: COLORS.subtext, fontWeight: '600' },
  sectionChevron: { fontSize: 11, color: COLORS.subtext },
  fabRow: {
    position: 'absolute', bottom: 28, right: 24,
    flexDirection: 'row', gap: 12, alignItems: 'center',
  },
  fab: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center',
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2, shadowRadius: 6,
  },
  fabText: { fontSize: 28, color: '#fff', fontWeight: '300', lineHeight: 32 },
  fabSecondary: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4,
    borderWidth: 1, borderColor: COLORS.border,
  },
  fabSecondaryText: { fontSize: 20 },
});
