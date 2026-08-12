import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity,
  Switch, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { DatePickerField } from '../src/components/DatePickerField';
import { TimePickerField } from '../src/components/TimePickerField';
import { createTask, updateTask, getTaskById } from '../src/db/tasks';
import { scheduleDeadlineReminders, cancelAllForTask } from '../src/notifications/notificationService';
import { advanceRandomizedTask } from '../src/engine/scheduler';
import { describeRule, normalizeRule, upcomingOccurrences } from '../src/engine/recurrence';
import { localDateStr, formatShortDate } from '../src/utils/date';
import { getAllCategories } from '../src/db/categories';
import { getAllLocations } from '../src/db/locations';
import { COLORS, PRIORITY_COLORS, PRIORITY_LABELS } from '../src/components/theme';

const TASK_TYPES = [
  { key: 'unscheduled', label: 'To-Do', desc: 'No date or schedule' },
  { key: 'deadline', label: 'Deadline', desc: 'Must be done by a date' },
  { key: 'recurring', label: 'Recurring', desc: 'Repeats on a schedule' },
  { key: 'randomized', label: 'Randomized', desc: 'Every 2–4 weeks, random day' },
  { key: 'date_anchor', label: 'Important Date', desc: 'Birthday, anniversary, etc.' },
  { key: 'timed_goal', label: 'Timed Goal', desc: 'Unscheduled habit — track time with no fixed days (e.g., practice guitar)' },
  { key: 'habit', label: 'Habit', desc: 'Daily behavior check-in — Kept it / Mostly / Didn\'t (e.g., avoid simple carbs)' },
];

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Standard US holidays in calendar order — fixed dates use anchor_date (MM-DD),
// floating holidays use anchor_nth_rule {n, weekday (0=Sun), month (1-indexed)}.
const HOLIDAY_PRESETS = [
  { label: "New Year's Day",    anchor_date: '01-01' },
  { label: 'MLK Day',           anchor_nth_rule: { n: 3,  weekday: 1, month: 1  } },
  { label: "Valentine's Day",   anchor_date: '02-14' },
  { label: "Presidents' Day",   anchor_nth_rule: { n: 3,  weekday: 1, month: 2  } },
  { label: "St. Patrick's Day", anchor_date: '03-17' },
  { label: "Mother's Day",      anchor_nth_rule: { n: 2,  weekday: 0, month: 5  } },
  { label: 'Memorial Day',      anchor_nth_rule: { n: -1, weekday: 1, month: 5  } },
  { label: "Father's Day",      anchor_nth_rule: { n: 3,  weekday: 0, month: 6  } },
  { label: 'Independence Day',  anchor_date: '07-04' },
  { label: 'Labor Day',         anchor_nth_rule: { n: 1,  weekday: 1, month: 9  } },
  { label: 'Columbus Day',      anchor_nth_rule: { n: 2,  weekday: 1, month: 10 } },
  { label: 'Halloween',         anchor_date: '10-31' },
  { label: 'Veterans Day',      anchor_date: '11-11' },
  { label: 'Thanksgiving',      anchor_nth_rule: { n: 4,  weekday: 4, month: 11 } },
  { label: 'Christmas',         anchor_date: '12-25' },
  { label: "New Year's Eve",    anchor_date: '12-31' },
];

