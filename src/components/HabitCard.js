import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { recordHabitCheckin } from '../db/habits';
import { COLORS } from './theme';

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

export function HabitCard({ task, checkinResponse: initialResponse, streak, onCheckin, onPress }) {
  const [response, setResponse] = useState(initialResponse ?? null);
  const wc = WINDOW_COLORS[task.habit_window] ?? WINDOW_COLORS.morning;
  const catColor = task.category_color ?? '#888';

  const handleCheckin = (key) => {
    recordHabitCheckin(task.id, task.habit_window, key);
    setResponse(key);
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
          {streak > 0 && (
            <View style={styles.streakChip}>
              <Text style={styles.streakText}>🔥 {streak}d</Text>
            </View>
          )}
        </View>

        {/* Title */}
        <Text style={styles.title}>{task.title}</Text>
        {task.notes ? <Text style={styles.notes} numberOfLines={2}>{task.notes}</Text> : null}

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
});
