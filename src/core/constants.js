// Frozen constants and shared types. SPEC 7 and 9.
// Nothing outside DEFAULTS may hardcode an interval, window, settle time or cap (CLAUDE.md rule 11).

/**
 * @typedef {Object} Job                        always the output of sanitizeJob()
 * @property {string}  id            numeric proj_id as string, the dedupe key for BOTH parsers
 * @property {string}  title         <= 300 chars
 * @property {string|null} url       null unless https://www.peopleperhour.com/...
 * @property {number}  postedMs      epoch ms, UTC corrected. NOT clamped, so NaN reaches the gate
 * @property {number}  ageMin        (serverTimeMs - postedMs) / 60000
 * @property {number}  budget        clamped 0..1e7
 * @property {string}  currency      "GBP", A-Z only, <= 3 chars
 * @property {'fixed_price'|'hourly'} projectType
 * @property {number}  proposals     integer 0..10000
 * @property {string}  state         "open" | other
 * @property {'remote'|'onsite'} locationType
 * @property {string}  category      <= 100 chars
 * @property {{featured:boolean,opportunity:boolean,prefunded:boolean,urgent:boolean,nda:boolean}} etiquettes
 */

/**
 * @typedef {Object} CardData                   plain data read from one DOM card, no elements
 * @property {string}   href
 * @property {string}   title
 * @property {string}   price        "£88" / "$25/hr"
 * @property {string[]} footer       ["4 minutes ago", "8 proposals", "Remote", "Remote"]
 * @property {string[]} badges       ["Pre-funded", "Opportunity"]
 */

/**
 * @typedef {Object} ParseResult
 * @property {boolean} ok
 * @property {'state'|'dom'} [source]
 * @property {number}  [serverTimeMs]
 * @property {Job[]}   [jobs]
 * @property {'OFFLINE'|'NOT_READY'|'NO_CARDS'|'BLOCKED'|'PARSE_FAILED'} [reason]
 * @property {string[]} [failures]
 */

/** @typedef {{ ok: true, value: any } | { ok: false, error: string }} Result */

/** Freeze plain objects and arrays recursively. RegExp and other instances are left alone. */
export function deepFreeze(value) {
  const isPlain = v => Array.isArray(v) || (v !== null && Object.getPrototypeOf(v) === Object.prototype);
  if (isPlain(value) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const enumOf = (...names) => deepFreeze(Object.fromEntries(names.map(n => [n, n])));

export const PPH_ORIGIN = 'https://www.peopleperhour.com';
export const PPH_HOST = 'www.peopleperhour.com';
export const BASE_PATH = '/freelance-jobs';
export const BASE_URL = `${PPH_ORIGIN}${BASE_PATH}`;

export const TIME = deepFreeze({
  SECOND_MS: 1000,
  MINUTE_MS: 60_000,
  HOUR_MS: 3_600_000,
  DAY_MS: 86_400_000
});

export const SOUND_FILES = deepFreeze(['sounds/chime.wav', 'sounds/ping.wav', 'sounds/alarm.wav']);

export const DEFAULTS = deepFreeze({
  enabled: true,
  debug: false,

  intervalMode: 'random',
  minIntervalMin: 5,
  maxIntervalMin: 10,
  freshWindowMin: 10,
  autoWidenFreshWindow: true,
  settleSec: 20,
  topN: 5,

  maxReloadsPerHour: 20,
  maxNotificationsPerCycle: 3,
  requireInteraction: true,

  autoReopenTab: true,
  useOwnTab: true,
  pauseWhenLocked: false,

  sound: {
    enabled: true,
    file: 'sounds/chime.wav',
    volume: 0.8,
    highValueFile: 'sounds/alarm.wav',
    highValueBudget: 500
  },

  filters: {
    keywordsInclude: [],
    keywordsExclude: [],
    minBudget: 0,
    maxProposals: null,
    remoteOnly: false,
    prefundedOnly: false
  }
});

export const LIMITS = deepFreeze({
  MESSAGE_TIMEOUT_MS: 3000,
  READY_RETRIES: 5,
  READY_RETRY_MS: 2000,
  WATCHDOG_MIN: 1.5,
  LOCK_STALE_MS: 3 * 60_000,
  SEEN_TTL_MS: 6 * 3_600_000,
  LOG_MAX: 50,
  FUTURE_TOLERANCE_MS: 60_000,
  SERVER_CLOCK_TOLERANCE_MS: 86_400_000,
  MAX_SCRIPT_CHARS: 2_000_000,
  ID_MAX: 20,
  TITLE_MAX: 300,
  CATEGORY_MAX: 100,
  STATE_MAX: 20,
  URL_MAX: 500,
  BUDGET_MAX: 10_000_000,
  PROPOSALS_MAX: 10_000,
  CROSS_CHECK_CARDS: 20
});

/** Prefix matching only: CSS module hashes change on every deploy (CLAUDE.md rule 8). */
export const SELECTORS = deepFreeze({
  CARD: '[class*="item--container"]',
  TITLE_LINK: 'a[class*="item__url"]',
  PRICE: '[class*="card__price"]',
  FOOTER_SPANS: '[class*="card__footer-left"] span',
  BADGE: '[class*="etiquettes--"]',
  CAPTCHA_FRAME: 'iframe[src*="captcha"], iframe[src*="challenge"]'
});

export const BLOCKED_TITLE_RE = /just a moment|attention required|access denied|sign in|log in/i;

export const STATUS = enumOf(
  'IDLE', 'RUNNING', 'OK', 'OFFLINE', 'UNRESPONSIVE', 'PARSE_FAILED', 'BLOCKED', 'NO_TAB', 'PAUSED', 'CAPPED'
);

export const REASON = enumOf('OFFLINE', 'NOT_READY', 'NO_CARDS', 'BLOCKED', 'PARSE_FAILED');

export const GATE = enumOf(
  'GATE_COUNT', 'GATE_SERVER_TIME', 'GATE_NAN_TIME', 'GATE_FUTURE', 'GATE_ID', 'GATE_DUP_ID'
);

export const MSG = enumOf(
  'HELLO', 'JOBS', 'NET_BACK', 'PING', 'PLAY_SOUND', 'GET_STATUS', 'FORCE_CHECK', 'SET_ENABLED',
  'APPLY_PRESET', 'SAVE_SETTINGS', 'RESUME_FROM_BLOCK', 'OPEN_MONITOR_TAB', 'TEST_SOUND',
  'TEST_NOTIFICATION', 'CLEAR_LOG', 'CLEAR_SEEN', 'RESET_SETTINGS'
);

export const ALARM = deepFreeze({ TICK: 'tick', WATCHDOG: 'watchdog' });
