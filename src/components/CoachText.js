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

// Maps the day's completion into a coaching tier. The denominator is the day's
// total surfaced tasks (done + still-open); habits and timed goals are tracked
// separately and don't count here. "Clean sweep" is reserved for 100%.
//   empty  — nothing was on the list today
//   clean  — 100% complete
//   almost — ≥80%
//   half   — ≥50%
//   some   — ≥30%
//   low    — >0% but <30%
//   none   — 0% (tasks remained, none done)
export function wrapupTier(done, remaining) {
  const total = done + remaining;
  if (total === 0) return 'empty';
  if (remaining === 0) return 'clean';
  if (done === 0) return 'none';
  const pct = done / total;
  if (pct >= 0.8) return 'almost';
  if (pct >= 0.5) return 'half';
  if (pct >= 0.3) return 'some';
  return 'low';
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
    eveningWrapup: (done, remaining) => {
      const total = done + remaining;
      switch (wrapupTier(done, remaining)) {
        case 'empty':  return `Quiet day — nothing on the list. Rest up.`;
        case 'clean':  return `All ${total} done, nothing left. Good work.`;
        case 'almost': return `${done} of ${total} done — nearly there. The last ${remaining} can wait for tomorrow.`;
        case 'half':   return `${done} of ${total} done. Steady progress; the rest carries forward.`;
        case 'some':   return `${done} of ${total} done. A start — more tomorrow.`;
        case 'low':    return `${done} of ${total} done. Slow day; tomorrow's another chance.`;
        default:       return `Nothing checked off today. ${remaining} carries forward — pick one tomorrow and start there.`;
      }
    },
    eveningBody: (done, remaining) => PERSONAS.steady_hand.eveningWrapup(done, remaining),
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
    eveningWrapup: (done, remaining) => {
      const total = done + remaining;
      switch (wrapupTier(done, remaining)) {
        case 'empty':  return `Nothing on the list today. Tomorrow, choose one thing that matters and start there.`;
        case 'clean':  return `You finished all ${total} today and cleared the list. That's worth noting.`;
        case 'almost': return `${done} of ${total} done — you nearly cleared it. Just ${remaining} left for tomorrow.`;
        case 'half':   return `${done} of ${total} done. Real progress — finish what matters most tomorrow.`;
        case 'some':   return `${done} of ${total} done. A foundation to build on tomorrow.`;
        case 'low':    return `${done} of ${total} done. Some days are like that — tomorrow's a fresh start.`;
        default:       return `Nothing got done today, and ${remaining} waits for tomorrow. Start with the one that matters most.`;
      }
    },
    eveningBody: (done, remaining) => PERSONAS.mentor.eveningWrapup(done, remaining),
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
    eveningWrapup: (done, remaining) => {
      const total = done + remaining;
      switch (wrapupTier(done, remaining)) {
        case 'empty':  return `Nothing on the board today. Tomorrow, let's put a few up and knock them down.`;
        case 'clean':  return `Clean sweep — all ${total} knocked out. That's how it's done.`;
        case 'almost': return `So close — ${done} of ${total} done! Just ${remaining} left to grab tomorrow.`;
        case 'half':   return `Solid — ${done} of ${total} done. Keep that pace and finish strong tomorrow.`;
        case 'some':   return `Made progress — ${done} of ${total} done. Build on it tomorrow.`;
        case 'low':    return `${done} of ${total} done. You can get more tomorrow — pick one and go.`;
        default:       return `Nothing checked off yet — ${remaining} still on the board. Tomorrow, pick one and go.`;
      }
    },
    eveningBody: (done, remaining, missedHabits) => {
      let msg = PERSONAS.coach.eveningWrapup(done, remaining);
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
    eveningWrapup: (done, remaining) => {
      const total = done + remaining;
      switch (wrapupTier(done, remaining)) {
        case 'empty':  return `Nothing on the list today — tomorrow's a clean slate. Let's make it a big one! 🔥`;
        case 'clean':  return `CLEAN SWEEP! All ${total} DONE! That's how it's done! 🎯`;
        case 'almost': return `SO CLOSE — ${done} of ${total}! 🔥 Grab the last ${remaining} tomorrow and finish it off!`;
        case 'half':   return `Halfway hero — ${done} of ${total} done! 💪 Big finish tomorrow!`;
        case 'some':   return `Made progress — ${done} of ${total} knocked out! 🙌 Keep it rolling tomorrow!`;
        case 'low':    return `${done} of ${total} done — every one counts! Tomorrow's your shot to CRUSH the rest! 💪`;
        default:       return `Nothing checked off yet — ${remaining} waiting for you to CRUSH tomorrow! 💪`;
      }
    },
    eveningBody: (done, remaining, missedHabits) => {
      let msg = PERSONAS.hype.eveningWrapup(done, remaining);
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
