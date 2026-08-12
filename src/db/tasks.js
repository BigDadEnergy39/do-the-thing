import { getDb } from './schema';
import { localDateStr } from '../utils/date';

export function getAllTasks() {
  const db = getDb();
  return db.getAllSync(`
    SELECT t.*,
           c.name as category_name, c.color as category_color, c.icon as category_icon,
           l.name as location_name, l.color as location_color, l.icon as location_icon
    FROM tasks t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN locations l ON t.location_id = l.id
    WHERE t.is_active = 1
    ORDER BY t.base_priority DESC, t.title ASC
  `);
}

export function getTaskById(id) {
  const db = getDb();
  return db.getFirstSync(`
    SELECT t.*,
           c.name as category_name, c.color as category_color,
           l.name as location_name, l.color as location_color
    FROM tasks t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN locations l ON t.location_id = l.id
    WHERE t.id = ?
  `, [id]);
}

export function createTask(task) {
  const db = getDb();
  const result = db.runSync(
    `INSERT INTO tasks (
      title, notes, category_id, location_id, task_type, base_priority, priority_ceiling,
      due_date, due_time, escalate_days_out, escalate_to_priority,
      recur_rule, recur_persistent, recur_display_overdue, recur_anchor, recur_escalate_days,
      rand_min_days, rand_max_days, rand_persistent, rand_next_date,
      anchor_date, anchor_year, anchor_label,
      goal_minutes, goal_reset,
      notification_config, auto_escalate_days, auto_hide_after_skips,
      has_timer, duration_intent, preferred_time, habit_window, snooze_until, anchor_nth_rule, due_reminders,
      streak_target, streak_mode, streak_success, streak_started_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      task.title,
      task.notes ?? null,
      task.category_id ?? null,
      task.location_id ?? null,
      task.task_type ?? 'unscheduled',
      task.base_priority ?? 2,
      task.priority_ceiling ?? 4,
      task.due_date ?? null,
      task.due_time ?? null,
      task.escalate_days_out ?? 14,
      task.escalate_to_priority ?? 3,
      task.recur_rule ?? null,
      task.recur_persistent ? 1 : 0,
      task.recur_display_overdue !== false ? 1 : 0,
      task.recur_anchor ?? null,
      task.recur_escalate_days ?? null,
      task.rand_min_days ?? null,
      task.rand_max_days ?? null,
      task.rand_persistent ? 1 : 0,
      task.rand_next_date ?? null,
      task.anchor_date ?? null,
      task.anchor_year ?? null,
      task.anchor_label ?? null,
      task.goal_minutes ?? null,
      task.goal_reset ?? 'daily',
      task.notification_config ? JSON.stringify(task.notification_config) : null,
      task.auto_escalate_days ?? 14,
      task.auto_hide_after_skips ?? null,
      task.has_timer ? 1 : 0,
      task.duration_intent ?? null,
      task.preferred_time ?? null,
      task.habit_window ?? null,
      task.snooze_until ?? null,
      task.anchor_nth_rule ?? null,
      task.due_reminders ? JSON.stringify(task.due_reminders) : null,
      task.streak_target ?? null,
      task.streak_mode ?? null,
      task.streak_success ?? null,
      task.streak_started_at ?? null,
    ]
  );
  return result.lastInsertRowId;
}

export function updateTask(id, fields) {
  const db = getDb();
  const allowed = [
    'title','notes','category_id','location_id','base_priority','priority_ceiling',
    'due_date','due_time','escalate_days_out','escalate_to_priority',
    'recur_rule','recur_persistent','recur_display_overdue','recur_anchor','recur_escalate_days',
    'rand_min_days','rand_max_days','rand_persistent','rand_next_date',
    'anchor_date','anchor_year','anchor_label',
    'goal_minutes','goal_reset','notification_config',
    'auto_escalate_days','auto_hide_after_skips',
    'skip_count','last_skip_date','is_active',
    'has_timer','duration_intent','preferred_time','habit_window',
    'anchor_nth_rule','snooze_until','task_type','due_reminders',
    'streak_target','streak_mode','streak_success','streak_started_at','streak_dismissed',
  ];
  const keys = Object.keys(fields).filter(k => allowed.includes(k));
  if (!keys.length) return;
  const setClauses = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k =>
    k === 'notification_config' && typeof fields[k] === 'object'
      ? JSON.stringify(fields[k])
      : fields[k]
  );
  db.runSync(`UPDATE tasks SET ${setClauses} WHERE id = ?`, [...values, id]);
}

export function archiveTask(id) {
  const db = getDb();
  db.runSync(
    `UPDATE tasks SET is_active = 0, archived_at = datetime('now') WHERE id = ?`, [id]
  );
}

// Hide a task from Today until `untilLocalDateTime` (a local 'YYYY-MM-DD HH:MM:SS'
// string). The scheduler's snooze gate parses it as local. Pass null to un-snooze.
export function snoozeTask(id, untilLocalDateTime) {
  updateTask(id, { snooze_until: untilLocalDateTime ?? null });
}

export function recordCompletion(taskId, scheduledFor = null, secondsLogged = 0) {
  const db = getDb();
  db.runSync(
    `INSERT INTO completions (task_id, scheduled_for, seconds_logged) VALUES (?,?,?)`,
    [taskId, scheduledFor, secondsLogged]
  );
  // Reset skip count on completion
  db.runSync(`UPDATE tasks SET skip_count = 0, last_skip_date = NULL WHERE id = ?`, [taskId]);
  // Randomized tasks: roll the next due date forward so the task doesn't re-appear immediately
  const task = db.getFirstSync(`SELECT task_type, rand_min_days, rand_max_days FROM tasks WHERE id = ?`, [taskId]);
  if (task?.task_type === 'randomized') {
    const min = task.rand_min_days ?? 7;
    const max = task.rand_max_days ?? 14;
    const days = min + Math.floor(Math.random() * (max - min + 1));
    const next = new Date();
    next.setDate(next.getDate() + days);
    const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    db.runSync(`UPDATE tasks SET rand_next_date = ? WHERE id = ?`, [nextStr, taskId]);
  }
}

export function undoCompletion(taskId) {
  const db = getDb();
  db.runSync(
    `DELETE FROM completions WHERE id = (
       SELECT id FROM completions WHERE task_id = ? ORDER BY completed_at DESC LIMIT 1
     )`,
    [taskId]
  );
}

export function getCompletionsForTask(taskId, sinceDate = null) {
  const db = getDb();
  if (sinceDate) {
    return db.getAllSync(
      `SELECT * FROM completions WHERE task_id = ? AND date(completed_at) >= ? ORDER BY completed_at DESC`,
      [taskId, sinceDate]
    );
  }
  return db.getAllSync(
    `SELECT * FROM completions WHERE task_id = ? ORDER BY completed_at DESC LIMIT 50`,
    [taskId]
  );
}

export function getLastCompletion(taskId) {
  const db = getDb();
  return db.getFirstSync(
    `SELECT * FROM completions WHERE task_id = ? ORDER BY completed_at DESC LIMIT 1`,
    [taskId]
  );
}

// Convert a JS Date to SQLite datetime string ('YYYY-MM-DD HH:MM:SS') in UTC.
// All completions are stored as UTC via datetime('now'), so queries must also
// use UTC boundaries — derived from local midnight — to match correctly.
export function toSqliteDatetime(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// Returns UTC boundaries [start, end) that span "today" in local time.
function localDayBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start: toSqliteDatetime(start), end: toSqliteDatetime(end) };
}

export function getTodayTimedSeconds(taskId) {
  const db = getDb();
  const { start, end } = localDayBounds();
  const row = db.getFirstSync(
    `SELECT COALESCE(SUM(seconds_logged),0) as total
     FROM completions WHERE task_id = ? AND completed_at >= ? AND completed_at < ?`,
    [taskId, start, end]
  );
  return row?.total ?? 0;
}

export function getWeekTimedSeconds(taskId) {
  const db = getDb();
  const now = new Date();
  // Midnight local time on the most recent Sunday
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const row = db.getFirstSync(
    `SELECT COALESCE(SUM(seconds_logged),0) as total
     FROM completions WHERE task_id = ? AND completed_at >= ?`,
    [taskId, toSqliteDatetime(startOfWeek)]
  );
  return row?.total ?? 0;
}

export function startTimedSession(taskId) {
  const db = getDb();
  const today = localDateStr(); // local day — must match getActiveTimedSession
  const result = db.runSync(
    `INSERT INTO timed_sessions (task_id, started_at, date) VALUES (?, datetime('now'), ?)`,
    [taskId, today]
  );
  return result.lastInsertRowId;
}

export function endTimedSession(sessionId) {
  const db = getDb();
  db.runSync(
    `UPDATE timed_sessions SET ended_at = datetime('now') WHERE id = ?`, [sessionId]
  );
  const session = db.getFirstSync(
    `SELECT *, CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER) as seconds
     FROM timed_sessions WHERE id = ?`,
    [sessionId]
  );
  const seconds = session?.seconds ?? 0;
  if (seconds > 0) {
    db.runSync(
      `INSERT INTO completions (task_id, seconds_logged) VALUES (?,?)`,
      [session.task_id, seconds]
    );
  }
  return seconds;
}

export function getActiveTimedSession(taskId) {
  const db = getDb();
  const today = localDateStr(); // local day — sessions from previous local days
  // (app closed while timer running) are treated as ended and ignored.
  return db.getFirstSync(
    `SELECT * FROM timed_sessions WHERE task_id = ? AND ended_at IS NULL AND date = ? ORDER BY started_at DESC LIMIT 1`,
    [taskId, today]
  );
}

export function getTodayCompletedTasks() {
  const db = getDb();
  const { start, end } = localDayBounds();
  return db.getAllSync(`
    SELECT DISTINCT t.id, t.title, t.task_type, t.base_priority,
      t.category_id, c.name as category_name,
      t.location_id, l.name as location_name
    FROM completions co
    JOIN tasks t ON t.id = co.task_id
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN locations l ON l.id = t.location_id
    WHERE co.completed_at >= ? AND co.completed_at < ?
    ORDER BY co.completed_at DESC
  `, [start, end]);
}
