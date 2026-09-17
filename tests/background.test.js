// Worker integration tests: the real src/background.js against an in-memory fake chrome.
// Stands in for SPEC 22.2 tests 7, 10, 11, 13, 14, 16, 17, 26, 29, 30 where Chrome itself is not needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome, flush, EXTENSION_BASE } from './fakes/chrome.js';
import { BASE_URL, DEFAULTS, LIMITS } from '../src/core/constants.js';
import { clampSettings } from '../src/core/settings.js';
import { hourBucket } from '../src/core/schedule.js';
import { jobsFromState } from '../src/core/parser.js';
import { makeState, IDS } from './fixtures/synthetic.js';

const T0 = Date.UTC(2026, 8, 17, 10, 7, 0);
const SEC = 1000;
const MIN = 60_000;
const OPTIONS_PAGE = { url: `${EXTENSION_BASE}ui/options.html` };
const pageSender = tabId => ({ tab: { id: tabId }, frameId: 0, url: BASE_URL });

let instance = 0;

/** Fresh worker on a fake chrome, with Date and Math.random under test control. */
async function startWorker(t, { fake = createFakeChrome(), now = T0, install = true, timers = true } = {}) {
  if (timers) {
    t.mock.timers.enable({ apis: ['Date'], now });
    t.mock.method(Math, 'random', () => 0);
  }
  globalThis.chrome = fake.api;
  await import(`../src/background.js?instance=${instance++}`);
  if (install) {
    fake.emit('runtime.onInstalled', { reason: 'install' });
    await flush();
  }
  return fake;
}

const local = (fake, key) => fake.areas.local.get(key);
const session = (fake, key) => fake.areas.session.get(key);
const stats = fake => local(fake, 'stats') ?? {};
const alarmAt = (fake, name) => fake.alarms.get(name)?.scheduledTime;

async function fireAlarm(fake, name) {
  fake.alarms.delete(name);                        // Chrome one-shot alarms are gone once they fire
  fake.emit('alarms.onAlarm', { name, scheduledTime: Date.now() });
  await flush();
}

async function send(fake, msg, sender = OPTIONS_PAGE) {
  const reply = await fake.sendRuntime(msg, sender);
  await flush();
  return reply;
}

function goodResult(nowMs, topN = 5) {
  return { ok: true, source: 'state', serverTimeMs: nowMs, jobs: jobsFromState(makeState(IDS, { serverTimeMs: nowMs }), nowMs, topN), failures: [] };
}

function seedMonitorTab(fake, url = BASE_URL) {
  const id = fake.openTab(url);
  fake.areas.session.set('monitorTabId', id);
  return id;
}

// ------------------------------------------------------------------ lifecycle

test('install saves clamped defaults and arms the first check in 30 s', async (t) => {
  const fake = await startWorker(t);
  assert.deepEqual(local(fake, 'settings'), clampSettings(DEFAULTS));
  assert.equal(alarmAt(fake, 'tick'), T0 + 30 * SEC);
  assert.equal(stats(fake).nextRunMs, T0 + 30 * SEC);
  assert.equal(fake.badge.text, '');
});

test('startup keeps user timing, clamps junk, and does not re-arm an existing timer', async (t) => {
  const fake = createFakeChrome();
  fake.areas.local.set('settings', { intervalMode: 'fixed', minIntervalMin: 1, evil: true });
  await startWorker(t, { fake, install: false });
  fake.emit('runtime.onStartup');
  await flush();
  const settings = local(fake, 'settings');
  assert.equal(settings.intervalMode, 'fixed');
  assert.equal(settings.minIntervalMin, 2);
  assert.equal('evil' in settings, false);
  assert.equal(alarmAt(fake, 'tick'), T0 + 30 * SEC);

  t.mock.timers.tick(10 * SEC);
  fake.emit('runtime.onStartup');
  await flush();
  assert.equal(alarmAt(fake, 'tick'), T0 + 30 * SEC, 'existing alarm kept');
});

