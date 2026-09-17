// U11. SPEC 8.2, 11, 12.3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decidePrecheck, isCycleSender, statusForReason, backoffApplies, withOutcome, badgeFor, reloadsThisHour,
  senderAllowed, cleanFailures
} from '../src/core/cycle.js';
import { clampSettings, applyPreset } from '../src/core/settings.js';
import { hourBucket } from '../src/core/schedule.js';
import { DEFAULTS, LIMITS } from '../src/core/constants.js';
import { isBaseJobsUrl } from '../src/core/validate.js';

const NOW = Date.UTC(2026, 8, 17, 9, 30);
const settings = clampSettings(DEFAULTS);
const tab = { id: 7, url: 'https://www.peopleperhour.com/freelance-jobs' };
const facts = (patch = {}) => ({ settings, stats: {}, cycleLock: null, tab, ping: { online: true }, nowMs: NOW,
  workerOnline: true, idleState: 'active', trigger: 'alarm', ...patch });

test('U11 happy path runs and patches stats', () => {
  const d = decidePrecheck(facts());
  assert.equal(d.action, 'run');
  assert.equal(d.tabId, 7);
  assert.equal(d.clearStaleLock, false);
  assert.deepEqual(d.statsPatch, { status: 'RUNNING', lastRunMs: NOW, hourBucketMs: hourBucket(NOW), reloadsThisHour: 1 });
});

test('U11 row 1: disabled pauses and stops, unless forced', () => {
  const off = { ...settings, enabled: false };
  assert.deepEqual(decidePrecheck(facts({ settings: off })),
    { action: 'skip', status: 'PAUSED', backoff: false, clearStaleLock: false, stop: true });
  assert.equal(decidePrecheck(facts({ settings: off, trigger: 'force' })).action, 'run');
});

test('U11 row 2: blocked stops entirely', () => {
  const d = decidePrecheck(facts({ stats: { status: 'BLOCKED' }, trigger: 'force' }));
  assert.equal(d.status, 'BLOCKED');
  assert.equal(d.stop, true);
});

test('U11 rows 3-4: fresh lock skips, stale lock is cleared and the cycle continues', () => {
  const fresh = decidePrecheck(facts({ cycleLock: { id: 'c', tabId: 7, startedMs: NOW - 60_000 } }));
  assert.equal(fresh.status, 'RUNNING');
  assert.equal(fresh.backoff, false);
  const stale = decidePrecheck(facts({ cycleLock: { id: 'c', tabId: 7, startedMs: NOW - LIMITS.LOCK_STALE_MS } }));
  assert.equal(stale.action, 'run');
  assert.equal(stale.clearStaleLock, true);
});

test('U11 row 5: hourly cap, reset on a new hour', () => {
  const capped = decidePrecheck(facts({ stats: { hourBucketMs: hourBucket(NOW), reloadsThisHour: 20 } }));
  assert.equal(capped.status, 'CAPPED');
  assert.equal(capped.nextAt, hourBucket(NOW) + 3_600_000);
  const lastHour = decidePrecheck(facts({ stats: { hourBucketMs: hourBucket(NOW) - 3_600_000, reloadsThisHour: 99 } }));
  assert.equal(lastHour.action, 'run');
  assert.equal(lastHour.statsPatch.reloadsThisHour, 1);
  const every3 = applyPreset(settings, 'every3');
  assert.equal(decidePrecheck(facts({ settings: every3, stats: { hourBucketMs: hourBucket(NOW), reloadsThisHour: 20 } })).action,
    'run', 'every 3 min raises the cap to 24');
  assert.equal(reloadsThisHour(undefined, NOW), 0);
  assert.equal(reloadsThisHour({ hourBucketMs: hourBucket(NOW), reloadsThisHour: 'x' }, NOW), 0);
});

test('U11 row 6: missing tab reopens, or skips when auto reopen is off', () => {
  const reopen = decidePrecheck(facts({ tab: null, ping: null }));
  assert.equal(reopen.action, 'reopen');
  assert.equal(reopen.tabId, null);
  const noTab = decidePrecheck(facts({ tab: null, ping: null, settings: { ...settings, autoReopenTab: false } }));
  assert.equal(noTab.status, 'NO_TAB');
  assert.equal(noTab.backoff, true);
});

