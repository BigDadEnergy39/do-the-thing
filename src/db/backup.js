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
import { localDateStr } from '../utils/date';

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

// Returns the live column names for a table, so restore stays agnostic to schema
// drift between the version that wrote the backup and the version reading it.
function getTableColumns(db, table) {
  return db.getAllSync(`PRAGMA table_info(${table})`).map(c => c.name);
}

// Inserts each row using only the keys that exist as columns in the current
// schema. Columns present in the backup but not in this build are dropped;
// columns in this build but absent from the backup fall back to their schema
// default. This is what keeps a backup forward- and backward-compatible.
function restoreRows(db, table, rows) {
  if (!rows?.length) return;
  const columns = new Set(getTableColumns(db, table));
  for (const row of rows) {
    const keys = Object.keys(row).filter(k => columns.has(k));
    if (!keys.length) continue;
    const placeholders = keys.map(() => '?').join(',');
    db.runSync(
      `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`,
      keys.map(k => row[k] ?? null)
    );
  }
}

export function importBackup(jsonString) {
  const parsed = JSON.parse(jsonString);
  if (!parsed?.data) throw new Error('Invalid backup file — missing data section.');

  const { categories, tasks, completions, timedSessions, habitCheckins, settings } = parsed.data;
  const db = getDb();

  db.withTransactionSync(() => {
    // Wipe existing data in dependency order (children before parents)
    db.runSync('DELETE FROM habit_checkins');
    db.runSync('DELETE FROM timed_sessions');
    db.runSync('DELETE FROM completions');
    db.runSync('DELETE FROM tasks');
    db.runSync('DELETE FROM categories');
    db.runSync('DELETE FROM settings');

    // Restore in dependency order (parents before children). Every column is
    // mapped by name against the live schema — see restoreRows — so no column
    // is silently dropped and no phantom column breaks the insert.
    restoreRows(db, 'categories', categories);
    restoreRows(db, 'tasks', tasks);
    restoreRows(db, 'completions', completions);
    restoreRows(db, 'timed_sessions', timedSessions);
    restoreRows(db, 'habit_checkins', habitCheckins);
    restoreRows(db, 'settings', settings);
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
  const stamp = localDateStr(); // local YYYY-MM-DD
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
  const now = new Date();
  const stamp = `${localDateStr(now)}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
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