export default function AddTaskScreen() {
  const router = useRouter();
  const { editId } = useLocalSearchParams();
  const isEditing = !!editId;

  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [taskType, setTaskType] = useState('unscheduled');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState(null);
  // Location is the second, independent axis (where/how you can act). A task may
  // carry neither tag, either, or both — the two never constrain each other.
  const [locationId, setLocationId] = useState(null);
  const [priority, setPriority] = useState(2);
  const [priorityCeiling, setPriorityCeiling] = useState(4);
  const [autoEscalateDays, setAutoEscalateDays] = useState('14');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [escalateDays, setEscalateDays] = useState('14');
  const [escalatePriority, setEscalatePriority] = useState(3);
  // Flexible recurrence builder state (see src/engine/recurrence.js for the rule shape).
  const [recurFreq, setRecurFreq] = useState('weekly');      // 'daily' | 'weekly' | 'monthly'
  const [recurInterval, setRecurInterval] = useState('1');   // every N days/weeks/months
  const [recurDays, setRecurDays] = useState([]);            // weekly: weekdays 0–6
  const [recurMonthMode, setRecurMonthMode] = useState('day'); // 'day' | 'weekday'
  const [recurDayOfMonth, setRecurDayOfMonth] = useState('1');  // month_mode 'day'
  const [recurNth, setRecurNth] = useState(1);               // month_mode 'weekday': 1–4 or -1
  const [recurWeekday, setRecurWeekday] = useState(0);       // month_mode 'weekday': 0–6
  const [recurStartDate, setRecurStartDate] = useState(localDateStr()); // cycle anchor
  const [recurEndMode, setRecurEndMode] = useState('never'); // 'never' | 'date' | 'count'
  const [recurEndDate, setRecurEndDate] = useState('');
  const [recurEndCount, setRecurEndCount] = useState('10');
  const [recurAnchor, setRecurAnchor] = useState('schedule'); // 'schedule' | 'completion'
  const [recurEscalate, setRecurEscalate] = useState(false);  // escalate priority if overdue
  const [recurEscalateDays, setRecurEscalateDays] = useState('3');
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
  const [preferredTime, setPreferredTime] = useState(null);
  const [habitWindow, setHabitWindow] = useState('morning');
  // Habit streak target: 'open' (no target, legacy 🔥), 'tally' (count over a
  // fixed window), or 'consecutive' (N in a row, resets on a miss).
  const [streakMode, setStreakMode] = useState('open');
  const [streakTargetDays, setStreakTargetDays] = useState('30');
  const [streakSuccess, setStreakSuccess] = useState('kept_mostly'); // 'kept' | 'kept_mostly'
  // What the task carried when editing, so we can keep the tally window anchor
  // stable unless the mode actually changes: { mode, started_at } | null.
  const [loadedStreak, setLoadedStreak] = useState(null);
  const [anchorMode, setAnchorMode] = useState('fixed'); // 'fixed' | 'nth_weekday'
  const [anchorNthRule, setAnchorNthRule] = useState({ n: 2, weekday: 0, month: 5 });
  const [dueReminders, setDueReminders] = useState([]); // [{id, amount, unit}]
  const [showAddReminderModal, setShowAddReminderModal] = useState(false);
  const [newReminderAmount, setNewReminderAmount] = useState('1');
  const [newReminderUnit, setNewReminderUnit] = useState('hours');
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showCatModal, setShowCatModal] = useState(false);
  const [showLocModal, setShowLocModal] = useState(false);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [showMonthModal, setShowMonthModal] = useState(false);

  useEffect(() => {
    setCategories(getAllCategories());
    setLocations(getAllLocations());
    if (editId) {
      const task = getTaskById(Number(editId));
      if (!task) return;
      setTaskType(task.task_type);
      setTitle(task.title);
      setNotes(task.notes ?? '');
      setCategoryId(task.category_id);
      setLocationId(task.location_id);
      setPriority(task.base_priority);
      setPriorityCeiling(task.priority_ceiling ?? 4);
      setAutoEscalateDays(String(task.auto_escalate_days ?? 14));
      setDueDate(task.due_date ?? '');
      setDueTime(task.due_time ?? '');
      setEscalateDays(String(task.escalate_days_out ?? 14));
      setEscalatePriority(task.escalate_to_priority ?? 3);
      setRecurPersistent(!!task.recur_persistent);
      setRecurAnchor(task.recur_anchor === 'completion' ? 'completion' : 'schedule');
      setRecurEscalate(task.recur_escalate_days != null);
      if (task.recur_escalate_days != null) setRecurEscalateDays(String(task.recur_escalate_days));
      setAutoHideAfterSkips(task.auto_hide_after_skips ? String(task.auto_hide_after_skips) : '');
      setRandMin(String(task.rand_min_days ?? 14));
      setRandMax(String(task.rand_max_days ?? 21));
      setRandPersistent(!!task.rand_persistent);
      setAnchorDate(task.anchor_date ?? '');
      setAnchorLabel(task.anchor_label ?? '');
      if (task.anchor_nth_rule) {
        setAnchorMode('nth_weekday');
        try { setAnchorNthRule(JSON.parse(task.anchor_nth_rule)); } catch {}
      } else {
        setAnchorMode('fixed');
      }
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
      setPreferredTime(task.preferred_time ?? null);
      setHabitWindow(task.habit_window ?? 'morning');
      setStreakMode(task.streak_target ? (task.streak_mode ?? 'consecutive') : 'open');
      if (task.streak_target) setStreakTargetDays(String(task.streak_target));
      setStreakSuccess(task.streak_success ?? 'kept_mostly');
      setLoadedStreak(task.streak_target
        ? { mode: task.streak_mode ?? 'consecutive', started_at: task.streak_started_at }
        : null);
      if (task.due_reminders) {
        try {
          const loaded = typeof task.due_reminders === 'string' ? JSON.parse(task.due_reminders) : task.due_reminders;
          setDueReminders(loaded.map((r, i) => ({ ...r, id: i + 1 })));
        } catch {}
      }
      if (task.recur_rule) {
        // normalizeRule upgrades legacy rule shapes to the canonical v2 form,
        // so editing an old recurring task loads cleanly into the new builder.
        const rule = normalizeRule(task.recur_rule);
        if (rule) {
          setRecurFreq(rule.freq);
          setRecurInterval(String(rule.interval));
          setRecurMonthMode(rule.month_mode);
          if (rule.freq === 'weekly') setRecurDays(rule.days ?? []);
          if (rule.day_of_month != null) setRecurDayOfMonth(String(rule.day_of_month));
          else if (rule.freq === 'monthly' && rule.days?.length) setRecurDayOfMonth(String(rule.days[0]));
          if (rule.nth != null) setRecurNth(rule.nth);
          if (rule.weekday != null) setRecurWeekday(rule.weekday);
          if (rule.start_date) setRecurStartDate(rule.start_date);
          if (rule.end?.type === 'date') { setRecurEndMode('date'); setRecurEndDate(rule.end.date); }
          else if (rule.end?.type === 'count') { setRecurEndMode('count'); setRecurEndCount(String(rule.end.count)); }
          else setRecurEndMode('never');
        }
      }
    }
  }, [editId]);

  const selectedType = TASK_TYPES.find(t => t.key === taskType);
  const selectedCategory = categories.find(c => c.id === categoryId);
  const selectedLocation = locations.find(l => l.id === locationId);

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

  const applyHolidayPreset = (preset) => {
    setAnchorLabel(preset.label);
    if (preset.anchor_date) {
      setAnchorMode('fixed');
      setAnchorDate(preset.anchor_date);
    } else {
      setAnchorMode('nth_weekday');
      setAnchorNthRule(preset.anchor_nth_rule);
    }
    setShowHolidayModal(false);
  };

  // Assemble the canonical v2 recurrence rule from builder state. Used for both
  // the live summary and Save, so the preview always matches what's stored.
  const buildRecurRule = () => {
    const interval = Math.max(1, Number(recurInterval) || 1);
    const rule = { v: 2, freq: recurFreq, interval, start_date: recurStartDate || localDateStr() };
    // Rolling ('from last completion') mode has no calendar pattern — the next
    // due date is just interval-after-completion — so weekday/month fields are
    // omitted. They only apply to a fixed schedule.
    if (recurAnchor !== 'completion') {
      if (recurFreq === 'weekly') {
        rule.days = recurDays;
      } else if (recurFreq === 'monthly') {
        rule.month_mode = recurMonthMode;
        if (recurMonthMode === 'day') rule.day_of_month = Number(recurDayOfMonth) || 1;
        else { rule.nth = recurNth; rule.weekday = recurWeekday; }
      }
    }
    if (recurEndMode === 'date' && recurEndDate) rule.end = { type: 'date', date: recurEndDate };
    else if (recurEndMode === 'count') rule.end = { type: 'count', count: Number(recurEndCount) || 1 };
    return rule;
  };

  // Human summary for the builder — anchor-aware, since describeRule only knows
  // the calendar pattern, not the rolling mode.
  const recurSummaryText = () => {
    if (recurAnchor === 'completion') {
      const n = Math.max(1, Number(recurInterval) || 1);
      const unit = recurFreq === 'weekly' ? 'week' : recurFreq === 'monthly' ? 'month' : 'day';
      let s = `Every ${n} ${unit}${n > 1 ? 's' : ''} after each completion`;
      if (recurEndMode === 'date' && recurEndDate) s += `, until ${recurEndDate}`;
      else if (recurEndMode === 'count') s += `, ${recurEndCount} times`;
      return s;
    }
    return describeRule(buildRecurRule());
  };

  // "Next: Jul 14, Jul 28, Aug 11" for fixed schedules. Rolling tasks have no
  // fixed future calendar (dates depend on when each is completed), so we show
  // the first due date and note that it rolls from completion.
  const recurPreviewText = () => {
    if (recurAnchor === 'completion') {
      const start = strToDate(recurStartDate) || new Date();
      return `First due ${formatShortDate(start)}, then repeats after each completion`;
    }
    const dates = upcomingOccurrences(buildRecurRule(), 3);
    if (!dates.length) return 'No upcoming dates — check the days / end condition';
    return `Next: ${dates.map(formatShortDate).join(', ')}`;
  };

  const handleSave = () => {
    if (taskType !== 'date_anchor' && !title.trim()) { Alert.alert('Missing Title', 'Please enter a task title.'); return; }

    let recurRule = null;
    if (taskType === 'recurring') {
      const fixedSchedule = recurAnchor !== 'completion';
      if (fixedSchedule && recurFreq === 'weekly' && !recurDays.length) {
        Alert.alert('Select Days', 'Choose at least one day of the week.'); return;
      }
      if (fixedSchedule && recurFreq === 'monthly' && recurMonthMode === 'day') {
        const dom = Number(recurDayOfMonth);
        if (!Number.isInteger(dom) || dom < 1 || dom > 31) {
          Alert.alert('Check the day', 'Enter a day of the month from 1 to 31.'); return;
        }
      }
      if (recurEscalate) {
        const ed = Number(recurEscalateDays);
        if (!Number.isInteger(ed) || ed < 1) {
          Alert.alert('Check escalation', 'Enter a whole number of days (1 or more) for how often priority steps up.'); return;
        }
      }
      if (recurEndMode === 'date') {
        if (!recurEndDate) { Alert.alert('Pick an end date', 'Choose when the repeat should stop, or set Ends to Never.'); return; }
        if (recurEndDate < (recurStartDate || localDateStr())) {
          Alert.alert('Check the dates', 'The end date can’t be before the start date.'); return;
        }
      }
      if (recurEndMode === 'count') {
        const c = Number(recurEndCount);
        if (!Number.isInteger(c) || c < 1) { Alert.alert('Check the count', 'Enter how many times it should repeat (1 or more).'); return; }
      }
      recurRule = JSON.stringify(buildRecurRule());
    }

    // Validate the randomized day range before it reaches advanceRandomizedTask —
    // blank/non-numeric/negative values otherwise produce an Invalid Date that
    // throws on toISOString(), making Save silently fail.
    if (taskType === 'randomized') {
      const min = Number(randMin);
      const max = Number(randMax);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < 1) {
        Alert.alert('Check the day range', 'Enter whole numbers of days (1 or more) for both the minimum and maximum.');
        return;
      }
      if (min > max) {
        Alert.alert('Check the day range', 'The minimum days can’t be greater than the maximum.');
        return;
      }
    }

    const randNextDate = taskType === 'randomized'
      ? advanceRandomizedTask({ rand_min_days: Number(randMin), rand_max_days: Number(randMax) })
      : null;

    // Habit streak target: validate the day count and resolve the window anchor.
    const hasStreakTarget = taskType === 'habit' && streakMode !== 'open';
    if (hasStreakTarget) {
      const days = Number(streakTargetDays);
      if (!Number.isInteger(days) || days < 1) {
        Alert.alert('Check the target', 'Enter a whole number of days (1 or more) for the streak goal.');
        return;
      }
    }
    // Anchor the tally window to when the target was set. Keep the existing
    // anchor when editing without changing the mode; otherwise start today so an
    // old habit doesn't begin mid-window (consecutive ignores this field).
    const now = new Date();
    const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const streakStart = hasStreakTarget
      ? (loadedStreak && loadedStreak.mode === streakMode && loadedStreak.started_at
          ? loadedStreak.started_at
          : localToday)
      : null;

    const taskData = {
      title: title.trim(),
      notes: notes.trim() || null,
      category_id: categoryId,
      location_id: locationId,
      task_type: taskType,
      base_priority: taskType === 'habit' ? 2 : priority,
      priority_ceiling:
        ((taskType === 'unscheduled' || taskType === 'timed_goal') && Number(autoEscalateDays) > 0)
        || (taskType === 'recurring' && recurEscalate)
          ? priorityCeiling : 4,
      auto_escalate_days: (taskType === 'unscheduled' || taskType === 'timed_goal') ? (Number(autoEscalateDays) || 0) : 0,
      due_date: taskType === 'deadline' ? dueDate || null : null,
      due_time: taskType === 'deadline' ? dueTime || null : null,
      due_reminders: taskType === 'deadline' && dueReminders.length
        ? dueReminders.map(({ amount, unit }) => ({ amount: Number(amount), unit }))
        : null,
      escalate_days_out: taskType === 'deadline' ? Number(escalateDays) : 0,
      escalate_to_priority: taskType === 'deadline' && Number(escalateDays) > 0 ? escalatePriority : null,
      recur_rule: recurRule,
      recur_persistent: recurPersistent,
      recur_anchor: taskType === 'recurring' ? recurAnchor : null,
      recur_escalate_days: taskType === 'recurring' && recurEscalate ? Number(recurEscalateDays) : null,
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
      preferred_time: preferredTime ?? null,
      habit_window: taskType === 'habit' ? habitWindow : null,
      streak_target:     hasStreakTarget ? Number(streakTargetDays) : null,
      streak_mode:       hasStreakTarget ? streakMode : null,
      streak_success:    hasStreakTarget ? streakSuccess : null,
      streak_started_at: streakStart,
    };

    if (taskType === 'date_anchor') {
      if (anchorMode === 'fixed' && !anchorDate) {
        Alert.alert('Missing Date', 'Please pick an annual date.'); return;
      }
      if (anchorMode === 'nth_weekday' && !anchorNthRule.month) {
        Alert.alert('Incomplete', 'Please select a month for the date rule.'); return;
      }
      const validActions = anchorActions.filter(a => a.description.trim());
      if (!validActions.length) { Alert.alert('Missing Action', 'Add at least one action for this date.'); return; }

      const anchorDateVal  = anchorMode === 'fixed'       ? anchorDate                       : null;
      const anchorNthVal   = anchorMode === 'nth_weekday' ? JSON.stringify(anchorNthRule)     : null;
      const anchorLabelVal = anchorLabel || (anchorMode === 'fixed' ? anchorDate : 'Event');

      if (isEditing) {
        const action = validActions[0];
        updateTask(Number(editId), {
          ...taskData,
          title: action.description.trim(),
          task_type: 'date_anchor',
          base_priority: action.priority,
          priority_ceiling: action.priority,
          anchor_date: anchorDateVal,
          anchor_nth_rule: anchorNthVal,
          anchor_label: anchorLabelVal,
          escalate_days_out: leadToDays(action.leadAmount, action.leadUnit),
        });
        // If this was previously a deadline, clear its scheduled alarms — a
        // date_anchor doesn't use them, and they'd otherwise keep firing.
        cancelAllForTask(Number(editId)).catch(() => {});
      } else {
        for (const action of validActions) {
          createTask({
            ...taskData,
            title: action.description.trim(),
            task_type: 'date_anchor',
            base_priority: action.priority,
            priority_ceiling: action.priority,
            anchor_date: anchorDateVal,
            anchor_nth_rule: anchorNthVal,
            anchor_label: anchorLabelVal,
            escalate_days_out: leadToDays(action.leadAmount, action.leadUnit),
          });
        }
      }
    } else if (isEditing) {
      updateTask(Number(editId), taskData);
      if (taskType === 'deadline') {
        // scheduleDeadlineReminders cancels existing alarms before rescheduling.
        scheduleDeadlineReminders({ id: Number(editId), ...taskData }).catch(() => {});
      } else {
        // Type changed away from deadline — clear any orphaned alarms left behind.
        cancelAllForTask(Number(editId)).catch(() => {});
      }
    } else {
      const newId = createTask(taskData);
      if (taskType === 'deadline') {
        scheduleDeadlineReminders({ id: newId, ...taskData }).catch(() => {});
      }
    }
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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

      <Text style={styles.label}>Location</Text>
      <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowLocModal(true)}>
        <Text style={styles.pickerBtnTitle}>{selectedLocation?.name ?? 'Anywhere'}</Text>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      {taskType !== 'date_anchor' && taskType !== 'habit' && (
        <>
          <Text style={styles.label}>Base Priority</Text>
          <PriorityRow value={priority} onChange={setPriority} options={[1,2,3,4]} />
        </>
      )}

      {/* Unscheduled / Timed Goal: auto-escalation + ceiling */}
      {(taskType === 'unscheduled' || taskType === 'timed_goal') && (
        <>
          <Text style={styles.label}>Auto-escalate every N days</Text>
          <Text style={styles.sublabel}>Priority climbs by 1 step every N days if untouched. 0 = off.</Text>
          <TextInput style={styles.input} value={autoEscalateDays} onChangeText={setAutoEscalateDays} keyboardType="numeric" placeholder="14" placeholderTextColor="#aaa" />
          {Number(autoEscalateDays) > 0 && (
            <>
              <Text style={styles.label}>Priority Ceiling</Text>
              <Text style={styles.sublabel}>Auto-escalation will never exceed this level.</Text>
              <PriorityRow value={priorityCeiling} onChange={setPriorityCeiling} options={[1,2,3,4]} />
            </>
          )}
          {taskType === 'unscheduled' && (
            <TimeOfDayField value={preferredTime} onChange={setPreferredTime} />
          )}
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

          {/* ── Due Reminders ── */}
          <Text style={[styles.label, !dueTime && { color: '#bbb' }]}>Due Reminders</Text>
          {!dueTime ? (
            <Text style={styles.sublabel}>Set a due time to enable advance reminders.</Text>
          ) : (
            <>
              {dueReminders.map(r => {
                const offsetMs = r.unit === 'days' ? r.amount * 86400000
                               : r.unit === 'hours' ? r.amount * 3600000
                               : r.amount * 60000;
                const isPast = dueDate && dueTime && (() => {
                  const [dy, dm, dd] = dueDate.split('-').map(Number);
                  const [dh, dmin] = dueTime.split(':').map(Number);
                  return new Date(dy, dm - 1, dd, dh, dmin).getTime() - offsetMs <= Date.now();
                })();
                return (
                  <View key={r.id} style={styles.reminderRow}>
                    <Text style={styles.reminderLabel}>
                      {isPast ? '⚠️ ' : ''}{r.amount} {r.unit} before
                    </Text>
                    {isPast && <Text style={styles.reminderWarn}>Alert already passed</Text>}
                    <TouchableOpacity onPress={() => setDueReminders(prev => prev.filter(x => x.id !== r.id))}>
                      <Text style={styles.reminderRemove}>✕</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
              <TouchableOpacity style={styles.addReminderBtn} onPress={() => setShowAddReminderModal(true)}>
                <Text style={styles.addReminderText}>+ Add Reminder</Text>
              </TouchableOpacity>
              <Text style={styles.sublabel}>
                {'Critical priority tasks also receive overdue alerts every 30 minutes after the due time until marked complete.'}
              </Text>
            </>
          )}

          <Text style={styles.label}>Escalate priority when within N days</Text>
          <Text style={styles.sublabel}>Priority bumps up automatically as the deadline approaches. 0 = off.</Text>
          <TextInput style={styles.input} value={escalateDays} onChangeText={setEscalateDays} keyboardType="numeric" placeholder="0" placeholderTextColor="#aaa" />
          {Number(escalateDays) > 0 && (
            <>
              <Text style={styles.label}>Escalate to priority</Text>
              <PriorityRow value={escalatePriority} onChange={setEscalatePriority} options={[2,3,4]} />
            </>
          )}
          {dueTime ? (
            <>
              <Text style={styles.label}>Time of Day</Text>
              <Text style={styles.sublabel}>Set automatically from the due time ({dueTime}). Clear the due time to choose a window manually.</Text>
            </>
          ) : (
            <TimeOfDayField value={preferredTime} onChange={setPreferredTime} />
          )}
        </>
      )}

      {/* ── Recurring ── */}
      {taskType === 'recurring' && (
        <>
          <Text style={styles.label}>Repeat</Text>
          <View style={styles.segmentRow}>
            {['daily','weekly','monthly'].map(f => (
              <TouchableOpacity key={f} style={[styles.segBtn, recurFreq === f && styles.segBtnActive]} onPress={() => setRecurFreq(f)}>
                <Text style={[styles.segText, recurFreq === f && styles.segTextActive]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Schedule anchor</Text>
          <View style={styles.segmentRow}>
            {[{ key: 'schedule', label: 'Fixed schedule' }, { key: 'completion', label: 'From last done' }].map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.segBtn, recurAnchor === opt.key && styles.segBtnActive]}
                onPress={() => setRecurAnchor(opt.key)}
              >
                <Text style={[styles.segText, recurAnchor === opt.key && styles.segTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.sublabel}>
            {recurAnchor === 'completion'
              ? 'Next due date is counted from when you last completed it (e.g. feed the snake 7 days after the last feeding).'
              : 'Repeats on fixed calendar days, whether or not you did the last one.'}
          </Text>

          <Text style={styles.label}>Every</Text>
          <View style={styles.intervalRow}>
            <TextInput
              style={[styles.input, styles.intervalInput]}
              value={recurInterval}
              onChangeText={setRecurInterval}
              keyboardType="numeric"
              placeholder="1"
              placeholderTextColor="#aaa"
            />
            <Text style={styles.intervalUnit}>
              {recurFreq === 'daily' ? 'day(s)' : recurFreq === 'weekly' ? 'week(s)' : 'month(s)'}
            </Text>
          </View>

          {recurAnchor === 'schedule' && recurFreq === 'weekly' && (
            <>
              <Text style={styles.label}>On these days</Text>
              <View style={styles.dowRow}>
                {DOW_LABELS.map((d, i) => (
                  <TouchableOpacity key={i} style={[styles.dowBtn, recurDays.includes(i) && styles.dowBtnActive]} onPress={() => toggleRecurDay(i)}>
                    <Text style={[styles.dowText, recurDays.includes(i) && styles.dowTextActive]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {recurAnchor === 'schedule' && recurFreq === 'monthly' && (
            <>
              <Text style={styles.label}>On</Text>
              <View style={styles.segmentRow}>
                {[{ key: 'day', label: 'Day of month' }, { key: 'weekday', label: 'A weekday' }].map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.segBtn, recurMonthMode === opt.key && styles.segBtnActive]}
                    onPress={() => setRecurMonthMode(opt.key)}
                  >
                    <Text style={[styles.segText, recurMonthMode === opt.key && styles.segTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {recurMonthMode === 'day' ? (
                <>
                  <Text style={styles.label}>Day of month (1–31)</Text>
                  <TextInput style={styles.input} value={recurDayOfMonth} onChangeText={setRecurDayOfMonth} keyboardType="numeric" placeholder="1" placeholderTextColor="#aaa" />
                </>
              ) : (
                <>
                  <Text style={styles.label}>Which</Text>
                  <View style={styles.segmentRow}>
                    {[{ label: '1st', n: 1 }, { label: '2nd', n: 2 }, { label: '3rd', n: 3 }, { label: '4th', n: 4 }, { label: 'Last', n: -1 }].map(opt => (
                      <TouchableOpacity
                        key={opt.n}
                        style={[styles.segBtn, recurNth === opt.n && styles.segBtnActive]}
                        onPress={() => setRecurNth(opt.n)}
                      >
                        <Text style={[styles.segText, recurNth === opt.n && styles.segTextActive]}>{opt.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.label}>Day of Week</Text>
                  <View style={styles.dowRow}>
                    {DOW_LABELS.map((d, i) => (
                      <TouchableOpacity
                        key={i}
                        style={[styles.dowBtn, recurWeekday === i && styles.dowBtnActive]}
                        onPress={() => setRecurWeekday(i)}
                      >
                        <Text style={[styles.dowText, recurWeekday === i && styles.dowTextActive]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </>
          )}

          <DatePickerField
            label="Starts"
            value={strToDate(recurStartDate)}
            onChange={d => setRecurStartDate(dateToStr(d))}
            placeholder="Pick a start date"
          />

          <Text style={styles.label}>Ends</Text>
          <View style={styles.segmentRow}>
            {[{ key: 'never', label: 'Never' }, { key: 'date', label: 'On date' }, { key: 'count', label: 'After N' }].map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.segBtn, recurEndMode === opt.key && styles.segBtnActive]}
                onPress={() => setRecurEndMode(opt.key)}
              >
                <Text style={[styles.segText, recurEndMode === opt.key && styles.segTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {recurEndMode === 'date' && (
            <DatePickerField
              label="End date"
              value={strToDate(recurEndDate)}
              onChange={d => setRecurEndDate(dateToStr(d))}
              placeholder="Pick an end date"
            />
          )}
          {recurEndMode === 'count' && (
            <View style={styles.intervalRow}>
              <Text style={styles.intervalUnit}>After</Text>
              <TextInput
                style={[styles.input, styles.intervalInput]}
                value={recurEndCount}
                onChangeText={setRecurEndCount}
                keyboardType="numeric"
                placeholder="10"
                placeholderTextColor="#aaa"
              />
              <Text style={styles.intervalUnit}>times</Text>
            </View>
          )}

          <Text style={styles.recurSummary}>{recurSummaryText()}</Text>
          <Text style={styles.recurPreview}>{recurPreviewText()}</Text>

          <SwitchRow
            label="Persist if missed"
            desc="Stays on the list if you miss the scheduled day (e.g. snake feeding)"
            value={recurPersistent}
            onChange={setRecurPersistent}
          />
          <SwitchRow
            label="Escalate priority if overdue"
            desc="Steps priority up a level for every N days it sits unfinished, then resets on the next occurrence. Needs 'Persist if missed' on."
            value={recurEscalate}
            onChange={setRecurEscalate}
          />
          {recurEscalate && (
            <>
              {!recurPersistent && (
                <Text style={[styles.sublabel, { color: '#c0392b' }]}>
                  Turn on “Persist if missed” too — otherwise a missed occurrence disappears before it can escalate.
                </Text>
              )}
              <Text style={styles.label}>Escalate every</Text>
              <View style={styles.intervalRow}>
                <TextInput
                  style={[styles.input, styles.intervalInput]}
                  value={recurEscalateDays}
                  onChangeText={setRecurEscalateDays}
                  keyboardType="numeric"
                  placeholder="3"
                  placeholderTextColor="#aaa"
                />
                <Text style={styles.intervalUnit}>day(s) overdue</Text>
              </View>
              <Text style={styles.label}>Ceiling (max priority)</Text>
              <PriorityRow value={priorityCeiling} onChange={setPriorityCeiling} options={[2,3,4]} />
            </>
          )}
          <Text style={styles.label}>Auto-hide after N skips (optional)</Text>
          <Text style={styles.sublabel}>If skipped this many times in a row, steps back until next occurrence. Leave blank to always show.</Text>
          <TextInput style={styles.input} value={autoHideAfterSkips} onChangeText={setAutoHideAfterSkips} keyboardType="numeric" placeholder="e.g. 3" placeholderTextColor="#aaa" />
          <TimeOfDayField value={preferredTime} onChange={setPreferredTime} />

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
          <TimeOfDayField value={preferredTime} onChange={setPreferredTime} />
        </>
      )}

      {/* ── Date Anchor ── */}
      {taskType === 'date_anchor' && (
        <>
          {/* Holiday preset picker */}
          <Text style={styles.label}>Holiday Preset</Text>
          <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowHolidayModal(true)}>
            <Text style={[styles.pickerBtnTitle, !anchorLabel && { color: '#aaa' }]}>
              {anchorLabel || 'Choose a holiday…'}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <Text style={styles.sublabel}>Or set a custom date below.</Text>

          {/* Date type toggle */}
          <Text style={styles.label}>Date Type</Text>
          <View style={styles.segmentRow}>
            {[
              { key: 'fixed',       label: 'Fixed (MM/DD)'  },
              { key: 'nth_weekday', label: 'Nth Weekday' },
            ].map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.segBtn, anchorMode === opt.key && styles.segBtnActive]}
                onPress={() => setAnchorMode(opt.key)}
              >
                <Text style={[styles.segText, anchorMode === opt.key && styles.segTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {anchorMode === 'fixed' ? (
            <DatePickerField
              label="Annual Date"
              value={monthDayToDate(anchorDate)}
              onChange={d => setAnchorDate(dateToMonthDay(d))}
              placeholder="Pick a date (year ignored)"
              monthDayOnly
            />
          ) : (
            <>
              <Text style={styles.label}>Ordinal</Text>
              <View style={styles.segmentRow}>
                {[{label:'1st',n:1},{label:'2nd',n:2},{label:'3rd',n:3},{label:'4th',n:4},{label:'Last',n:-1}].map(opt => (
                  <TouchableOpacity
                    key={opt.n}
                    style={[styles.segBtn, anchorNthRule.n === opt.n && styles.segBtnActive]}
                    onPress={() => setAnchorNthRule(r => ({ ...r, n: opt.n }))}
                  >
                    <Text style={[styles.segText, anchorNthRule.n === opt.n && styles.segTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Day of Week</Text>
              <View style={styles.dowRow}>
                {DOW_LABELS.map((d, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.dowBtn, anchorNthRule.weekday === i && styles.dowBtnActive]}
                    onPress={() => setAnchorNthRule(r => ({ ...r, weekday: i }))}
                  >
                    <Text style={[styles.dowText, anchorNthRule.weekday === i && styles.dowTextActive]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Month</Text>
              <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowMonthModal(true)}>
                <Text style={styles.pickerBtnTitle}>{MONTHS[(anchorNthRule.month ?? 1) - 1]}</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            </>
          )}

          <Text style={styles.label}>Event Label</Text>
          <TextInput style={styles.input} value={anchorLabel} onChangeText={setAnchorLabel} placeholder="e.g. Mother's Day, Jim's Birthday" placeholderTextColor="#aaa" />

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

      {/* ── Habit ── */}
      {taskType === 'habit' && (
        <>
          <Text style={styles.label}>Check-in Window</Text>
          <Text style={styles.sublabel}>When does this habit apply? You'll see it in this window each day.</Text>
          <View style={styles.segmentRow}>
            {[
              { key: 'morning',   label: 'Morning',   sub: 'before 10 AM' },
              { key: 'afternoon', label: 'Afternoon', sub: '12–5 PM'      },
              { key: 'evening',   label: 'Evening',   sub: 'after 5 PM'   },
            ].map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.segBtn, habitWindow === opt.key && styles.segBtnActive]}
                onPress={() => setHabitWindow(opt.key)}
              >
                <Text style={[styles.segText, habitWindow === opt.key && styles.segTextActive]}>
                  {opt.label}
                </Text>
                <Text style={[styles.segSubText, habitWindow === opt.key && styles.segTextActive]}>
                  {opt.sub}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.sublabel, { marginTop: 12 }]}>
            Each day you'll get three options: Kept it, Mostly, or Didn't.
          </Text>

          <Text style={[styles.label, { marginTop: 16 }]}>Streak Goal</Text>
          <Text style={styles.sublabel}>Set a target to work toward, or keep it open-ended.</Text>
          {[
            { key: 'open',        title: 'Open-ended',       desc: 'No target — just track your 🔥 streak as it grows.' },
            { key: 'tally',       title: 'Tally over N days', desc: 'Count successes over a fixed window (e.g. 18 of 30 days). A miss doesn’t reset it.' },
            { key: 'consecutive', title: 'N days in a row',   desc: 'Build a run of successes. A miss starts you back at zero.' },
          ].map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.modalOption, streakMode === opt.key && styles.modalOptionSelected]}
              onPress={() => setStreakMode(opt.key)}
            >
              <Text style={styles.modalOptTitle}>{opt.title}</Text>
              <Text style={styles.modalOptDesc}>{opt.desc}</Text>
            </TouchableOpacity>
          ))}

          {streakMode !== 'open' && (
            <>
              <Text style={styles.label}>Target (days)</Text>
              <Text style={styles.sublabel}>
                {streakMode === 'tally'
                  ? 'How long the window runs. The card shows successes over days elapsed.'
                  : 'How many successes in a row to finish the goal.'}
              </Text>
              <TextInput
                style={styles.input}
                value={streakTargetDays}
                onChangeText={setStreakTargetDays}
                keyboardType="numeric"
                placeholder="30"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.label}>What counts as success?</Text>
              <View style={styles.segmentRow}>
                {[
                  { key: 'kept',        label: 'Kept it only' },
                  { key: 'kept_mostly', label: 'Kept it + Mostly' },
                ].map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.segBtn, streakSuccess === opt.key && styles.segBtnActive]}
                    onPress={() => setStreakSuccess(opt.key)}
                  >
                    <Text style={[styles.segText, streakSuccess === opt.key && styles.segTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
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

      {/* Holiday preset modal */}
      <Modal visible={showHolidayModal} transparent animationType="slide" onRequestClose={() => setShowHolidayModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>Holiday Presets</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {HOLIDAY_PRESETS.map(preset => (
                <TouchableOpacity
                  key={preset.label}
                  style={[styles.modalOption, anchorLabel === preset.label && styles.modalOptionSelected]}
                  onPress={() => applyHolidayPreset(preset)}
                >
                  <Text style={styles.modalOptTitle}>{preset.label}</Text>
                  <Text style={styles.modalOptDesc}>
                    {preset.anchor_date
                      ? MONTHS[Number(preset.anchor_date.split('-')[0]) - 1] + ' ' + Number(preset.anchor_date.split('-')[1])
                      : (() => { const r = preset.anchor_nth_rule; return `${['Last','1st','2nd','3rd','4th'][r.n === -1 ? 0 : r.n]} ${DOW_LABELS[r.weekday]} of ${MONTHS[r.month - 1]}`; })()
                    }
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowHolidayModal(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Month picker modal */}
      <Modal visible={showMonthModal} transparent animationType="slide" onRequestClose={() => setShowMonthModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>Month</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {MONTHS.map((m, i) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modalOption, anchorNthRule.month === i + 1 && styles.modalOptionSelected]}
                  onPress={() => { setAnchorNthRule(r => ({ ...r, month: i + 1 })); setShowMonthModal(false); }}
                >
                  <Text style={styles.modalOptTitle}>{m}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowMonthModal(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add Reminder modal */}
      <Modal visible={showAddReminderModal} transparent animationType="slide" onRequestClose={() => setShowAddReminderModal(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Add Reminder</Text>
            <Text style={styles.label}>Amount</Text>
            <TextInput
              style={styles.input}
              value={newReminderAmount}
              onChangeText={setNewReminderAmount}
              keyboardType="numeric"
              placeholder="e.g. 30"
              placeholderTextColor="#aaa"
            />
            <Text style={styles.label}>Unit</Text>
            <View style={styles.segmentRow}>
              {['minutes','hours','days'].map(u => (
                <TouchableOpacity
                  key={u}
                  style={[styles.segBtn, newReminderUnit === u && styles.segBtnActive]}
                  onPress={() => setNewReminderUnit(u)}
                >
                  <Text style={[styles.segText, newReminderUnit === u && styles.segTextActive]}>
                    {u.charAt(0).toUpperCase() + u.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.modalOption, styles.modalOptionSelected, { marginTop: 12 }]}
              onPress={() => {
                const amt = Number(newReminderAmount);
                if (!amt || amt <= 0) { Alert.alert('Invalid', 'Enter a positive number.'); return; }
                setDueReminders(prev => [...prev, { id: Date.now(), amount: amt, unit: newReminderUnit }]);
                setNewReminderAmount('1');
                setNewReminderUnit('hours');
                setShowAddReminderModal(false);
              }}
            >
              <Text style={[styles.modalOptTitle, { textAlign: 'center', color: COLORS.primary }]}>Add</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowAddReminderModal(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          </KeyboardAvoidingView>
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

      {/* Location modal — deliberately identical to the Category modal above; the
          two axes are independent but should feel like the same kind of control. */}
      <Modal visible={showLocModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Location</Text>
            <TouchableOpacity style={[styles.modalOption, !locationId && styles.modalOptionSelected]} onPress={() => { setLocationId(null); setShowLocModal(false); }}>
              <Text style={styles.modalOptTitle}>Anywhere</Text>
            </TouchableOpacity>
            {locations.map(l => (
              <TouchableOpacity key={l.id} style={[styles.modalOption, locationId === l.id && styles.modalOptionSelected]} onPress={() => { setLocationId(l.id); setShowLocModal(false); }}>
                <View style={[styles.catDot, { backgroundColor: l.color }]} />
                <Text style={styles.modalOptTitle}>{l.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowLocModal(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const TIME_OF_DAY_OPTIONS = [
  { key: null,        label: 'Any time'  },
  { key: 'morning',   label: 'Morning'   },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening',   label: 'Evening'   },
];

// Time-of-day picker shared by every schedulable type (To-Do, Recurring,
// Randomized, and Deadlines without a due time). "Any time" (null) sorts with
// the afternoon band — see src/engine/bands.js. A Deadline with a due time does
// not render this: the due time already determines its band, so the two can't
// be set into conflict from the form.
function TimeOfDayField({ value, onChange }) {
  return (
    <>
      <Text style={styles.label}>Time of Day (optional)</Text>
      <Text style={styles.sublabel}>Groups this task into its morning, afternoon, or evening band on the Today list.</Text>
      <View style={styles.segmentRow}>
        {TIME_OF_DAY_OPTIONS.map(opt => (
          <TouchableOpacity
            key={String(opt.key)}
            style={[styles.segBtn, value === opt.key && styles.segBtnActive]}
            onPress={() => onChange(opt.key)}
          >
            <Text style={[styles.segText, value === opt.key && styles.segTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
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
  segSubText: { fontSize: 10, color: COLORS.subtext, marginTop: 2 },
  segTextActive: { color: '#fff' },
  dowRow: { flexDirection: 'row', gap: 4 },
  dowBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', backgroundColor: '#fff' },
  dowBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dowText: { fontSize: 11, fontWeight: '600', color: COLORS.subtext },
  dowTextActive: { color: '#fff' },
  leadTimeRow: { gap: 8 },
  leadTimeInput: { marginBottom: 8 },
  leadUnitRow: { flexDirection: 'row', gap: 8 },
  intervalRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  intervalInput: { width: 80, textAlign: 'center' },
  intervalUnit: { fontSize: 16, color: COLORS.text },
  recurSummary: {
    marginTop: 16, padding: 12, borderRadius: 10,
    backgroundColor: '#eaf2fb', color: COLORS.text,
    borderWidth: 1, borderColor: COLORS.primary,
    fontSize: 14, fontWeight: '600', fontStyle: 'italic',
  },
  recurPreview: { marginTop: 6, fontSize: 13, color: COLORS.subtext, fontWeight: '500' },
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
  reminderRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 6, borderWidth: 1, borderColor: COLORS.border,
  },
  reminderLabel: { flex: 1, fontSize: 15, color: COLORS.text, fontWeight: '500' },
  reminderWarn: { fontSize: 11, color: '#e67e22', marginRight: 8 },
  reminderRemove: { fontSize: 16, color: '#e74c3c', fontWeight: '700', paddingHorizontal: 4 },
  addReminderBtn: {
    borderWidth: 1, borderColor: COLORS.primary, borderStyle: 'dashed',
    borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 6,
  },
  addReminderText: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
});
