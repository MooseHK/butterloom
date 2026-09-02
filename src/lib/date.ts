/**
 * The admin's two date formats, in one place because they were about to be
 * written twice.
 *
 * Both are en-GB on purpose: "2 Sep 2026" is unambiguous to read and to say
 * aloud down a phone line, which is what an operator is usually doing with one
 * of these. A bare numeric date is not — 2/9 and 9/2 are the same six pixels
 * and different months.
 *
 * Timestamps are stored as unix seconds throughout (see db/schema.ts), so both
 * of these take seconds and do the ×1000 themselves rather than leaving every
 * caller to remember it.
 */

/** Day and time — for a thing that happened at a moment, like an order. */
export function formatDateTime(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Day only — for a state that has held since then, like a withdrawal. */
export function formatDay(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
