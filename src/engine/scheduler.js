/**
 * Task scheduler engine — two-factor sort (urgency + importance),
 * auto-escalation, auto-hide stale recurring tasks, backlog grouping.
 */

import { getAllTasks, getLastCompletion, updateTask, getTodayCompletedTasks } from '../db/tasks';
import { getTodayHabitCheckin, getHabitStreak } from '../db/habits';
import { localDateStr, localDateTimeStr, parseLocalDateTime, parseLocalDay } from '../utils/date';
import { isDue, nextOccurrence, currentOccurrence, addByFreq, normalizeRule, nthWeekdayOfMonth } from './recurrence';
import { getBands, compareByBand, minutesOfDay } from './bands';

const TODAY = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const toDate = (str) => {
  if (!str) return null;
  // Date-only strings (YYYY-MM-DD) are parsed as UTC midnight by JS, but we
  // need local midnight so day comparisons align with the user's timezone.
  // Splitting manually avoids the UTC-vs-local ambiguity entirely.
  const parts = str.slice(0, 10).split('-').map(Number);
  if (parts.length === 3) {
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return isNaN(d) ? null : d;
  }
  // Fall back for full datetime strings (e.g. completed_at)
  const d = new Date(str);
  d.setHours(0, 0, 0, 0);
  return isNaN(d) ? null : d;
};

const daysBetween = (a, b) => Math.round((b - a) / 86400000);

// ─── Urgency score (time pressure) ───────────────────────────────────────────
function computeUrgencyScore(task, today, overdueDays, daysUntilDue) {
  // Time-specific task today
  if (task.due_time && daysUntilDue === 0) {
    const [h, m] = task.due_time.split(':').map(Number);
    const now = new Date();
    const hoursUntil = (h * 60 + m - (now.getHours() * 60 + now.getMinutes())) / 60;
    if (hoursUntil <= 0) return 600; // past the time, highest urgency
    if (hoursUntil <= 2) return 500;
    return 400;
  }
  if (overdueDays > 0) return 200 + Math.min(overdueDays * 15, 150);
  if (daysUntilDue === 0) return 150;
  if (daysUntilDue <= 2) return 75;
  if (daysUntilDue <= 7) return 25;
  return 0;
}

// Standing intra-day ramp for a timed deadline: how close (in minutes) the due
// time is forces what *minimum* priority. This is the "escape hatch" the design
// settled on — but expressed as priority, not a separate sort overlay, so it
// simply moves the task up bands as its clock nears. Past due (minsUntil <= 0)
// and within the hour both floor at Critical; within two hours, High. Applied
// with Math.max so it only ever raises.
function timedRampFloor(minsUntil) {
  if (minsUntil <= 60) return 4;   // 1h out, or already past the time -> Critical
  if (minsUntil <= 120) return 3;  // 2h out -> High
  return 0;                        // further out -> no floor
}

// ─── Importance score (user priority, possibly auto-escalated) ────────────────
const IMPORTANCE = { 4: 300, 3: 200, 2: 100, 1: 50 };

function computeAutoEscalatedPriority(task, today, lastCompletion) {
  if (task.task_type !== 'unscheduled' && task.task_type !== 'timed_goal') {
    return task.base_priority;
  }
  const escalateDays = task.auto_escalate_days ?? 14;
  if (!escalateDays) return task.base_priority;

  const refDate = lastCompletion
    ? toDate(lastCompletion.completed_at)
    : toDate(task.created_at);
  if (!refDate) return task.base_priority;

  const daysSince = daysBetween(refDate, today);
  const steps = Math.floor(daysSince / escalateDays);
  const ceiling = task.priority_ceiling ?? 4;
  return Math.min(task.base_priority + steps, ceiling);
}

// ─── Recurring helpers ────────────────────────────────────────────────────────
// All recurrence math now lives in ./recurrence (canonical rule engine, handles
// v2 rules + legacy shapes). These thin wrappers adapt it to the scheduler's
// task/date vocabulary.
function isRecurringDueToday(task, today) {
  if (!task.recur_rule) return false;
  return isDue(task.recur_rule, today);
}