// ------------------------------------------------------------------ the cycle

test('first tick opens a pinned monitor tab, locks, arms the watchdog, then navigates (test 7)', async (t) => {
  const fake = await startWorker(t);
  await fireAlarm(fake, 'tick');

  const tabId = session(fake, 'monitorTabId');
  assert.equal(typeof tabId, 'number');
  assert.deepEqual(fake.calls.find(c => c[0] === 'create'), ['create', tabId, 'about:blank', { pinned: true, active: false }]);
  assert.deepEqual(fake.calls.find(c => c[0] === 'update'), ['update', tabId, { url: BASE_URL }]);

  const lock = session(fake, 'cycleLock');
  assert.equal(lock.tabId, tabId);
  assert.equal(lock.startedMs, T0);
  assert.equal(alarmAt(fake, 'watchdog'), T0 + LIMITS.WATCHDOG_MIN * MIN);
  assert.equal(stats(fake).status, 'RUNNING');
  assert.equal(stats(fake).reloadsThisHour, 1);
  assert.equal(fake.badge.text, '···');
});

test('HELLO: only the locked monitor tab is told to report (test 29)', async (t) => {
  const fake = await startWorker(t);
  const otherTab = fake.openTab(BASE_URL);
  assert.deepEqual(await send(fake, { type: 'HELLO' }, pageSender(otherTab)),
    { isMonitor: false, topN: 5, settleSec: 20, debug: false }, 'no cycle yet');

  await fireAlarm(fake, 'tick');
  const monitor = session(fake, 'monitorTabId');
  assert.equal((await send(fake, { type: 'HELLO' }, pageSender(monitor))).isMonitor, true);
  assert.equal((await send(fake, { type: 'HELLO' }, pageSender(otherTab))).isMonitor, false);
  assert.equal((await send(fake, { type: 'HELLO' }, { ...pageSender(monitor), frameId: 2 })).isMonitor, false, 'subframe');
  assert.deepEqual(await send(fake, { type: 'HELLO' }, OPTIONS_PAGE), { ok: false, error: 'FORBIDDEN' });
});

test('JOBS from the monitor tab completes the cycle and anchors the next check on cycle start', async (t) => {
  const fake = await startWorker(t);
  await fireAlarm(fake, 'tick');
  const monitor = session(fake, 'monitorTabId');
  t.mock.timers.tick(25 * SEC);

  const stray = await send(fake, { type: 'JOBS', result: goodResult(Date.now()) }, pageSender(fake.openTab(BASE_URL)));
  assert.deepEqual(stray, { ok: false, ignored: true }, 'other tabs are ignored');
  assert.ok(session(fake, 'cycleLock'), 'lock untouched by the stray message');

  assert.deepEqual(await send(fake, { type: 'JOBS', result: goodResult(Date.now()) }, pageSender(monitor)), { ok: true, fresh: 2 });
  assert.equal(session(fake, 'cycleLock'), undefined);
  assert.equal(fake.alarms.has('watchdog'), false);
  const s = stats(fake);
  assert.equal(s.status, 'OK');
  assert.equal(s.consecutiveFailures, 0);
  assert.equal(local(fake, 'lastJobs').length, 5);
  assert.equal(local(fake, 'log')[0].status, 'OK');
  assert.equal(local(fake, 'log')[0].source, 'state');
  assert.equal(alarmAt(fake, 'tick'), T0 + 5 * MIN, 'random 5-10 with rand 0, from cycle start not cycle end');
  assert.equal(s.nextRunMs, T0 + 5 * MIN);
  assert.equal(fake.badge.text, '2', 'badge shows the two new jobs found');
});

