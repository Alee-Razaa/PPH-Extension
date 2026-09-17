// Settings: merge, clamp, presets. SPEC 4.4 and 9. Every settings write goes through clampSettings. Pure.
import { DEFAULTS, SOUND_FILES } from './constants.js';

export const RANGES = Object.freeze({
  minIntervalMin: [2, 60],
  maxIntervalMin: [2, 60],
  freshWindowMin: [2, 60],
  settleSec: [5, 60],
  topN: [3, 20],
  maxReloadsPerHour: [6, 40],
  maxNotificationsPerCycle: [1, 5],
  volume: [0, 1],
  budget: [0, 10_000_000],
  proposals: [0, 10_000]
});

export const INTERVAL_MODES = Object.freeze(['fixed', 'random']);
export const TIMING_KEYS = Object.freeze(['enabled', 'intervalMode', 'minIntervalMin', 'maxIntervalMin']);
export const KEYWORDS_MAX = 50;
export const KEYWORD_CHARS_MAX = 50;

export const PRESETS = Object.freeze({
  every3: Object.freeze({ intervalMode: 'fixed', minIntervalMin: 3 }),
  random5to10: Object.freeze({ intervalMode: 'random', minIntervalMin: 5, maxIntervalMin: 10 }),
  every10: Object.freeze({ intervalMode: 'fixed', minIntervalMin: 10 })
});

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep merge `patch` onto `base`. Only keys that exist in `base` are taken, so unknown or hostile
 * keys (including __proto__) are dropped. Arrays and scalars are replaced, objects are merged.
 */
export function mergeSettings(base, patch) {
  const out = {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    const p = isPlainObject(patch) && Object.hasOwn(patch, key) ? patch[key] : undefined;
    if (isPlainObject(b)) out[key] = mergeSettings(b, isPlainObject(p) ? p : {});
    else out[key] = p === undefined ? (Array.isArray(b) ? [...b] : b) : p;
  }
  return out;
}

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

function num(v, [lo, hi], d, { integer = true } = {}) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return d;
  const clamped = Math.min(hi, Math.max(lo, n));
  return integer ? Math.round(clamped) : clamped;
}

function keywords(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const k = item.trim().slice(0, KEYWORD_CHARS_MAX);
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
    if (out.length === KEYWORDS_MAX) break;
  }
  return out;
}

/** Validate every field against DEFAULTS. Wrong types fall back to the default, numbers are clamped. */
export function clampSettings(input) {
  const s = mergeSettings(DEFAULTS, input);
  const d = DEFAULTS;
  const minIntervalMin = num(s.minIntervalMin, RANGES.minIntervalMin, d.minIntervalMin);
  const maxIntervalMin = Math.max(minIntervalMin, num(s.maxIntervalMin, RANGES.maxIntervalMin, d.maxIntervalMin));
  return {
    enabled: bool(s.enabled, d.enabled),
    debug: bool(s.debug, d.debug),

    intervalMode: oneOf(s.intervalMode, INTERVAL_MODES, d.intervalMode),
    minIntervalMin,
    maxIntervalMin,
    freshWindowMin: num(s.freshWindowMin, RANGES.freshWindowMin, d.freshWindowMin),
    autoWidenFreshWindow: bool(s.autoWidenFreshWindow, d.autoWidenFreshWindow),
    settleSec: num(s.settleSec, RANGES.settleSec, d.settleSec),
    topN: num(s.topN, RANGES.topN, d.topN),

    maxReloadsPerHour: num(s.maxReloadsPerHour, RANGES.maxReloadsPerHour, d.maxReloadsPerHour),
    maxNotificationsPerCycle: num(s.maxNotificationsPerCycle, RANGES.maxNotificationsPerCycle, d.maxNotificationsPerCycle),
    requireInteraction: bool(s.requireInteraction, d.requireInteraction),

    autoReopenTab: bool(s.autoReopenTab, d.autoReopenTab),
    useOwnTab: bool(s.useOwnTab, d.useOwnTab),
    pauseWhenLocked: bool(s.pauseWhenLocked, d.pauseWhenLocked),

    sound: {
      enabled: bool(s.sound.enabled, d.sound.enabled),
      file: oneOf(s.sound.file, SOUND_FILES, d.sound.file),
      volume: num(s.sound.volume, RANGES.volume, d.sound.volume, { integer: false }),
      highValueFile: oneOf(s.sound.highValueFile, SOUND_FILES, d.sound.highValueFile),
      highValueBudget: num(s.sound.highValueBudget, RANGES.budget, d.sound.highValueBudget)
    },

    filters: {
      keywordsInclude: keywords(s.filters.keywordsInclude),
      keywordsExclude: keywords(s.filters.keywordsExclude),
      minBudget: num(s.filters.minBudget, RANGES.budget, d.filters.minBudget),
      maxProposals: s.filters.maxProposals === null ? null : num(s.filters.maxProposals, RANGES.proposals, null),
      remoteOnly: bool(s.filters.remoteOnly, d.filters.remoteOnly),
      prefundedOnly: bool(s.filters.prefundedOnly, d.filters.prefundedOnly)
    }
  };
}

/** True when a scheduling-relevant key changed. False when either side is missing (first write). */
export function timingChanged(before, after) {
  if (!isPlainObject(before) || !isPlainObject(after)) return false;
  return TIMING_KEYS.some(k => before[k] !== after[k]);
}

/** Apply a named preset. Unknown names return the settings unchanged. */
export function applyPreset(settings, name) {
  return Object.hasOwn(PRESETS, name) ? clampSettings({ ...settings, ...PRESETS[name] }) : settings;
}

/** Which preset the settings currently match, or 'custom'. */
export function presetOf(s) {
  if (s.intervalMode === 'fixed' && s.minIntervalMin === 3) return 'every3';
  if (s.intervalMode === 'fixed' && s.minIntervalMin === 10) return 'every10';
  if (s.intervalMode === 'random' && s.minIntervalMin === 5 && s.maxIntervalMin === 10) return 'random5to10';
  return 'custom';
}