/**
 * Resolve where a recurring task stands *right now*, for either anchoring mode:
 *   { occ, overdueDays, pending }
 *     occ         — the date of the occurrence the task is currently sitting in
 *     overdueDays — days since that occurrence (0 on the occurrence day itself)
 *     pending     — whether it's actionable now (not satisfied, not pre-creation)
 *
 * 'schedule' (fixed calendar): occ = the most recent occurrence ≤ today, so a
 *   brand-new occurrence resets overdueDays to 0 even if the last one was never
 *   done — which is what makes per-occurrence escalation reset each cycle.
 * 'completion' (rolling): the due date is `interval` after the last completion
 *   (or the start/creation date before the first completion).
 */
function computeRecurringWindow(task, today, lastCompletion) {
  const createdDate = toDate(task.created_at) ?? today;
  const lastDone = lastCompletion ? toDate(lastCompletion.completed_at) : null;

  if (task.recur_anchor === 'completion') {
    const rule = normalizeRule(task.recur_rule) ?? { freq: 'daily', interval: 1 };
    const start = rule.start_date ? toDate(rule.start_date) : createdDate;
    const due = lastDone
      ? addByFreq(lastDone, rule.freq || 'daily', rule.interval || 1)
      : (start ?? createdDate);
    if (!due) return { occ: null, overdueDays: 0, pending: false };
    return { occ: due, overdueDays: Math.max(0, daysBetween(due, today)), pending: today >= due };
  }

  // Fixed calendar schedule.
  const occ = currentOccurrence(task.recur_rule, today);
  if (!occ || occ < createdDate) return { occ: null, overdueDays: 0, pending: false };
  // Completed on/after this occurrence → satisfied for this cycle.
  if (lastDone && lastDone >= occ) return { occ, overdueDays: 0, pending: false };
  return { occ, overdueDays: daysBetween(occ, today), pending: true };
}

// The next date (after `today`, at local midnight) on which a recurring task is
// due. Used by skipTask to hide a skipped occurrence until the next one.
// Rolling tasks have no fixed calendar, so a skip pushes out by one interval.
function computeNextRecurrence(task, today) {
  if (task.recur_anchor === 'completion') {
    const rule = normalizeRule(task.recur_rule) ?? { freq: 'daily', interval: 1 };
    return addByFreq(today, rule.freq || 'daily', rule.interval || 1);
  }
  return nextOccurrence(task.recur_rule, today);
}

function wasCompletedToday(lastCompletion, today) {
  if (!lastCompletion) return false;
  // completed_at is stored as UTC ('YYYY-MM-DD HH:MM:SS'). Parse it as UTC
  // by normalising to ISO format before constructing the Date, then compare
  // against local-day boundaries so evening completions aren't missed.
  const completedAt = new Date(lastCompletion.completed_at.replace(' ', 'T') + 'Z');
  const startOfTomorrow = new Date(today.getTime() + 86400000);
  return completedAt >= today && completedAt < startOfTomorrow;
}

// nthWeekdayOfMonth is imported from ./recurrence (single source of truth for
// this math, shared with the recurring-task engine).

function computeAnchorNextDate(task, today) {
  // Floating holiday: nth weekday of a given month
  if (task.anchor_nth_rule) {
    let rule;
    try { rule = typeof task.anchor_nth_rule === 'string' ? JSON.parse(task.anchor_nth_rule) : task.anchor_nth_rule; } catch { return null; }
    const year = today.getFullYear();
    let candidate = nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.n);
    if (candidate < today) candidate = nthWeekdayOfMonth(year + 1, rule.month, rule.weekday, rule.n);
    return candidate;
  }
  // Fixed MM-DD anchor
  if (!task.anchor_date) return null;
  const [month, day] = task.anchor_date.split('-').map(Number);
  const year = today.getFullYear();
  let candidate = new Date(year, month - 1, day);
  candidate.setHours(0, 0, 0, 0);
  if (candidate < today) candidate = new Date(year + 1, month - 1, day);
  return candidate;
}

// ─── Time-of-day window boost ─────────────────────────────────────────────────
const TIME_WINDOWS = {
  morning:   { start: 5,  end: 10 },
  afternoon: { start: 12, end: 17 },
  evening:   { start: 17, end: 22 },
};

