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

// Cap the input before reading it into memory, so a hostile/huge file can't OOM
// the app during JSON.parse. 50 MB is generous for a personal task database.
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
// Tables restore may touch — also gates the table name interpolated into SQL
// (defence in depth; call sites are already hardcoded).
const RESTORE_TABLES = new Set(['categories', 'tasks', 'completions', 'timed_sessions', 'habit_checkins', 'settings']);
// A column name must look like a plain SQL identifier before it is interpolated.
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Table keys as they appear in a backup's `data` object (camelCase), for validation.
const DATA_KEYS = ['categories', 'tasks', 'completions', 'timedSessions', 'habitCheckins', 'settings'];

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
  // Gate the interpolated table name against a fixed allowlist (call sites are
  // already hardcoded; this makes the guarantee explicit and local).
  if (!RESTORE_TABLES.has(table)) throw new Error(`Refusing to restore unknown table: ${table}`);
  if (!rows?.length) return;
  const columns = new Set(getTableColumns(db, table));
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    // Defence in depth: a key must be a real column AND a syntactically valid
    // identifier before it is interpolated into SQL. The columns.has() check
    // alone already neutralises injection (an injected key isn't a real column),
    // but the SAFE_IDENT check makes that explicit so it survives any future
    // change to the column filter. Values stay parameterised.
    const keys = Object.keys(row).filter(k => columns.has(k) && SAFE_IDENT.test(k));
    if (!keys.length) continue;
    const placeholders = keys.map(() => '?').join(',');
    db.runSync(
      `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`,
      keys.map(k => row[k] ?? null)
    );
  }
}

// Validate the shape of a parsed backup BEFORE we touch the database. Throws a
// user-facing Error on anything malformed, so a corrupt or hostile file is
// rejected before the destructive wipe — rather than wiping, then failing to
// restore and leaving the user with nothing.
function validateBackup(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid backup file — not a backup object.');
  }
  if (typeof parsed.version !== 'number' || parsed.version > BACKUP_VERSION) {
    throw new Error(`Unsupported backup version (${parsed.version ?? 'none'}). This app reads version ${BACKUP_VERSION} or older.`);
  }
  if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new Error('Invalid backup file — missing data section.');
  }
  for (const key of DATA_KEYS) {
    const v = parsed.data[key];
    if (v != null && !Array.isArray(v)) {
      throw new Error(`Invalid backup file — "${key}" must be a list.`);
    }
  }
}

export function importBackup(jsonString) {
  const parsed = JSON.parse(jsonString);
  validateBackup(parsed);

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

// Snapshot current data to a recoverable file before a destructive restore, so a
// valid-but-unwanted import isn't an irreversible mistake. Best-effort.
async function savePreImportSnapshot() {
  await ensureBackupDir();
  const json = exportBackup();
  const now = new Date();
  const stamp = `${localDateStr(now)}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const path = `${BACKUP_DIR}dtt-preimport-${stamp}.json`;
  await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 });
  return path;
}

/** Opens a file picker, reads the chosen backup, and restores it. */
export async function pickAndImportBackup() {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.length) return { success: false, reason: 'cancelled' };

  const asset = result.assets[0];
  // Bound the file before reading it into memory (OOM defence). Prefer the size
  // the picker reports; fall back to a stat if it didn't.
  let size = asset.size ?? null;
  if (size == null) {
    try { size = (await FileSystem.getInfoAsync(asset.uri, { size: true })).size ?? null; } catch { /* unknown */ }
  }
  if (size != null && size > MAX_BACKUP_BYTES) {
    throw new Error(`Backup file is too large (${Math.round(size / 1048576)} MB; limit ${Math.round(MAX_BACKUP_BYTES / 1048576)} MB).`);
  }

  const json = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });

  // Snapshot current data before the destructive restore so a bad (but parseable)
  // import can be undone. Best-effort — never blocks the import.
  await savePreImportSnapshot().catch(() => {});

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
