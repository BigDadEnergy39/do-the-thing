import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity,
  Switch, Alert, Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { createTask, updateTask, getTaskById } from '../src/db/tasks';
import { advanceRandomizedTask } from '../src/engine/scheduler';
import { getAllCategories } from '../src/db/categories';
import { COLORS, PRIORITY_COLORS, PRIORITY_LABELS } from '../src/components/theme';

const TASK_TYPES = [
  { key: 'unscheduled', label: 'To-Do', desc: 'No date or schedule' },
  { key: 'deadline', label: 'Deadline', desc: 'Must be done by a date' },
  { key: 'recurring', label: 'Recurring', desc: 'Repeats on a schedule' },
  { key: 'randomized', label: 'Randomized', desc: 'Every 2–4 weeks, random day' },
  { key: 'date_anchor', label: 'Important Date', desc: 'Birthday, anniversary, etc.' },
  { key: 'timed_goal', label: 'Timed Goal', desc: 'Track time spent (e.g., practice guitar)' },
];

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AddTaskScreen() {
  const router = useRouter();
  const { editId } = useLocalSearchParams();
  const isEditing = !!editId;

  const [categories, setCategories] = useState([]);
  const [taskType, setTaskType] = useState('unscheduled');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState(null);
  const [priority, setPriority] = useState(2);
  const [priorityCeiling, setPriorityCeiling] = useState(4);
  const [autoEscalateDays, setAutoEscalateDays] = useState('14');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [escalateDays, setEscalateDays] = useState('14');
  const [escalatePriority, setEscalatePriority] = useState(3);
  const [recurType, setRecurType] = useState('weekly');
  const [recurDays, setRecurDays] = useState([]);
  const [recurInterval, setRecurInterval] = useState('7');
  const [recurPersistent, setRecurPersistent] = useState(false);
  const [autoHideAfterSkips, setAutoHideAfterSkips] = useState('');
  const [randMin, setRandMin] = useState('14');
  const [randMax, setRandMax] = useState('21');
  const [randPersistent, setRandPersistent] = useState(false);
  const [anchorDate, setAnchorDate] = useState('');
  const [anchorLabel, setAnchorLabel] = useState('');
  const [anchorLeadDays, setAnchorLeadDays] = useState('42');
  const [goalMinutes, setGoalMinutes] = useState('30');
  const [goalReset, setGoalReset] = useState('daily');
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showCatModal, setShowCatModal] = useState(false);

  useEffect(() => {
    setCategories(getAllCategories());
    if (editId) {
      const task = getTaskById(Number(editId));
      if (!task) return;
      setTaskType(task.task_type);
      setTitle(task.title);
      setNotes(task.notes ?? '');
      setCategoryId(task.category_id);
      setPriority(task.base_priority);
      setPriorityCeiling(task.priority_ceiling ?? 4);
      setAutoEscalateDays(String(task.auto_escalate_days ?? 14));
      setDueDate(task.due_date ?? '');
      setDueTime(task.due_time ?? '');
      setEscalateDays(String(task.escalate_days_out ?? 14));
      setEscalatePriority(task.escalate_to_priority ?? 3);
      setRecurPersistent(!!task.recur_persistent);
      setAutoHideAfterSkips(task.auto_hide_after_skips ? String(task.auto_hide_after_skips) : '');
      setRandMin(String(task.rand_min_days ?? 14));
      setRandMax(String(task.rand_max_days ?? 21));
      setRandPersistent(!!task.rand_persistent);
      setAnchorDate(task.anchor_date ?? '');
      setAnchorLabel(task.anchor_label ?? '');
      setAnchorLeadDays(String(task.escalate_days_out ?? 42));
      setGoalMinutes(String(task.goal_minutes ?? 30));
      setGoalReset(task.goal_reset ?? 'daily');
      if (task.recur_rule) {
        try {
          const rule = JSON.parse(task.recur_rule);
          setRecurType(rule.type);
          setRecurDays(rule.days ?? []);
          setRecurInterval(String(rule.interval ?? 7));
        } catch {}
      }
    }
  }, [editId]);

  const selectedType = TASK_TYPES.find(t => t.key === taskType);
  const selectedCategory = categories.find(c => c.id === categoryId);

  const toggleRecurDay = (dow) => {
    setRecurDays(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow]);
  };

  const handleSave = () => {
    if (!title.trim()) { Alert.alert('Missing Title', 'Please enter a task title.'); return; }

    let recurRule = null;
    if (taskType === 'recurring') {
      if (recurType === 'weekly') {
        if (!recurDays.length) { Alert.alert('Select Days', 'Choose at least one day.'); return; }
        recurRule = JSON.stringify({ type: 'weekly', days: recurDays });
      } else if (recurType === 'daily') {
        recurRule = JSON.stringify({ type: 'daily' });
      } else if (recurType === 'interval') {
        recurRule = JSON.stringify({ type: 'interval', interval: Number(recurInterval), start_date: new Date().toISOString().slice(0, 10) });
      }
    }

    const randNextDate = taskType === 'randomized'
      ? advanceRandomizedTask({ rand_min_days: Number(randMin), rand_max_days: Number(randMax) })
      : null;

    const taskData = {
      title: title.trim(),
      notes: notes.trim() || null,
      category_id: categoryId,
      task_type: taskType,
      base_priority: priority,
      priority_ceiling: priorityCeiling,
      auto_escalate_days: Number(autoEscalateDays) || 14,
      due_date: taskType === 'deadline' ? dueDate || null : null,
      due_time: taskType === 'deadline' ? dueTime || null : null,
      escalate_days_out: taskType === 'deadline' ? Number(escalateDays) : Number(anchorLeadDays),
      escalate_to_priority: escalatePriority,
      recur_rule: recurRule,
      recur_persistent: recurPersistent,
      rand_min_days: Number(randMin),
      rand_max_days: Number(randMax),
      rand_persistent: randPersistent,
      rand_next_date: randNextDate,
      anchor_date: taskType === 'date_anchor' ? anchorDate || null : null,
      anchor_label: taskType === 'date_anchor' ? anchorLabel || null : null,
      goal_minutes: taskType === 'timed_goal' ? Number(goalMinutes) : null,
      goal_reset: goalReset,
      auto_hide_after_skips: autoHideAfterSkips ? Number(autoHideAfterSkips) : null,
    };

    if (isEditing) updateTask(Number(editId), taskData);
    else createTask(taskData);
    router.back();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      <Text style={styles.label}>Task Type</Text>
      <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTypeModal(true)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pickerBtnTitle}>{selectedType?.label ?? 'Select…'}</Text>
          {selectedType && <Text style={styles.pickerBtnDesc}>{selectedType.desc}</Text>}
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="What needs doing?" placeholderTextColor="#aaa" />

      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput style={[styles.input, styles.notesInput]} value={notes} onChangeText={setNotes} placeholder="Any additional details…" placeholderTextColor="#aaa" multiline />

      <Text style={styles.label}>Category</Text>
      <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowCatModal(true)}>
        <Text style={styles.pickerBtnTitle}>{selectedCategory?.name ?? 'None'}</Text>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Base Priority</Text>
      <PriorityRow value={priority} onChange={setPriority} options={[1,2,3,4]} />

      <Text style={styles.label}>Priority Ceiling</Text>
      <Text style={styles.sublabel}>Auto-escalation will never exceed this level.</Text>
      <PriorityRow value={priorityCeiling} onChange={setPriorityCeiling} options={[1,2,3,4]} />

      {/* Unscheduled / Timed Goal: auto-escalation */}
      {(taskType === 'unscheduled' || taskType === 'timed_goal') && (
        <>
          <Text style={styles.label}>Auto-escalate every N days</Text>
          <Text style={styles.sublabel}>Priority climbs by 1 step every N days if untouched. 0 = off.</Text>
          <TextInput style={styles.input} value={autoEscalateDays} onChangeText={setAutoEscalateDays} keyboardType="numeric" placeholder="14" placeholderTextColor="#aaa" />
        </>
      )}

      {/* ── Deadline ── */}
      {taskType === 'deadline' && (
        <>
          <Text style={styles.label}>Due Date (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} placeholder="2025-12-31" placeholderTextColor="#aaa" />
          <Text style={styles.label}>Due Time (optional, HH:MM)</Text>
          <Text style={styles.sublabel}>Set a time and this task floats to the top of the list today.</Text>
          <TextInput style={styles.input} value={dueTime} onChangeText={setDueTime} placeholder="15:00" placeholderTextColor="#aaa" keyboardType="numbers-and-punctuation" />
          <Text style={styles.label}>Escalate priority when within N days</Text>
          <TextInput style={styles.input} value={escalateDays} onChangeText={setEscalateDays} keyboardType="numeric" placeholder="14" placeholderTextColor="#aaa" />
          <Text style={styles.label}>Escalate to priority</Text>
          <PriorityRow value={escalatePriority} onChange={setEscalatePriority} options={[2,3,4]} />
        </>
      )}

      {/* ── Recurring ── */}
      {taskType === 'recurring' && (
        <>
          <Text style={styles.label}>Repeat Type</Text>
          <View style={styles.segmentRow}>
            {['daily','weekly','interval'].map(t => (
              <TouchableOpacity key={t} style={[styles.segBtn, recurType === t && styles.segBtnActive]} onPress={() => setRecurType(t)}>
                <Text style={[styles.segText, recurType === t && styles.segTextActive]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {recurType === 'weekly' && (
            <>
              <Text style={styles.label}>Days of Week</Text>
              <View style={styles.dowRow}>
                {DOW_LABELS.map((d, i) => (
                  <TouchableOpacity key={i} style={[styles.dowBtn, recurDays.includes(i) && styles.dowBtnActive]} onPress={() => toggleRecurDay(i)}>
                    <Text style={[styles.dowText, recurDays.includes(i) && styles.dowTextActive]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          {recurType === 'interval' && (
            <>
              <Text style={styles.label}>Every N days</Text>
              <TextInput style={styles.input} value={recurInterval} onChangeText={setRecurInterval} keyboardType="numeric" placeholder="7" placeholderTextColor="#aaa" />
            </>
          )}
          <SwitchRow
            label="Persist if missed"
            desc="Stays on the list if you miss the scheduled day (e.g. snake feeding)"
            value={recurPersistent}
            onChange={setRecurPersistent}
          />
          <Text style={styles.label}>Auto-hide after N skips (optional)</Text>
          <Text style={styles.sublabel}>If skipped this many times in a row, steps back until next occurrence. Leave blank to always show.</Text>
          <TextInput style={styles.input} value={autoHideAfterSkips} onChangeText={setAutoHideAfterSkips} keyboardType="numeric" placeholder="e.g. 3" placeholderTextColor="#aaa" />
        </>
      )}

      {/* ── Randomized ── */}
      {taskType === 'randomized' && (
        <>
          <Text style={styles.label}>Minimum days between</Text>
          <TextInput style={styles.input} value={randMin} onChangeText={setRandMin} keyboardType="numeric" placeholder="14" placeholderTextColor="#aaa" />
          <Text style={styles.label}>Maximum days between</Text>
          <TextInput style={styles.input} value={randMax} onChangeText={setRandMax} keyboardType="numeric" placeholder="21" placeholderTextColor="#aaa" />
          <SwitchRow label="Persist if missed" desc="Stays on list past the scheduled date" value={randPersistent} onChange={setRandPersistent} />
          <Text style={styles.label}>Auto-hide after N skips (optional)</Text>
          <TextInput style={styles.input} value={autoHideAfterSkips} onChangeText={setAutoHideAfterSkips} keyboardType="numeric" placeholder="e.g. 3" placeholderTextColor="#aaa" />
        </>
      )}

      {/* ── Date Anchor ── */}
      {taskType === 'date_anchor' && (
        <>
          <Text style={styles.label}>Annual Date (MM-DD)</Text>
          <TextInput style={styles.input} value={anchorDate} onChangeText={setAnchorDate} placeholder="03-15" placeholderTextColor="#aaa" />
          <Text style={styles.label}>Event Label</Text>
          <TextInput style={styles.input} value={anchorLabel} onChangeText={setAnchorLabel} placeholder="Jim's Birthday" placeholderTextColor="#aaa" />
          <Text style={styles.label}>Lead time reminder (days before)</Text>
          <TextInput style={styles.input} value={anchorLeadDays} onChangeText={setAnchorLeadDays} keyboardType="numeric" placeholder="42" placeholderTextColor="#aaa" />
        </>
      )}

      {/* ── Timed Goal ── */}
      {taskType === 'timed_goal' && (
        <>
          <Text style={styles.label}>Goal (minutes)</Text>
          <TextInput style={styles.input} value={goalMinutes} onChangeText={setGoalMinutes} keyboardType="numeric" placeholder="30" placeholderTextColor="#aaa" />
          <Text style={styles.label}>Goal Period</Text>
          <View style={styles.segmentRow}>
            {['daily','weekly'].map(t => (
              <TouchableOpacity key={t} style={[styles.segBtn, goalReset === t && styles.segBtnActive]} onPress={() => setGoalReset(t)}>
                <Text style={[styles.segText, goalReset === t && styles.segTextActive]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>{isEditing ? 'Save Changes' : 'Add Task'}</Text>
      </TouchableOpacity>

      {/* Task type modal */}
      <Modal visible={showTypeModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Task Type</Text>
            {TASK_TYPES.map(t => (
              <TouchableOpacity key={t.key} style={[styles.modalOption, taskType === t.key && styles.modalOptionSelected]} onPress={() => { setTaskType(t.key); setShowTypeModal(false); }}>
                <Text style={styles.modalOptTitle}>{t.label}</Text>
                <Text style={styles.modalOptDesc}>{t.desc}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowTypeModal(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Category modal */}
      <Modal visible={showCatModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Category</Text>
            <TouchableOpacity style={[styles.modalOption, !categoryId && styles.modalOptionSelected]} onPress={() => { setCategoryId(null); setShowCatModal(false); }}>
              <Text style={styles.modalOptTitle}>None</Text>
            </TouchableOpacity>
            {categories.map(c => (
              <TouchableOpacity key={c.id} style={[styles.modalOption, categoryId === c.id && styles.modalOptionSelected]} onPress={() => { setCategoryId(c.id); setShowCatModal(false); }}>
                <View style={[styles.catDot, { backgroundColor: c.color }]} />
                <Text style={styles.modalOptTitle}>{c.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowCatModal(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function PriorityRow({ value, onChange, options }) {
  return (
    <View style={styles.priorityRow}>
      {options.map(p => (
        <TouchableOpacity key={p} style={[styles.priorityBtn, value === p && { backgroundColor: PRIORITY_COLORS[p] }]} onPress={() => onChange(p)}>
          <Text style={[styles.priorityBtnText, value === p && { color: '#fff' }]}>{PRIORITY_LABELS[p]}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function SwitchRow({ label, desc, value, onChange }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchLabelBlock}>
        <Text style={styles.switchLabel}>{label}</Text>
        {desc && <Text style={styles.switchDesc}>{desc}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} thumbColor={COLORS.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 60 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.subtext, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 6 },
  sublabel: { fontSize: 12, color: COLORS.subtext, marginBottom: 8, marginTop: -2 },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 16, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border },
  notesInput: { height: 90, textAlignVertical: 'top' },
  pickerBtn: { backgroundColor: '#fff', borderRadius: 10, padding: 14, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  pickerBtnTitle: { fontSize: 16, color: COLORS.text, fontWeight: '500' },
  pickerBtnDesc: { fontSize: 13, color: COLORS.subtext, marginTop: 2 },
  chevron: { fontSize: 22, color: '#aaa', marginLeft: 8 },
  priorityRow: { flexDirection: 'row', gap: 8 },
  priorityBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', backgroundColor: '#fff' },
  priorityBtnText: { fontSize: 13, fontWeight: '600', color: COLORS.subtext },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', backgroundColor: '#fff' },
  segBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  segText: { fontSize: 14, color: COLORS.subtext, fontWeight: '500' },
  segTextActive: { color: '#fff' },
  dowRow: { flexDirection: 'row', gap: 4 },
  dowBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', backgroundColor: '#fff' },
  dowBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dowText: { fontSize: 11, fontWeight: '600', color: COLORS.subtext },
  dowTextActive: { color: '#fff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: COLORS.border },
  switchLabelBlock: { flex: 1, marginRight: 12 },
  switchLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  switchDesc: { fontSize: 13, color: COLORS.subtext, marginTop: 2 },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 18, alignItems: 'center', marginTop: 32 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  modalOverlay: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  modalOption: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 10, marginBottom: 6, backgroundColor: '#f8f8f8' },
  modalOptionSelected: { backgroundColor: COLORS.primary + '22', borderWidth: 1, borderColor: COLORS.primary },
  modalOptTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  modalOptDesc: { fontSize: 13, color: COLORS.subtext },
  catDot: { width: 12, height: 12, borderRadius: 6 },
  modalCancel: { padding: 14, alignItems: 'center', marginTop: 8 },
  modalCancelText: { fontSize: 16, color: COLORS.subtext },
});
