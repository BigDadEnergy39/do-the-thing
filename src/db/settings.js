import { getDb } from './schema';

const DEFAULTS = {
  coach_persona: 'coach',
  notification_intensity: '3',
  morning_briefing_time: '07:00',
  bedtime: '22:00',
  summary_time_1: '12:00',
  summary_time_2: '17:00',
  weekly_review_day: '0', // Sunday
  weekly_review_time: '20:00',
};

export function getSetting(key) {
  const db = getDb();
  const row = db.getFirstSync('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? DEFAULTS[key] ?? null;
}

export function setSetting(key, value) {
  const db = getDb();
  db.runSync(
    'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, String(value)]
  );
}

export function getAllSettings() {
  const db = getDb();
  const rows = db.getAllSync('SELECT key, value FROM settings');
  const result = { ...DEFAULTS };
  for (const row of rows) result[row.key] = row.value;
  return result;
}
