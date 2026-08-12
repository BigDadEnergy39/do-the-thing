/**
 * Backup and restore for Do The Thing.
 *
 * exportBackup()  — returns a JSON string of all app data
 * importBackup()  — restores from a JSON string (replaces all data)
 * saveAutoBackup() — writes a dated backup to private storage, and (if a durable
 *                    folder is set) dual-writes it there so it survives uninstall
 * pruneOldBackups() — keeps only the last N private auto-backup files
 *
 * Durable off-device folder (SAF): pickBackupFolder / clearBackupFolder /
 *   getDurableBackupStatus manage a user-chosen folder the daily task also writes to.
 * Restore: listPrivateBackups / restoreFromPrivateFile power the in-app restore list;
 *   pickAndImportBackup handles disaster recovery from an arbitrary file.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { getDb } from './schema';
import { getSetting, setSetting } from './settings';
import { localDateStr, parseLocalDay } from '../utils/date';

const BACKUP_DIR = `${FileSystem.documentDirectory}backups/`;
const BACKUP_VERSION = 1;

// Backups are APPEND-ONLY: each write is a distinct timestamped file, and a new
// backup NEVER overwrites or deletes an earlier one. (Device testing found the old
// one-file-per-day scheme let an empty fresh-install backup destroy the good same-day
// backup via delete-then-recreate — a data-loss trap.) Old files age out only by the
// retention windows below, pruned by calendar age so multiple-per-day is fine.
const PRIVATE_RETAIN_DAYS = 7;
// The durable folder is the real disaster-recovery copy (survives uninstall), so it
// keeps a longer horizon — backups are tiny JSON, and a wider window lets a user
// recover from corruption they only notice weeks later.
const DURABLE_RETAIN_DAYS = 30;
// A durable write older than this many days is treated as "stale" and surfaced in
// Settings. The background task targets daily, so >2 days means it has silently
// missed at least one cycle (folder unavailable, permission revoked, card pulled).
const DURABLE_STALE_DAYS = 2;
// Settings keys for the user-chosen durable off-device folder (SAF tree URI + the
// local date of the last successful write there).
const SET_FOLDER_URI = 'backup_folder_uri';
const SET_LAST_SUCCESS = 'backup_folder_last_success';

// Cap the input before reading it into memory, so a hostile/huge file can't OOM
// the app during JSON.parse. 50 MB is generous for a personal task database.
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
// Tables restore may touch — also gates the table name interpolated into SQL
// (defence in depth; call sites are already hardcoded).
const RESTORE_TABLES = new Set(['categories', 'locations', 'tasks', 'completions', 'timed_sessions', 'habit_checkins', 'settings']);
// A column name must look like a plain SQL identifier before it is interpolated.
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Table keys as they appear in a backup's `data` object (camelCase), for validation.
// `locations` is newer than the others: backups written before the Location axis
// existed simply omit the key, which validateBackup treats as absent (not
// invalid), so older backup files still restore cleanly.
const DATA_KEYS = ['categories', 'locations', 'tasks', 'completions', 'timedSessions', 'habitCheckins', 'settings'];

// ─── Core serialise / deserialise ────────────────────────────────────────────

export function exportBackup() {
  const db = getDb();

  const categories    = db.getAllSync('SELECT * FROM categories');
  const locations     = db.getAllSync('SELECT * FROM locations');
  const tasks         = db.getAllSync('SELECT * FROM tasks');
  const completions   = db.getAllSync('SELECT * FROM completions');
  const timedSessions = db.getAllSync('SELECT * FROM timed_sessions');
  const habitCheckins = db.getAllSync('SELECT * FROM habit_checkins');
  const settings      = db.getAllSync('SELECT * FROM settings');

  return JSON.stringify({
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { categories, locations, tasks, completions, timedSessions, habitCheckins, settings },
  }, null, 2);
}

// True when there is nothing worth backing up: no tasks, completions, timed sessions
// or habit check-ins. (Categories/settings are excluded — a fresh install seeds those,
// so they'd never read as "empty".) Used to skip writing an empty snapshot that could
// otherwise clutter the restore list or be mistaken for a real backup.
function isDatabaseEmpty() {
  const db = getDb();
  const row = db.getFirstSync(
    `SELECT (SELECT COUNT(*) FROM tasks)
          + (SELECT COUNT(*) FROM completions)
          + (SELECT COUNT(*) FROM timed_sessions)
          + (SELECT COUNT(*) FROM habit_checkins) AS n`
  );
  return (row?.n ?? 0) === 0;
}

// ─── Backup filename helpers ────────────────────────────────────────────────────
// Every backup file is `dtt-backup-YYYY-MM-DD_HH-MM-SS.json`. The full timestamp makes
// each write a UNIQUE file (append-only — see the retention comment up top), and the
// fixed-width, lexically-sortable name means a plain `.sort()` is chronological.

/** Local timestamp for a backup filename: 'YYYY-MM-DD_HH-MM-SS'. */
function backupStamp(now = new Date()) {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${localDateStr(now)}_${hh}-${mm}-${ss}`;
}

/** The local calendar day embedded in a backup filename (or SAF URI), as a Date, or null. */
function backupFileDay(nameOrUri) {
  const m = nameOrUri.match(/dtt-backup-(\d{4}-\d{2}-\d{2})/);
  return m ? parseLocalDay(m[1]) : null;
}

/** Whole days between a backup file's day and today (used for age-based pruning). */
function backupAgeDays(nameOrUri) {
  const day = backupFileDay(nameOrUri);
  if (!day) return Infinity; // unparseable name — treat as ancient so it prunes
  const today = parseLocalDay(localDateStr());
  return Math.round((today - day) / 86400000);
}

/** Human label for the restore list: '2026-07-07  11:16' (falls back to the day, then raw). */
function backupLabel(name) {
  const t = name.match(/dtt-backup-(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-\d{2}/);
  if (t) return `${t[1]}  ${t[2]}:${t[3]}`;
  const d = name.match(/dtt-backup-(\d{4}-\d{2}-\d{2})/); // legacy day-only files
  return d ? d[1] : name.replace('dtt-backup-', '').replace('.json', '');
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

  const { categories, locations, tasks, completions, timedSessions, habitCheckins, settings } = parsed.data;
  const db = getDb();

  db.withTransactionSync(() => {
    // Wipe existing data in dependency order (children before parents)
    db.runSync('DELETE FROM habit_checkins');
    db.runSync('DELETE FROM timed_sessions');
    db.runSync('DELETE FROM completions');
    db.runSync('DELETE FROM tasks');
    db.runSync('DELETE FROM categories');
    db.runSync('DELETE FROM locations');
    db.runSync('DELETE FROM settings');

    // Restore in dependency order (parents before children). Every column is
    // mapped by name against the live schema — see restoreRows — so no column
    // is silently dropped and no phantom column breaks the insert.
    restoreRows(db, 'categories', categories);
    restoreRows(db, 'locations', locations);
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

/**
 * Writes a timestamped backup to private storage, and (if a durable folder is set)
 * dual-writes it there. Called by the background task and the Backup Now button.
 * Returns the private path, or null if skipped because there was nothing to back up.
 */
export async function saveAutoBackup() {
  // Skip an empty database. Beyond avoiding useless files, this is a data-safety guard:
  // a fresh install / wiped DB must never produce a backup that could be mistaken for a
  // real one (see isDatabaseEmpty). Append-only naming already prevents overwrites, so
  // this is belt-and-suspenders.
  if (isDatabaseEmpty()) return null;

  await ensureBackupDir();
  const json = exportBackup();
  const stamp = backupStamp(); // local YYYY-MM-DD_HH-MM-SS — unique per write (append-only)
  const path = `${BACKUP_DIR}dtt-backup-${stamp}.json`;
  await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 });
  await pruneOldBackups();

  // Dual-write: also copy to the user's durable folder if one is set, so backups
  // survive an app uninstall (private storage above does NOT). This is best-effort
  // and MUST NOT break the private backup — a folder that's gone/revoked just leaves
  // SET_LAST_SUCCESS untouched, which Settings renders as a staleness warning.
  const durableUri = getBackupFolderUri();
  if (durableUri) {
    try {
      await writeToDurableFolder(durableUri, json, stamp);
      setSetting(SET_LAST_SUCCESS, localDateStr());
    } catch (e) {
      console.log('Durable backup failed:', e.message);
    }
  }
  return path;
}

/** Deletes private auto-backup files older than PRIVATE_RETAIN_DAYS (by calendar age). */
export async function pruneOldBackups() {
  await ensureBackupDir();
  const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  const backups = files.filter(f => f.startsWith('dtt-backup-') && f.endsWith('.json'));
  for (const f of backups) {
    if (backupAgeDays(f) <= PRIVATE_RETAIN_DAYS) continue;
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
    return { filename: latest, label: backupLabel(latest), modificationTime: info.modificationTime ?? null };
  } catch { return null; }
}

// ─── Durable off-device folder (Storage Access Framework) ───────────────────────
//
// Auto-backups above live in app-private storage, which Android wipes on uninstall.
// To survive an uninstall / new phone, the user can grant access to a folder of
// their choosing (ideally a synced one — Nextcloud, Syncthing, SD card) via SAF, and
// the daily task dual-writes there. SAF is Android's user-mediated file access: the
// grant is persisted across reboots but revoked on uninstall (so disaster recovery
// after a reinstall goes through the manual Import path, which re-picks the folder).

/** The stored durable-folder SAF URI, or null if the user hasn't chosen one (or cleared it). */
export function getBackupFolderUri() {
  const uri = getSetting(SET_FOLDER_URI);
  return uri ? uri : null; // '' (cleared) and null both mean "not set"
}

/** A human-readable folder name derived from a SAF tree URI, for display in Settings. */
export function getBackupFolderName(uri = getBackupFolderUri()) {
  if (!uri) return null;
  try {
    // SAF tree URIs look like content://…/tree/primary%3ABackups%2FDoTheThing —
    // decode and take the segment after the volume prefix ("primary:") for display.
    const decoded = decodeURIComponent(uri);
    const afterColon = decoded.slice(decoded.lastIndexOf(':') + 1);
    const leaf = afterColon.split('/').filter(Boolean).pop();
    return leaf || decoded;
  } catch { return uri; }
}

/**
 * Prompts the user to pick a durable backup folder and persists the grant.
 * Returns { success, uri } or { success:false, reason:'denied' } if they cancelled.
 */
export async function pickBackupFolder() {
  const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!perm.granted) return { success: false, reason: 'denied' };
  setSetting(SET_FOLDER_URI, perm.directoryUri);
  return { success: true, uri: perm.directoryUri };
}

/** Forgets the durable folder (stops dual-writing). Files already written are left in place. */
export function clearBackupFolder() {
  setSetting(SET_FOLDER_URI, '');
  setSetting(SET_LAST_SUCCESS, '');
}

// Writes one timestamped backup into the SAF folder. The name is unique per write, so
// we simply create a NEW file every time — never deleting an existing one. This is the
// heart of the append-only guarantee: a later backup can never destroy an earlier good
// one (the old delete-same-day-first scheme is exactly what ate a good backup in testing).
async function writeToDurableFolder(uri, json, stamp) {
  const SAF = FileSystem.StorageAccessFramework;
  // createFileAsync takes the name WITHOUT extension; the mime type drives ".json".
  const fileUri = await SAF.createFileAsync(uri, `dtt-backup-${stamp}`, 'application/json');
  await SAF.writeAsStringAsync(fileUri, json, { encoding: FileSystem.EncodingType.UTF8 });
  await pruneDurableFolder(uri);
}

// Deletes durable backups older than DURABLE_RETAIN_DAYS (by calendar age). Runs only
// after a real (non-empty) write, so on a fresh install nothing prunes and old good
// backups are preserved until the user has restored and made a new one.
async function pruneDurableFolder(uri) {
  const SAF = FileSystem.StorageAccessFramework;
  const entries = await SAF.readDirectoryAsync(uri);
  for (const u of entries) {
    const dec = decodeURIComponent(u);
    if (!/dtt-backup-.*\.json$/.test(dec)) continue;
    if (backupAgeDays(dec) <= DURABLE_RETAIN_DAYS) continue;
    await SAF.deleteAsync(u, { idempotent: true });
  }
}

/**
 * Status of the durable folder for the Settings UI:
 *   { uri, name, lastSuccess, stale }
 * `stale` is true when a folder is set but the last successful write is missing or
 * older than DURABLE_STALE_DAYS — i.e. the off-device copy has silently fallen behind.
 */
export function getDurableBackupStatus() {
  const uri = getBackupFolderUri();
  const lastSuccess = getSetting(SET_LAST_SUCCESS) || null;
  let stale = false;
  if (uri) {
    if (!lastSuccess) {
      stale = true;
    } else {
      const last = parseLocalDay(lastSuccess);
      const today = parseLocalDay(localDateStr());
      const days = last && today ? Math.round((today - last) / 86400000) : Infinity;
      stale = days > DURABLE_STALE_DAYS;
    }
  }
  return { uri, name: getBackupFolderName(uri), lastSuccess, stale };
}

// ─── Restore from an existing private auto-backup ───────────────────────────────

/** Lists the private auto-backups, newest first: [{ filename, label }]. */
export async function listPrivateBackups() {
  await ensureBackupDir();
  const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  return files
    .filter(f => f.startsWith('dtt-backup-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .map(f => ({ filename: f, label: backupLabel(f) }));
}

/** Restores from a named private auto-backup (destructive; snapshots current data first). */
export async function restoreFromPrivateFile(filename) {
  // Only accept our own generated names, never an arbitrary path (this value ends up
  // interpolated into a file path). Mirrors the allowlist discipline in restoreRows.
  // Accepts both timestamped names and legacy day-only names.
  if (!/^dtt-backup-\d{4}-\d{2}-\d{2}(_\d{2}-\d{2}-\d{2})?\.json$/.test(filename)) {
    throw new Error('Invalid backup filename.');
  }
  const path = `${BACKUP_DIR}${filename}`;
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) throw new Error('Backup file not found.');
  const json = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 });
  // Snapshot current data before the destructive restore so a wrong pick can be undone.
  await savePreImportSnapshot().catch(() => {});
  importBackup(json);
  return { success: true };
}
