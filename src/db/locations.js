import { getDb } from './schema';

// Locations mirror categories deliberately (same shape, same CRUD surface).
// They are the second, orthogonal tagging axis: *where/how* you can act, vs a
// category's *life domain*. Kept as a parallel module rather than a shared
// generic "taxonomy" helper — at two axes the indirection costs more clarity
// than it saves, and the two are free to diverge later.

export function getAllLocations() {
  const db = getDb();
  return db.getAllSync('SELECT * FROM locations ORDER BY sort_order ASC, name ASC');
}

export function createLocation(name, color = '#4a90d9', icon = 'pin') {
  const db = getDb();
  const result = db.runSync(
    'INSERT INTO locations (name, color, icon) VALUES (?,?,?)',
    [name, color, icon]
  );
  return result.lastInsertRowId;
}

export function updateLocation(id, fields) {
  const db = getDb();
  const allowed = ['name', 'color', 'icon', 'sort_order'];
  const keys = Object.keys(fields).filter(k => allowed.includes(k));
  if (!keys.length) return;
  const setClauses = keys.map(k => `${k} = ?`).join(', ');
  db.runSync(`UPDATE locations SET ${setClauses} WHERE id = ?`, [...keys.map(k => fields[k]), id]);
}

export function deleteLocation(id) {
  const db = getDb();
  // Untag affected tasks EXPLICITLY. tasks.location_id declares
  // `REFERENCES locations(id) ON DELETE SET NULL`, but that never fires: the
  // app never runs `PRAGMA foreign_keys = ON` and SQLite leaves enforcement off
  // by default. Without this, deleting a location would strand tasks pointing
  // at a row that no longer exists, and a stranded task is *hidden* by any
  // active filter (its id matches nothing) — tasks silently vanishing is the
  // one failure mode this feature must never have.
  db.runSync('UPDATE tasks SET location_id = NULL WHERE location_id = ?', [id]);
  db.runSync('DELETE FROM locations WHERE id = ?', [id]);
}
