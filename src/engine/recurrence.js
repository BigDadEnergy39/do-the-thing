/**
 * Flexible recurrence engine.
 *
 * A single canonical rule shape (v2) describes every repeating pattern the app
 * supports, and a small set of pure functions answer the only questions the rest
 * of the app asks: "is this task due on day X?", "when's the next/previous
 * occurrence?", and "describe this rule in plain English".
 *
 * Canonical rule (stored as JSON in tasks.recur_rule):
 *   {
 *     v: 2,
 *     freq: 'daily' | 'weekly' | 'monthly',
 *     interval: 2,                 // every N days/weeks/months (>= 1)
 *     start_date: 'YYYY-MM-DD',    // cycle anchor (which week/month is "1")
 *     days: [2],                   // weekly: weekdays, 0=Sun … 6=Sat
 *     month_mode: 'day'|'weekday', // monthly only
 *     day_of_month: 15,            //   month_mode 'day'  → the 15th
 *     nth: 1, weekday: 4,          //   month_mode 'weekday' → 1st Thu (nth:-1 = last)
 *     end: null                    // never
 *        | { type: 'date',  date: 'YYYY-MM-DD' }   // stop after this day
 *        | { type: 'count', count: 10 },           // stop after the Nth occurrence
 *   }
 *
 * Legacy rules (written by earlier versions, keyed by `type`) are normalised on
 * read, so existing tasks keep working without a DB migration:
 *   {type:'daily'}                          → every day
 *   {type:'interval', interval, start_date} → every N days
 *   {type:'weekly',  days}                  → those weekdays, every week
 *   {type:'monthly', days}                  → those days-of-month, every month
 *
 * All dates are compared at LOCAL midnight — the app's hard rule is that the user
 * only ever perceives local time, so occurrence math must key off the local
 * calendar day, never UTC. Parsing of stored 'YYYY-MM-DD' strings goes through
 * parseLocalDay for the same reason.
 */

import { parseLocalDay } from '../utils/date';

