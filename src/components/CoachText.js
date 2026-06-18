/**
 * Returns persona-appropriate strings for all coaching surfaces.
 * Persona keys: just_facts | steady_hand | mentor | coach | hype
 *
 * NUDGE_LEVEL controls how proactive a persona is:
 *   0 — no proactive nudges (just_facts, steady_hand)
 *   1 — morning + evening only (mentor)
 *   2 — morning + midday + evening + habit nudges (coach)
 *   3 — all of the above, lower thresholds, more enthusiasm (hype)
 */

function fmtLead(minutes) {
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  const h = Math.round(minutes / 60);
  if (h < 24) return `${h} hour${h !== 1 ? 's' : ''}`;
  const d = Math.round(minutes / 1440);
  return `${d} day${d !== 1 ? 's' : ''}`;
}

// How many days missed before each persona mentions a habit
export const HABIT_NUDGE_THRESHOLD = {
  just_facts:  Infinity,
  steady_hand: Infinity,
  mentor:      Infinity,
  coach:       2,
  hype:        1,
};

// Minimum task priority (inclusive) to trigger a completion acknowledgment
export const COMPLETION_ACK_THRESHOLD = {
  just_facts:  Infinity,
  steady_hand: Infinity,
  mentor:      Infinity,
  coach:       3,  // High or Critical
  hype:        1,  // everything
};

// 0=silent, 1=morning+evening, 2=+midday+habits, 3=+higher frequency+lower thresholds
export const PERSONA_NUDGE_LEVEL = {
  just_facts:  0,
  steady_hand: 0,
  mentor:      1,
  coach:       2,
  hype:        3,
};

