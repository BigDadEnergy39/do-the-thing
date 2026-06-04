import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  startTimedSession, endTimedSession,
  getActiveTimedSession, getTodayTimedSeconds, getWeekTimedSeconds,
} from '../db/tasks';
import { COLORS } from './theme';

export function TimedGoalCard({ task, onPress }) {
  const isWeekly = task.goal_reset === 'weekly';
  const [timerRunning, setTimerRunning] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [baseSeconds, setBaseSeconds] = useState(0);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    const logged = isWeekly
      ? getWeekTimedSeconds(task.id)
      : getTodayTimedSeconds(task.id);
    setBaseSeconds(logged);

    const active = getActiveTimedSession(task.id);
    if (active) {
      setSessionId(active.id);
      setTimerRunning(true);
      const elapsed = Math.floor((Date.now() - new Date(active.started_at).getTime()) / 1000);
      setElapsedSecs(elapsed);
    }
    return () => clearInterval(intervalRef.current);
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
      const secs = endTimedSession(sessionId);
      setBaseSeconds(s => s + secs);
      setElapsedSecs(0);
      setTimerRunning(false);
      setSessionId(null);
    } else {
      const id = startTimedSession(task.id);
      setSessionId(id);
      setTimerRunning(true);
    }
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
    <View style={[styles.card, timerRunning && styles.cardActive]}>
      <View style={[styles.accentBar, { backgroundColor: timerRunning ? COLORS.success : catColor }]} />

      <TouchableOpacity style={styles.body} onPress={() => onPress?.(task)} activeOpacity={0.7}>
        <View style={styles.titleRow}>
          {task.category_name && (
            <View style={[styles.catChip, { backgroundColor: catColor + '33' }]}>
              <Text style={[styles.catText, { color: catColor }]}>{task.category_name}</Text>
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

        <View style={styles.timerRow}>
          <Text style={styles.timerText}>
            {formatTime(totalSecs)}
            {task.goal_minutes ? (
              <Text style={styles.goalText}> / {task.goal_minutes}m {periodLabel}</Text>
            ) : null}
          </Text>
          <TouchableOpacity
            style={[styles.timerBtn, timerRunning && styles.timerBtnActive]}
            onPress={handleToggleTimer}
          >
            <Text style={styles.timerBtnText}>{timerRunning ? '⏸ Pause' : '▶ Start'}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </View>
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
  },
  cardActive: {
    borderWidth: 1,
    borderColor: COLORS.success + '66',
  },
  accentBar: { width: 4 },
  body: { flex: 1, padding: 14 },
  titleRow: { flexDirection: 'row', gap: 6, marginBottom: 4, flexWrap: 'wrap' },
  title: { fontSize: 16, fontWeight: '600', color: '#1a1a2e', marginBottom: 10 },
  catChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  catText: { fontSize: 11, fontWeight: '600' },
  goalMetChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: COLORS.success + '22' },
  goalMetText: { fontSize: 11, fontWeight: '700', color: COLORS.success },
  barBg: { height: 4, backgroundColor: '#eee', borderRadius: 2, marginBottom: 10, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  timerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timerText: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', fontVariant: ['tabular-nums'] },
  goalText: { fontSize: 13, fontWeight: '400', color: COLORS.subtext },
  timerBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: COLORS.success + '22',
  },
  timerBtnActive: { backgroundColor: '#e74c3c22' },
  timerBtnText: { fontSize: 14, fontWeight: '600', color: '#333' },
});