test('the worker re-validates JOBS and maps page failure reasons', async (t) => {
  const fake = await startWorker(t);
  await fireAlarm(fake, 'tick');
  const monitor = session(fake, 'monitorTabId');
  const tampered = goodResult(Date.now());
  tampered.jobs[4] = { ...tampered.jobs[0] };
  await send(fake, { type: 'JOBS', result: tampered }, pageSender(monitor));
  assert.equal(stats(fake).status, 'PARSE_FAILED');
  assert.deepEqual(local(fake, 'log')[0].failures, ['worker:GATE_DUP_ID']);
  assert.equal(stats(fake).consecutiveFailures, 1);
  assert.equal(fake.badge.text, '?');

  t.mock.timers.tick(5 * MIN);
  await fireAlarm(fake, 'tick');
  await send(fake, { type: 'JOBS', result: { ok: false, reason: 'NOT_READY', failures: ['x', 42] } }, pageSender(monitor));
  assert.equal(stats(fake).status, 'UNRESPONSIVE');
  assert.deepEqual(local(fake, 'log')[0].failures, ['x']);
  assert.equal(stats(fake).consecutiveFailures, 2);
  assert.equal(alarmAt(fake, 'tick'), T0 + 5 * MIN + 10 * MIN, 'second failure backs off to 10 min');
});

test('watchdog marks a silent cycle UNRESPONSIVE and keeps the schedule alive (test 13)', async (t) => {
  const fake = await startWorker(t);
  await fireAlarm(fake, 'watchdog');
  assert.notEqual(stats(fake).status, 'UNRESPONSIVE', 'watchdog without a cycle does nothing');

  await fireAlarm(fake, 'tick');
  t.mock.timers.tick(90 * SEC);
  await fireAlarm(fake, 'watchdog');
  assert.equal(stats(fake).status, 'UNRESPONSIVE');
  assert.equal(session(fake, 'cycleLock'), undefined);
  assert.equal(alarmAt(fake, 'tick'), T0 + 5 * MIN);
  assert.deepEqual(local(fake, 'log')[0].failures, ['watchdog']);
});

// ------------------------------------------------------------------ timing

test('live interval change: 10 -> 3 moves the next check up, 3 -> 10 moves it out (test 26)', async (t) => {
  const fake = await startWorker(t);
  assert.equal((await send(fake, { type: 'APPLY_PRESET', preset: 'every10' })).preset, 'every10');
  await fireAlarm(fake, 'tick');
  const monitor = session(fake, 'monitorTabId');
  t.mock.timers.tick(20 * SEC);
  await send(fake, { type: 'JOBS', result: goodResult(Date.now()) }, pageSender(monitor));
  assert.equal(alarmAt(fake, 'tick'), T0 + 10 * MIN);

  t.mock.timers.setTime(T0 + 4 * MIN);
  const reply = await send(fake, { type: 'APPLY_PRESET', preset: 'every3' });
  assert.equal(reply.ok, true);
  assert.equal(reply.settings.minIntervalMin, 3);
  assert.equal(alarmAt(fake, 'tick'), T0 + 4 * MIN + 30 * SEC, 'overdue at 3 min, so 30 s from now');
  assert.equal(stats(fake).nextRunMs, alarmAt(fake, 'tick'), 'popup countdown follows');

  await send(fake, { type: 'APPLY_PRESET', preset: 'every10' });
  assert.equal(alarmAt(fake, 'tick'), T0 + 10 * MIN);

  await send(fake, { type: 'SAVE_SETTINGS', patch: { intervalMode: 'fixed', minIntervalMin: 7 } });
  assert.equal(alarmAt(fake, 'tick'), T0 + 7 * MIN, 'custom value');

  const before = alarmAt(fake, 'tick');
  await send(fake, { type: 'SAVE_SETTINGS', patch: { topN: 8 } });
  assert.equal(alarmAt(fake, 'tick'), before, 'non-timing changes do not touch the timer');
});