const PERSONAS = {
  just_facts: {
    // ── Scheduled touchpoints ─────────────────────────────────────────────────
    morningBriefing: (n) => `${n} task${n !== 1 ? 's' : ''} today.`,
    morningBody: (n) => `${n} task${n !== 1 ? 's' : ''} today.`,
    midDaySummary: (n) => `${n} task${n !== 1 ? 's' : ''} remaining.`,
    eveningWrapup: (done, remaining) =>
      `Completed: ${done}. Remaining: ${remaining}.`,
    eveningBody: (done, remaining, missedHabits) =>
      `Completed: ${done}. Remaining: ${remaining}.${missedHabits?.length ? ` Habits missed: ${missedHabits.join(', ')}.` : ''}`,
    weeklyReview: (stats) =>
      `This week: ${stats.done} completed. Goals hit: ${stats.goalsHit}/${stats.goalsTotal}.`,

    // ── Reactive moments ──────────────────────────────────────────────────────
    allClear: () => `Nothing remaining.`,
    taskOverdue: (title) => `Overdue: ${title}`,
    nudge: (n) => `${n} item${n !== 1 ? 's' : ''} still open.`,
    completionAck: () => null,
    habitNudge: () => null,

    // ── Deadline alerts ───────────────────────────────────────────────────────
    taskDueReminder: (title, minutes) => `${title} — due in ${fmtLead(minutes)}.`,
    taskCriticalOverdue: (title) => `OVERDUE: ${title}`,
  },

  steady_hand: {
    morningBriefing: (n) =>
      `${n} thing${n !== 1 ? 's' : ''} on the list today. You've handled days like this before.`,
    morningBody: (n) =>
      `${n} thing${n !== 1 ? 's' : ''} on the list today. You've handled days like this before.`,
    midDaySummary: (n) =>
      `${n} still open. There's time.`,
    eveningWrapup: (done, remaining) =>
      `You finished ${done} today. ${remaining > 0 ? `${remaining} carries forward — that's fine.` : `Nothing left. Good work.`}`,
    eveningBody: (done, remaining, missedHabits) =>
      `You finished ${done} today. ${remaining > 0 ? `${remaining} carries forward — that's fine.` : `Nothing left. Good work.`}`,
    weeklyReview: (stats) =>
      `This week you completed ${stats.done} tasks. You hit ${stats.goalsHit} of ${stats.goalsTotal} goals. Consistent.`,
    allClear: () => `All clear. You handled it.`,
    taskOverdue: (title) => `Still waiting on you: ${title}`,
    nudge: (n) => `${n} thing${n !== 1 ? 's' : ''} still need your attention today.`,
    completionAck: () => null,
    habitNudge: () => null,
    taskDueReminder: (title, minutes) => `Heads up — "${title}" is due in ${fmtLead(minutes)}.`,
    taskCriticalOverdue: (title) => `"${title}" is still overdue. When you're ready.`,
  },

  mentor: {
    morningBriefing: (n) =>
      `Good morning. ${n} thing${n !== 1 ? 's' : ''} worth your attention today.`,
    morningBody: (n, criticalTitles) => {
      const base = `Good morning. ${n} thing${n !== 1 ? 's' : ''} worth your attention today.`;
      if (criticalTitles?.length) return `${base} Critical: ${criticalTitles.slice(0, 2).join(', ')}.`;
      return base;
    },
    midDaySummary: (n) =>
      `Checking in: ${n} task${n !== 1 ? 's' : ''} still open. The afternoon is yours.`,
    eveningWrapup: (done, remaining) =>
      `Today you finished ${done} things. ${remaining > 0 ? `${remaining} moves to tomorrow — choose the most important one first.` : `The list is clear. That's worth noting.`}`,
    eveningBody: (done, remaining, missedHabits) => {
      const base = `Today you finished ${done} things. ${remaining > 0 ? `${remaining} moves to tomorrow — choose the most important one first.` : `The list is clear. That's worth noting.`}`;
      return base;
    },
    weeklyReview: (stats) =>
      `This week: ${stats.done} tasks done, ${stats.goalsHit}/${stats.goalsTotal} goals hit. ${stats.streak > 0 ? `You've been showing up. That matters.` : `Next week is a fresh start.`}`,
    allClear: () => `Nothing left today. Use the time well.`,
    taskOverdue: (title) => `"${title}" is still waiting. What's in the way?`,
    nudge: (n) => `Just a reminder — ${n} thing${n !== 1 ? 's' : ''} still on your list today.`,
    completionAck: () => null,
    habitNudge: () => null,
    taskDueReminder: (title, minutes) => `"${title}" is due in ${fmtLead(minutes)}. Worth making sure you're ready.`,
    taskCriticalOverdue: (title) => `"${title}" is still waiting on you. This one matters — what needs to happen?`,
  },

  coach: {
    morningBriefing: (n) =>
      `Here's your day. ${n} task${n !== 1 ? 's' : ''} — let's make them count.`,
    morningBody: (n, criticalTitles) => {
      const base = `${n} task${n !== 1 ? 's' : ''} on deck today — let's make them count.`;
      if (criticalTitles?.length) return `${base} Don't lose sight of: ${criticalTitles.slice(0, 2).join(', ')}.`;
      return base;
    },
    midDaySummary: (n) =>
      `You've still got ${n} to go. Plenty of day left — finish strong.`,
    eveningWrapup: (done, remaining) =>
      `Nice work today — ${done} done. ${remaining > 0 ? `${remaining} rolls to tomorrow. Hit the ground running.` : `Clean sweep. That's how it's done.`}`,
    eveningBody: (done, remaining, missedHabits) => {
      let msg = `${done} done today. ${remaining > 0 ? `${remaining} carries to tomorrow — hit the ground running.` : `Clean sweep — that's how it's done.`}`;
      if (missedHabits?.length) msg += ` Habit${missedHabits.length !== 1 ? 's' : ''} to get back to: ${missedHabits.join(', ')}.`;
      return msg;
    },
    weeklyReview: (stats) =>
      `Week in review: ${stats.done} tasks knocked out, ${stats.goalsHit}/${stats.goalsTotal} goals hit. ${stats.streak > 1 ? `${stats.streak}-day streak — keep it going.` : `Build on this next week.`}`,
    allClear: () => `All done. You showed up today.`,
    taskOverdue: (title) => `"${title}" is overdue. Time to make it happen.`,
    nudge: (n) => `${n} task${n !== 1 ? 's' : ''} still on the board. You've got this.`,
    completionAck: (title, priority) =>
      priority >= 4 ? `"${title}" — that was a big one. Keep going.`
      : priority >= 3 ? `"${title}" — done. Nice work.`
      : `"${title}" — checked off. Keep the momentum.`,
    habitNudge: (title, daysMissed) =>
      daysMissed > 1
        ? `"${title}" has slipped ${daysMissed} days. Tomorrow's a good time to get back on it.`
        : `You didn't keep up "${title}" today — get back on it tomorrow.`,
    taskDueReminder: (title, minutes) => `"${title}" is due in ${fmtLead(minutes)} — don't let it sneak up on you.`,
    taskCriticalOverdue: (title) => `"${title}" is overdue. This one's critical — let's get it done.`,
  },

  hype: {
    morningBriefing: (n) =>
      `LET'S GO! 🔥 ${n} task${n !== 1 ? 's' : ''} standing between you and an amazing day!`,
    morningBody: (n, criticalTitles) => {
      const base = `LET'S GO! 🔥 ${n} task${n !== 1 ? 's' : ''} today — let's CRUSH them!`;
      if (criticalTitles?.length) return `${base} Big ones: ${criticalTitles.slice(0, 2).join(', ')}. You've got this! 💪`;
      return base;
    },
    midDaySummary: (n) =>
      `You're on fire! Just ${n} more to crush today! 💪`,
    eveningWrapup: (done, remaining) =>
      `${done} tasks DONE — you absolutely showed up today! 🙌 ${remaining > 0 ? `${remaining} moves to tomorrow. Fresh start, full energy!` : `CLEAN SWEEP! Incredible work! 🎯`}`,
    eveningBody: (done, remaining, missedHabits) => {
      let msg = `${done} tasks DONE — you showed up today! 🙌 ${remaining > 0 ? `${remaining} carries to tomorrow — fresh start, full energy!` : `CLEAN SWEEP! Incredible! 🎯`}`;
      if (missedHabits?.length) msg += ` ${missedHabits.length === 1 ? `"${missedHabits[0]}" slipped today — come back strong tomorrow! 💪` : `A couple habits slipped — no big deal, tomorrow is a new shot! 🔥`}`;
      return msg;
    },
    weeklyReview: (stats) =>
      `WHAT A WEEK! 🏆 ${stats.done} tasks completed! Goals hit: ${stats.goalsHit}/${stats.goalsTotal}! ${stats.streak > 1 ? `${stats.streak}-day streak — UNSTOPPABLE!` : `Next week is going to be even better!`}`,
    allClear: () => `NOTHING LEFT! You absolutely crushed it today! 🎉`,
    taskOverdue: (title) => `"${title}" is waiting for you to DESTROY IT! 💥`,
    nudge: (n) => `Hey! ${n} task${n !== 1 ? 's' : ''} left! You've totally got this! 🚀`,
    completionAck: (title, priority) =>
      priority >= 4 ? `"${title}" — HUGE! That's the one that matters! 🏆`
      : priority >= 3 ? `"${title}" — YES! Keep that energy going! 🔥`
      : `"${title}" — done! Every single one counts! 💪`,
    habitNudge: (title, daysMissed) =>
      daysMissed > 1
        ? `Hey! "${title}" has been on pause for ${daysMissed} days — tomorrow's your comeback! 💪`
        : `"${title}" didn't happen today — but tomorrow is a FRESH START! 🔥`,
    taskDueReminder: (title, minutes) => `⏰ "${title}" is due in ${fmtLead(minutes)}! You've GOT this!`,
    taskCriticalOverdue: (title) => `🚨 "${title}" is OVERDUE! Time to make it happen RIGHT NOW! 💪`,
  },
};

export function getCoachText(persona = 'coach') {
  return PERSONAS[persona] ?? PERSONAS.coach;
}

export const PERSONA_OPTIONS = [
  {
    key: 'just_facts',
    label: 'Just the Facts',
    sample: '3 tasks remaining.',
    desc: 'Pure neutral. No editorializing.',
  },
  {
    key: 'steady_hand',
    label: 'The Steady Hand',
    sample: '3 still open. There\'s time.',
    desc: 'Calm and measured. Acknowledges without cheerleading.',
  },
  {
    key: 'mentor',
    label: 'The Mentor',
    sample: 'Checking in: 3 tasks still open. The afternoon is yours.',
    desc: 'Warm but grounded. Sees the bigger picture.',
  },
  {
    key: 'coach',
    label: 'The Coach',
    sample: 'You\'ve still got 3 to go. Plenty of day left — finish strong.',
    desc: 'Active and encouraging. Pushes you toward your goals.',
  },
  {
    key: 'hype',
    label: 'The Hype Person',
    sample: 'You\'re on fire! Just 3 more to crush today! 💪',
    desc: 'Full energy. Maximum enthusiasm. In your corner every step.',
  },
];