test('U11 row 7: locked screen pauses only when the option is on', () => {
  assert.equal(decidePrecheck(facts({ idleState: 'locked' })).action, 'run');
  const d = decidePrecheck(facts({ idleState: 'locked', settings: { ...settings, pauseWhenLocked: true } }));
  assert.equal(d.status, 'PAUSED');
  assert.equal(d.stop, undefined, 'locked pause keeps the schedule alive');
});

test('U11 rows 8-10: offline via page or worker, unanswered PING still runs (R11)', () => {
  assert.deepEqual(decidePrecheck(facts({ ping: { online: false } })).status, 'OFFLINE');
  assert.equal(decidePrecheck(facts({ ping: { online: false } })).backoff, true);
  assert.equal(decidePrecheck(facts({ ping: null, workerOnline: false })).status, 'OFFLINE');
  const unanswered = decidePrecheck(facts({ ping: null }));
  assert.equal(unanswered.action, 'run', 'a tab without a content script is reloaded, not skipped forever');
  assert.equal(decidePrecheck(facts({ ping: null, workerOnline: undefined })).action, 'run');
});

test('U11 isCycleSender', () => {
  const lock = { id: 'c', tabId: 7, startedMs: NOW - 30_000 };
  assert.equal(isCycleSender(lock, { tab: { id: 7 }, frameId: 0 }, NOW), true);
  assert.equal(isCycleSender(lock, { tab: { id: 7 } }, NOW), true, 'frameId absent counts as top frame');
  assert.equal(isCycleSender(lock, { tab: { id: 8 }, frameId: 0 }, NOW), false, 'other tab');
  assert.equal(isCycleSender(lock, { tab: { id: 7 }, frameId: 3 }, NOW), false, 'subframe');
  assert.equal(isCycleSender(null, { tab: { id: 7 } }, NOW), false, 'no cycle');
  assert.equal(isCycleSender({ ...lock, tabId: null }, { tab: { id: 7 } }, NOW), false);
  assert.equal(isCycleSender(lock, undefined, NOW), false);
  assert.equal(isCycleSender({ ...lock, startedMs: NOW - LIMITS.LOCK_STALE_MS }, { tab: { id: 7 } }, NOW), false, 'stale');
});

test('U11 statusForReason and backoffApplies', () => {
  assert.equal(statusForReason('OFFLINE'), 'OFFLINE');
  assert.equal(statusForReason('NOT_READY'), 'UNRESPONSIVE');
  assert.equal(statusForReason('BLOCKED'), 'BLOCKED');
  assert.equal(statusForReason('NO_CARDS'), 'PARSE_FAILED');
  assert.equal(statusForReason('PARSE_FAILED'), 'PARSE_FAILED');
  assert.equal(statusForReason(undefined), 'PARSE_FAILED');
  for (const s of ['OFFLINE', 'UNRESPONSIVE', 'PARSE_FAILED', 'NO_TAB']) assert.equal(backoffApplies(s), true, s);
  for (const s of ['OK', 'PAUSED', 'RUNNING', 'CAPPED', 'BLOCKED']) assert.equal(backoffApplies(s), false, s);
});

test('U11 withOutcome counts failures and keeps a 50 entry log', () => {
  let state = { stats: { reloadsThisHour: 2 }, log: [] };
  state = withOutcome(state.stats, state.log, { status: 'PARSE_FAILED', nowMs: 1, failures: ['state:MISSING'] });
  state = withOutcome(state.stats, state.log, { status: 'PARSE_FAILED', nowMs: 2 });
  assert.equal(state.stats.consecutiveFailures, 2);
  assert.equal(state.stats.consecutiveParseFailures, 2);
  assert.equal(state.stats.reloadsThisHour, 2, 'other stats preserved');
  state = withOutcome(state.stats, state.log, { status: 'PAUSED', nowMs: 3 });
  assert.equal(state.stats.consecutiveFailures, 2, 'non-backoff statuses do not reset or add');
  state = withOutcome(state.stats, state.log, { status: 'OK', nowMs: 4, source: 'state', note: 'top 5' });
  assert.equal(state.stats.consecutiveFailures, 0);
  assert.equal(state.stats.consecutiveParseFailures, 0);
  assert.deepEqual(state.log[0], { ts: 4, status: 'OK', source: 'state', note: 'top 5', failures: [] });
  assert.deepEqual(state.log[3].failures, ['state:MISSING']);

  let big = { stats: undefined, log: 'corrupt' };
  for (let i = 0; i < 60; i++) big = withOutcome(big.stats, big.log, { status: 'OK', nowMs: i, note: 'n'.repeat(500) });
  assert.equal(big.log.length, LIMITS.LOG_MAX);
  assert.equal(big.log[0].ts, 59, 'newest first');
  assert.equal(big.log[0].note.length, 200);
});

