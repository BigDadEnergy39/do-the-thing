/**
 * Backup and restore for Do The Thing.
 *
 * exportBackup()  — returns a JSON string of all app data
 * importBackup()  — restores from a JSON string (replaces all data)
 * saveAutoBackup() — writes a dated backup file to the app documents folder
 * pruneOldBackups() — keeps only the last N auto-backup files
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { getDb } from './schema';

const BACKUP_DIR = `${FileSystem.documentDirectory}backups/`;
const MAX_AUTO_BACKUPS = 7;
const BACKUP_VERSION = 1;

// ─── Core serialise / deserialise ────────────────────────────────────────────

export function exportBackup() {
  const db = getDb();

  const categories    = db.getAllSync('SELECT * FROM categories');
  const tasks         = db.getAllSync('SELECT * FROM tasks');
  const completions   = db.getAllSync('SELECT * FROM completions');
  const timedSessions = db.getAllSync('SELECT * FROM timed_sessions');
  const habitCheckins = db.getAllSync('SELECT * FROM habit_checkins');
  const settings      = db.getAllSync('SELECT * FROM settings');

  return JSON.stringify({
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { categories, tasks, completions, timedSessions, habitCheckins, settings },
  }, null, 2);
}

export function importBackup(jsonString) {
  const parsed = JSON.parse(jsonString);
  if (!parsed?.data) throw new Error('Invalid backup file — missing data section.');

  const { categories, tasks, completions, timedSessions, habitCheckins, settings } = parsed.data;
  const db = getDb();

  db.withTransactionSync(() => {
    // Wipe existing data in dependency order
    db.runSync('DELETE FROM habit_checkins');
    db.runSync('DELETE FROM timed_sessions');
    db.runSync('DELETE FROM completions');
    db.runSync('DELETE FROM tasks');
    db.runSync('DELETE FROM categories');
    db.runSync('DELETE FROM settings');

    // Restore categories
    for (const row of (categories ?? [])) {
      db.runSync(
        'INSERT INTO categories (id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, ?)',
        [row.id, row.name, row.color, row.icon ?? 'list', row.sort_order ?? 0]
      );
    }

    // Restore tasks — insert every column by name to stay schema-version agnostic
    for (const row of (tasks ?? [])) {
      db.runSync(`
        INSERT INTO tasks (
          id, title, notes, category_id, task_type, base_priority, priority_ceiling,
          due_date, due_time, escalate_days_out, escalate_to_priority,
          recur_rule, recur_persistent, recur_display_overdue,
          rand_min_days, rand_max_days, rand_next_date, rand_persistent,
          anchor_date, anchor_label, goal_minutes, goal_reset,
          snooze_until, auto_hide_after_skips, skip_count,
          duration_intent, preferred_time, habit_window,
          is_active, created_at, updated_at
        ) VALUES (
          ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        )`,
        [
          row.id, row.title, row.notes ?? null, row.category_id ?? null,
          row.task_type, row.base_priority, row.priority_ceiling ?? row.base_priority,
          row.due_date ?? null, row.due_time ?? null,
          row.escalate_days_out ?? null, row.escalate_to_priority ?? null,
          row.recur_rule ?? null, row.recur_persistent ?? 0, row.recur_display_overdue ?? 0,
          row.rand_min_days ?? null, row.rand_max_days ?? null,
          row.rand_next_date ?? null, row.rand_persistent ?? 0,
          row.anchor_date ?? null, row.anchor_label ?? null,
          row.goal_minutes ?? null, row.goal_reset ?? 'daily',
          row.snooze_until ?? null, row.auto_hide_after_skips ?? null, row.skip_count ?? 0,
          row.duration_intent ?? null, row.preferred_time ?? null, row.habit_window ?? null,
          row.is_active ?? 1, row.created_at, row.updated_at ?? row.created_at,
        ]
      );
    }

    // Restore completions
    for (const row of (completions ?? [])) {
      db.runSync(
        'INSERT INTO completions (id, task_id, completed_at, scheduled_for, seconds_logged) VALUES (?,?,?,?,?)',
        [row.id, row.task_id, row.completed_at, row.scheduled_for ?? null, row.seconds_logged ?? 0]
      );
    }

    // Restore timed sessions
    for (const row of (timedSessions ?? [])) {
      db.runSync(
        'INSERT INTO timed_sessions (id, task_id, started_at, ended_at, date) VALUES (?,?,?,?,?)',
        [row.id, row.task_id, row.started_at, row.ended_at ?? null, row.date ?? '']
      );
    }

    // Restore habit check-ins
    for (const row of (habitCheckins ?? [])) {
      db.runSync(
        'INSERT INTO habit_checkins (id, task_id, window, response, checked_in_at) VALUES (?,?,?,?,?)',
        [row.id, row.task_id, row.window, row.response, row.checked_in_at]
      );
    }

    // Restore settings
    for (const row of (settings ?? [])) {
      db.runSync(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        [row.key, row.value]
      );
    }
  });
}

// ─── File operations ──────────────────────────────────────────────────────────

async function ensureBackupDir() {
  const info = await FileSystem.getInfoAsync(BACKUP_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(BACKUP_DIR, { intermediates: true });
}

/** Writes a dated backup to the app documents folder. Called by the background task. */
export async function saveAutoBackup() {
  await ensureBackupDir();
  const json = exportBackup();
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const path = `${BACKUP_DIR}dtt-backup-${stamp}.json`;
  await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 });
  await pruneOldBackups();
  return path;
}

/** Deletes auto-backup files older than the most recent MAX_AUTO_BACKUPS. */
export async function pruneOldBackups() {
  await ensureBackupDir();
  const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  const backups = files
    .filter(f => f.startsWith('dtt-backup-') && f.endsWith('.json'))
    .sort(); // ISO date names sort chronologically
  const toDelete = backups.slice(0, Math.max(0, backups.length - MAX_AUTO_BACKUPS));
  for (const f of toDelete) {
    await FileSystem.deleteAsync(`${BACKUP_DIR}${f}`, { idempotent: true });
  }
}

/** Exports the current backup as a shareable file (share sheet). */
export async function shareBackup() {
  await ensureBackupDir();
  const json = exportBackup();
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const path = `${BACKUP_DIR}dtt-export-${stamp}.json`;
  await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(path, {
    mimeType: 'application/json',
    dialogTitle: 'Save or send your Do The Thing backup',
    UTI: 'public.json',
  });
}

/** Opens a file picker, reads the chosen backup, and restores it. */
export async function pickAndImportBackup() {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.length) return { success: false, reason: 'cancelled' };

  const uri = result.assets[0].uri;
  const json = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
  importBackup(json);
  return { success: true };
}

/** Returns info about the most recent auto-backup, or null if none exists. */
export async function getLastAutoBackupInfo() {
  try {
    await ensureBackupDir();
    const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
    const backups = files
      .filter(f => f.startsWith('dtt-backup-') && f.endsWith('.json'))
      .sort();
    if (!backups.length) return null;
    const latest = backups[backups.length - 1];
    const info = await FileSystem.getInfoAsync(`${BACKUP_DIR}${latest}`);
    return { filename: latest, modificationTime: info.modificationTime ?? null };
  } catch { return null; }
}