test('an interval change during a cycle applies when that cycle finishes', async (t) => {
  const fake = await startWorker(t);
  await fireAlarm(fake, 'tick');
  const monitor = session(fake, 'monitorTabId');
  await send(fake, { type: 'APPLY_PRESET', preset: 'every3' });
  assert.equal(fake.alarms.has('tick'), false, 'no timer while the cycle is in flight');
  t.mock.timers.tick(22 * SEC);
  await send(fake, { type: 'JOBS', result: goodResult(Date.now()) }, pageSender(monitor));
  assert.equal(alarmAt(fake, 'tick'), T0 + 3 * MIN);
});

test('pause clears the timer and skips, resume re-arms in 30 s', async (t) => {
  const fake = await startWorker(t);
  await send(fake, { type: 'SET_ENABLED', enabled: false });
  assert.equal(local(fake, 'settings').enabled, false);
  assert.equal(fake.alarms.has('tick'), false);
  assert.equal(stats(fake).status, 'PAUSED');
  assert.equal(fake.badge.text, 'II');

  await fireAlarm(fake, 'tick');                       // a stale alarm firing anyway
  assert.equal(fake.calls.some(c => c[0] === 'create'), false, 'paused never opens or reloads');
  assert.equal(fake.alarms.has('tick'), false);

  t.mock.timers.tick(MIN);
  await send(fake, { type: 'SET_ENABLED', enabled: true });
  assert.equal(stats(fake).status, 'IDLE');
  assert.equal(alarmAt(fake, 'tick'), T0 + MIN + 30 * SEC);
});

test('hourly cap waits for the next hour', async (t) => {
  const fake = await startWorker(t);
  fake.areas.local.set('stats', { hourBucketMs: hourBucket(T0), reloadsThisHour: 20 });
  await fireAlarm(fake, 'tick');
  assert.equal(stats(fake).status, 'CAPPED');
  assert.equal(fake.calls.some(c => c[0] === 'create' || c[0] === 'reload'), false);
  assert.equal(alarmAt(fake, 'tick'), hourBucket(T0) + 60 * MIN);
  assert.equal(fake.badge.text, 'max');
});

// ------------------------------------------------------------------ failures and recovery

test('offline page: no reload, backoff, and NET_BACK brings the check forward (tests 10, 11)', async (t) => {
  const fake = await startWorker(t, { fake: createFakeChrome({ ping: { online: false, ready: true } }) });
  const monitor = seedMonitorTab(fake);
  await fireAlarm(fake, 'tick');
  assert.equal(stats(fake).status, 'OFFLINE');
  assert.equal(fake.calls.some(c => c[0] === 'reload' || c[0] === 'update'), false, 'no reload attempted');
  assert.equal(stats(fake).consecutiveFailures, 1);
  assert.equal(alarmAt(fake, 'tick'), T0 + 5 * MIN);

  t.mock.timers.setTime(T0 + 5 * MIN);
  await fireAlarm(fake, 'tick');
  assert.equal(stats(fake).consecutiveFailures, 2);
  assert.equal(alarmAt(fake, 'tick'), T0 + 15 * MIN);

  t.mock.timers.tick(MIN);
  assert.deepEqual(await send(fake, { type: 'NET_BACK' }, pageSender(monitor)), { ok: true, rescheduled: true });
  assert.equal(stats(fake).consecutiveFailures, 0);
  assert.equal(alarmAt(fake, 'tick'), T0 + 6 * MIN + 30 * SEC);
  assert.deepEqual(await send(fake, { type: 'NET_BACK' }, pageSender(monitor)), { ok: true, rescheduled: false }, 'repeats do not push it out');
});

test('a tab with no content script is still reloaded (test 30, R11)', async (t) => {
  const fake = await startWorker(t, { fake: createFakeChrome({ ping: new Error('Receiving end does not exist.') }) });
  const monitor = seedMonitorTab(fake);
  await fireAlarm(fake, 'tick');
  assert.deepEqual(fake.calls.find(c => c[0] === 'reload'), ['reload', monitor, { bypassCache: true }]);
  assert.equal(session(fake, 'cycleLock').tabId, monitor);
});

