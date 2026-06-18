/**
 * Returns persona-appropriate strings for all coaching surfaces.
 * Persona keys: just_facts | steady_hand | mentor | coach | hype
 */

function fmtLead(minutes) {
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  const h = Math.round(minutes / 60);
  if (h < 24) return `${h} hour${h !== 1 ? 's' : ''}`;
  const d = Math.round(minutes / 1440);
  return `${d} day${d !== 1 ? 's' : ''}`;
}

const PERSONAS = {
  just_facts: {
    morningBriefing: (n) => `${n} task${n !== 1 ? 's' : ''} today.`,
    midDaySummary: (n) => `${n} task${n !== 1 ? 's' : ''} remaining.`,
    eveningWrapup: (done, remaining) =>
      `Completed: ${done}. Remaining: ${remaining}.`,
    weeklyReview: (stats) =>
      `This week: ${stats.done} completed. Goals hit: ${stats.goalsHit}/${stats.goalsTotal}.`,
    allClear: () => `Nothing remaining.`,
    taskOverdue: (title) => `Overdue: ${title}`,
    nudge: (n) => `${n} item${n !== 1 ? 's' : ''} still open.`,
    taskDueReminder: (title, minutes) => `${title} — due in ${fmtLead(minutes)}.`,
    taskCriticalOverdue: (title) => `OVERDUE: ${title}`,
  },

  steady_hand: {
    morningBriefing: (n) =>
      `${n} thing${n !== 1 ? 's' : ''} on the list today. You've handled days like this before.`,
    midDaySummary: (n) =>
      `${n} still open. There's time.`,
    eveningWrapup: (done, remaining) =>
      `You finished ${done} today. ${remaining > 0 ? `${remaining} carries forward — that's fine.` : `Nothing left. Good work.`}`,
    weeklyReview: (stats) =>
      `This week you completed ${stats.done} tasks. You hit ${stats.goalsHit} of ${stats.goalsTotal} goals. Consistent.`,
    allClear: () => `All clear. You handled it.`,
    taskOverdue: (title) => `Still waiting on you: ${title}`,
    nudge: (n) => `${n} thing${n !== 1 ? 's' : ''} still need your attention today.`,
    taskDueReminder: (title, minutes) => `Heads up — "${title}" is due in ${fmtLead(minutes)}.`,
    taskCriticalOverdue: (title) => `"${title}" is still overdue. When you're ready.`,
  },

  mentor: {
    morningBriefing: (n) =>
      `Good morning. ${n} things worth your attention today — each one connects to something you care about.`,
    midDaySummary: (n) =>
      `Checking in: ${n} task${n !== 1 ? 's' : ''} still open. The afternoon is yours.`,
    eveningWrapup: (done, remaining) =>
      `Today you finished ${done} things. ${remaining > 0 ? `${remaining} moves to tomorrow — choose the most important one first.` : `The list is clear. That's worth noting.`}`,
    weeklyReview: (stats) =>
      `This week: ${stats.done} tasks done, ${stats.goalsHit}/${stats.goalsTotal} goals hit. ${stats.streak > 0 ? `You've been showing up. That matters.` : `Next week is a fresh start.`}`,
    allClear: () => `Nothing left today. Use the time well.`,
    taskOverdue: (title) => `"${title}" is still waiting. What's in the way?`,
    nudge: (n) => `Just a reminder — ${n} thing${n !== 1 ? 's' : ''} still on your list today.`,
    taskDueReminder: (title, minutes) => `"${title}" is due in ${fmtLead(minutes)}. Worth making sure you're ready.`,
    taskCriticalOverdue: (title) => `"${title}" is still waiting on you. This one matters — what needs to happen?`,
  },

  coach: {
    morningBriefing: (n) =>
      `Here's your day. ${n} task${n !== 1 ? 's' : ''} — let's make them count.`,
    midDaySummary: (n) =>
      `You've still got ${n} to go. Plenty of day left — finish strong.`,
    eveningWrapup: (done, remaining) =>
      `Nice work today — ${done} done. ${remaining > 0 ? `${remaining} rolls to tomorrow. Hit the ground running.` : `Clean sweep. That's how it's done.`}`,
    weeklyReview: (stats) =>
      `Week in review: ${stats.done} tasks knocked out, ${stats.goalsHit}/${stats.goalsTotal} goals hit. ${stats.streak > 1 ? `${stats.streak}-day streak — keep it going.` : `Build on this next week.`}`,
    allClear: () => `All done. You showed up today. `,
    taskOverdue: (title) => `"${title}" is overdue. Time to make it happen.`,
    nudge: (n) => `${n} task${n !== 1 ? 's' : ''} still on the board. You've got this.`,
    taskDueReminder: (title, minutes) => `"${title}" is due in ${fmtLead(minutes)} — don't let it sneak up on you.`,
    taskCriticalOverdue: (title) => `"${title}" is overdue. This one's critical — let's get it done.`,
  },

  hype: {
    morningBriefing: (n) =>
      `LET'S GO! 🔥 ${n} task${n !== 1 ? 's' : ''} standing between you and an amazing day!`,
    midDaySummary: (n) =>
      `You're on fire! Just ${n} more to crush today! 💪`,
    eveningWrapup: (done, remaining) =>
      `${done} tasks DONE — you absolutely showed up today! 🙌 ${remaining > 0 ? `${remaining} moves to tomorrow. Fresh start, full energy!` : `CLEAN SWEEP! Incredible work! 🎯`}`,
    weeklyReview: (stats) =>
      `WHAT A WEEK! 🏆 ${stats.done} tasks completed! Goals hit: ${stats.goalsHit}/${stats.goalsTotal}! ${stats.streak > 1 ? `${stats.streak}-day streak — UNSTOPPABLE!` : `Next week is going to be even better!`}`,
    allClear: () => `NOTHING LEFT! You absolutely crushed it today! 🎉`,
    taskOverdue: (title) => `"${title}" is waiting for you to DESTROY IT! 💥`,
    nudge: (n) => `Hey! ${n} task${n !== 1 ? 's' : ''} left! You've totally got this! 🚀`,
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
    desc: 'Encouraging and energizing. Believes in you.',
  },
  {
    key: 'hype',
    label: 'The Hype Person',
    sample: 'You\'re on fire! Just 3 more to crush today! 💪',
    desc: 'Full energy. Maximum enthusiasm.',
  },
];
