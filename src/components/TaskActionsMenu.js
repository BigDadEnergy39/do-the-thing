import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { snoozeTask } from '../db/tasks';
import { skipTask } from '../engine/scheduler';
import { localDateTimeStr, parseLocalDay } from '../utils/date';
import { COLORS } from './theme';

// Cyclic types are the only ones where "skip this occurrence" has meaning.
const CYCLIC = new Set(['recurring', 'randomized']);

/**
 * The ⋯ overflow menu shown on actionable task cards. Snooze is time-aware
 * (duration presets + a date-and-time picker), so tasks with a same-day due time
 * can still be deferred by hours. For deadlines every option is capped at the due
 * moment so a snooze can never hide an overdue task. Skip is offered for cyclic
 * types. Calls onChanged after an action so the parent can refresh.
 */
export function TaskActionsMenu({ task, onChanged }) {
  const [open, setOpen] = useState(false);
  const [pickerStep, setPickerStep] = useState(null); // 'date' | 'time' | null
  const [pickedDate, setPickedDate] = useState(null);

  // A deadline can't be snoozed past its due moment, else the snooze gate would
  // keep an overdue task hidden. Compute the due instant to cap against.
  const dueMs = (() => {
    if (task.task_type !== 'deadline' || !task.due_date) return null;
    const base = parseLocalDay(task.due_date);
    if (!base) return null;
    if (task.due_time) {
      const [h, m] = task.due_time.split(':').map(Number);
      base.setHours(h, m, 0, 0);
    } else {
      base.setHours(23, 59, 59, 0);
    }
    return base.getTime();
  })();

  // No room to snooze a deadline that's already due/overdue.
  const canSnooze = !dueMs || dueMs > Date.now() + 60000;

  const applySnooze = (date) => {
    let t = date.getTime();
    if (t < Date.now() + 60000) t = Date.now() + 60000;        // always at least a minute out
    if (dueMs && t >= dueMs) t = dueMs - 60000;                 // never on/after the due moment
    snoozeTask(task.id, localDateTimeStr(new Date(t)));
    setOpen(false);
    setPickerStep(null);
    onChanged?.();
  };

  // Duration/time presets — auto-filtered to future-and-before-due.
  const presets = (() => {
    const now = Date.now();
    const out = [];
    const push = (key, label, date) => {
      const t = date.getTime();
      if (t > now && (!dueMs || t < dueMs)) out.push({ key, label, date });
    };
    push('1h', '1 hour', new Date(now + 3600000));
    push('3h', '3 hours', new Date(now + 3 * 3600000));
    const evening = new Date(); evening.setHours(18, 0, 0, 0);
    push('eve', 'This evening', evening);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
    push('tom', 'Tomorrow morning', tomorrow);
    const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7); nextWeek.setHours(9, 0, 0, 0);
    push('week', 'Next week', nextWeek);
    return out;
  })();

  const canSkip = CYCLIC.has(task.task_type);

  const onDateChange = (event, selected) => {
    if (event.type === 'dismissed' || !selected) { setPickerStep(null); return; }
    setPickedDate(selected);
    setPickerStep('time');
  };
  const onTimeChange = (event, selected) => {
    setPickerStep(null);
    if (event.type === 'dismissed' || !selected || !pickedDate) return;
    const d = new Date(pickedDate);
    d.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    applySnooze(d);
  };

  const handleSkip = () => {
    skipTask(task);
    setOpen(false);
    onChanged?.();
  };

  return (
    <>
      <TouchableOpacity
        style={styles.dotsBtn}
        onPress={() => setOpen(true)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.dots}>⋯</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{task.title}</Text>

            {canSnooze ? (
              <>
                <Text style={styles.section}>Snooze</Text>
                {presets.map(p => (
                  <TouchableOpacity key={p.key} style={styles.row} onPress={() => applySnooze(p.date)} activeOpacity={0.7}>
                    <Text style={styles.rowText}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => { setPickedDate(new Date()); setPickerStep('date'); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.rowText}>Pick date &amp; time…</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.note}>This deadline is due — too late to snooze.</Text>
            )}

            {canSkip && (
              <>
                <Text style={styles.section}>Skip</Text>
                <TouchableOpacity style={styles.row} onPress={handleSkip} activeOpacity={0.7}>
                  <Text style={styles.rowText}>
                    {task.task_type === 'randomized' ? 'Skip — roll to next time' : 'Skip this occurrence'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.cancel} onPress={() => setOpen(false)} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {pickerStep === 'date' && (
        <DateTimePicker
          value={pickedDate ?? new Date()}
          mode="date"
          display="calendar"
          minimumDate={new Date()}
          maximumDate={dueMs ? new Date(dueMs) : undefined}
          onChange={onDateChange}
        />
      )}
      {pickerStep === 'time' && (
        <DateTimePicker
          value={pickedDate ?? new Date()}
          mode="time"
          display="clock"
          onChange={onTimeChange}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  dotsBtn: { paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' },
  dots: { fontSize: 22, color: COLORS.subtext, fontWeight: '700', lineHeight: 22 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000055' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 12 },
  section: {
    fontSize: 11, fontWeight: '700', color: COLORS.subtext,
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12, marginBottom: 4,
  },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  rowText: { fontSize: 16, color: COLORS.text },
  note: { fontSize: 14, color: COLORS.subtext, fontStyle: 'italic', paddingVertical: 12 },
  cancel: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  cancelText: { fontSize: 16, color: COLORS.subtext, fontWeight: '600' },
});
