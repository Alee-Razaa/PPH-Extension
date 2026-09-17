// Cycle decisions: precheck, sender matching, outcomes, badge. SPEC 8.2, 11, 12.3. Pure.
import { STATUS, REASON, LIMITS, TIME } from './constants.js';
import { reloadCap, hourBucket } from './schedule.js';

const BACKOFF_STATUSES = new Set([STATUS.OFFLINE, STATUS.UNRESPONSIVE, STATUS.PARSE_FAILED, STATUS.NO_TAB]);

export const backoffApplies = status => BACKOFF_STATUSES.has(status);

/** Reloads already made in the current hour (0 when the stored bucket is an older hour). */
export function reloadsThisHour(stats, nowMs) {
  return stats?.hourBucketMs === hourBucket(nowMs) ? Number(stats.reloadsThisHour) || 0 : 0;
}

/**
 * Decide what a tick does. Facts are gathered by background.js through platform/.
 * @param {{
 *   settings: object, stats?: object, cycleLock?: {id:string, tabId:number, startedMs:number} | null,
 *   tab?: {id:number, url?:string} | null, ping?: {online?:boolean} | null,
 *   nowMs: number, workerOnline?: boolean, idleState?: string, trigger?: 'alarm'|'force'
 * }} f
 * @returns {{ action: 'skip', status: string, backoff: boolean, stop?: boolean, nextAt?: number, clearStaleLock: boolean }
 *         | { action: 'run' | 'reopen', tabId: number | null, clearStaleLock: boolean, statsPatch: object }}
 */
export function decidePrecheck(f) {
  const { settings, stats = {}, cycleLock = null, tab = null, ping = null, nowMs } = f;
  const skip = (status, extra = {}) => ({ action: 'skip', status, backoff: backoffApplies(status), clearStaleLock, ...extra });
  let clearStaleLock = false;

  if (!settings.enabled && f.trigger !== 'force') return skip(STATUS.PAUSED, { stop: true });
  if (stats.status === STATUS.BLOCKED) return skip(STATUS.BLOCKED, { stop: true });

  if (cycleLock) {
    if (nowMs - cycleLock.startedMs < LIMITS.LOCK_STALE_MS) return skip(STATUS.RUNNING);
    clearStaleLock = true;
  }

  const done = reloadsThisHour(stats, nowMs);
  if (done >= reloadCap(settings)) return skip(STATUS.CAPPED, { nextAt: hourBucket(nowMs) + TIME.HOUR_MS });

  if (settings.pauseWhenLocked && f.idleState === 'locked') return skip(STATUS.PAUSED);
  if (ping?.online === false) return skip(STATUS.OFFLINE);
  if (!ping && f.workerOnline === false) return skip(STATUS.OFFLINE);
  if (!tab && !settings.autoReopenTab) return skip(STATUS.NO_TAB);

  // An unanswered PING no longer blocks the reload (R11): the watchdog covers a dead page.
  return {
    action: tab ? 'run' : 'reopen',
    tabId: tab ? tab.id : null,
    clearStaleLock,
    statsPatch: {
      status: STATUS.RUNNING,
      lastRunMs: nowMs,
      hourBucketMs: hourBucket(nowMs),
      reloadsThisHour: done + 1
    }
  };
}

/** Only the locked monitor tab's top frame, during a live cycle, may report. */
export function isCycleSender(lock, sender, nowMs) {
  if (!lock || typeof lock.tabId !== 'number') return false;
  if (sender?.tab?.id !== lock.tabId) return false;
  if ((sender.frameId ?? 0) !== 0) return false;
  return nowMs - lock.startedMs < LIMITS.LOCK_STALE_MS;
}

/** Messages a content script may send. Everything else must come from an extension page. */
export const CONTENT_MESSAGES = Object.freeze(['HELLO', 'JOBS', 'NET_BACK']);

/**
 * Route guard for runtime messages. Content scripts (a tab, a web page URL) may only send
 * CONTENT_MESSAGES. Settings and control messages must come from the extension's own pages.
 */
export function senderAllowed(type, sender, extensionBaseUrl) {
  const base = typeof extensionBaseUrl === 'string' ? extensionBaseUrl : '';
  const fromExtensionPage = base !== '' && typeof sender?.url === 'string' && sender.url.startsWith(base);
  if (CONTENT_MESSAGES.includes(type)) return !fromExtensionPage && typeof sender?.tab?.id === 'number';
  return fromExtensionPage;
}

/** Keep only short strings from a failures list received in a message. */
export function cleanFailures(failures) {
  return (Array.isArray(failures) ? failures : [])
    .filter(f => typeof f === 'string')
    .map(f => f.slice(0, 80))
    .slice(0, 10);
}

export function statusForReason(reason) {
  switch (reason) {
    case REASON.OFFLINE: return STATUS.OFFLINE;
    case REASON.NOT_READY: return STATUS.UNRESPONSIVE;
    case REASON.BLOCKED: return STATUS.BLOCKED;
    default: return STATUS.PARSE_FAILED;
  }
}

/**
 * Record a cycle outcome in stats and the ring buffer log.
 * @returns {{ stats: object, log: object[] }}
 */
export function withOutcome(stats = {}, log = [], { status, nowMs, note = '', source = null, failures = [] }) {
  const prevFailures = Number(stats.consecutiveFailures) || 0;
  const prevParse = Number(stats.consecutiveParseFailures) || 0;
  let consecutiveFailures = prevFailures;
  if (status === STATUS.OK) consecutiveFailures = 0;
  else if (backoffApplies(status)) consecutiveFailures = prevFailures + 1;

  let consecutiveParseFailures = prevParse;
  if (status === STATUS.OK) consecutiveParseFailures = 0;
  else if (status === STATUS.PARSE_FAILED) consecutiveParseFailures = prevParse + 1;

  const entry = { ts: nowMs, status, source, note: String(note).slice(0, 200), failures: cleanFailures(failures) };
  return {
    stats: { ...stats, status, consecutiveFailures, consecutiveParseFailures },
    log: [entry, ...(Array.isArray(log) ? log : [])].slice(0, LIMITS.LOG_MAX)
  };
}

const BADGE_COLORS = Object.freeze({ accent: '#10a37f', warn: '#d97706', danger: '#dc2626', idle: '#6b7280' });

/** Toolbar badge per SPEC 12.3. */
export function badgeFor(status, unreadAlerts = 0) {
  if (unreadAlerts > 0 && (status === STATUS.OK || status === STATUS.RUNNING)) {
    return { text: String(Math.min(unreadAlerts, 99)), color: BADGE_COLORS.accent };
  }
  switch (status) {
    case STATUS.RUNNING: return { text: '···', color: BADGE_COLORS.accent };
    case STATUS.PAUSED: return { text: 'II', color: BADGE_COLORS.idle };
    case STATUS.OFFLINE: return { text: 'off', color: BADGE_COLORS.warn };
    case STATUS.UNRESPONSIVE: return { text: '!', color: BADGE_COLORS.warn };
    case STATUS.PARSE_FAILED: return { text: '?', color: BADGE_COLORS.warn };
    case STATUS.NO_TAB: return { text: '-', color: BADGE_COLORS.idle };
    case STATUS.CAPPED: return { text: 'max', color: BADGE_COLORS.warn };
    case STATUS.BLOCKED: return { text: '!', color: BADGE_COLORS.danger };
    default: return { text: '', color: BADGE_COLORS.accent };
  }
}
