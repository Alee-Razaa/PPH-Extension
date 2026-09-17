// Service worker (type: module). Wiring only: facts come from platform/, decisions from core/.
// SPEC 4.2 (inverted cycle), 4.4 (timing), 8 (cycle), 10 (messages), 11 (errors), 26 (skeleton).
import { LIMITS, MSG, STATUS, ALARM, BASE_URL, SOUND_FILES } from './core/constants.js';
import { mergeSettings, clampSettings, timingChanged, applyPreset, presetOf } from './core/settings.js';
import { nextDelayMin, nextRunAt, reloadCap, effectiveFreshMin, loadsPerHour, ALARM_FLOOR_MS } from './core/schedule.js';
import {
  decidePrecheck, isCycleSender, statusForReason, withOutcome, senderAllowed, cleanFailures
} from './core/cycle.js';
import { sanitizeJob, checkGates, isPphUrl } from './core/validate.js';
import { pickFresh, markSeen, pruneSeen } from './core/select.js';
import { planAlerts, SYSTEM_NOTICES } from './core/alerts.js';
import { formatAge } from './core/time.js';
import * as on from './platform/events.js';
import * as store from './platform/storage.js';
import * as alarms from './platform/alarms.js';
import * as tabs from './platform/tabs.js';
import * as idle from './platform/idle.js';
import { getURL } from './platform/runtime.js';
import { paint } from './platform/badge.js';
import * as notifications from './platform/notifications.js';
import { playSound } from './platform/offscreen.js';

const JOBS_TAB_PATTERN = `${BASE_URL}*`;
const FORCE_MIN_GAP_MS = 30_000;
const CAPPED_JITTER_MS = 60_000;

// State-changing work runs one task at a time within a worker lifetime, so a tick, a JOBS message
// and a settings change can never interleave their storage reads and writes.
let queue = Promise.resolve();
function serial(task) {
  const run = queue.then(() => task());
  queue = run.catch(() => {});
  return run;
}

function guard(handlers) {
  return Object.fromEntries(Object.entries(handlers).map(([type, handler]) => [
    type,
    (msg, sender) => (senderAllowed(type, sender, getURL('')) ? handler(msg, sender) : { ok: false, error: 'FORBIDDEN' })
  ]));
}

const HANDLERS = guard({
  [MSG.HELLO]: onHello,
  [MSG.JOBS]: (msg, sender) => serial(() => onJobs(msg, sender)),
  [MSG.NET_BACK]: () => serial(onNetBack),
  [MSG.GET_STATUS]: buildStatus,
  [MSG.FORCE_CHECK]: msg => serial(() => forceCheck(msg)),
  [MSG.SET_ENABLED]: ({ enabled }) => serial(() => saveSettings(s => ({ ...s, enabled: enabled === true }))),
  [MSG.APPLY_PRESET]: ({ preset }) => serial(() => saveSettings(s => applyPreset(s, preset))),
  [MSG.SAVE_SETTINGS]: ({ patch }) => serial(() => saveSettings(s => mergeSettings(s, patch))),
  [MSG.RESUME_FROM_BLOCK]: () => serial(resumeFromBlock),
  [MSG.OPEN_MONITOR_TAB]: () => serial(openMonitorTab),
  [MSG.CLEAR_LOG]: () => serial(async () => ({ ok: await store.setLocal({ log: [] }) })),
  [MSG.CLEAR_SEEN]: () => serial(async () => ({ ok: await store.setLocal({ seen: {} }) })),
  [MSG.CLEAR_UNREAD]: () => serial(clearUnread),
  [MSG.RESET_SETTINGS]: () => serial(() => saveSettings(() => ({}))),
  [MSG.TEST_NOTIFICATION]: () => serial(testNotification),
  [MSG.TEST_SOUND]: msg => serial(() => testSound(msg))
});

// ---- listeners registered SYNCHRONOUSLY at top level (SPEC 20) ----
on.installed(() => serial(bootstrap));
on.startup(() => serial(bootstrap));
on.alarm(onAlarm);
on.message(HANDLERS);
on.tabRemoved(tabId => serial(() => onTabRemoved(tabId)));
on.storageChanged(onStorageChanged);
on.notificationClicked(id => serial(() => onNotificationClicked(id)));