test('a monitor tab that wandered off is navigated back to the list', async (t) => {
  const fake = await startWorker(t);
  const monitor = seedMonitorTab(fake, `${BASE_URL}/design/logo-design/logo-4522017`);
  await fireAlarm(fake, 'tick');
  assert.deepEqual(fake.calls.find(c => c[0] === 'update'), ['update', monitor, { url: BASE_URL }]);
  assert.equal(fake.calls.some(c => c[0] === 'reload'), false);
});

test('closing the monitor tab mid-cycle fails NO_TAB and the next tick reopens it (test 14)', async (t) => {
  const fake = await startWorker(t);
  await fireAlarm(fake, 'tick');
  const first = session(fake, 'monitorTabId');
  fake.closeTab(first);
  await flush();
  assert.equal(stats(fake).status, 'NO_TAB');
  assert.equal(session(fake, 'monitorTabId'), undefined);
  assert.equal(session(fake, 'cycleLock'), undefined);
  assert.equal(fake.badge.text, '-');

  t.mock.timers.setTime(alarmAt(fake, 'tick'));
  await fireAlarm(fake, 'tick');
  const second = session(fake, 'monitorTabId');
  assert.ok(second && second !== first, 'a new pinned tab was opened');
});

test('BLOCKED stops the schedule until the user resumes', async (t) => {
  const fake = await startWorker(t);
  await fireAlarm(fake, 'tick');
  await send(fake, { type: 'JOBS', result: { ok: false, reason: 'BLOCKED' } }, pageSender(session(fake, 'monitorTabId')));
  assert.equal(stats(fake).status, 'BLOCKED');
  assert.equal(fake.alarms.has('tick'), false);
  assert.equal(fake.badge.text, '!');
  assert.equal(fake.badge.color, '#dc2626');

  await send(fake, { type: 'APPLY_PRESET', preset: 'every3' });
  assert.equal(fake.alarms.has('tick'), false, 'changing the interval does not restart a blocked monitor');
  t.mock.timers.tick(MIN);
  const forced = await send(fake, { type: 'FORCE_CHECK' });
  assert.deepEqual(forced, { started: false, reason: 'BLOCKED' });

  const resumed = await send(fake, { type: 'RESUME_FROM_BLOCK' });
  assert.equal(resumed.ok, true);
  assert.equal(stats(fake).status, 'IDLE');
  assert.equal(alarmAt(fake, 'tick'), Date.now() + 30 * SEC);
});

test('worker restart mid-cycle: a stale lock is cleared and the next tick runs (test 17)', async (t) => {
  const first = await startWorker(t);
  await fireAlarm(first, 'tick');
  assert.ok(session(first, 'cycleLock'));

  // The worker dies. Storage, alarms and tabs survive; a new worker instance starts cold.
  const second = createFakeChrome();
  for (const name of ['local', 'session']) for (const [k, v] of first.areas[name]) second.areas[name].set(k, v);
  for (const [k, v] of first.tabs) second.tabs.set(k, { ...v, url: BASE_URL });
  await startWorker(t, { fake: second, install: false, timers: false });

  t.mock.timers.setTime(T0 + 3 * MIN);
  await fireAlarm(second, 'tick');
  const lock = session(second, 'cycleLock');
  assert.equal(lock.startedMs, T0 + 3 * MIN, 'new cycle replaced the stale lock');
  assert.ok(second.calls.some(c => c[0] === 'reload'));
});

// ------------------------------------------------------------------ controls and security

