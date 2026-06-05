/**
 * Task scheduler engine — two-factor sort (urgency + importance),
 * auto-escalation, auto-hide stale recurring tasks, backlog grouping.
 */

import { getAllTasks, getLastCompletion, updateTask } from '../db/tasks';

const TODAY = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const toDate = (str) => {
  if (!str) return null;
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
function isRecurringDueToday(task, today) {
  if (!task.recur_rule) return false;
  const rule = parseRule(task.recur_rule);
  const dow = today.getDay();
  const dom = today.getDate();
  if (rule.type === 'weekly') return (rule.days || []).includes(dow);
  if (rule.type === 'daily') return true;
  if (rule.type === 'monthly') return (rule.days || []).includes(dom);
  if (rule.type === 'interval') {
    const start = toDate(rule.start_date);
    if (!start) return false;
    const diff = daysBetween(start, today);
    return diff >= 0 && diff % rule.interval === 0;
  }
  return false;
}

function getRecurringOverdueDays(task, today, lastCompletion) {
  const rule = parseRule(task.recur_rule);
  const lastDate = lastCompletion ? toDate(lastCompletion.completed_at) : null;

  if (rule.type === 'weekly') {
    let check = new Date(today);
    check.setDate(check.getDate() - 1);
    for (let i = 0; i < 14; i++) {
      if ((rule.days || []).includes(check.getDay())) {
        if (!lastDate || lastDate < check) return daysBetween(check, today);
        return 0;
      }
      check.setDate(check.getDate() - 1);
    }
  }
  if (rule.type === 'daily') {
    if (!lastDate) return Math.max(0, daysBetween(toDate(task.created_at) ?? today, today));
    const diff = daysBetween(lastDate, today);
    return diff > 1 ? diff - 1 : 0;
  }
  if (rule.type === 'interval') {
    const start = toDate(rule.start_date);
    if (!start) return 0;
    let check = new Date(today);
    check.setDate(check.getDate() - 1);
    for (let i = 0; i < (rule.interval ?? 7) * 2; i++) {
      const diff = daysBetween(start, check);
      if (diff >= 0 && diff % rule.interval === 0) {
        if (!lastDate || lastDate < check) return daysBetween(check, today);
        return 0;
      }
      check.setDate(check.getDate() - 1);
    }
  }
  return 0;
}

function parseRule(raw) {
  if (!raw) return {};
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
}

function wasCompletedToday(lastCompletion, today) {
  if (!lastCompletion) return false;
  const d = toDate(lastCompletion.completed_at);
  return d?.getTime() === today.getTime();
}

function computeAnchorNextDate(task, today) {
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
  morning:   { start: 5,  end: 12 },
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
  const todayStr = today.toISOString().slice(0, 10);
  if (task.last_skip_date === todayStr) return; // already counted today
  updateTask(task.id, {
    skip_count: (task.skip_count ?? 0) + 1,
    last_skip_date: todayStr,
  });
}

// ─── Main builder ─────────────────────────────────────────────────────────────
export function buildDailyList() {
  const today = TODAY();
  const todayStr = today.toISOString().slice(0, 10);
  const allTasks = getAllTasks();

  const mainItems = [];    // top + normal priority, active today
  const backlogItems = []; // low-priority or stale items
  const timedGoals = [];   // always-visible timed goals

  for (const task of allTasks) {
    const last = getLastCompletion(task.id);

    // ── Timed goals: always show, never filtered by completion ────────────
    // Completion records for timed goals are time logs, not "done" markers.
    if (task.task_type === 'timed_goal') {
      const timeBoost = computeTimeWindowBoost(task);
      timedGoals.push({ ...task, effectivePriority: task.base_priority, score: timeBoost, overdueDays: 0, daysUntilDue: null, displayLabel: null, completedToday: false });
      continue;
    }

    const completedToday = wasCompletedToday(last, today);
    if (completedToday) continue;

    let include = false;
    let isBacklog = false;
    let overdueDays = 0;
    let daysUntilDue = null;
    let displayLabel = null;

    // ── Unscheduled ───────────────────────────────────────────────────────
    if (task.task_type === 'unscheduled') {
      include = true;
    }

    // ── Deadline ──────────────────────────────────────────────────────────
    else if (task.task_type === 'deadline') {
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
      const dueToday = isRecurringDueToday(task, today);
      const od = task.recur_persistent
        ? getRecurringOverdueDays(task, today, last)
        : 0;

      if (od > 0 && task.recur_persistent && task.recur_display_overdue) {
        if (shouldAutoHide(task, today)) {
          // step back — don't include
        } else {
          recordSkipIfNeeded(task, today);
          overdueDays = od;
          displayLabel = `-${od}d`;
          include = true;
        }
      } else if (dueToday) {
        include = true;
        displayLabel = 'Today';
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

    // Deadline escalation
    if (task.task_type === 'deadline' && task.escalate_days_out && daysUntilDue !== null) {
      if (daysUntilDue < 0) effectivePriority = 4;
      else if (daysUntilDue <= task.escalate_days_out)
        effectivePriority = Math.max(effectivePriority, task.escalate_to_priority ?? 3);
    }

    // Anchor escalation
    if (task.task_type === 'date_anchor' && daysUntilDue !== null) {
      if (daysUntilDue <= 7) effectivePriority = Math.min(4, effectivePriority + 2);
      else if (daysUntilDue <= 14) effectivePriority = Math.min(4, effectivePriority + 1);
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

  const sortFn = (a, b) => b.score - a.score || a.title.localeCompare(b.title);
  mainItems.sort(sortFn);
  backlogItems.sort(sortFn);
  timedGoals.sort(sortFn);

  return { mainItems, backlogItems, timedGoals };
}

export function advanceRandomizedTask(task) {
  const min = task.rand_min_days ?? 7;
  const max = task.rand_max_days ?? 14;
  const days = min + Math.floor(Math.random() * (max - min + 1));
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}
