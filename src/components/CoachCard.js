import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getSetting } from '../db/settings';
import { getCoachText, PERSONA_NUDGE_LEVEL } from './CoachText';
import { COLORS } from './theme';

// Returns 'morning' | 'midday' | 'evening' based on current time vs schedule settings
function timeOfDayMoment() {
  const now = new Date();
  const h = now.getHours();
  const morningTime = getSetting('morning_briefing_time') ?? '07:00';
  const bedtime     = getSetting('bedtime') ?? '22:00';
  const [mh] = morningTime.split(':').map(Number);
  const [bh] = bedtime.split(':').map(Number);
  if (h < mh) return null;          // before morning briefing window
  if (h >= bh) return null;         // after bedtime
  if (h < 12)  return 'morning';
  if (h < 17)  return 'midday';
  return 'evening';
}

/**
 * props:
 *   remaining      — number of tasks still open today
 *   completedCount — number completed today
 *   criticalTitles — string[] of critical task titles still open
 *   missedHabits   — string[] of habit titles with no check-in today
 */
export function CoachCard({ remaining, completedCount, criticalTitles = [], missedHabits = [] }) {
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

  return (
    <View style={[styles.card, moment === 'morning' && styles.cardMorning, moment === 'evening' && styles.cardEvening]}>
      <Text style={styles.label}>
        {moment === 'morning' ? 'Good Morning' : moment === 'midday' ? 'Check-In' : 'Day Wrap-Up'}
      </Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
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
});