// ---------------------------------------------------------------- lifecycle

async function readState() {
  const { settings: stored, stats = {}, log = [] } = await store.getLocal(['settings', 'stats', 'log']);
  return { settings: clampSettings(stored), stats, log };
}

async function patchStats(patch) {
  const { stats = {} } = await store.getLocal(['stats']);
  await store.setLocal({ stats: { ...stats, ...patch } });
}

async function bootstrap() {
  const { settings, stats } = await readState();
  await store.setLocal({ settings });                  // migrate + clamp (SPEC 9)
  await store.removeSession('cycleLock');
  await alarms.clear(ALARM.WATCHDOG);
  if (!settings.enabled) {
    await alarms.clear(ALARM.TICK);
    await patchStats({ status: STATUS.PAUSED, nextRunMs: null });
  } else if (stats.status !== STATUS.BLOCKED && !(await alarms.get(ALARM.TICK))) {
    await scheduleNext(settings, 0, 0);                // first check in 30 s
  }
  await paintFromStats();
}

async function scheduleNext(settings, failures, anchorMs) {
  const now = Date.now();
  const when = nextRunAt(anchorMs, nextDelayMin(settings, failures, Math.random), now);
  await alarms.createAt(ALARM.TICK, when);
  await patchStats({ nextRunMs: when });
  return when;
}

async function paintFromStats() {
  const { stats = {} } = await store.getLocal(['stats']);
  await paint(stats.status ?? STATUS.IDLE, stats.unreadAlerts ?? 0);
}

function onAlarm({ name }) {
  if (name === ALARM.TICK) return serial(() => runCycle('alarm'));
  if (name === ALARM.WATCHDOG) {
    return serial(async () => {
      const { cycleLock } = await store.getSession(['cycleLock']);
      return cycleLock ? failCycle(STATUS.UNRESPONSIVE, ['watchdog']) : undefined;
    });
  }
  return undefined;
}

// ---------------------------------------------------------------- the cycle (SPEC 8.1)

async function runCycle(trigger, { settleSec } = {}) {
  const now = Date.now();
  const { settings, stats, log } = await readState();
  const { cycleLock = null, monitorTabId } = await store.getSession(['cycleLock', 'monitorTabId']);

  let tab = await tabs.get(monitorTabId);
  if (!tab && !settings.useOwnTab) {
    tab = await tabs.findJobsTab(JOBS_TAB_PATTERN);
    if (tab) await store.setSession({ monitorTabId: tab.id });
  }
  const ping = tab ? await tabs.sendWithTimeout(tab.id, { type: MSG.PING }, LIMITS.MESSAGE_TIMEOUT_MS) : null;
  const idleState = settings.pauseWhenLocked ? await idle.queryState(60) : 'active';

  const decision = decidePrecheck({
    settings, stats, cycleLock, tab, ping, nowMs: now, trigger,
    workerOnline: globalThis.navigator?.onLine, idleState
  });

  if (decision.clearStaleLock) {
    await store.removeSession('cycleLock');
    await alarms.clear(ALARM.WATCHDOG);
  }
  if (decision.action === 'skip') return skipCycle(decision, { settings, stats, log, now, trigger });

  let tabId = decision.tabId;
  if (decision.action === 'reopen') {
    // Open blank first, lock, then navigate: the page can never say HELLO before the lock exists.
    tabId = await tabs.createPinned('about:blank');
    if (tabId === null) return failCycle(STATUS.NO_TAB, ['tab:CREATE_FAILED']);
    await store.setSession({ monitorTabId: tabId });
  }

  const lock = { id: `c-${now}`, tabId, startedMs: now, trigger };
  if (settings.debug && Number.isFinite(settleSec)) lock.settleSec = Math.min(60, Math.max(1, Math.round(settleSec)));
  await store.setSession({ cycleLock: lock });
  await alarms.createIn(ALARM.WATCHDOG, LIMITS.WATCHDOG_MIN);
  await store.setLocal({ stats: { ...stats, ...decision.statsPatch } });
  await paint(STATUS.RUNNING);

  const reload = await tabs.reloadTo(tabId, BASE_URL);
  if (!reload.ok) return failCycle(STATUS.NO_TAB, [`tab:${reload.error}`.slice(0, 80)]);
  return { started: true, tabId };
  // The worker may now be terminated. content/main.js answers with JOBS.
}

