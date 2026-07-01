import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
  Modal, TextInput, KeyboardAvoidingView, Platform, AppState,
} from 'react-native';
import {
  startTimedSession, endTimedSession,
  getActiveTimedSession, getTodayTimedSeconds, getWeekTimedSeconds,
  recordCompletion,
} from '../db/tasks';
import { parseUtcStamp } from '../utils/date';
import { getSetting } from '../db/settings';
import { completionAckMessage } from './CoachText';
import { useToast } from './Toast';
import { TaskActionsMenu } from './TaskActionsMenu';
import { COLORS } from './theme';

/**
 * Used for two task types:
 *   task_type === 'timed_goal'  — always visible, no checkmark, accumulates time
 *   any type with has_timer     — scheduled task with timer; checkmark marks it done
 */
export function TimedGoalCard({ task, onComplete, onPress, onChanged }) {
  const isWeekly = task.goal_reset === 'weekly';
  const hasCheckmark = task.task_type !== 'timed_goal'; // recurring+timer tasks can be marked done

  const [timerRunning, setTimerRunning] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [baseSeconds, setBaseSeconds] = useState(0);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualMinutes, setManualMinutes] = useState('');
  const [manualSeconds, setManualSeconds] = useState('');
  const intervalRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const showToast = useToast();

  const showCompletionToast = () => {
    const msg = completionAckMessage(getSetting('coach_persona') ?? 'coach', task);
    if (msg) showToast(msg);
  };

  useEffect(() => {
    // Reset animation in case a Fast Refresh cycle left it at 0
    fadeAnim.setValue(1);

    const logged = isWeekly
      ? getWeekTimedSeconds(task.id)
      : getTodayTimedSeconds(task.id);
    setBaseSeconds(logged);

    const active = getActiveTimedSession(task.id);
    if (active) {
      setSessionId(active.id);
      setTimerRunning(true);
      const elapsed = Math.floor(
        (Date.now() - parseUtcStamp(active.started_at).getTime()) / 1000
      );
      setElapsedSecs(elapsed);
    }
    return () => clearInterval(intervalRef.current);
  }, [task.id, isWeekly]);

  // Resync from the DB whenever the app returns to the foreground. JS timers are
  // paused while backgrounded, so a running timer's on-screen counter drifts
  // behind — recompute elapsed from the session's authoritative start time so the
  // display snaps to correct instead of lagging until the next pause. Also catches
  // overnight date rollovers when no timer is running.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const active = getActiveTimedSession(task.id);
      if (active) {
        setSessionId(active.id);
        setTimerRunning(true);
        setElapsedSecs(Math.floor((Date.now() - parseUtcStamp(active.started_at).getTime()) / 1000));
      } else {
        const logged = isWeekly ? getWeekTimedSeconds(task.id) : getTodayTimedSeconds(task.id);
        setBaseSeconds(logged);
        setElapsedSecs(0);
        setTimerRunning(false);
      }
    });
    return () => sub.remove();
  }, [task.id, isWeekly]);

  useEffect(() => {
    if (timerRunning) {
      intervalRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [timerRunning]);

  const handleToggleTimer = () => {
    if (timerRunning) {
      endTimedSession(sessionId);
      // Re-read the authoritative total from DB now that the session is committed
      const newBase = isWeekly
        ? getWeekTimedSeconds(task.id)
        : getTodayTimedSeconds(task.id);
      setBaseSeconds(newBase);
      setElapsedSecs(0);
      setTimerRunning(false);
      setSessionId(null);
    } else {
      const id = startTimedSession(task.id);
      setSessionId(id);
      setTimerRunning(true);
    }
  };

  const handleManualAdd = () => {
    const mins = parseInt(manualMinutes) || 0;
    const secs = parseInt(manualSeconds) || 0;
    const total = mins * 60 + secs;
    if (total > 0) {
      recordCompletion(task.id, null, total);
      setBaseSeconds(s => s + total);
    }
    setManualMinutes('');
    setManualSeconds('');
    setManualModalVisible(false);
  };

  const handleComplete = () => {
    // Guard: timed_goal tasks never fade out — they accumulate time, not "done"
    if (!hasCheckmark) return;
    // Stop any running timer first, capture the seconds
    let finalSecs = baseSeconds + elapsedSecs;
    if (timerRunning && sessionId) {
      const secs = endTimedSession(sessionId);
      finalSecs = baseSeconds + secs;
      setTimerRunning(false);
    }
    Animated.timing(fadeAnim, {
      toValue: 0, duration: 300, useNativeDriver: true,
    }).start(() => {
      recordCompletion(task.id, task.due_date ?? null, finalSecs);
      showCompletionToast();
      onComplete?.(task.id);
    });
  };

  const totalSecs = baseSeconds + elapsedSecs;
  const goalSecs = (task.goal_minutes ?? 0) * 60;
  const pct = goalSecs > 0 ? Math.min(1, totalSecs / goalSecs) : 0;
  const goalMet = goalSecs > 0 && totalSecs >= goalSecs;

  const formatTime = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const periodLabel = isWeekly ? 'this week' : 'today';
  const catColor = task.category_color ?? COLORS.primary;

  return (
    <Animated.View style={[styles.card, timerRunning && styles.cardActive, hasCheckmark && { opacity: fadeAnim }]}>
      <View style={[styles.accentBar, { backgroundColor: timerRunning ? COLORS.success : catColor }]} />

      {/* Tappable info area: chips, title, progress bar — navigates to detail */}
      <View style={styles.bodyOuter}>
        <TouchableOpacity onPress={() => onPress?.(task)} activeOpacity={0.7} style={styles.bodyInfo}>
          {/* Chips row */}
          <View style={styles.chipsRow}>
            {task.category_name && (
              <View style={[styles.catChip, { backgroundColor: catColor + '33' }]}>
                <Text style={[styles.catText, { color: catColor }]}>{task.category_name}</Text>
              </View>
            )}
            {task.displayLabel && (
              <View style={[styles.labelChip, { backgroundColor: '#4a90d922' }]}>
                <Text style={[styles.labelText, { color: COLORS.primary }]}>{task.displayLabel}</Text>
              </View>
            )}
            {task.preferred_time && (
              <View style={[styles.timeChip, styles[`timeChip_${task.preferred_time}`]]}>
                <Text style={[styles.timeChipText, styles[`timeChipText_${task.preferred_time}`]]}>
                  {task.preferred_time === 'morning' ? 'Morning' : task.preferred_time === 'afternoon' ? 'Afternoon' : 'Evening'}
                </Text>
              </View>
            )}
            {goalMet && (
              <View style={styles.goalMetChip}>
                <Text style={styles.goalMetText}>Goal met ✓</Text>
              </View>
            )}
          </View>

          <Text style={styles.title}>{task.title}</Text>

          {/* Progress bar */}
          {goalSecs > 0 && (
            <View style={styles.barBg}>
              <View style={[
                styles.barFill,
                { width: `${pct * 100}%`, backgroundColor: goalMet ? COLORS.success : COLORS.primary }
              ]} />
            </View>
          )}
        </TouchableOpacity>

        {/* Timer row — NOT nested inside the body touchable to avoid Android touch conflicts */}
        <View style={styles.timerRow}>
          <View>
            <Text style={styles.timerText}>{formatTime(totalSecs)}</Text>
            {task.goal_minutes ? (
              <Text style={styles.goalText}>
                goal: {task.goal_minutes}m {periodLabel}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={[styles.timerBtn, timerRunning && styles.timerBtnActive]}
            onPress={handleToggleTimer}
          >
            <Text style={styles.timerBtnText}>{timerRunning ? '⏸ Pause' : '▶ Start'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Right-side action column */}
      <View style={styles.actionCol}>
        {/* Snooze/Skip — only on scheduled timer tasks, not pure timed goals */}
        {hasCheckmark && <TaskActionsMenu task={task} onChanged={onChanged} />}

        {/* Manual time entry — always available on timed cards */}
        <TouchableOpacity style={styles.addTimeBtn} onPress={() => setManualModalVisible(true)}>
          <Text style={styles.addTimeBtnText}>+</Text>
        </TouchableOpacity>

        {/* Checkmark — only for recurring+timer tasks, not pure timed goals */}
        {hasCheckmark && (
          <TouchableOpacity style={styles.checkBtn} onPress={handleComplete}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkMark}>✓</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Manual minutes modal */}
      <Modal visible={manualModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Add Time Manually</Text>
            <Text style={styles.modalSubtitle}>
              How much time would you like to log?
            </Text>
            <View style={styles.timeInputRow}>
              <View style={styles.timeInputBlock}>
                <TextInput
                  style={styles.modalInput}
                  value={manualMinutes}
                  onChangeText={setManualMinutes}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#aaa"
                  autoFocus
                  maxLength={3}
                />
                <Text style={styles.timeInputLabel}>min</Text>
              </View>
              <Text style={styles.timeSeparator}>:</Text>
              <View style={styles.timeInputBlock}>
                <TextInput
                  style={styles.modalInput}
                  value={manualSeconds}
                  onChangeText={setManualSeconds}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#aaa"
                  maxLength={2}
                />
                <Text style={styles.timeInputLabel}>sec</Text>
              </View>
            </View>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => { setManualMinutes(''); setManualSeconds(''); setManualModalVisible(false); }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleManualAdd}>
                <Text style={styles.modalConfirmText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 5,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    overflow: 'hidden',
    // borderWidth must stay constant on Android — changing it at runtime with
    // overflow:hidden + borderRadius causes content to be clipped to nothing.
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardActive: {
    borderColor: COLORS.success + '66',
  },
  accentBar: { width: 4 },
  bodyOuter: { flex: 1 },
  bodyInfo: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6 },
  body: { flex: 1, padding: 14 }, // kept for reference, no longer used directly
  chipsRow: { flexDirection: 'row', gap: 6, marginBottom: 4, flexWrap: 'wrap' },
  title: { fontSize: 16, fontWeight: '600', color: '#1a1a2e', marginBottom: 10 },
  catChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  catText: { fontSize: 11, fontWeight: '600' },
  labelChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  labelText: { fontSize: 11, fontWeight: '700' },
  goalMetChip: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
    backgroundColor: COLORS.success + '22',
  },
  goalMetText: { fontSize: 11, fontWeight: '700', color: COLORS.success },
  timeChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  timeChipText: { fontSize: 11, fontWeight: '600' },
  timeChip_morning:   { backgroundColor: '#e8f4fd' },
  timeChip_afternoon: { backgroundColor: '#fef9e7' },
  timeChip_evening:   { backgroundColor: '#f4ecf7' },
  timeChipText_morning:   { color: '#2980b9' },
  timeChipText_afternoon: { color: '#d68910' },
  timeChipText_evening:   { color: '#8e44ad' },
  barBg: {
    height: 4, backgroundColor: '#eee', borderRadius: 2,
    marginBottom: 10, overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 2 },
  timerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingBottom: 14,
  },
  timerText: {
    fontSize: 18, fontWeight: '700', color: '#1a1a2e',
    fontVariant: ['tabular-nums'],
  },
  goalText: { fontSize: 12, color: COLORS.subtext, marginTop: 2 },
  timerBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: COLORS.success + '22',
  },
  timerBtnActive: { backgroundColor: '#e74c3c22' },
  timerBtnText: { fontSize: 14, fontWeight: '600', color: '#333' },
  actionCol: {
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  addTimeBtn: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: COLORS.primary + '66',
    justifyContent: 'center', alignItems: 'center',
  },
  addTimeBtnText: {
    fontSize: 20, color: COLORS.primary,
    fontWeight: '300', lineHeight: 24,
  },
  checkBtn: { justifyContent: 'center' },
  checkCircle: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: '#ddd',
    justifyContent: 'center', alignItems: 'center',
  },
  checkMark: { fontSize: 16, color: COLORS.success, fontWeight: '700' },
  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: '#00000066',
    justifyContent: 'center', alignItems: 'center',
  },
  modalBox: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 24, width: '80%', elevation: 8,
  },
  modalTitle: {
    fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 14, color: COLORS.subtext, marginBottom: 16,
  },
  timeInputRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, marginBottom: 20,
  },
  timeInputBlock: { flex: 1, alignItems: 'center' },
  timeInputLabel: {
    fontSize: 12, color: COLORS.subtext,
    fontWeight: '600', marginTop: 4,
  },
  timeSeparator: {
    fontSize: 28, fontWeight: '300',
    color: COLORS.subtext, paddingBottom: 18,
  },
  modalInput: {
    backgroundColor: '#f4f6fb', borderRadius: 10, padding: 14,
    fontSize: 24, fontWeight: '600', color: COLORS.text,
    borderWidth: 1, borderColor: COLORS.border,
    textAlign: 'center', width: '100%',
  },
  modalBtnRow: { flexDirection: 'row', gap: 12 },
  modalCancel: {
    flex: 1, padding: 12, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border, alignItems: 'center',
  },
  modalCancelText: { fontSize: 15, color: COLORS.subtext, fontWeight: '600' },
  modalConfirm: {
    flex: 1, padding: 12, borderRadius: 10,
    backgroundColor: COLORS.primary, alignItems: 'center',
  },
  modalConfirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
