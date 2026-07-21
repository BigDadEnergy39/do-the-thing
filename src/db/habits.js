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

// A stored UTC datetime string ('YYYY-MM-DD HH:MM:SS') → local YYYY-MM-DD.
// Appending 'Z' marks the string as UTC so the Date is the correct instant,
// then getFullYear/Month/Date read it back in the device's local zone.
function toLocalDay(utcStr) {
  const d = new Date(utcStr.replace(' ', 'T') + 'Z');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// A local Date → local YYYY-MM-DD (no UTC round-trip).
function localDayOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
// Whole calendar days from dayA to dayB (both 'YYYY-MM-DD'); B−A, signed.
// Noon anchors dodge DST edges where a midnight diff could round to 23/25h.
function daysBetween(dayA, dayB) {
  const a = new Date(dayA + 'T12:00:00');
  const b = new Date(dayB + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}
// Which check-in responses count as a "success" for a target.
//   'kept'        → only "Kept it"
//   'kept_mostly' → "Kept it" or "Mostly"  (also the null/legacy default)
function successSet(streakSuccess) {
  return streakSuccess === 'kept'
    ? new Set(['kept'])
    : new Set(['kept', 'mostly']);
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
  // (toLocalDay is now a shared module-level helper)
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
 * Latest response per local day for a habit: Map<'YYYY-MM-DD', response>.
 * Used by the target calculators to tell success / explicit-miss / silent apart.
 */
function getCheckinDayMap(taskId) {
  const db = getDb();
  const rows = db.getAllSync(
    `SELECT checked_in_at, response FROM habit_checkins
     WHERE task_id = ? ORDER BY checked_in_at DESC`,
    [taskId]
  );
  const map = new Map();
  for (const r of rows) {
    const day = toLocalDay(r.checked_in_at);
    if (!map.has(day)) map.set(day, r.response); // DESC → first seen is the latest
  }
  return map;
}

/**
 * Record a check-in for a SPECIFIC past local day (backfill). Mirrors
 * recordHabitCheckin but stamps checked_in_at at local noon of `dayStr` so it
 * buckets into the intended day under both the local-midnight range queries and
 * the toLocalDay read path. Replaces any existing entry for that day/window.
 */
export function recordHabitCheckinForDay(taskId, window, response, dayStr) {
  const db = getDb();
  const [y, m, d] = dayStr.split('-').map(Number);
  const start = toSqliteDatetime(new Date(y, m - 1, d));
  const end   = toSqliteDatetime(new Date(y, m - 1, d + 1));
  db.runSync(
    `DELETE FROM habit_checkins
     WHERE task_id = ? AND window = ? AND checked_in_at >= ? AND checked_in_at < ?`,
    [taskId, window, start, end]
  );
  db.runSync(
    `INSERT INTO habit_checkins (task_id, window, response, checked_in_at) VALUES (?, ?, ?, ?)`,
    [taskId, window, response, toSqliteDatetime(new Date(y, m - 1, d, 12, 0, 0))]
  );
}

/**
 * Progress toward a habit's streak target.
 *
 * Returns null for open-ended habits (no target → legacy 🔥 streak). Otherwise:
 *   { mode, target, numerator, denominator, complete, needsBackfillHint }
 *
 * Modes:
 *   'tally'       numerator = successes within a fixed window of `target` days
 *                 from streak_started_at; denominator = days elapsed (capped at
 *                 target). Misses never reset — they just don't raise numerator.
 *                 complete once the window has fully elapsed.
 *   'consecutive' numerator = current run of successes in a row (capped at
 *                 target); denominator = target. A real miss resets the run.
 *                 complete once the run reaches target.
 *
 * Backfill grace: a silent day (no check-in) is only a "miss" once it can no
 * longer be logged. Missed days are loggable until the end of the FOLLOWING
 * day, so today and yesterday are still fillable and never break a run.
 */
export function getHabitTargetProgress(task) {
  if (!task.streak_target) return null; // open-ended habit
  const target = task.streak_target;
  const mode = task.streak_mode ?? 'consecutive';
  const success = successSet(task.streak_success);
  const dayMap = getCheckinDayMap(task.id);

  const now = new Date();
  const todayStr = localDayOf(now);
  const yestStr  = localDayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

  const isSuccess = (day) => dayMap.has(day) && success.has(dayMap.get(day));
  // Prompt to backfill only while yesterday is still un-logged and fillable —
  // and only if the goal already existed yesterday (no hint on day one).
  const startFloor = task.streak_started_at || toLocalDay(task.created_at);
  const needsBackfillHint = !dayMap.has(yestStr) && daysBetween(startFloor, yestStr) >= 0;

  if (mode === 'tally') {
    // Anchor to when the target was applied; fall back to created_at for safety.
    const startStr = task.streak_started_at || toLocalDay(task.created_at);
    const elapsed = daysBetween(startStr, todayStr) + 1; // creation day counts as day 1
    const denominator = Math.max(1, Math.min(target, elapsed));
    let numerator = 0;
    for (const [day, resp] of dayMap) {
      if (!success.has(resp)) continue;
      const idx = daysBetween(startStr, day);
      if (idx >= 0 && idx < target) numerator++; // only inside the window
    }
    return {
      mode, target, numerator, denominator,
      // Complete only once the window has fully passed, so the final day itself
      // is still loggable (on day `target` the user can still check in).
      complete: elapsed > target,
      needsBackfillHint,
    };
  }

  // consecutive: walk backwards from today, counting the current unbroken run.
  let run = 0;
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < 4000 && run < target; i++) { // bound: cap at target / sanity
    const dayStr = localDayOf(cursor);
    if (isSuccess(dayStr)) {
      run++;
    } else if (dayMap.has(dayStr)) {
      break; // explicit non-success → run broken
    } else if (dayStr !== todayStr && dayStr !== yestStr) {
      break; // silent day past the backfill grace → run broken
    }
    // (silent today/yesterday: neutral, keep walking without counting)
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  return {
    mode, target,
    numerator: Math.min(run, target),
    denominator: target,
    complete: run >= target,
    needsBackfillHint,
  };
}

/**
 * Mark a finished streak goal as dismissed so the scheduler drops it from Today.
 * Written directly (not via updateTask) to keep habits.js free of a tasks.js
 * import — the two modules deliberately avoid importing each other.
 */
export function dismissStreakGoal(taskId) {
  const db = getDb();
  db.runSync(`UPDATE tasks SET streak_dismissed = 1 WHERE id = ?`, [taskId]);
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