function computeTimeWindowBoost(task) {
  const w = TIME_WINDOWS[task.preferred_time];
  if (!w) return 0;
  const hour = new Date().getHours();
  if (hour >= w.start && hour < w.end) return 40; // in window — boost to top
  if (hour < w.start) return 10;                  // window coming up — keep visible
  return 0;                                        // window passed — no penalty
}

// ─── Auto-hide check ──────────────────────────────────────────────────────────
function shouldAutoHide(task, today) {
  if (!task.auto_hide_after_skips) return false;
  return (task.skip_count ?? 0) >= task.auto_hide_after_skips;
}

function recordSkipIfNeeded(task, today) {
  const todayStr = localDateStr(today);
  if (task.last_skip_date === todayStr) return; // already counted today
  updateTask(task.id, {
    skip_count: (task.skip_count ?? 0) + 1,
    last_skip_date: todayStr,
  });
}

// ─── Main builder ─────────────────────────────────────────────────────────────
export function buildDailyList() {
  const today = TODAY();
  const allTasks = getAllTasks();

  const mainItems = [];    // top + normal priority, active today
  const backlogItems = []; // low-priority or stale items
  const timedGoals = [];   // always-visible timed goals
  const habits = [];       // habit check-ins, grouped by window

  for (const task of allTasks) {
    const last = getLastCompletion(task.id);

    // ── Habits: always show, grouped by window ────────────────────────────
    if (task.task_type === 'habit') {
      const checkin = getTodayHabitCheckin(task.id, task.habit_window);
      const { streak } = getHabitStreak(task.id);
      habits.push({ ...task, checkinResponse: checkin?.response ?? null, streak });
      continue;
    }

    // ── Timed goals: always show, never filtered by completion ────────────
    // Completion records for timed goals are time logs, not "done" markers.
    if (task.task_type === 'timed_goal') {
      const timeBoost = computeTimeWindowBoost(task);
      timedGoals.push({ ...task, effectivePriority: task.base_priority, score: timeBoost, overdueDays: 0, daysUntilDue: null, displayLabel: null, completedToday: false });
      continue;
    }

    // ── Snoozed: hidden from Today until the snooze moment ────────────────
    // Applies to every actionable type (manual snooze + follow-up reminders).
    // Still visible in All Tasks. Stored as a local datetime so "Later today"
    // works; a deadline's snooze is capped at its due date elsewhere so an
    // overdue task can never stay hidden.
    if (task.snooze_until) {
      const until = parseLocalDateTime(task.snooze_until);
      if (until && until.getTime() > Date.now()) continue;
    }

    const completedToday = wasCompletedToday(last, today);
    if (completedToday) continue;

    let include = false;
    let isBacklog = false;
    let overdueDays = 0;
    let daysUntilDue = null;
    let displayLabel = null;

    // ── Unscheduled ───────────────────────────────────────────────────────
    // One-time to-dos: hide permanently once completed (any completion, not
    // just today's). wasCompletedToday already handled today's case above.
    if (task.task_type === 'unscheduled') {
      if (!last) include = true;
    }

    // ── Deadline ──────────────────────────────────────────────────────────
    else if (task.task_type === 'deadline') {
      if (last) continue;
      const due = toDate(task.due_date);
      if (!due) continue;
      daysUntilDue = daysBetween(today, due);
      if (daysUntilDue < 0) {
        overdueDays = Math.abs(daysUntilDue);
        displayLabel = `${overdueDays}d overdue`;
      } else {
        displayLabel = daysUntilDue === 0 ? 'Due today' : `${daysUntilDue}d left`;
      }
      include = true;
    }

    // ── Recurring ─────────────────────────────────────────────────────────
    else if (task.task_type === 'recurring') {
      const w = computeRecurringWindow(task, today, last);
      if (w.pending) {
        if (w.overdueDays > 0) {
          // Missed the occurrence day. Only persistent tasks linger to show it.
          if (task.recur_persistent && task.recur_display_overdue) {
            if (shouldAutoHide(task, today)) {
              // stepped back after too many skips — don't include
            } else {
              recordSkipIfNeeded(task, today);
              overdueDays = w.overdueDays;
              displayLabel = `-${w.overdueDays}d`;
              include = true;
            }
          }
          // non-persistent + overdue → drops off the list
        } else {
          // overdueDays === 0 → this is the occurrence day itself
          include = true;
          displayLabel = 'Today';
        }
      }
    }

    // ── Randomized ────────────────────────────────────────────────────────
    else if (task.task_type === 'randomized') {
      const nextDate = toDate(task.rand_next_date);
      if (!nextDate) continue;
      daysUntilDue = daysBetween(today, nextDate);
      if (nextDate <= today) {
        overdueDays = Math.abs(daysUntilDue);
        displayLabel = overdueDays > 0 ? `-${overdueDays}d` : 'Today';
        if (!task.rand_persistent && overdueDays > 0) {
          // drop off — non-persistent missed task
        } else {
          if (shouldAutoHide(task, today)) {
            recordSkipIfNeeded(task, today);
          } else {
            include = true;
          }
        }
      }
    }

    // ── Date anchor ───────────────────────────────────────────────────────
    else if (task.task_type === 'date_anchor') {
      const nextOccurrence = computeAnchorNextDate(task, today);
      if (!nextOccurrence) continue;
      daysUntilDue = daysBetween(today, nextOccurrence);
      let config = [];
      try { config = JSON.parse(task.notification_config || '[]'); } catch {}
      const maxLeadDays = config
        .filter(n => n.lead_days != null)
        .map(n => n.lead_days)
        .reduce((a, b) => Math.max(a, b), task.escalate_days_out ?? 42);
      if (daysUntilDue <= maxLeadDays) {
        displayLabel = daysUntilDue === 0
          ? task.anchor_label ?? 'Today!'
          : `${daysUntilDue}d until ${task.anchor_label ?? 'event'}`;
        include = true;
      }
    }

    if (!include) continue;

    // ── Compute effective priority (with auto-escalation) ─────────────────
    let effectivePriority = computeAutoEscalatedPriority(task, today, last);

    // Deadline: user-configured "escalate within N days" (date-based ramp).
    // The overdue case moved to the unconditional floor below — it must fire even
    // when this setting is off.
    if (task.task_type === 'deadline' && task.escalate_days_out && daysUntilDue !== null
        && daysUntilDue >= 0 && daysUntilDue <= task.escalate_days_out) {
      effectivePriority = Math.max(effectivePriority, task.escalate_to_priority ?? 3);
    }

    // Recurring escalation: step up one level per N days the current occurrence
    // is overdue, capped at the ceiling. overdueDays resets each occurrence
    // (see computeRecurringWindow), so next cycle starts back at base priority.
    if (task.task_type === 'recurring' && task.recur_escalate_days > 0 && overdueDays > 0) {
      const steps = Math.floor(overdueDays / task.recur_escalate_days);
      effectivePriority = Math.min(effectivePriority + steps, task.priority_ceiling ?? 4);
    }

    // Anchor escalation
    if (task.task_type === 'date_anchor' && daysUntilDue !== null) {
      if (daysUntilDue <= 7) effectivePriority = Math.min(4, effectivePriority + 2);
      else if (daysUntilDue <= 14) effectivePriority = Math.min(4, effectivePriority + 1);
    }

    // Timed ramp + overdue floor (deadlines), independent of the N-days setting.
    // Under the band sort there is no blended urgency score to float a late task
    // up, so priority itself must carry it. Raises only, never demotes.
    if (task.task_type === 'deadline') {
      if (overdueDays > 0) {
        // Overdue floor: the due date has passed. Always Critical, even if the
        // per-task escalation setting is off — this is the gap the old blended
        // score used to paper over (urgency 600 floated it; bands don't).
        effectivePriority = 4;
      } else if (task.due_time && daysUntilDue === 0) {
        const dueMin = minutesOfDay(task.due_time);
        if (dueMin != null) {
          const now = new Date();
          const minsUntil = dueMin - (now.getHours() * 60 + now.getMinutes());
          effectivePriority = Math.max(effectivePriority, timedRampFloor(minsUntil));
        }
      }
    }

    // Cap at ceiling
    effectivePriority = Math.min(effectivePriority, task.priority_ceiling ?? 4);

    // ── Two-factor score ──────────────────────────────────────────────────
    const urgencyScore = computeUrgencyScore(task, today, overdueDays, daysUntilDue) + computeTimeWindowBoost(task);
    const importanceScore = IMPORTANCE[effectivePriority] ?? 100;
    const score = urgencyScore + importanceScore;

    const item = { ...task, effectivePriority, score, urgencyScore, importanceScore, overdueDays, daysUntilDue, displayLabel, completedToday: false };

    // ── Backlog: low priority + no time pressure ──────────────────────────
    if (effectivePriority <= 1 && urgencyScore === 0) {
      isBacklog = true;
    }

    if (isBacklog) backlogItems.push(item);
    else mainItems.push(item);
  }

  // Today list order is the band model (src/engine/bands.js): Critical → High →
  // morning → afternoon/any → evening, with window order applied within every
  // band and timed tasks topping their window block. Boundaries are read from
  // the user's notification settings once here, then reused for every comparison.
  const bands = getBands();
  const byBand = compareByBand(bands);
  mainItems.sort(byBand);
  backlogItems.sort(byBand);
  // Timed goals live in their own always-visible section, not the banded list;
  // the blended score still orders that section until it's revisited.
  const sortFn = (a, b) => b.score - a.score || a.title.localeCompare(b.title);
  timedGoals.sort(sortFn);

  // Sort habits by window order: morning → afternoon → evening → other
  const WINDOW_ORDER = { morning: 0, afternoon: 1, evening: 2 };
  habits.sort((a, b) =>
    (WINDOW_ORDER[a.habit_window] ?? 3) - (WINDOW_ORDER[b.habit_window] ?? 3)
    || a.title.localeCompare(b.title)
  );

  // Completed today — for the "done" section at the bottom of the Today screen.
  // Exclude timed_goal tasks (their completions are time logs, not "done" markers).
  const completedToday = getTodayCompletedTasks()
    .filter(t => t.task_type !== 'timed_goal');

  return { mainItems, backlogItems, timedGoals, habits, completedToday };
}