test('U11 badgeFor follows SPEC 12.3', () => {
  const cases = { OK: '', RUNNING: '···', PAUSED: 'II', OFFLINE: 'off', UNRESPONSIVE: '!', PARSE_FAILED: '?',
    NO_TAB: '-', CAPPED: 'max', BLOCKED: '!', IDLE: '' };
  for (const [status, text] of Object.entries(cases)) assert.equal(badgeFor(status).text, text, status);
  assert.equal(badgeFor('BLOCKED').color, '#dc2626');
  assert.equal(badgeFor('OK', 3).text, '3');
  assert.equal(badgeFor('OK', 250).text, '99');
  assert.equal(badgeFor('OFFLINE', 3).text, 'off', 'problems outrank the alert count');
});

test('U11 senderAllowed: content scripts send page messages only, pages control the extension', () => {
  const base = 'chrome-extension://abc/';
  const content = { tab: { id: 7 }, frameId: 0, url: 'https://www.peopleperhour.com/freelance-jobs' };
  const options = { tab: { id: 9 }, url: `${base}ui/options.html` };
  const popup = { url: `${base}ui/popup.html` };
  for (const type of ['HELLO', 'JOBS', 'NET_BACK']) {
    assert.equal(senderAllowed(type, content, base), true, `content ${type}`);
    assert.equal(senderAllowed(type, popup, base), false, `popup ${type}`);
    assert.equal(senderAllowed(type, options, base), false, `options ${type}`);
  }
  for (const type of ['SAVE_SETTINGS', 'APPLY_PRESET', 'FORCE_CHECK', 'GET_STATUS']) {
    assert.equal(senderAllowed(type, content, base), false, `content ${type}`);
    assert.equal(senderAllowed(type, popup, base), true, `popup ${type}`);
    assert.equal(senderAllowed(type, options, base), true, `options ${type}`);
  }
  assert.equal(senderAllowed('JOBS', { url: 'https://www.peopleperhour.com/' }, base), false, 'no tab');
  assert.equal(senderAllowed('GET_STATUS', popup, ''), false, 'unknown extension base');
  assert.equal(senderAllowed('GET_STATUS', popup, undefined), false);
  assert.equal(senderAllowed('GET_STATUS', undefined, base), false);
  assert.equal(senderAllowed('GET_STATUS', { url: 'chrome-extension://other/ui/popup.html' }, base), false, 'other extension');
});

test('U11 cleanFailures', () => {
  assert.deepEqual(cleanFailures(['a', 42, null, 'b'.repeat(100)]), ['a', 'b'.repeat(80)]);
  assert.deepEqual(cleanFailures('state:MISSING'), []);
  assert.equal(cleanFailures(Array(20).fill('x')).length, 10);
});

test('isBaseJobsUrl: reload only the first page of the list', () => {
  assert.equal(isBaseJobsUrl('https://www.peopleperhour.com/freelance-jobs'), true);
  assert.equal(isBaseJobsUrl('https://www.peopleperhour.com/freelance-jobs#top'), true);
  assert.equal(isBaseJobsUrl('https://www.peopleperhour.com/freelance-jobs?page=2'), false);
  assert.equal(isBaseJobsUrl('https://www.peopleperhour.com/freelance-jobs/design/logo-4522017'), false);
  assert.equal(isBaseJobsUrl('about:blank'), false);
  assert.equal(isBaseJobsUrl(undefined), false);
});
