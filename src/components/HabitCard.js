import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { recordHabitCheckin, recordHabitCheckinForDay, dismissStreakGoal } from '../db/habits';
import { COLORS } from './theme';

// Yesterday as a local 'YYYY-MM-DD' string (for the backfill affordance).
function yesterdayLocalStr() {
  const n = new Date();
  const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  return `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
}

const WINDOW_COLORS = {
  morning:   { bg: '#e8f4fd', accent: '#2980b9', label: 'Morning'   },
  afternoon: { bg: '#fef9e7', accent: '#d68910', label: 'Afternoon' },
  evening:   { bg: '#f4ecf7', accent: '#8e44ad', label: 'Evening'   },
};

const RESPONSES = [
  { key: 'kept',   label: 'Kept it',  color: '#27ae60', bg: '#27ae6020' },
  { key: 'mostly', label: 'Mostly',   color: '#f39c12', bg: '#f39c1220' },
  { key: 'didnt',  label: "Didn't",   color: '#e74c3c', bg: '#e74c3c20' },
];

export function HabitCard({ task, checkinResponse: initialResponse, streak, targetProgress, onCheckin, onPress }) {
  const [response, setResponse] = useState(initialResponse ?? null);
  const [showBackfill, setShowBackfill] = useState(false);
  const wc = WINDOW_COLORS[task.habit_window] ?? WINDOW_COLORS.morning;
  const catColor = task.category_color ?? '#888';

  const tp = targetProgress ?? null;
  const done = !!tp?.complete;

  const handleCheckin = (key) => {
    recordHabitCheckin(task.id, task.habit_window, key);
    setResponse(key);
    onCheckin?.();
  };

  const handleBackfill = (key) => {
    recordHabitCheckinForDay(task.id, task.habit_window, key, yesterdayLocalStr());
    setShowBackfill(false);
    onCheckin?.(); // re-runs the daily list so the streak/counter reflects it
  };

  const handleDismiss = () => {
    dismissStreakGoal(task.id);
    onCheckin?.();
  };

  const chosenResponse = RESPONSES.find(r => r.key === response);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress?.(task)}
      activeOpacity={0.85}
    >
      {/* Left accent bar colored by window */}
      <View style={[styles.accentBar, { backgroundColor: wc.accent }]} />

      <View style={styles.body}>
        {/* Top row: chips */}
        <View style={styles.chipsRow}>
          {task.category_name && (
            <View style={[styles.chip, { backgroundColor: catColor + '33' }]}>
              <Text style={[styles.chipText, { color: catColor }]}>{task.category_name}</Text>
            </View>
          )}
          <View style={[styles.chip, { backgroundColor: wc.bg }]}>
            <Text style={[styles.chipText, { color: wc.accent }]}>{wc.label}</Text>
          </View>
          {tp ? (
            <View style={[styles.streakChip, done && styles.doneChip]}>
              <Text style={[styles.streakText, done && styles.doneText]}>
                {done ? '🎉 ' : (tp.mode === 'consecutive' ? '🔥 ' : '')}
                {tp.numerator}/{tp.denominator}
              </Text>
            </View>
          ) : streak > 0 ? (
            <View style={styles.streakChip}>
              <Text style={styles.streakText}>🔥 {streak}d</Text>
            </View>
          ) : null}
        </View>

        {/* Title */}
        <Text style={styles.title}>{task.title}</Text>
        {task.notes ? <Text style={styles.notes} numberOfLines={2}>{task.notes}</Text> : null}

        {/* Finished streak goal: show the result + a Dismiss control. It stays
            on Today until dismissed, then the scheduler drops it. */}
        {done ? (
          <View style={styles.doneRow}>
            <Text style={styles.doneMsg}>
              {tp.mode === 'consecutive'
                ? `Goal reached — ${tp.target} days in a row!`
                : `Window complete — ${tp.numerator} of ${tp.denominator} days kept.`}
            </Text>
            <TouchableOpacity onPress={handleDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.dismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Check-in buttons or response badge */}
            {response && chosenResponse ? (
              <View style={styles.responseRow}>
                <View style={[styles.responseBadge, { backgroundColor: chosenResponse.bg }]}>
                  <Text style={[styles.responseText, { color: chosenResponse.color }]}>
                    {chosenResponse.label}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setResponse(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.changeText}>change</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.checkinRow}>
                {RESPONSES.map(r => (
                  <TouchableOpacity
                    key={r.key}
                    style={[styles.checkinBtn, { backgroundColor: r.bg, borderColor: r.color + '44' }]}
                    onPress={() => handleCheckin(r.key)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.checkinBtnText, { color: r.color }]}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Backfill: only for targeted habits with an un-logged, still-fillable
                yesterday. Lets a forgotten day be recorded before it breaks a run. */}
            {tp?.needsBackfillHint && (
              showBackfill ? (
                <View style={styles.backfillRow}>
                  <Text style={styles.backfillLabel}>Yesterday:</Text>
                  {RESPONSES.map(r => (
                    <TouchableOpacity
                      key={r.key}
                      style={[styles.backfillBtn, { backgroundColor: r.bg, borderColor: r.color + '44' }]}
                      onPress={() => handleBackfill(r.key)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.backfillBtnText, { color: r.color }]}>{r.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <TouchableOpacity onPress={() => setShowBackfill(true)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={styles.backfillHint}>Forgot yesterday? Log it →</Text>
                </TouchableOpacity>
              )
            )}
          </>
        )}
      </View>
    </TouchableOpacity>
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
  accentBar: { width: 4 },
  body: { flex: 1, padding: 14 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  chipText: { fontSize: 11, fontWeight: '600' },
  streakChip: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
    backgroundColor: '#fff3e0',
  },
  streakText: { fontSize: 11, fontWeight: '700', color: '#e67e22' },
  doneChip: { backgroundColor: '#e8f8ee' },
  doneText: { color: '#27ae60' },
  title: { fontSize: 16, fontWeight: '600', color: '#1a1a2e', marginBottom: 4 },
  notes: { fontSize: 13, color: '#666', marginBottom: 8 },
  checkinRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  checkinBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 8,
    alignItems: 'center', borderWidth: 1,
  },
  checkinBtnText: { fontSize: 13, fontWeight: '700' },
  responseRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8,
  },
  responseBadge: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
  },
  responseText: { fontSize: 14, fontWeight: '700' },
  changeText: { fontSize: 12, color: COLORS.subtext, textDecorationLine: 'underline' },
  doneRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, marginTop: 8,
  },
  doneMsg: { flex: 1, fontSize: 13, fontWeight: '600', color: '#27ae60' },
  dismissText: { fontSize: 13, fontWeight: '700', color: COLORS.subtext },
  backfillHint: {
    fontSize: 12, color: '#e67e22', marginTop: 10, fontWeight: '600',
  },
  backfillRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  backfillLabel: { fontSize: 12, color: COLORS.subtext, fontWeight: '600' },
  backfillBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, borderWidth: 1,
  },
  backfillBtnText: { fontSize: 12, fontWeight: '700' },
});
