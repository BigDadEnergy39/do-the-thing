import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { getSetting } from '../db/settings';
import { getCoachText, PERSONA_NUDGE_LEVEL } from './CoachText';
import { COLORS } from './theme';

// Returns 'morning' | 'midday' | 'evening' based on current time vs schedule settings.
// All boundaries are derived from the user's configured times — nothing is hardcoded.
// The wrap-up ("evening") tone begins one hour before the Bedtime setting.
function timeOfDayMoment() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = (str, fallback) => {
    const [h, m] = (str ?? fallback).split(':').map(Number);
    return h * 60 + m;
  };
  const morning = toMins(getSetting('morning_briefing_time'), '07:00');
  const midday  = toMins(getSetting('summary_time_1'), '12:00');
  const bedtime = toMins(getSetting('bedtime'), '22:00');
  const wrapStart = bedtime - 60; // wrap-up tone kicks in 1 hour before bedtime

  if (mins < morning) return null;         // overnight / before the day starts
  if (mins >= wrapStart) return 'evening'; // final wind-down through the evening
  if (mins >= midday) return 'midday';
  return 'morning';
}

/**
 * props:
 *   remaining      — number of tasks still open today
 *   completedCount — number completed today
 *   criticalTitles — string[] of critical task titles still open
 *   missedHabits   — string[] of habit titles with no check-in today
 */
export function CoachCard({ remaining, completedCount, criticalTitles = [], missedHabits = [], onPressWrapup }) {
  const { message, moment } = useMemo(() => {
    const persona    = getSetting('coach_persona') ?? 'coach';
    const nudgeLevel = PERSONA_NUDGE_LEVEL[persona] ?? 0;

    // just_facts and steady_hand don't show a coach card
    if (nudgeLevel === 0) return { message: null, moment: null };

    const coach = getCoachText(persona);
    const m     = timeOfDayMoment();
    if (!m) return { message: null, moment: null };

    let msg = null;
    if (m === 'morning') {
      if (remaining === 0) {
        msg = coach.allClear();
      } else {
        msg = coach.morningBody
          ? coach.morningBody(remaining, criticalTitles)
          : coach.morningBriefing(remaining);
      }
    } else if (m === 'midday') {
      if (nudgeLevel < 2) return { message: null, moment: null };
      msg = remaining === 0 ? coach.allClear() : coach.midDaySummary(remaining);
    } else if (m === 'evening') {
      msg = coach.eveningBody
        ? coach.eveningBody(completedCount, remaining, missedHabits)
        : coach.eveningWrapup(completedCount, remaining);
    }

    return { message: msg, moment: m };
  }, [remaining, completedCount, criticalTitles, missedHabits]);

  if (!message) return null;

  const cardStyle = [styles.card, moment === 'morning' && styles.cardMorning, moment === 'evening' && styles.cardEvening];
  const label = moment === 'morning' ? 'Good Morning' : moment === 'midday' ? 'Check-In' : 'Day Wrap-Up';
  // The evening card opens the full wrap-up screen on demand (so it's reachable
  // even if the bedtime notification is missed).
  const tappable = moment === 'evening' && !!onPressWrapup;

  const body = (
    <>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.message}>{message}</Text>
      {tappable && <Text style={styles.wrapupHint}>Tap for your full wrap-up ›</Text>}
    </>
  );

  if (tappable) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPressWrapup} activeOpacity={0.85}>
        {body}
      </TouchableOpacity>
    );
  }
  return <View style={cardStyle}>{body}</View>;
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: COLORS.primary + '12',
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    padding: 14,
  },
  cardMorning: {
    backgroundColor: '#e8f4fd',
    borderLeftColor: '#2980b9',
  },
  cardEvening: {
    backgroundColor: '#f4ecf7',
    borderLeftColor: '#8e44ad',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.subtext,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  message: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  wrapupHint: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8e44ad',
    marginTop: 8,
  },
});