test('FORCE_CHECK runs now, honours a debug settle override, and is rate limited', async (t) => {
  const fake = await startWorker(t);
  await send(fake, { type: 'SAVE_SETTINGS', patch: { debug: true, enabled: false } });
  const started = await send(fake, { type: 'FORCE_CHECK', settleSec: 3 });
  assert.equal(started.started, true, 'force works even while paused');
  const monitor = session(fake, 'monitorTabId');
  assert.equal((await send(fake, { type: 'HELLO' }, pageSender(monitor))).settleSec, 3);

  t.mock.timers.tick(10 * SEC);
  await send(fake, { type: 'JOBS', result: goodResult(Date.now()) }, pageSender(monitor));
  assert.deepEqual(await send(fake, { type: 'FORCE_CHECK' }), { started: false, reason: 'TOO_SOON' });
  t.mock.timers.tick(25 * SEC);
  assert.equal((await send(fake, { type: 'FORCE_CHECK' })).started, true);
});

test('content scripts cannot change settings or trigger checks', async (t) => {
  const fake = await startWorker(t);
  const tab = fake.openTab(BASE_URL);
  const before = local(fake, 'settings');
  for (const msg of [
    { type: 'SAVE_SETTINGS', patch: { enabled: false } },
    { type: 'APPLY_PRESET', preset: 'every3' },
    { type: 'FORCE_CHECK' },
    { type: 'GET_STATUS' }
  ]) assert.deepEqual(await send(fake, msg, pageSender(tab)), { ok: false, error: 'FORBIDDEN' }, msg.type);
  assert.deepEqual(local(fake, 'settings'), before);
  assert.equal(await send(fake, { type: 'NOT_A_MESSAGE' }), undefined, 'unknown types are not answered');
});

test('OPEN_MONITOR_TAB opens one pinned tab, then focuses it', async (t) => {
  const fake = await startWorker(t);
  t.mock.timers.tick(10 * SEC);
  const { tabId } = await send(fake, { type: 'OPEN_MONITOR_TAB' });
  assert.deepEqual(fake.calls.find(c => c[0] === 'create'), ['create', tabId, BASE_URL, { pinned: true, active: true }]);
  assert.equal(alarmAt(fake, 'tick'), T0 + 40 * SEC, 'first check soon after opening');
  assert.deepEqual(await send(fake, { type: 'OPEN_MONITOR_TAB' }), { tabId });
  assert.equal(fake.calls.filter(c => c[0] === 'create').length, 1);
});

test('"use my own tab" mode adopts an open jobs tab instead of opening one', async (t) => {
  const fake = await startWorker(t);
  await send(fake, { type: 'SAVE_SETTINGS', patch: { useOwnTab: false } });
  const mine = fake.openTab(BASE_URL);
  await fireAlarm(fake, 'tick');
  assert.equal(session(fake, 'monitorTabId'), mine);
  assert.equal(fake.calls.some(c => c[0] === 'create'), false);
  assert.ok(fake.calls.some(c => c[0] === 'reload' && c[1] === mine));
});

test('GET_STATUS summarises state for the popup', async (t) => {
  const fake = await startWorker(t);
  await send(fake, { type: 'APPLY_PRESET', preset: 'every3' });
  const status = await send(fake, { type: 'GET_STATUS' });
  assert.equal(status.preset, 'every3');
  assert.equal(status.effectiveFreshMin, 10);
  assert.equal(status.reloadCap, 24);
  assert.equal(status.loadsPerHour, 20);
  assert.equal(status.running, false);
  assert.equal(status.monitorTabId, null);
  assert.equal(status.msToNext, 30 * SEC);
  assert.deepEqual(status.lastJobs, []);
});

// ------------------------------------------------------------------ alerts (Phase 3)

async function completeCycle(fake, t, result) {
  await fireAlarm(fake, 'tick');
  const monitor = session(fake, 'monitorTabId');
  t.mock.timers.tick(22 * SEC);
  const reply = await send(fake, { type: 'JOBS', result: result ?? goodResult(Date.now()) }, pageSender(monitor));
  return { monitor, reply };
}

