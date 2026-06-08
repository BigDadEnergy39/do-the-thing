import { getDb } from './schema';

// Helpers shared with tasks.js — duplicated here to avoid circular imports
function toSqliteDatetime(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
function localDayBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start: toSqliteDatetime(start), end: toSqliteDatetime(end) };
}

/**
 * Return the check-in row for a habit in a given window today, or null if none.
 */
export function getTodayHabitCheckin(taskId, window) {
  const db = getDb();
  const { start, end } = localDayBounds();
  return db.getFirstSync(
    `SELECT * FROM habit_checkins
     WHERE task_id = ? AND window = ? AND checked_in_at >= ? AND checked_in_at < ?
     ORDER BY checked_in_at DESC LIMIT 1`,
    [taskId, window, start, end]
  ) ?? null;
}

/**
 * Record a check-in response ('kept' | 'mostly' | 'didnt') for a habit window.
 * Replaces any existing check-in for the same habit/window/day.
 */
export function recordHabitCheckin(taskId, window, response) {
  const db = getDb();
  const { start, end } = localDayBounds();
  // Remove today's existing entry first so we don't accumulate duplicates
  db.runSync(
    `DELETE FROM habit_checkins
     WHERE task_id = ? AND window = ? AND checked_in_at >= ? AND checked_in_at < ?`,
    [taskId, window, start, end]
  );
  db.runSync(
    `INSERT INTO habit_checkins (task_id, window, response) VALUES (?, ?, ?)`,
    [taskId, window, response]
  );
}

/**
 * Calculate the current streak for a habit (consecutive days with 'kept' or 'mostly').
 * Returns { streak, bestStreak }.
 */
export function getHabitStreak(taskId) {
  const db = getDb();
  // checked_in_at is stored as UTC. Use local-day boundaries for each day so
  // that late-evening check-ins aren't attributed to the wrong (UTC) date.
  // We fetch all successful check-ins and bucket them into local days in JS,
  // matching the same localDayBounds() approach used elsewhere.
  const allRows = db.getAllSync(
    `SELECT checked_in_at FROM habit_checkins
     WHERE task_id = ? AND response IN ('kept', 'mostly')
     ORDER BY checked_in_at DESC`,
    [taskId]
  );
  if (!allRows.length) return { streak: 0, bestStreak: 0 };

  // Convert each UTC timestamp to a local YYYY-MM-DD string, then deduplicate
  const toLocalDay = (utcStr) => {
    const d = new Date(utcStr.replace(' ', 'T') + 'Z');
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const days = [...new Set(allRows.map(r => toLocalDay(r.checked_in_at)))];
  // days is already newest-first (inherited from ORDER BY DESC)

  const now = new Date();
  const todayStr = toLocalDay(toSqliteDatetime(now));
  const yestStr  = toLocalDay(toSqliteDatetime(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)));

  // Current streak: consecutive days ending today or yesterday
  let streak = 0;
  if (days[0] === todayStr || days[0] === yestStr) {
    streak = 1;
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(days[i-1] + 'T12:00:00');
      const curr = new Date(days[i]   + 'T12:00:00');
      if (Math.round((prev - curr) / 86400000) === 1) streak++;
      else break;
    }
  }

  // Best streak: longest consecutive run anywhere in history
  let bestStreak = 0;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i-1] + 'T12:00:00');
    const curr = new Date(days[i]   + 'T12:00:00');
    if (Math.round((prev - curr) / 86400000) === 1) {
      run++;
    } else {
      if (run > bestStreak) bestStreak = run;
      run = 1;
    }
  }
  if (run > bestStreak) bestStreak = run;

  return { streak, bestStreak };
}

/**
 * All habit check-ins for a task (for detail screen history).
 */
export function getHabitCheckinHistory(taskId, limit = 30) {
  const db = getDb();
  return db.getAllSync(
    `SELECT * FROM habit_checkins WHERE task_id = ? ORDER BY checked_in_at DESC LIMIT ?`,
    [taskId, limit]
  );
}
