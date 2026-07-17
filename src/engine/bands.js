/**
 * Time-of-day bands for the Today list.
 *
 * The Today list sorts into bands — Critical, High, then morning → afternoon →
 * evening — and this module owns everything about the time-of-day part: where the
 * boundaries are, which band a task belongs to, and how the bands rank.
 *
 * Two design decisions worth knowing:
 *
 * 1. Boundaries come from the user's own notification cadence settings, NOT from
 *    constants. The previous `TIME_WINDOWS` const in scheduler.js was a *frozen
 *    copy* of those settings' defaults (its 12/17/22 matched summary_time_1 /
 *    summary_time_2 / bedtime exactly) that never re-read them — so moving your
 *    bedtime left the evening window behind at 22:00. Deriving them means
 *    "evening" denotes the same span in your list as in your notifications, from
 *    one source of truth.
 *
 * 2. A band is a *stable ordinal position*, not a score bump. The old model gave
 *    an in-window task a temporary +40 that expired at the window's end — so a
 *    morning task silently lost its advantage at 10:00 and fell to an
 *    alphabetical tiebreak, which is why "Afternoon Vitamins" outranked "Morning
 *    Vitamins". Position is fixed regardless of the current clock.
 */

import { getSetting } from '../db/settings';

// "Any time" deliberately ranks WITH afternoon rather than last. An evening task
// is typically something that *can't* be done earlier, so it has to end the list;
// an untagged task could plausibly be done before evening, so it shouldn't sort
// below one.
const WINDOW_RANK = { morning: 0, afternoon: 1, evening: 2 };
const ANY_TIME_RANK = WINDOW_RANK.afternoon;

/** Sort rank for a window name. A null/unknown window ("Any time") ranks with afternoon. */
export function windowRank(window) {
  return WINDOW_RANK[window] ?? ANY_TIME_RANK;
}

/** 'HH:MM' → minutes since local midnight, or null if absent/unparseable. */
export function minutesOfDay(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// Mirror of the defaults in src/db/settings.js, used only if a setting is missing
// or malformed. getSetting already falls back to those defaults, so this is a
// second belt — it exists so a hand-edited garbage value can't produce NaN bands.
const FALLBACK_MIDDAY = 12 * 60;  // summary_time_1  '12:00'
const FALLBACK_EVENING = 17 * 60; // summary_time_2  '17:00'

/**
 * The two boundaries that partition the day, read from settings.
 *
 * Only the *interior* boundaries are needed. morning_briefing_time and bedtime
 * don't appear because times outside the waking day clamp to the nearest band by
 * construction (see windowForMinutes) — a 03:00 task is Morning and a 23:30 task
 * is Evening without either setting being consulted.
 *
 * Does two DB reads, so call it once per list build and pass the result down
 * rather than calling it per task.
 */
export function getBands() {
  const midday = minutesOfDay(getSetting('summary_time_1')) ?? FALLBACK_MIDDAY;
  let eveningStart = minutesOfDay(getSetting('summary_time_2')) ?? FALLBACK_EVENING;
  // Settings are independently editable, so nothing stops evening < midday. Clamp
  // rather than reject: an empty afternoon band is degenerate but harmless, while
  // a negative one would scramble the sort.
  if (eveningStart < midday) eveningStart = midday;
  return { midday, eveningStart };
}

/**
 * Which window a local clock time falls in. Clamps at both ends by construction:
 * anything before the mid-day check-in is Morning (including pre-dawn), anything
 * from the afternoon check-in onward is Evening (including past bedtime).
 */
export function windowForMinutes(mins, bands) {
  if (mins < bands.midday) return 'morning';
  if (mins < bands.eveningStart) return 'afternoon';
  return 'evening';
}

/**
 * The window a task sorts into, or null for "Any time".
 *
 * A due time always wins over a tagged preferred_time. The precedence is resolved
 * here at read time rather than by clearing preferred_time on save, so removing a
 * due time restores the task's original Time of Day instead of having silently
 * destroyed it.
 */
export function taskWindow(task, bands) {
  const due = minutesOfDay(task.due_time);
  if (due != null) return windowForMinutes(due, bands);
  return task.preferred_time ?? null;
}
