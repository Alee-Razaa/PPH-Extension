// Time handling. SPEC 3.5 (the UTC trap) and 3.6 (moment.js relative text). Pure.
import { TIME } from './constants.js';

const { MINUTE_MS, HOUR_MS, DAY_MS } = TIME;

/** Age used for unrecognised relative text: finite so gates pass, old enough to never be fresh. */
export const UNKNOWN_AGE_MS = 99 * DAY_MS;

const POSTED_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const RELATIVE_RE = /^(\d{1,4}) (minute|hour|day)s? ago$/;
const UNIT_MS = { minute: MINUTE_MS, hour: HOUR_MS, day: DAY_MS };

/**
 * posted_dt is a UTC wall clock "YYYY-MM-DD HH:mm:ss" with no zone. Plain Date.parse reads it as
 * local time (5 hours wrong in Asia/Karachi). Anything not in that exact format returns NaN.
 * @returns {number} epoch ms or NaN
 */
export function toUtcMs(postedDt) {
  if (typeof postedDt !== 'string' || !POSTED_RE.test(postedDt)) return NaN;
  return Date.parse(`${postedDt.replace(' ', 'T')}Z`);
}

export const ageMinutes = (nowMs, postedMs) => (nowMs - postedMs) / MINUTE_MS;

/** moment.js fromNow() text -> representative age in ms. */
export function relToMs(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (t === 'a few seconds ago' || t === 'in a few seconds' || t === 'just now') return 0;
  if (t === 'a minute ago') return MINUTE_MS;
  if (t === 'an hour ago') return HOUR_MS;
  if (t === 'a day ago') return DAY_MS;
  const m = t.match(RELATIVE_RE);
  return m ? Number(m[1]) * UNIT_MS[m[2]] : UNKNOWN_AGE_MS;
}

/**
 * Does a computed age agree with the page's rounded relative text?
 * Minute buckets allow ±toleranceMin, hour and day buckets ±30 min (moment rounds hours).
 */
export function ageMatchesText(ageMs, text, toleranceMin = 1) {
  const shown = relToMs(text);
  if (shown === UNKNOWN_AGE_MS || !Number.isFinite(ageMs)) return false;
  const tolerance = shown >= HOUR_MS ? 30 * MINUTE_MS : toleranceMin * MINUTE_MS;
  return Math.abs(ageMs - shown) <= tolerance;
}

export function formatAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return '?';
  if (ageMs < MINUTE_MS) return '<1 min';
  if (ageMs < HOUR_MS) return `${Math.round(ageMs / MINUTE_MS)} min`;
  if (ageMs < DAY_MS) return `${Math.round(ageMs / HOUR_MS)} h`;
  return `${Math.round(ageMs / DAY_MS)} d`;
}
