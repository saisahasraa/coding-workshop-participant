/** Due dates in words. */

const DAY_MS = 86400000;
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Whole days from `today` to an ISO date (negative when it has passed).
 * @param {string} isoDate `YYYY-MM-DD`
 * @param {Date} [today]
 */
export function daysUntil(isoDate, today = new Date()) {
  return Math.round((startOfDay(new Date(`${isoDate}T00:00:00`)) - startOfDay(today)) / DAY_MS);
}

/**
 * How to say a due date: `{text, tone}` where tone is a theme colour or null. Finished work just shows
 * nothing special; dates more than two weeks away are left to the caller to print in full.
 * @param {?string} isoDate
 * @param {boolean} done Whether the work is completed
 * @param {Date} [today]
 * @returns {?{text: string, tone: ?string}}
 */
export function dueInWords(isoDate, done, today = new Date()) {
  if (!isoDate || done) return null;
  const days = daysUntil(isoDate, today);
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} overdue`, tone: 'error' };
  if (days === 0) return { text: 'Due today', tone: 'warning' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'warning' };
  if (days <= 14) return { text: `Due in ${days} days`, tone: null };
  return null;
}