async function skipCycle(decision, { settings, stats, log, now, trigger }) {
  const { status } = decision;
  if (status === STATUS.RUNNING) return { started: false, reason: status };   // that cycle schedules the next

  const outcome = withOutcome(stats, log, { status, nowMs: now, note: `skipped (${trigger})` });
  await store.setLocal(outcome);
  await paint(status);

  if (decision.stop) {
    await alarms.clear(ALARM.TICK);
    await patchStats({ nextRunMs: null });
  } else if (status === STATUS.CAPPED) {
    const when = Math.max(decision.nextAt + Math.random() * CAPPED_JITTER_MS, now + ALARM_FLOOR_MS);
    await alarms.createAt(ALARM.TICK, when);
    await patchStats({ nextRunMs: when });
  } else {
    await scheduleNext(settings, outcome.stats.consecutiveFailures, now);
  }
  return { started: false, reason: status };
}

async function onHello(_msg, sender) {
  const { settings: stored } = await store.getLocal(['settings']);
  const { cycleLock } = await store.getSession(['cycleLock']);
  const settings = clampSettings(stored);
  const isMonitor = isCycleSender(cycleLock, sender, Date.now());
  return {
    isMonitor,
    topN: settings.topN,
    settleSec: isMonitor && cycleLock.settleSec ? cycleLock.settleSec : settings.settleSec,
    debug: settings.debug
  };
}

async function onJobs({ result }, sender) {
  const now = Date.now();
  const { cycleLock } = await store.getSession(['cycleLock']);
  if (!isCycleSender(cycleLock, sender, now)) return { ok: false, ignored: true };
  await alarms.clear(ALARM.WATCHDOG);

  if (!result || result.ok !== true) return failCycle(statusForReason(result?.reason), result?.failures);

  const { settings, stats, log } = await readState();
  // Re-validate: a message is data, not proof (SPEC 8.4).
  const jobs = (Array.isArray(result.jobs) ? result.jobs : []).slice(0, settings.topN + 1).map(sanitizeJob);
  const serverTimeMs = Number(result.serverTimeMs);
  const gate = checkGates(jobs, serverTimeMs, now, settings.topN);
  if (!gate.ok) return failCycle(STATUS.PARSE_FAILED, [`worker:${gate.error}`, ...cleanFailures(result.failures)]);

  const { seen = {} } = await store.getLocal(['seen']);
  const { fresh, overflow } = pickFresh(jobs, serverTimeMs, settings, seen);
  const plan = planAlerts(fresh, settings, serverTimeMs);

  const newestAgeMs = Math.min(...jobs.map(j => serverTimeMs - j.postedMs));
  const parts = [`read ${jobs.length}, newest ${formatAge(newestAgeMs)} old`, `${fresh.length} new`];
  if (plan.sound) parts.push(plan.highValue ? 'loud sound' : 'sound');
  if (overflow) parts.push('OVERFLOW');
  const outcome = withOutcome(stats, log, {
    status: STATUS.OK,
    nowMs: now,
    source: result.source === 'dom' ? 'dom' : 'state',
    note: parts.join(', '),
    failures: result.failures
  });
  outcome.stats.totalAlerts = (Number(stats.totalAlerts) || 0) + fresh.length;
  outcome.stats.unreadAlerts = (Number(stats.unreadAlerts) || 0) + fresh.length;
  outcome.stats.overflow = overflow;
  if (fresh.length) outcome.stats.lastAlertMs = now;

  // Remember the jobs before alerting: if the worker dies mid-alert, a job must never alert twice.
  await store.setLocal({ ...outcome, lastJobs: jobs, seen: pruneSeen(markSeen(seen, jobs, now), now) });
  await store.removeSession('cycleLock');
  await deliverAlerts(plan, settings);
  await paint(STATUS.OK, outcome.stats.unreadAlerts);
  await scheduleNext(settings, 0, cycleLock.startedMs);
  return { ok: true, fresh: fresh.length };
}

