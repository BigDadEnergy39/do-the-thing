import React, { useState, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, SectionList, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useDailyList } from '../src/hooks/useDailyList';
import { TaskCard } from '../src/components/TaskCard';
import { TimedGoalCard } from '../src/components/TimedGoalCard';
import { HabitCard } from '../src/components/HabitCard';
import { FastCapture } from '../src/components/FastCapture';
import { COLORS } from '../src/components/theme';
import { getSetting } from '../src/db/settings';
import { getCoachText } from '../src/components/CoachText';
import { createTask, toSqliteDatetime, undoCompletion } from '../src/db/tasks';

export default function TodayScreen() {
  const router = useRouter();
  const { mainItems, backlogItems, timedGoals, habits, completedToday, loading, refresh } = useDailyList();
  const [completedIds, setCompletedIds] = useState(new Set());
  const [backlogExpanded, setBacklogExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [fastCaptureVisible, setFastCaptureVisible] = useState(false);
  const [followUpTask, setFollowUpTask] = useState(null);
  const completePendingRef = useRef(null);

  const persona = getSetting('coach_persona') ?? 'coach';
  const coach = getCoachText(persona);

  const visibleMain = mainItems.filter(i => !completedIds.has(i.id));
  const visibleBacklog = backlogItems.filter(i => !completedIds.has(i.id));
  const totalRemaining = visibleMain.length + visibleBacklog.length;

  const handleComplete = (taskId) => {
    setCompletedIds(prev => new Set([...prev, taskId]));
    setTimeout(refresh, 400);
  };

  const handleUndo = (taskId) => {
    undoCompletion(taskId);
    setCompletedIds(prev => { const s = new Set(prev); s.delete(taskId); return s; });
    refresh();
  };

  const handleFollowUp = (task, completeNow) => {
    completePendingRef.current = completeNow;
    setFollowUpTask(task);
  };

  const handleFollowUpChoice = (days) => {
    // Complete the original task
    completePendingRef.current?.();
    completePendingRef.current = null;

    // Create the follow-up task if an interval was chosen
    if (days > 0 && followUpTask) {
      const target = new Date();
      target.setDate(target.getDate() + days);
      target.setHours(0, 0, 0, 0);
      createTask({
        title: `Follow up: ${followUpTask.title}`,
        notes: followUpTask.notes ?? null,
        category_id: followUpTask.category_id ?? null,
        task_type: 'unscheduled',
        base_priority: followUpTask.base_priority,
        priority_ceiling: followUpTask.base_priority,
        snooze_until: toSqliteDatetime(target),
        due_date: null, due_time: null,
        escalate_days_out: null, escalate_to_priority: null,
        recur_rule: null, recur_persistent: 0, recur_display_overdue: 0,
        rand_min_days: null, rand_max_days: null, rand_next_date: null, rand_persistent: 0,
        anchor_date: null, anchor_label: null,
        goal_minutes: null, goal_reset: 'daily',
        auto_hide_after_skips: null, duration_intent: null,
        preferred_time: followUpTask.preferred_time ?? null,
        habit_window: null,
      });
    }

    setFollowUpTask(null);
  };

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const isEmpty = totalRemaining === 0 && timedGoals.length === 0 && habits.length === 0;

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
                onFollowUp={handleFollowUp}
                onPress={(t) => router.push(`/task/${t.id}`)}
              />
            : <TaskCard
                key={item.id}
                task={item}
                onComplete={handleComplete}
                onFollowUp={handleFollowUp}
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

        {/* Habits section */}
        {habits.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Habits</Text>
            </View>
            {habits.map(item => (
              <HabitCard
                key={item.id}
                task={item}
                checkinResponse={item.checkinResponse}
                streak={item.streak}
                onCheckin={refresh}
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
                    onFollowUp={handleFollowUp}
                    onPress={(t) => router.push(`/task/${t.id}`)}
                  />
                : <TaskCard
                    key={item.id}
                    task={item}
                    onComplete={handleComplete}
                    onFollowUp={handleFollowUp}
                    onPress={(t) => router.push(`/task/${t.id}`)}
                  />
            ))}
          </View>
        )}

        {/* Completed today section */}
        {completedToday.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => setCompletedExpanded(e => !e)}
              activeOpacity={0.7}
            >
              <Text style={styles.sectionTitle}>Completed</Text>
              <Text style={styles.sectionCount}>{completedToday.length}</Text>
              <Text style={styles.sectionChevron}>{completedExpanded ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {completedExpanded && completedToday.map(item => (
              <View key={item.id} style={styles.completedRow}>
                <TouchableOpacity
                  style={styles.completedMain}
                  onPress={() => router.push(`/task/${item.id}`)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.completedCheck}>✓</Text>
                  <View style={styles.completedBody}>
                    {item.category_name && (
                      <Text style={styles.completedCat}>{item.category_name}</Text>
                    )}
                    <Text style={styles.completedTitle}>{item.title}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.undoBtn}
                  onPress={() => handleUndo(item.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.undoBtnText}>Undo</Text>
                </TouchableOpacity>
              </View>
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

      {/* Follow-up prompt */}
      <Modal visible={!!followUpTask} transparent animationType="fade" onRequestClose={() => handleFollowUpChoice(0)}>
        <View style={styles.followUpOverlay}>
          <View style={styles.followUpSheet}>
            <Text style={styles.followUpTitle}>✓ Done!</Text>
            <Text style={styles.followUpBody}>Add a follow-up reminder?</Text>
            {[
              { label: 'In 3 days', days: 3 },
              { label: 'In 1 week', days: 7 },
              { label: 'In 2 weeks', days: 14 },
            ].map(({ label, days }) => (
              <TouchableOpacity
                key={days}
                style={styles.followUpBtn}
                onPress={() => handleFollowUpChoice(days)}
                activeOpacity={0.7}
              >
                <Text style={styles.followUpBtnText}>{label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.followUpSkip}
              onPress={() => handleFollowUpChoice(0)}
              activeOpacity={0.7}
            >
              <Text style={styles.followUpSkipText}>No follow-up needed</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  followUpOverlay: {
    flex: 1, backgroundColor: '#00000066',
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  followUpSheet: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 24, width: '100%',
  },
  followUpTitle: { fontSize: 22, fontWeight: '700', color: COLORS.success, marginBottom: 4 },
  followUpBody: { fontSize: 16, color: COLORS.subtext, marginBottom: 20 },
  followUpBtn: {
    backgroundColor: COLORS.primary + '15', borderRadius: 12,
    padding: 14, alignItems: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.primary + '30',
  },
  followUpBtnText: { fontSize: 15, fontWeight: '600', color: COLORS.primary },
  followUpSkip: { padding: 12, alignItems: 'center', marginTop: 4 },
  followUpSkipText: { fontSize: 14, color: COLORS.subtext },

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
  completedRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginVertical: 3,
    backgroundColor: '#fff', borderRadius: 10,
    overflow: 'hidden', opacity: 0.55,
  },
  completedMain: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  completedCheck: { fontSize: 14, color: COLORS.success, fontWeight: '700', marginRight: 10 },
  completedBody: { flex: 1 },
  completedCat: { fontSize: 10, fontWeight: '700', color: COLORS.subtext, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1 },
  completedTitle: { fontSize: 15, color: COLORS.text, fontWeight: '500', textDecorationLine: 'line-through' },
  undoBtn: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderLeftWidth: 1, borderLeftColor: '#eee',
  },
  undoBtnText: { fontSize: 13, fontWeight: '600', color: COLORS.subtext },
});