// ─── Local-midnight date helpers ──────────────────────────────────────────────
const atMidnight = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
};
const daysBetween = (a, b) =>
  Math.round((atMidnight(b).getTime() - atMidnight(a).getTime()) / 86400000);
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
// Sunday that starts the week containing d — the reference point for aligning
// "every N weeks" so the parity is stable regardless of which weekday we test.
const startOfWeekSun = (d) => {
  const x = atMidnight(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
};

/**
 * The nth weekday of a month, at local midnight.
 * `month` is 1-based (1 = January). `weekday` is 0=Sun … 6=Sat.
 * `n` is 1..4, or -1 for the LAST occurrence in the month.
 * Exported because the date-anchor path (floating holidays) needs the same math.
 */
export function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n === -1) {
    const last = new Date(year, month, 0); // day 0 of next month = last day of this one
    last.setHours(0, 0, 0, 0);
    last.setDate(last.getDate() - ((last.getDay() - weekday + 7) % 7));
    return last;
  }
  const first = new Date(year, month - 1, 1);
  const d = new Date(
    year,
    month - 1,
    1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7
  );
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Parsing / normalisation ──────────────────────────────────────────────────
function safeParse(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function normalizeEnd(end) {
  if (!end || typeof end !== 'object') return null;
  if (end.type === 'date' && end.date) return { type: 'date', date: end.date };
  if (end.type === 'count' && Number(end.count) >= 1) {
    return { type: 'count', count: Math.floor(Number(end.count)) };
  }
  return null;
}

/**
 * Coerce any stored rule (v2 or legacy, string or object) into the canonical v2
 * shape. Returns null if the input isn't a usable recurrence rule.
 */
export function normalizeRule(raw) {
  const r = safeParse(raw);
  if (!r || typeof r !== 'object') return null;

  // Already v2 (or close enough — has an explicit freq)
  if (r.v === 2 || r.freq) {
    return {
      v: 2,
      freq: r.freq || 'daily',
      interval: Math.max(1, Math.floor(Number(r.interval) || 1)),
      start_date: r.start_date || null,
      days: Array.isArray(r.days) ? r.days.slice() : [],
      month_mode: r.month_mode === 'weekday' ? 'weekday' : 'day',
      day_of_month: r.day_of_month != null ? Number(r.day_of_month) : null,
      nth: r.nth != null ? Number(r.nth) : null,
      weekday: r.weekday != null ? Number(r.weekday) : null,
      end: normalizeEnd(r.end),
    };
  }

  // Legacy shapes keyed by `type`
  const base = { v: 2, interval: 1, start_date: r.start_date || null, days: [], month_mode: 'day', day_of_month: null, nth: null, weekday: null, end: null };
  switch (r.type) {
    case 'daily':
      return { ...base, freq: 'daily' };
    case 'interval':
      return { ...base, freq: 'daily', interval: Math.max(1, Math.floor(Number(r.interval) || 1)) };
    case 'weekly':
      return { ...base, freq: 'weekly', days: Array.isArray(r.days) ? r.days.slice() : [] };
    case 'monthly':
      // Legacy monthly stored days-of-month in `days`; keep them as day targets.
      return { ...base, freq: 'monthly', month_mode: 'day', days: Array.isArray(r.days) ? r.days.slice() : [] };
    default:
      return null;
  }
}

const startOf = (r) => (r.start_date ? atMidnight(parseLocalDay(r.start_date)) : null);

// Days-of-month a monthly 'day'-mode rule targets. Accepts the new single
// day_of_month and the legacy `days` array, so both render/compute the same way.
function monthDayTargets(r) {
  const set = new Set();
  if (r.day_of_month != null && !Number.isNaN(r.day_of_month)) set.add(r.day_of_month);
  for (const d of r.days || []) if (d >= 1 && d <= 31) set.add(d);
  return [...set].sort((a, b) => a - b);
}

// ─── Occurrence test (pattern only, ignores the end condition) ────────────────
function matchesPattern(r, day, start) {
  if (r.freq === 'daily') {
    if (r.interval <= 1) return true;
    if (!start) return true; // no anchor to count intervals from → treat as every day
    const diff = daysBetween(start, day);
    return diff >= 0 && diff % r.interval === 0;
  }

  if (r.freq === 'weekly') {
    // No explicit weekdays → fall back to the anchor's weekday (or every day if none).
    const days = r.days.length ? r.days : start ? [start.getDay()] : null;
    if (days && !days.includes(day.getDay())) return false;
    if (r.interval <= 1) return true;
    if (!start) return true;
    const weeks = daysBetween(startOfWeekSun(start), startOfWeekSun(day)) / 7;
    return weeks >= 0 && Math.round(weeks) % r.interval === 0;
  }

  if (r.freq === 'monthly') {
    if (r.interval > 1 && start) {
      const monthsDiff =
        (day.getFullYear() - start.getFullYear()) * 12 + (day.getMonth() - start.getMonth());
      if (monthsDiff < 0 || monthsDiff % r.interval !== 0) return false;
    }
    if (r.month_mode === 'weekday') {
      if (r.weekday == null || r.nth == null) return false;
      const occ = nthWeekdayOfMonth(day.getFullYear(), day.getMonth() + 1, r.weekday, r.nth);
      // nthWeekdayOfMonth can overflow into an adjacent month for n=5; re-verify.
      return occ.getMonth() === day.getMonth() && sameDay(occ, day);
    }
    return monthDayTargets(r).includes(day.getDate());
  }

  return false;
}

// True if `day` is an occurrence of the pattern, respecting the start anchor but
// NOT the end condition. Kept separate so endDate()'s count-walk can enumerate
// occurrences without recursing back through the end check.
function isOccurrence(r, day) {
  const start = startOf(r);
  const d = atMidnight(day);
  if (start && d < start) return false;
  return matchesPattern(r, d, start);
}

// The concrete last day the rule is allowed to fire, or null for "never ends".
// For a count end, this is the date of the Nth occurrence counted from start.
function endDate(r) {
  if (!r.end) return null;
  if (r.end.type === 'date') {
    const d = parseLocalDay(r.end.date);
    return d ? atMidnight(d) : null;
  }
  if (r.end.type === 'count') {
    const n = r.end.count;
    const start = startOf(r);
    if (!n || n < 1 || !start) return null; // a count needs an anchor to count from
    let d = new Date(start);
    let seen = 0;
    // Generous guard: N occurrences, worst case ~a month apart per interval step.
    const guard = n * 31 * Math.max(1, r.interval) + 4000;
    for (let i = 0; i < guard; i++) {
      if (isOccurrence(r, d)) {
        seen++;
        if (seen >= n) return atMidnight(d);
      }
      d = addDays(d, 1);
    }
    return null;
  }
  return null;
}

// Rough upper bound on how far ahead/behind the next/previous occurrence can be.
const capDays = (r) => {
  const k = Math.max(1, r.interval);
  if (r.freq === 'monthly') return 366 * k + 40;
  if (r.freq === 'weekly') return 7 * k * 2 + 40;
  return k + 40; // daily
};

function _isDue(r, day, end) {
  if (!isOccurrence(r, day)) return false;
  if (end && day > end) return false;
  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Is the (recurring) task due on `date`? `date` may be any Date; time is ignored. */
export function isDue(rule, date) {
  const r = normalizeRule(rule);
  if (!r) return false;
  return _isDue(r, atMidnight(date), endDate(r));
}

/** The next occurrence strictly AFTER `after`, or null if the rule has ended. */
export function nextOccurrence(rule, after) {
  const r = normalizeRule(rule);
  if (!r) return null;
  const end = endDate(r);
  let d = addDays(atMidnight(after), 1);
  const cap = capDays(r);
  for (let i = 0; i < cap; i++) {
    if (end && d > end) return null;
    if (_isDue(r, d, end)) return d;
    d = addDays(d, 1);
  }
  return null;
}

/**
 * The previous occurrence strictly BEFORE `before`, or null if there isn't one
 * (nothing before the start anchor). Used to measure how overdue a missed
 * recurring task is.
 */
export function prevOccurrence(rule, before) {
  const r = normalizeRule(rule);
  if (!r) return null;
  const start = startOf(r);
  const end = endDate(r);
  let d = addDays(atMidnight(before), -1);
  const cap = capDays(r);
  for (let i = 0; i < cap; i++) {
    if (start && d < start) return null;
    if (_isDue(r, d, end)) return d;
    d = addDays(d, -1);
  }
  return null;
}

/**
 * The most recent occurrence on OR BEFORE `onDate` — the "current occurrence
 * window" the task is sitting in. If `onDate` itself is an occurrence, that's
 * returned. This is what makes per-occurrence escalation reset: a fresh
 * occurrence becomes `currentOccurrence`, so days-overdue drops back to zero
 * even if the prior window was never completed.
 */
export function currentOccurrence(rule, onDate) {
  const r = normalizeRule(rule);
  if (!r) return null;
  const day = atMidnight(onDate);
  const end = endDate(r);
  if (_isDue(r, day, end)) return day;
  return prevOccurrence(r, day);
}

/**
 * Add `n` of the rule's frequency unit to a date, at local midnight. Used by the
 * 'completion'-anchored (rolling) mode: the next due date is this many
 * days/weeks/months after the last time the task was actually done.
 */
export function addByFreq(date, freq, n) {
  const step = Math.max(1, Math.floor(Number(n) || 1));
  if (freq === 'weekly') return addDays(date, step * 7);
  if (freq === 'monthly') {
    const x = new Date(date.getFullYear(), date.getMonth() + step, date.getDate());
    x.setHours(0, 0, 0, 0);
    return x;
  }
  return addDays(date, step); // daily
}

/**
 * The next `count` occurrences on or after `after` (inclusive of `after` itself
 * when it's an occurrence), as an array of local-midnight Dates. Respects the
 * end condition — returns fewer than `count` (or none) once the rule has ended.
 * Powers the "upcoming dates" previews. Meaningful for fixed-schedule rules;
 * rolling (completion-anchored) tasks have no fixed future calendar.
 */
export function upcomingOccurrences(rule, count = 3, after = new Date()) {
  const out = [];
  let cursor = addDays(atMidnight(after), -1); // so an occurrence exactly on `after` is included
  for (let i = 0; i < count; i++) {
    const next = nextOccurrence(rule, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDINAL = { '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '-1': 'last' };

/** Plain-English summary, e.g. "Every 2 weeks on Tue" or "Monthly on the first Thu". */
export function describeRule(rule) {
  const r = normalizeRule(rule);
  if (!r) return '';
  let base;

  if (r.freq === 'daily') {
    base = r.interval > 1 ? `Every ${r.interval} days` : 'Every day';
  } else if (r.freq === 'weekly') {
    const every = r.interval > 1 ? `Every ${r.interval} weeks` : 'Weekly';
    const list = (r.days.length ? r.days.slice().sort((a, b) => a - b) : [])
      .map((d) => DOW[d])
      .join(', ');
    base = list ? `${every} on ${list}` : every;
  } else {
    const every = r.interval > 1 ? `Every ${r.interval} months` : 'Monthly';
    if (r.month_mode === 'weekday' && r.weekday != null && r.nth != null) {
      base = `${every} on the ${ORDINAL[String(r.nth)] || ''} ${DOW[r.weekday]}`.replace(/\s+/g, ' ').trim();
    } else {
      const t = monthDayTargets(r);
      base = t.length ? `${every} on day ${t.join(', ')}` : every;
    }
  }

  if (r.end?.type === 'date' && r.end.date) base += `, until ${r.end.date}`;
  else if (r.end?.type === 'count' && r.end.count) base += `, ${r.end.count} times`;
  return base;
}