async function failCycle(status, failures) {
  const now = Date.now();
  const { settings, stats, log } = await readState();
  const { cycleLock } = await store.getSession(['cycleLock']);
  await alarms.clear(ALARM.WATCHDOG);
  await store.removeSession('cycleLock');

  const outcome = withOutcome(stats, log, { status, nowMs: now, note: 'cycle failed', failures });
  await store.setLocal(outcome);
  await paint(status);
  if (status === STATUS.PARSE_FAILED && outcome.stats.consecutiveParseFailures === 2) {
    await notifications.show(SYSTEM_NOTICES.layout.id, SYSTEM_NOTICES.layout);
  }
  if (status === STATUS.BLOCKED && stats.status !== STATUS.BLOCKED) {
    await notifications.show(SYSTEM_NOTICES.blocked.id, { ...SYSTEM_NOTICES.blocked, requireInteraction: true });
  }

  if (status === STATUS.BLOCKED) {                   // never keep reloading after BLOCKED (SPEC 11.5)
    await alarms.clear(ALARM.TICK);
    await patchStats({ nextRunMs: null });
  } else {
    await scheduleNext(settings, outcome.stats.consecutiveFailures, cycleLock?.startedMs ?? now);
  }
  return { ok: false, status };
}

// ---------------------------------------------------------------- events and messages

async function onTabRemoved(tabId) {
  const { monitorTabId, cycleLock } = await store.getSession(['monitorTabId', 'cycleLock']);
  if (tabId !== monitorTabId) return;
  await store.removeSession('monitorTabId');
  if (cycleLock?.tabId === tabId) {
    await failCycle(STATUS.NO_TAB, ['tab:closed']);
    return;
  }
  await patchStats({ status: STATUS.NO_TAB });
  await paint(STATUS.NO_TAB);
}

async function onNetBack() {
  const now = Date.now();
  const { stats } = await readState();
  if (stats.status !== STATUS.OFFLINE) return { ok: true, rescheduled: false };
  const when = now + ALARM_FLOOR_MS;
  if (Number.isFinite(stats.nextRunMs) && stats.nextRunMs <= when) return { ok: true, rescheduled: false };
  await alarms.createAt(ALARM.TICK, when);
  await patchStats({ consecutiveFailures: 0, nextRunMs: when });
  return { ok: true, rescheduled: true };
}

async function forceCheck({ settleSec } = {}) {
  const { stats } = await readState();
  if (Number.isFinite(stats.lastRunMs) && Date.now() - stats.lastRunMs < FORCE_MIN_GAP_MS) {
    return { started: false, reason: 'TOO_SOON' };
  }
  return runCycle('force', { settleSec: Number(settleSec) });
}

async function saveSettings(update) {
  const { settings: current } = await readState();
  const next = clampSettings(update(current));
  await store.setLocal({ settings: next });           // storage.onChanged re-arms the timer
  return { ok: true, settings: next, preset: presetOf(next) };
}

/** Live re-arm when the interval or enabled flag changes (SPEC 4.4). */
function onStorageChanged(changes, area) {
  if (area !== 'local' || !changes?.settings) return undefined;
  const { oldValue, newValue } = changes.settings;
  if (!timingChanged(oldValue, newValue)) return undefined;

  return serial(async () => {
    const settings = clampSettings(newValue);
    const { stats } = await readState();
    if (!settings.enabled) {
      await alarms.clear(ALARM.TICK);
      await patchStats({ status: STATUS.PAUSED, nextRunMs: null });
      await paint(STATUS.PAUSED);
      return;
    }
    if (stats.status === STATUS.BLOCKED) return;
    const { cycleLock } = await store.getSession(['cycleLock']);
    if (cycleLock) return;                              // applied when this cycle schedules the next
    if (stats.status === STATUS.PAUSED) {
      await patchStats({ status: STATUS.IDLE });
      await paint(STATUS.IDLE);
    }
    await scheduleNext(settings, stats.consecutiveFailures ?? 0, stats.lastRunMs || 0);
  });
}