test('new jobs raise notifications and exactly one sound; the same jobs never alert twice (tests 8, 9)', async (t) => {
  const fake = await startWorker(t);
  const { reply } = await completeCycle(fake, t);
  assert.deepEqual(reply, { ok: true, fresh: 2 }, 'jobs 4 and 11 min old are inside the 12 min window');
  assert.deepEqual([...fake.notifications.keys()], ['pph-4521929', 'pph-4521928']);
  const first = fake.notifications.get('pph-4521929');
  assert.equal(first.title, 'Job 4521929');
  assert.match(first.message, /^£88 fixed · 8 proposals · posted 4 min ago$/);
  assert.equal(first.silent, true);
  assert.equal(first.requireInteraction, true);
  assert.match(first.iconUrl, /icons\/notif-128\.png$/);
  assert.deepEqual(fake.sounds, [{ file: 'sounds/chime.wav', volume: 0.8 }]);
  assert.deepEqual(fake.calls.filter(c => c[0] === 'offscreen'), [['offscreen', ['AUDIO_PLAYBACK']]]);
  assert.equal(stats(fake).totalAlerts, 2);
  assert.equal(stats(fake).unreadAlerts, 2);
  assert.equal(fake.badge.text, '2');
  assert.equal(Object.keys(local(fake, 'seen')).length, 5, 'all top 5 are remembered, not just the alerted ones');
  assert.match(local(fake, 'log')[0].note, /2 new, sound/);

  fake.notifications.clear();
  t.mock.timers.setTime(alarmAt(fake, 'tick'));
  const again = await completeCycle(fake, t);
  assert.deepEqual(again.reply, { ok: true, fresh: 0 });
  assert.equal(fake.notifications.size, 0, 'no repeat notifications');
  assert.equal(fake.sounds.length, 1, 'no repeat sound');
});

test('five new jobs give the capped notifications, one summary and one sound (test 8)', async (t) => {
  const fake = await startWorker(t);
  await send(fake, { type: 'SAVE_SETTINGS', patch: { freshWindowMin: 60 } });
  await completeCycle(fake, t);
  const ids = [...fake.notifications.keys()];
  assert.equal(ids.length, 4);
  assert.deepEqual(ids.slice(0, 3), ['pph-4521929', 'pph-4521928', 'pph-4521927']);
  assert.match(ids[3], /^pph-summary-/);
  assert.equal(fake.notifications.get(ids[3]).title, '2 more new jobs');
  assert.equal(fake.sounds.length, 1);
});

test('filters, mute and the loud sound for high budgets', async (t) => {
  const fake = await startWorker(t);
  await send(fake, { type: 'SAVE_SETTINGS', patch: { sound: { highValueBudget: 50 }, filters: { keywordsExclude: ['4521928'] } } });
  await completeCycle(fake, t);
  assert.deepEqual([...fake.notifications.keys()], ['pph-4521929'], 'excluded keyword filtered out');
  assert.deepEqual(fake.sounds, [{ file: 'sounds/alarm.wav', volume: 0.8 }], 'budget 88 >= 50 plays the loud sound');

  const muted = await startWorker(t, { timers: false });
  await send(muted, { type: 'SAVE_SETTINGS', patch: { sound: { enabled: false } } });
  await completeCycle(muted, t);
  assert.equal(muted.notifications.size, 2);
  assert.equal(muted.sounds.length, 0);
});

test('clicking a job notification opens that job; the summary focuses the monitor tab', async (t) => {
  const fake = await startWorker(t);
  await send(fake, { type: 'SAVE_SETTINGS', patch: { freshWindowMin: 60, maxNotificationsPerCycle: 1 } });
  const { monitor } = await completeCycle(fake, t);
  fake.emit('notifications.onClicked', 'pph-4521929');
  await flush();
  const opened = fake.calls.filter(c => c[0] === 'create' && c[2] !== 'about:blank');
  assert.deepEqual(opened.map(c => c[2]),
    ['https://www.peopleperhour.com/freelance-jobs/technology-programming/website-development/i-need-a-sample-website-4521929']);
  assert.equal(fake.notifications.has('pph-4521929'), false, 'clicked notification is cleared');

  const summaryId = [...fake.notifications.keys()].find(id => id.startsWith('pph-summary-'));
  fake.emit('notifications.onClicked', summaryId);
  await flush();
  assert.equal(fake.calls.filter(c => c[0] === 'create').length, 2, 'summary opens nothing new');
  assert.ok(fake.calls.some(c => c[0] === 'update' && c[1] === monitor && c[2].active === true), 'monitor tab focused');

  fake.emit('notifications.onClicked', 'another-extension-notification');
  await flush();
  assert.equal(fake.calls.filter(c => c[0] === 'create').length, 2);
});

