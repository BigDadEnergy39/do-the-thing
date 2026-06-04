import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
} from 'react-native';
import {
  recordCompletion, startTimedSession, endTimedSession,
  getActiveTimedSession, getTodayTimedSeconds,
} from '../db/tasks';
import { COLORS, PRIORITY_COLORS } from './theme';

const PRIORITY_LABELS = { 1: 'Low', 2: 'Normal', 3: 'High', 4: 'Critical' };

export function TaskCard({ task, onComplete, onPress }) {
  const [timerRunning, setTimerRunning] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [secondsToday, setSecondsToday] = useState(0);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const intervalRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (task.task_type === 'timed_goal') {
      const s = getTodayTimedSeconds(task.id);
      setSecondsToday(s);
      const active = getActiveTimedSession(task.id);
      if (active) {
        setSessionId(active.id);
        setTimerRunning(true);
        const elapsed = Math.floor((Date.now() - new Date(active.started_at).getTime()) / 1000);
        setElapsedSecs(elapsed);
      }
    }
    return () => clearInterval(intervalRef.current);
  }, [task.id, task.task_type]);

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
      setSecondsToday(s => s + secs);
      setElapsedSecs(0);
      setTimerRunning(false);
      setSessionId(null);
    } else {
      const id = startTimedSession(task.id);
      setSessionId(id);
      setTimerRunning(true);
    }
  };

  const handleComplete = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      recordCompletion(task.id, task.due_date ?? null, secondsToday);
      onComplete?.(task.id);
    });
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const priorityColor = PRIORITY_COLORS[task.effectivePriority ?? task.base_priority] ?? COLORS.primary;
  const catColor = task.category_color ?? '#888';

  const goalPct = task.task_type === 'timed_goal' && task.goal_minutes
    ? Math.min(1, (secondsToday + elapsedSecs) / (task.goal_minutes * 60))
    : null;

  return (
    <Animated.View style={[styles.card, { opacity: fadeAnim }]}>
      <View style={[styles.priorityBar, { backgroundColor: priorityColor }]} />

      <TouchableOpacity style={styles.body} onPress={() => onPress?.(task)} activeOpacity={0.7}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            {task.category_name && (
              <View style={[styles.categoryChip, { backgroundColor: catColor + '33' }]}>
                <Text style={[styles.categoryText, { color: catColor }]}>{task.category_name}</Text>
              </View>
            )}
            {task.displayLabel && (
              <View style={[styles.labelChip, {
                backgroundColor: task.overdueDays > 0 ? '#e74c3c22' : '#4a90d922'
              }]}>
                <Text style={[styles.labelText, {
                  color: task.overdueDays > 0 ? '#e74c3c' : '#4a90d9'
                }]}>{task.displayLabel}</Text>
              </View>
            )}
            {task.duration_intent ? (
              <View style={styles.durationChip}>
                <Text style={styles.durationText}>~{task.duration_intent}m</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.title}>{task.title}</Text>
          {task.notes ? <Text style={styles.notes} numberOfLines={2}>{task.notes}</Text> : null}
        </View>

        {task.task_type === 'timed_goal' && (
          <View style={styles.timerSection}>
            <View style={styles.goalBarBg}>
              <View style={[styles.goalBarFill, { width: `${(goalPct ?? 0) * 100}%` }]} />
            </View>
            <View style={styles.timerRow}>
              <Text style={styles.timerText}>
                {formatTime(secondsToday + elapsedSecs)}
                {task.goal_minutes ? ` / ${task.goal_minutes}m` : ''}
              </Text>
              <TouchableOpacity
                style={[styles.timerBtn, timerRunning && styles.timerBtnActive]}
                onPress={handleToggleTimer}
              >
                <Text style={styles.timerBtnText}>{timerRunning ? '⏸ Pause' : '▶ Start'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.checkBtn} onPress={handleComplete}>
        <View style={styles.checkCircle}>
          <Text style={styles.checkMark}>✓</Text>
        </View>
      </TouchableOpacity>
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
  },
  priorityBar: {
    width: 4,
  },
  body: {
    flex: 1,
    padding: 14,
  },
  header: {
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a2e',
  },
  notes: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  categoryChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
  },
  labelChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  labelText: {
    fontSize: 11,
    fontWeight: '700',
  },
  durationChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: '#88888822',
  },
  durationText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
  },
  checkBtn: {
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  checkCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkMark: {
    fontSize: 16,
    color: '#27ae60',
    fontWeight: '700',
  },
  timerSection: {
    marginTop: 10,
  },
  goalBarBg: {
    height: 4,
    backgroundColor: '#eee',
    borderRadius: 2,
    marginBottom: 8,
    overflow: 'hidden',
  },
  goalBarFill: {
    height: '100%',
    backgroundColor: '#27ae60',
    borderRadius: 2,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#444',
    fontVariant: ['tabular-nums'],
  },
  timerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#27ae6022',
  },
  timerBtnActive: {
    backgroundColor: '#e74c3c22',
  },
  timerBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
});
