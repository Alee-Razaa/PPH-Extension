// Sanitizers and sanity gates. SPEC 8.4 and 18. Site data is untrusted: clamp, cap, coerce. Pure.
import { ok, err } from './result.js';
import { PPH_HOST, LIMITS, GATE } from './constants.js';

const clamp = (n, lo, hi) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').slice(0, max);
const text = (v, max) => str(v, max * 2).trim().slice(0, max);

/** https, host exactly www.peopleperhour.com, no credentials, bounded length. */
export function isPphUrl(u) {
  if (typeof u !== 'string' || u.length > LIMITS.URL_MAX) return false;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname === PPH_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** @returns {import('./constants.js').Job} */
export function sanitizeJob(j = {}) {
  const e = j.etiquettes && typeof j.etiquettes === 'object' ? j.etiquettes : {};
  return {
    id: str(j.id, LIMITS.ID_MAX),
    title: text(j.title, LIMITS.TITLE_MAX),
    url: isPphUrl(j.url) ? j.url : null,
    postedMs: Number(j.postedMs),                      // not clamped: NaN must reach the gate
    ageMin: Number(j.ageMin),
    budget: clamp(Number(j.budget), 0, LIMITS.BUDGET_MAX),
    currency: str(j.currency, 3).toUpperCase().replace(/[^A-Z]/g, ''),
    projectType: j.projectType === 'hourly' ? 'hourly' : 'fixed_price',
    proposals: Math.round(clamp(Number(j.proposals), 0, LIMITS.PROPOSALS_MAX)),
    state: str(j.state, LIMITS.STATE_MAX),
    locationType: /^remote/.test(str(j.locationType, 30)) ? 'remote' : 'onsite',   // "remote", "remote_country"
    category: text(j.category, LIMITS.CATEGORY_MAX),
    etiquettes: {
      featured: !!e.featured,
      opportunity: !!e.opportunity,
      prefunded: !!e.prefunded,
      urgent: !!e.urgent,
      nda: !!e.nda
    }
  };
}

/** @returns {import('./constants.js').Result} error names the failing gate */
export function checkGates(jobs, serverTimeMs, nowMs, topN) {
  if (!Array.isArray(jobs) || jobs.length !== topN) return err(GATE.GATE_COUNT);
  if (!Number.isFinite(serverTimeMs) || Math.abs(serverTimeMs - nowMs) > LIMITS.SERVER_CLOCK_TOLERANCE_MS)
    return err(GATE.GATE_SERVER_TIME);
  if (!jobs.every(j => Number.isFinite(j.postedMs))) return err(GATE.GATE_NAN_TIME);
  if (!jobs.every(j => serverTimeMs - j.postedMs > -LIMITS.FUTURE_TOLERANCE_MS)) return err(GATE.GATE_FUTURE);
  if (!jobs.every(j => /^\d{1,20}$/.test(j.id))) return err(GATE.GATE_ID);
  if (new Set(jobs.map(j => j.id)).size !== topN) return err(GATE.GATE_DUP_ID);
  return ok(true);
}
