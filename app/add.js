import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity,
  Switch, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { DatePickerField } from '../src/components/DatePickerField';
import { TimePickerField } from '../src/components/TimePickerField';
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
  { key: 'timed_goal', label: 'Timed Goal', desc: 'Unscheduled habit — track time with no fixed days (e.g., practice guitar)' },
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
  // Each action item: { id, description, leadAmount, leadUnit, priority }
  const [anchorActions, setAnchorActions] = useState([
    { id: 1, description: '', leadAmount: '6', leadUnit: 'weeks', priority: 3 },
  ]);
  const [goalMinutes, setGoalMinutes] = useState('30');
  const [goalReset, setGoalReset] = useState('daily');
  const [hasTimer, setHasTimer] = useState(false);
  const [durationIntent, setDurationIntent] = useState('');
  const [preferredTime, setPreferredTime] = useState(null);
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
      // Populate anchorActions from the single task being edited
      if (task.task_type === 'date_anchor') {
        const { amount, unit } = daysToUnit(task.escalate_days_out ?? 42);
        setAnchorActions([{
          id: 1,
          description: task.title,
          leadAmount: amount,
          leadUnit: unit,
          priority: task.base_priority,
        }]);
      }
      setGoalMinutes(String(task.goal_minutes ?? 30));
      setGoalReset(task.goal_reset ?? 'daily');
      setHasTimer(!!task.has_timer);
      setDurationIntent(task.duration_intent ? String(task.duration_intent) : '');
      setPreferredTime(task.preferred_time ?? null);
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

  // Convert "YYYY-MM-DD" string ↔ Date object
  const strToDate = (str) => {
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const dateToStr = (date) => {
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Convert "MM-DD" string ↔ Date object (uses current year, year ignored)
  const monthDayToDate = (str) => {
    if (!str) return null;
    const [m, d] = str.split('-').map(Number);
    return new Date(new Date().getFullYear(), m - 1, d);
  };
  const dateToMonthDay = (date) => {
    if (!date) return '';
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${m}-${d}`;
  };

  const leadToDays = (amount, unit) => {
    const n = Number(amount) || 0;
    if (unit === 'months') return n * 30;
    if (unit === 'weeks') return n * 7;
    return n;
  };

  const daysToUnit = (days) => {
    if (days % 30 === 0 && days > 0) return { amount: String(days / 30), unit: 'months' };
    if (days % 7 === 0 && days > 0) return { amount: String(days / 7), unit: 'weeks' };
    return { amount: String(days), unit: 'days' };
  };

  const addAnchorAction = () => {
    setAnchorActions(prev => [
      ...prev,
      { id: Date.now(), description: '', leadAmount: '0', leadUnit: 'days', priority: 2 },
    ]);
  };

  const removeAnchorAction = (id) => {
    setAnchorActions(prev => prev.filter(a => a.id !== id));
  };

  const updateAnchorAction = (id, field, value) => {
    setAnchorActions(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  };

  const handleSave = () => {
    if (taskType !== 'date_anchor' && !title.trim()) { Alert.alert('Missing Title', 'Please enter a task title.'); return; }

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
      escalate_days_out: Number(escalateDays),
      escalate_to_priority: escalatePriority,
      recur_rule: recurRule,
      recur_persistent: recurPersistent,
      rand_min_days: Number(randMin),
      rand_max_days: Number(randMax),
      rand_persistent: randPersistent,
      rand_next_date: randNextDate,
      anchor_date: null,
      anchor_label: null,
      goal_minutes: taskType === 'timed_goal' ? Number(goalMinutes) : (hasTimer && goalMinutes ? Number(goalMinutes) : null),
      goal_reset: goalReset,
      auto_hide_after_skips: autoHideAfterSkips ? Number(autoHideAfterSkips) : null,
      has_timer: hasTimer,
      duration_intent: durationIntent ? Number(durationIntent) : null,
      preferred_time: preferredTime ?? null,
    };

    if (taskType === 'date_anchor') {
      // Create one task per action item
      if (!anchorDate) { Alert.alert('Missing Date', 'Please enter the event date (MM-DD).'); return; }
      const validActions = anchorActions.filter(a => a.description.trim());
      if (!validActions.length) { Alert.alert('Missing Action', 'Add at least one action for this date.'); return; }
      for (const action of validActions) {
        createTask({
          ...taskData,
          title: action.description.trim(),
          task_type: 'date_anchor',
          base_priority: action.priority,
          priority_ceiling: action.priority,
          anchor_date: anchorDate,
          anchor_label: anchorLabel || anchorDate,
          escalate_days_out: leadToDays(action.leadAmount, action.leadUnit),
        });
      }
    } else if (isEditing) {
      updateTask(Number(editId), taskData);
    } else {
      createTask(taskData);
    }
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
      keyboardVerticalOffset={80}
    >
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      <Text style={styles.label}>Task Type</Text>
      <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTypeModal(true)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pickerBtnTitle}>{selectedType?.label ?? 'Select…'}</Text>
          {selectedType && <Text style={styles.pickerBtnDesc}>{selectedType.desc}</Text>}
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      {taskType !== 'date_anchor' && (
        <>
          <Text style={styles.label}>Title</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="What needs doing?" placeholderTextColor="#aaa" />

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput style={[styles.input, styles.notesInput]} value={notes} onChangeText={setNotes} placeholder="Any additional details…" placeholderTextColor="#aaa" multiline />
        </>
      )}

      <Text style={styles.label}>Category</Text>
      <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowCatModal(true)}>
        <Text style={styles.pickerBtnTitle}>{selectedCategory?.name ?? 'None'}</Text>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      {taskType !== 'date_anchor' && (
        <>
          <Text style={styles.label}>Base Priority</Text>
          <PriorityRow value={priority} onChange={setPriority} options={[1,2,3,4]} />

          <Text style={styles.label}>Priority Ceiling</Text>
          <Text style={styles.sublabel}>Auto-escalation will never exceed this level.</Text>
          <PriorityRow value={priorityCeiling} onChange={setPriorityCeiling} options={[1,2,3,4]} />
        </>
      )}

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
          <DatePickerField
            label="Due Date"
            value={strToDate(dueDate)}
            onChange={d => setDueDate(dateToStr(d))}
            placeholder="Pick a date"
          />
          <TimePickerField
            label="Due Time (optional)"
            value={dueTime || null}
            onChange={setDueTime}
            placeholder="No specific time"
          />
          <Text style={styles.sublabel}>Setting a time makes this task float to the top of the list as it approaches.</Text>
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
          <Text style={styles.label}>Time of Day (optional)</Text>
          <Text style={styles.sublabel}>Floats this task to the top of your list during the right window.</Text>
          <View style={styles.segmentRow}>
            {[
              { key: null,          label: 'Any time'  },
              { key: 'morning',     label: 'Morning'   },
              { key: 'afternoon',   label: 'Afternoon' },
              { key: 'evening',     label: 'Evening'   },
            ].map(opt => (
              <TouchableOpacity
                key={String(opt.key)}
                style={[styles.segBtn, preferredTime === opt.key && styles.segBtnActive]}
                onPress={() => setPreferredTime(opt.key)}
              >
                <Text style={[styles.segText, preferredTime === opt.key && styles.segTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <SwitchRow
            label="Track time"
            desc="Add a start/stop timer and optional minute goal to this task"
            value={hasTimer}
            onChange={setHasTimer}
          />
          {hasTimer && (
            <>
              <Text style={styles.label}>Minute goal (optional)</Text>
              <Text style={styles.sublabel}>e.g. 150 for 150 min/week of cardio</Text>
              <TextInput style={styles.input} value={goalMinutes} onChangeText={setGoalMinutes} keyboardType="numeric" placeholder="e.g. 150" placeholderTextColor="#aaa" />
              <Text style={styles.label}>Goal period</Text>
              <View style={styles.segmentRow}>
                {['daily','weekly'].map(t => (
                  <TouchableOpacity key={t} style={[styles.segBtn, goalReset === t && styles.segBtnActive]} onPress={() => setGoalReset(t)}>
                    <Text style={[styles.segText, goalReset === t && styles.segTextActive]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
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
          <DatePickerField
            label="Annual Date"
            value={monthDayToDate(anchorDate)}
            onChange={d => setAnchorDate(dateToMonthDay(d))}
            placeholder="Pick a date (year ignored)"
            monthDayOnly
          />
          <Text style={styles.label}>Event Label</Text>
          <TextInput style={styles.input} value={anchorLabel} onChangeText={setAnchorLabel} placeholder="Jim's Birthday" placeholderTextColor="#aaa" />

          <Text style={styles.label}>Actions</Text>
          <Text style={styles.sublabel}>Add one action per thing you need to do for this event.</Text>

          {anchorActions.map((action, index) => (
            <View key={action.id} style={styles.actionCard}>
              <View style={styles.actionCardHeader}>
                <Text style={styles.actionCardTitle}>Action {index + 1}</Text>
                {anchorActions.length > 1 && (
                  <TouchableOpacity onPress={() => removeAnchorAction(action.id)}>
                    <Text style={styles.actionRemove}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.actionLabel}>What to do</Text>
              <TextInput
                style={styles.input}
                value={action.description}
                onChangeText={v => updateAnchorAction(action.id, 'description', v)}
                placeholder="e.g. Buy a gift, Send a text, Make a call"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.actionLabel}>When to remind me</Text>
              <View style={styles.leadTimeRow}>
                <TextInput
                  style={[styles.input, styles.leadTimeInput]}
                  value={action.leadAmount}
                  onChangeText={v => updateAnchorAction(action.id, 'leadAmount', v)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#aaa"
                />
                <View style={styles.leadUnitRow}>
                  {['days', 'weeks', 'months'].map(unit => (
                    <TouchableOpacity
                      key={unit}
                      style={[styles.segBtn, action.leadUnit === unit && styles.segBtnActive]}
                      onPress={() => updateAnchorAction(action.id, 'leadUnit', unit)}
                    >
                      <Text style={[styles.segText, action.leadUnit === unit && styles.segTextActive]}>
                        {unit}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              {action.leadAmount === '0' || action.leadAmount === '' ? (
                <Text style={styles.sublabel}>On the day itself</Text>
              ) : null}

              <Text style={styles.actionLabel}>Priority</Text>
              <PriorityRow
                value={action.priority}
                onChange={v => updateAnchorAction(action.id, 'priority', v)}
                options={[1, 2, 3, 4]}
              />
            </View>
          ))}

          <TouchableOpacity style={styles.addActionBtn} onPress={addAnchorAction}>
            <Text style={styles.addActionBtnText}>+ Add Another Action</Text>
          </TouchableOpacity>
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

      {/* Duration intent — available on all task types */}
      {taskType !== 'timed_goal' && (
        <>
          <Text style={styles.label}>Estimated time (optional)</Text>
          <Text style={styles.sublabel}>Soft commitment — shows as "~Xm" on the card. Not tracked, just a reminder.</Text>
          <TextInput
            style={styles.input}
            value={durationIntent}
            onChangeText={setDurationIntent}
            keyboardType="numeric"
            placeholder="e.g. 90"
            placeholderTextColor="#aaa"
          />
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
    </KeyboardAvoidingView>
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
  leadTimeRow: { gap: 8 },
  leadTimeInput: { marginBottom: 8 },
  leadUnitRow: { flexDirection: 'row', gap: 8 },
  actionCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  actionCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  actionCardTitle: { fontSize: 13, fontWeight: '700', color: COLORS.subtext, textTransform: 'uppercase', letterSpacing: 0.6 },
  actionRemove: { fontSize: 13, color: '#e74c3c', fontWeight: '600' },
  actionLabel: { fontSize: 12, fontWeight: '700', color: COLORS.subtext, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 6 },
  addActionBtn: {
    borderWidth: 1.5, borderColor: COLORS.primary, borderStyle: 'dashed',
    borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4,
  },
  addActionBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: 15 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: COLORS.border },
  switchLabelBlock: { flex: 1, marginRight: 12 },
  switchLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  switchDesc: { fontSize: 13, color: COLORS.subtext, marginTop: 2 },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 18, alignItems: 'center', marginTop: 32 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  modalOverlay: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  modalOption: { flexDirection: 'column', padding: 14, borderRadius: 10, marginBottom: 6, backgroundColor: '#f8f8f8' },
  modalOptionSelected: { backgroundColor: COLORS.primary + '22', borderWidth: 1, borderColor: COLORS.primary },
  modalOptTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 2 },
  modalOptDesc: { fontSize: 13, color: COLORS.subtext },
  catDot: { width: 12, height: 12, borderRadius: 6, marginRight: 2 },
  modalCancel: { padding: 14, alignItems: 'center', marginTop: 8 },
  modalCancelText: { fontSize: 16, color: COLORS.subtext },
});
