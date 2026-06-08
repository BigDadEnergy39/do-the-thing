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
  // Fetch all distinct local days with a 'kept' or 'mostly' checkin, newest first
  const rows = db.getAllSync(
    `SELECT date(checked_in_at) as day
     FROM habit_checkins
     WHERE task_id = ? AND response IN ('kept', 'mostly')
     GROUP BY date(checked_in_at)
     ORDER BY day DESC`,
    [taskId]
  );
  if (!rows.length) return { streak: 0, bestStreak: 0 };

  // Count consecutive days ending today (or yesterday — allow same-day viewing)
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestStr = `${yest.getFullYear()}-${String(yest.getMonth()+1).padStart(2,'0')}-${String(yest.getDate()).padStart(2,'0')}`;

  let streak = 0;
  let bestStreak = 0;
  let tempStreak = 0;
  let expected = rows[0].day === todayStr || rows[0].day === yestStr
    ? rows[0].day : null;

  for (let i = 0; i < rows.length; i++) {
    const day = rows[i].day;
    if (i === 0) {
      tempStreak = 1;
      if (expected) streak = 1;
    } else {
      // Check if this day is exactly one before the previous
      const prev = new Date(rows[i-1].day + 'T12:00:00');
      const curr = new Date(day + 'T12:00:00');
      const diffDays = Math.round((prev - curr) / 86400000);
      if (diffDays === 1) {
        tempStreak++;
        if (i < streak + 1 || streak === i) streak = tempStreak;
      } else {
        if (tempStreak > bestStreak) bestStreak = tempStreak;
        tempStreak = 1;
        if (streak === i) streak = 0; // broke before counting this far
      }
    }
    if (tempStreak > bestStreak) bestStreak = tempStreak;
  }
  // Final streak is only valid if it chains back to today/yesterday
  if (rows[0].day !== todayStr && rows[0].day !== yestStr) streak = 0;
  else streak = tempStreak; // recount properly

  // Simpler recount: walk from the start again for current streak
  let cur = 0;
  if (rows[0].day === todayStr || rows[0].day === yestStr) {
    cur = 1;
    for (let i = 1; i < rows.length; i++) {
      const prev = new Date(rows[i-1].day + 'T12:00:00');
      const curr = new Date(rows[i].day + 'T12:00:00');
      const diff = Math.round((prev - curr) / 86400000);
      if (diff === 1) cur++;
      else break;
    }
  }

  return { streak: cur, bestStreak };
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