// Read-only lookahead for the bedtime wrap-up: which high-stakes items land
// tomorrow. Deliberately does NOT touch the DB (unlike buildDailyList, which
// records skips as a side effect), so it's safe to call from the review screen.
//   - deadlines due tomorrow (not yet completed)
//   - important dates occurring tomorrow
//   - recurring tasks scheduled tomorrow at High/Critical priority
export function getTomorrowCritical() {
  const today = TODAY();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const items = [];

  for (const task of getAllTasks()) {
    if (task.task_type === 'deadline') {
      if (getLastCompletion(task.id)) continue; // already done
      const due = toDate(task.due_date);
      if (due && daysBetween(today, due) === 1) {
        items.push({ id: task.id, title: task.title, label: 'Due tomorrow' });
      }
    } else if (task.task_type === 'date_anchor') {
      const next = computeAnchorNextDate(task, today);
      if (next && daysBetween(today, next) === 1) {
        items.push({ id: task.id, title: task.title, label: task.anchor_label ?? 'Tomorrow' });
      }
    } else if (task.task_type === 'recurring') {
      if (isRecurringDueToday(task, tomorrow) && (task.base_priority ?? 2) >= 3) {
        items.push({ id: task.id, title: task.title, label: 'Tomorrow' });
      }
    }
  }
  return items;
}

// Skip the current occurrence of a cyclic task (recurring or randomized).
//   recurring  → hide until the next scheduled occurrence + count a skip
//                (feeds the existing auto-hide-after-N-skips machinery)
//   randomized → roll the next due date forward to a fresh random date
// Returns true if the task type supports skipping, false otherwise.
export function skipTask(task) {
  if (task.task_type === 'recurring') {
    const today = TODAY();
    const next = computeNextRecurrence(task, today);
    updateTask(task.id, {
      snooze_until: next ? localDateTimeStr(next) : localDateTimeStr(new Date(today.getTime() + 86400000)),
      skip_count: (task.skip_count ?? 0) + 1,
      last_skip_date: localDateStr(today),
    });
    return true;
  }
  if (task.task_type === 'randomized') {
    updateTask(task.id, { rand_next_date: advanceRandomizedTask(task) });
    return true;
  }
  return false;
}

export function advanceRandomizedTask(task) {
  const min = task.rand_min_days ?? 7;
  const max = task.rand_max_days ?? 14;
  const days = min + Math.floor(Math.random() * (max - min + 1));
  const next = new Date();
  next.setDate(next.getDate() + days);
  return localDateStr(next);
}
