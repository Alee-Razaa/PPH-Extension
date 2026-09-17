// Timing model. SPEC 4.4 and 11. Time and randomness are passed in. Pure.
import { TIME } from './constants.js';

export const CYCLE_MARGIN_MIN = 2;                            // settle 20 s + readiness 10 s + slack
export const BACKOFF_LADDER_MIN = Object.freeze([0, 0, 10, 20, 40, 60]);
export const ALARM_FLOOR_MS = 30_000;                         // chrome.alarms minimum

export const maxIntervalOf = s => (s.intervalMode === 'fixed' ? s.minIntervalMin : s.maxIntervalMin);

/** Fresh window widened to cover the gap between checks (R9). */
export function effectiveFreshMin(s) {
  return s.autoWidenFreshWindow
    ? Math.max(s.freshWindowMin, maxIntervalOf(s) + CYCLE_MARGIN_MIN)
    : s.freshWindowMin;
}

/** Minutes until the next check. Backoff can slow checks down, never speed them up. */
export function nextDelayMin(s, failures, rand) {
  const lo = s.minIntervalMin;
  const hi = maxIntervalOf(s);
  const r = Math.min(Math.max(Number(rand()) || 0, 0), 1);
  const normal = lo + r * (hi - lo);
  const steps = Math.max(0, Math.floor(Number(failures) || 0));
  const ladder = BACKOFF_LADDER_MIN[Math.min(steps, BACKOFF_LADDER_MIN.length - 1)];
  return Math.max(normal, ladder);
}

/** Absolute alarm time. Anchored on the last cycle start so cadence does not drift, floored at 30 s. */
export function nextRunAt(anchorMs, delayMin, nowMs) {
  return Math.max(anchorMs + delayMin * TIME.MINUTE_MS, nowMs + ALARM_FLOOR_MS);
}

/** The hourly safety cap never blocks the interval the user chose. */
export function reloadCap(s) {
  return Math.max(s.maxReloadsPerHour, Math.ceil(60 / s.minIntervalMin) + 4);
}

export const hourBucket = nowMs => Math.floor(nowMs / TIME.HOUR_MS) * TIME.HOUR_MS;

/** Page loads per hour at the average interval, for the options readout. */
export function loadsPerHour(s) {
  return Math.round(60 / ((s.minIntervalMin + maxIntervalOf(s)) / 2));
}
