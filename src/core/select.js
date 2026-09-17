// Which jobs are new, and the dedupe store. SPEC 8.5 and risk "Job listed late". Pure.
import { LIMITS, TIME } from './constants.js';
import { effectiveFreshMin } from './schedule.js';

export function passesFilters(job, filters) {
  const f = filters ?? {};
  const hay = `${job.title} ${job.category}`.toLowerCase();
  const include = Array.isArray(f.keywordsInclude) ? f.keywordsInclude : [];
  const exclude = Array.isArray(f.keywordsExclude) ? f.keywordsExclude : [];
  if (exclude.some(k => hay.includes(String(k).toLowerCase()))) return false;
  if (include.length && !include.some(k => hay.includes(String(k).toLowerCase()))) return false;
  if (f.minBudget && job.budget < f.minBudget) return false;
  if (f.maxProposals != null && job.proposals > f.maxProposals) return false;
  if (f.remoteOnly && job.locationType !== 'remote') return false;
  if (f.prefundedOnly && !job.etiquettes?.prefunded) return false;
  return true;
}

/** Highest numeric job id already seen, or null before the first cycle. */
export function highestSeenId(seen) {
  let highest = null;
  for (const key of Object.keys(seen ?? {})) {
    const n = Number(key);
    if (Number.isFinite(n) && (highest === null || n > highest)) highest = n;
  }
  return highest;
}

/**
 * A job is new when it was never seen AND either
 *   - it is younger than the effective fresh window (SPEC 4.4), or
 *   - it was listed late: its id is above every id seen so far and it is under an hour old.
 * The second rule exists because PeoplePerHour can list a job minutes after its posted_dt (SPEC 3.3).
 * @returns {{ fresh: import('./constants.js').Job[], overflow: boolean }}
 */
export function pickFresh(jobs, serverTimeMs, settings, seen) {
  const windowMs = effectiveFreshMin(settings) * TIME.MINUTE_MS;
  const lateMs = LIMITS.LATE_LISTING_MAX_MIN * TIME.MINUTE_MS;
  const store = seen ?? {};
  const highest = highestSeenId(store);

  const unseen = job => !Object.hasOwn(store, job.id);
  const isNew = job => {
    const age = serverTimeMs - job.postedMs;
    if (age < windowMs) return true;
    return highest !== null && Number(job.id) > highest && age < lateMs;
  };

  const fresh = jobs.filter(job => job.state === 'open' && unseen(job) && isNew(job) && passesFilters(job, settings.filters));
  const overflow = jobs.length > 0 && jobs.every(job => unseen(job) && isNew(job));
  return { fresh, overflow };
}

/** Mark every job in the list as seen (not just alerted ones), keeping the first-seen time. */
export function markSeen(seen, jobs, nowMs) {
  const next = { ...(seen ?? {}) };
  for (const job of jobs) if (!Object.hasOwn(next, job.id)) next[job.id] = nowMs;
  return next;
}

export function pruneSeen(seen, nowMs, ttlMs = LIMITS.SEEN_TTL_MS) {
  return Object.fromEntries(Object.entries(seen ?? {}).filter(([, t]) => Number.isFinite(t) && nowMs - t < ttlMs));
}
