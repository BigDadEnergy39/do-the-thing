import * as SQLite from 'expo-sqlite';

let _db = null;
let _initialized = false;

export function getDb() {
  if (!_db) {
    _db = SQLite.openDatabaseSync('dothethinig.db');
  }
  if (!_initialized) {
    _initialized = true;
    initDbSync(_db);
  }
  return _db;
}

export async function initDb() {
  getDb(); // triggers initDbSync if not already run
}

function initDbSync(db) {

  // Initial schema
  db.execSync(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#4a90d9',
      icon TEXT NOT NULL DEFAULT 'list',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      notes TEXT,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      task_type TEXT NOT NULL DEFAULT 'unscheduled',
      base_priority INTEGER NOT NULL DEFAULT 2,
      priority_ceiling INTEGER NOT NULL DEFAULT 4,
      due_date TEXT,
      due_time TEXT,
      escalate_days_out INTEGER DEFAULT 14,
      escalate_to_priority INTEGER DEFAULT 3,
      recur_rule TEXT,
      recur_persistent INTEGER NOT NULL DEFAULT 0,
      recur_display_overdue INTEGER NOT NULL DEFAULT 1,
      rand_min_days INTEGER,
      rand_max_days INTEGER,
      rand_persistent INTEGER NOT NULL DEFAULT 0,
      rand_next_date TEXT,
      anchor_date TEXT,
      anchor_year INTEGER,
      anchor_label TEXT,
      goal_minutes INTEGER,
      goal_reset TEXT NOT NULL DEFAULT 'daily',
      notification_config TEXT,
      auto_escalate_days INTEGER DEFAULT 14,
      auto_hide_after_skips INTEGER,
      skip_count INTEGER NOT NULL DEFAULT 0,
      last_skip_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      scheduled_for TEXT,
      seconds_logged INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS timed_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      notification_id TEXT,
      scheduled_for TEXT,
      snoozed_until TEXT,
      dismissed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrations: add columns that may not exist in older installs
  const migrations = [
    `ALTER TABLE tasks ADD COLUMN priority_ceiling INTEGER NOT NULL DEFAULT 4`,
    `ALTER TABLE tasks ADD COLUMN due_time TEXT`,
    `ALTER TABLE tasks ADD COLUMN auto_escalate_days INTEGER DEFAULT 14`,
    `ALTER TABLE tasks ADD COLUMN auto_hide_after_skips INTEGER`,
    `ALTER TABLE tasks ADD COLUMN skip_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tasks ADD COLUMN last_skip_date TEXT`,
  ];
  for (const sql of migrations) {
    try { db.execSync(sql); } catch (_) { /* column already exists */ }
  }

  // Seed default categories if none exist
  const count = db.getFirstSync('SELECT COUNT(*) as n FROM categories');
  if (count.n === 0) {
    db.execSync(`
      INSERT INTO categories (name, color, icon, sort_order) VALUES
        ('Health', '#e74c3c', 'heart', 0),
        ('Household', '#f39c12', 'home', 1),
        ('Relationships', '#9b59b6', 'people', 2),
        ('Work', '#2980b9', 'briefcase', 3),
        ('Personal', '#27ae60', 'person', 4);
    `);
  }
}
