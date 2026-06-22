// Local-date helpers.
//
// Date#toISOString().slice(0,10) yields the *UTC* calendar date, which differs
// from the user's local date for part of every day (for US users, UTC midnight
// falls in the afternoon/evening). Using it as a "today" key causes day-rollover
// bugs — most importantly, timer sessions keyed by UTC date get orphaned when
// the UTC date rolls over mid-afternoon. These helpers use local components so
// "today" matches the user's wall clock.

/** Returns the local calendar date as 'YYYY-MM-DD'. */
export function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parses a date-only 'YYYY-MM-DD' string as LOCAL midnight. `new Date('2026-06-20')`
 * parses as UTC midnight, which renders as the previous day for users behind UTC —
 * use this for any stored date that the user should see on their own calendar.
 */
export function parseLocalDay(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * Parses a SQLite UTC datetime ('YYYY-MM-DD HH:MM:SS', as written by datetime('now'))
 * into a Date at the correct instant, so it can be rendered in local time. Parsing the
 * raw string with `new Date()` treats it as local and shifts it by the UTC offset.
 */
export function parseUtcStamp(s) {
  if (!s) return null;
  const iso = s.replace(' ', 'T');
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
}

/** Returns a LOCAL datetime string 'YYYY-MM-DD HH:MM:SS' (used for snooze targets). */
export function localDateTimeStr(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${localDateStr(date)} ${hh}:${mm}:${ss}`;
}

/**
 * Parses a LOCAL datetime string ('YYYY-MM-DD HH:MM:SS', or date-only) into a Date in
 * local time — the inverse of localDateTimeStr. Unlike parseUtcStamp, the stored value
 * is already local wall-clock, so no offset is applied.
 */
export function parseLocalDateTime(s) {
  if (!s) return null;
  const [datePart, timePart = '00:00:00'] = s.trim().split(/[ T]/);
  const [y, m, d] = datePart.split('-').map(Number);
  const [h = 0, mi = 0, se = 0] = timePart.split(':').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, h, mi, se);
}
