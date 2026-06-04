import { getDb } from './schema';

export function getAllCategories() {
  const db = getDb();
  return db.getAllSync('SELECT * FROM categories ORDER BY sort_order ASC, name ASC');
}

export function createCategory(name, color = '#4a90d9', icon = 'list') {
  const db = getDb();
  const result = db.runSync(
    'INSERT INTO categories (name, color, icon) VALUES (?,?,?)',
    [name, color, icon]
  );
  return result.lastInsertRowId;
}

export function updateCategory(id, fields) {
  const db = getDb();
  const allowed = ['name', 'color', 'icon', 'sort_order'];
  const keys = Object.keys(fields).filter(k => allowed.includes(k));
  if (!keys.length) return;
  const setClauses = keys.map(k => `${k} = ?`).join(', ');
  db.runSync(`UPDATE categories SET ${setClauses} WHERE id = ?`, [...keys.map(k => fields[k]), id]);
}

export function deleteCategory(id) {
  const db = getDb();
  db.runSync('DELETE FROM categories WHERE id = ?', [id]);
}
