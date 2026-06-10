import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { getAllTasks } from '../src/db/tasks';
import { COLORS, PRIORITY_COLORS } from '../src/components/theme';

const TYPE_LABELS = {
  unscheduled:  'To-Do',
  deadline:     'Deadline',
  recurring:    'Recurring',
  randomized:   'Randomized',
  date_anchor:  'Important Date',
  timed_goal:   'Timed Goal',
  habit:        'Habit',
};

const TYPE_ORDER = ['unscheduled','deadline','recurring','randomized','date_anchor','timed_goal','habit'];

export default function AllTasksScreen() {
  const router = useRouter();
  const [tasks, setTasks] = useState([]);
  const [query, setQuery] = useState('');

  useFocusEffect(useCallback(() => {
    setTasks(getAllTasks());
  }, []));

  const filtered = query.trim()
    ? tasks.filter(t =>
        t.title.toLowerCase().includes(query.toLowerCase()) ||
        (t.category_name ?? '').toLowerCase().includes(query.toLowerCase())
      )
    : tasks;

  // Group by type in a fixed order
  const groups = TYPE_ORDER
    .map(type => ({ type, items: filtered.filter(t => t.task_type === type) }))
    .filter(g => g.items.length > 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search tasks…"
        placeholderTextColor="#aaa"
        clearButtonMode="while-editing"
      />

      {groups.map(group => (
        <View key={group.type} style={styles.group}>
          <Text style={styles.groupHeader}>{TYPE_LABELS[group.type]}</Text>
          {group.items.map(task => {
            const catColor = task.category_color ?? '#888';
            const priorityColor = PRIORITY_COLORS[task.base_priority] ?? COLORS.primary;
            return (
              <TouchableOpacity
                key={task.id}
                style={styles.row}
                onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
                activeOpacity={0.7}
              >
                <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{task.title}</Text>
                  {task.category_name && (
                    <View style={[styles.catChip, { backgroundColor: catColor + '33' }]}>
                      <Text style={[styles.catText, { color: catColor }]}>{task.category_name}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.editArrow}>›</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      {filtered.length === 0 && (
        <Text style={styles.empty}>No tasks found.</Text>
      )}

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingTop: 12 },
  search: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 16,
  },
  group: { marginBottom: 8 },
  groupHeader: {
    fontSize: 11, fontWeight: '700', color: COLORS.subtext,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 6, paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    marginBottom: 4, gap: 10,
  },
  priorityDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowTitle: { fontSize: 15, fontWeight: '500', color: COLORS.text, flexShrink: 1 },
  catChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  catText: { fontSize: 11, fontWeight: '600' },
  editArrow: { fontSize: 22, color: '#ccc' },
  empty: { textAlign: 'center', color: COLORS.subtext, marginTop: 40, fontSize: 15 },
});