async function resumeFromBlock() {
  const { settings } = await readState();
  await patchStats({ status: STATUS.IDLE, consecutiveFailures: 0 });
  await paint(STATUS.IDLE);
  const nextRunMs = settings.enabled ? await scheduleNext(settings, 0, 0) : null;
  return { ok: true, nextRunMs };
}

// ---------------------------------------------------------------- alerts (SPEC 15)

async function deliverAlerts(plan, settings) {
  if (!plan.notifications.length && !plan.summary) return;
  const { notifTargets = {} } = await store.getSession(['notifTargets']);
  const targets = { ...notifTargets };
  for (const n of plan.notifications) {
    if (await notifications.show(n.id, { ...n, requireInteraction: settings.requireInteraction })) targets[n.id] = n.url;
  }
  if (plan.summary && await notifications.show(plan.summary.id, { ...plan.summary, requireInteraction: settings.requireInteraction })) {
    targets[plan.summary.id] = null;
  }
  const kept = Object.entries(targets).slice(-LIMITS.NOTIFICATION_TARGETS_MAX);
  await store.setSession({ notifTargets: Object.fromEntries(kept) });
  if (plan.sound) {
    const played = await playSound(plan.sound.file, plan.sound.volume);
    if (!played.ok) console.warn('[PPH Job Radar] alert sound did not play:', played.error);
  }
}

async function onNotificationClicked(id) {
  if (typeof id !== 'string' || !id.startsWith('pph-')) return;
  const { notifTargets = {} } = await store.getSession(['notifTargets']);
  await notifications.clear(id);
  const url = notifTargets[id];
  if (isPphUrl(url)) await tabs.openUrl(url);            // only ever open PeoplePerHour job pages
  else await openMonitorTab();
  const { [id]: _clicked, ...rest } = notifTargets;
  await store.setSession({ notifTargets: rest });
}

async function clearUnread() {
  const { stats } = await readState();
  await patchStats({ unreadAlerts: 0 });
  await paint(stats.status ?? STATUS.IDLE, 0);
  return { ok: true };
}

async function testNotification() {
  const ok = await notifications.show(SYSTEM_NOTICES.test.id, SYSTEM_NOTICES.test);
  return { ok };
}

async function testSound({ file, volume } = {}) {
  const { settings } = await readState();
  const chosen = SOUND_FILES.includes(file) ? file : settings.sound.file;
  const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : settings.sound.volume;
  return playSound(chosen, level);
}

async function openMonitorTab() {
  const { settings } = await readState();
  const { monitorTabId, cycleLock } = await store.getSession(['monitorTabId', 'cycleLock']);
  const existing = await tabs.get(monitorTabId);
  if (existing) {
    await tabs.focus(existing.id);
    return { tabId: existing.id };
  }
  const tabId = await tabs.createPinned(BASE_URL, { active: true });
  if (tabId === null) return { tabId: null };
  await store.setSession({ monitorTabId: tabId });
  if (settings.enabled && !cycleLock) await scheduleNext(settings, 0, 0);
  return { tabId };
}

async function buildStatus() {
  const now = Date.now();
  const { settings, stats } = await readState();
  const { lastJobs = [] } = await store.getLocal(['lastJobs']);
  const { cycleLock, monitorTabId } = await store.getSession(['cycleLock', 'monitorTabId']);
  return {
    settings,
    stats,
    lastJobs,
    running: Boolean(cycleLock),
    monitorTabId: monitorTabId ?? null,
    preset: presetOf(settings),
    effectiveFreshMin: effectiveFreshMin(settings),
    reloadCap: reloadCap(settings),
    loadsPerHour: loadsPerHour(settings),
    msToNext: Number.isFinite(stats.nextRunMs) ? Math.max(0, stats.nextRunMs - now) : null
  };
}
