import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Switch,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getTaskById, archiveTask, updateTask, getCompletionsForTask } from '../../src/db/tasks';
import { cancelAllForTask } from '../../src/notifications/notificationService';
import { parseLocalDay, parseUtcStamp, formatShortDate } from '../../src/utils/date';
import { describeRule, upcomingOccurrences, normalizeRule, addByFreq } from '../../src/engine/recurrence';
import { COLORS, PRIORITY_COLORS, PRIORITY_LABELS } from '../../src/components/theme';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [task, setTask] = useState(null);
  const [completions, setCompletions] = useState([]);

  useEffect(() => {
    const t = getTaskById(Number(id));
    setTask(t);
    setCompletions(getCompletionsForTask(Number(id)));
  }, [id]);

  if (!task) return <View style={styles.container}><Text>Loading...</Text></View>;

  const priorityColor = PRIORITY_COLORS[task.base_priority] ?? COLORS.primary;

  const handleDelete = () => {
    Alert.alert('Delete Task', `Remove "${task.title}" permanently?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          // Cancel any pending alarms (e.g. a deadline's overdue loop) so a
          // deleted task can't keep firing notifications.
          cancelAllForTask(task.id).catch(() => {});
          archiveTask(task.id);
          router.back();
        },
      },
    ]);
  };

  const handleEdit = () => {
    router.push({ pathname: '/add', params: { editId: task.id } });
  };

  const formatDate = (iso) => {
    const d = parseUtcStamp(iso); // stored as UTC — render in the user's local time
    if (!d) return '—';
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  };

  const formatTime12h = (hhmm) => {
    if (!hhmm) return 'Any time';
    const [h, m] = hhmm.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
  };

  // describeRule handles both the new v2 rules and legacy shapes.
  const getRecurSummary = () => (task.recur_rule ? describeRule(task.recur_rule) : '—');

  // Upcoming occurrences. Fixed schedule → the next 3 calendar dates. Rolling
  // ("from last done") → the single next due date, computed from the most recent
  // completion (or the start date if never completed), since future dates there
  // depend on when each one is actually finished.
  const getRecurNext = () => {
    if (!task.recur_rule) return '—';
    if (task.recur_anchor === 'completion') {
      const rule = normalizeRule(task.recur_rule);
      if (!rule) return '—';
      // Most recent completion, regardless of list order (completed_at is a
      // sortable UTC 'YYYY-MM-DD HH:MM:SS' string).
      const latest = completions.reduce(
        (a, c) => (!a || c.completed_at > a.completed_at ? c : a), null);
      const lastStamp = latest ? parseUtcStamp(latest.completed_at) : null;
      let due;
      if (lastStamp) {
        const lastDay = new Date(lastStamp.getFullYear(), lastStamp.getMonth(), lastStamp.getDate());
        due = addByFreq(lastDay, rule.freq, rule.interval);
      } else {
        due = rule.start_date ? parseLocalDay(rule.start_date) : null;
      }
      return due ? `${formatShortDate(due)} · rolls from completion` : '—';
    }
    const dates = upcomingOccurrences(task.recur_rule, 3);
    return dates.length ? dates.map(formatShortDate).join(', ') : '—';
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.priorityBanner, { backgroundColor: priorityColor + '22' }]}>
        <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
        <Text style={[styles.priorityText, { color: priorityColor }]}>
          {PRIORITY_LABELS[task.base_priority]} Priority
        </Text>
        {task.category_name && (
          <View style={[styles.catChip, { backgroundColor: task.category_color + '33' }]}>
            <Text style={[styles.catText, { color: task.category_color }]}>{task.category_name}</Text>
          </View>
        )}
      </View>

      <Text style={styles.title}>{task.title}</Text>
      {task.notes ? <Text style={styles.notes}>{task.notes}</Text> : null}

      <View style={styles.detailsCard}>
        <DetailRow label="Type" value={task.task_type.replace('_', ' ')} />
        {task.task_type === 'deadline' && <>
          <DetailRow label="Due Date" value={task.due_date ? (parseLocalDay(task.due_date)?.toLocaleDateString() ?? '—') : '—'} />
          <DetailRow label="Due Time" value={formatTime12h(task.due_time)} />
          <DetailRow label="Escalates at" value={task.escalate_days_out ? `${task.escalate_days_out} days out` : '—'} />
        </>}
        {task.task_type === 'recurring' && <>
          <DetailRow label="Schedule" value={getRecurSummary()} />
          <DetailRow label="Next" value={getRecurNext()} />
          <DetailRow label="Persistent if missed" value={task.recur_persistent ? 'Yes' : 'No'} />
        </>}
        {task.task_type === 'randomized' && <>
          <DetailRow label="Range" value={`${task.rand_min_days}–${task.rand_max_days} days`} />
          <DetailRow label="Next due" value={task.rand_next_date ?? '—'} />
          <DetailRow label="Persistent if missed" value={task.rand_persistent ? 'Yes' : 'No'} />
        </>}
        {task.task_type === 'date_anchor' && <>
          <DetailRow label="Annual date" value={task.anchor_date ?? '—'} />
          <DetailRow label="Label" value={task.anchor_label ?? '—'} />
        </>}
        {task.task_type === 'timed_goal' && <>
          <DetailRow label="Daily goal" value={task.goal_minutes ? `${task.goal_minutes} min` : '—'} />
          <DetailRow label="Resets" value={task.goal_reset} />
        </>}
        <DetailRow label="Created" value={formatDate(task.created_at)} />
      </View>

      {completions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Recent Completions</Text>
          {completions.slice(0, 10).map(c => (
            <Text key={c.id} style={styles.completionItem}>
              ✓ {formatDate(c.completed_at)}
              {c.seconds_logged > 60 ? `  (${Math.round(c.seconds_logged / 60)}m)` : ''}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.editBtn} onPress={handleEdit}>
          <Text style={styles.editBtnText}>Edit Task</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function DetailRow({ label, value }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 60 },
  priorityBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: 10, marginBottom: 16,
  },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  priorityText: { fontSize: 13, fontWeight: '700', flex: 1 },
  catChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  catText: { fontSize: 12, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  notes: { fontSize: 15, color: COLORS.subtext, marginBottom: 20, lineHeight: 22 },
  detailsCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    marginBottom: 20, elevation: 1,
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  detailLabel: { fontSize: 14, color: COLORS.subtext },
  detailValue: { fontSize: 14, color: COLORS.text, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
  section: { marginBottom: 20 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: COLORS.subtext, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  completionItem: { fontSize: 14, color: COLORS.text, paddingVertical: 4 },
  actions: { gap: 12 },
  editBtn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    padding: 16, alignItems: 'center',
  },
  editBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  deleteBtn: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e74c3c',
    padding: 16, alignItems: 'center',
  },
  deleteBtnText: { color: '#e74c3c', fontWeight: '700', fontSize: 16 },
});