test('a job with an unsafe url still alerts but never opens that url', async (t) => {
  const fake = await startWorker(t);
  const result = goodResult(T0 + 22 * SEC);
  result.jobs[0] = { ...result.jobs[0], url: 'https://evil.example/phish' };
  await completeCycle(fake, t, result);
  assert.ok(fake.notifications.has('pph-4521929'));
  fake.emit('notifications.onClicked', 'pph-4521929');
  await flush();
  assert.equal(fake.calls.some(c => c[0] === 'create' && String(c[2]).includes('evil')), false);
});

test('two unreadable pages in a row raise one layout notice; BLOCKED raises one blocked notice', async (t) => {
  const fake = await startWorker(t);
  await completeCycle(fake, t, { ok: false, reason: 'PARSE_FAILED' });
  assert.equal(fake.notifications.has('pph-layout'), false, 'one failure is not worth a notification');
  t.mock.timers.setTime(alarmAt(fake, 'tick'));
  await completeCycle(fake, t, { ok: false, reason: 'NO_CARDS' });
  assert.equal(fake.notifications.has('pph-layout'), true);

  t.mock.timers.setTime(alarmAt(fake, 'tick'));
  await completeCycle(fake, t, { ok: false, reason: 'BLOCKED' });
  assert.equal(fake.notifications.get('pph-blocked').requireInteraction, true);
});

test('Test notification, Test sound, clear unread, clear seen, reset settings', async (t) => {
  const fake = await startWorker(t);
  assert.deepEqual(await send(fake, { type: 'TEST_NOTIFICATION' }), { ok: true });
  assert.ok(fake.notifications.has('pph-test'));
  assert.deepEqual(await send(fake, { type: 'TEST_SOUND', file: 'sounds/ping.wav', volume: 0.3 }), { ok: true });
  assert.deepEqual(await send(fake, { type: 'TEST_SOUND', file: 'https://evil.example/x.mp3', volume: 7 }), { ok: true });
  assert.deepEqual(fake.sounds, [{ file: 'sounds/ping.wav', volume: 0.3 }, { file: 'sounds/chime.wav', volume: 1 }],
    'unknown files fall back to the chosen sound, volume is clamped');

  await completeCycle(fake, t);
  assert.equal(fake.badge.text, '2');
  await send(fake, { type: 'CLEAR_UNREAD' });
  assert.equal(stats(fake).unreadAlerts, 0);
  assert.equal(fake.badge.text, '');
  await send(fake, { type: 'CLEAR_SEEN' });
  assert.deepEqual(local(fake, 'seen'), {});

  await send(fake, { type: 'APPLY_PRESET', preset: 'every3' });
  const reset = await send(fake, { type: 'RESET_SETTINGS' });
  assert.deepEqual(reset.settings, clampSettings(DEFAULTS));
});

test('a sound that fails to play never breaks the cycle', async (t) => {
  const fake = await startWorker(t, { fake: createFakeChrome({ soundReply: { ok: false, error: 'NotAllowedError' } }) });
  t.mock.method(console, 'warn', () => {});
  const { reply } = await completeCycle(fake, t);
  assert.deepEqual(reply, { ok: true, fresh: 2 });
  assert.equal(stats(fake).status, 'OK');
  assert.ok(alarmAt(fake, 'tick'));
});
