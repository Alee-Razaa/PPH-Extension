// End-to-end check in a real, throwaway Chrome profile against the live PeoplePerHour site.
// Loads src/ unpacked over the DevTools pipe, then drives the extension from its own options page.
// Usage: node tools/e2e.mjs [--headed] [--skip-alerts]
// Makes ~4 page loads over ~3 minutes. Never touches your normal Chrome profile.
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, evaluate, sleep } from './cdp.mjs';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const headed = process.argv.includes('--headed');
const skipAlerts = process.argv.includes('--skip-alerts');

const results = [];
const problems = [];
const t0 = Date.now();
const stamp = () => `${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s`;
const log = (...a) => console.log(stamp(), ...a);
function check(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass), detail });
  log(pass ? 'PASS' : 'FAIL', name, detail);
}

const { proc, cdp, profile, stderr } = launchChrome({ headless: !headed });

async function main() {
  await sleep(1500);
  const { product } = await cdp.send('Browser.getVersion');
  log('browser', product);

  // Collect extension errors from every target it runs in.
  let extensionId = '';
  const extensionSessions = new Set();
  cdp.on(message => {
    if (message.method === 'Target.targetCreated' || message.method === 'Target.targetInfoChanged') {
      const info = message.params.targetInfo;
      const ours = extensionId && info.url.startsWith(`chrome-extension://${extensionId}/`);
      const pph = info.url.startsWith('https://www.peopleperhour.com/');
      if ((ours && info.type !== 'page') || (pph && info.type === 'page')) watch(info).catch(() => {});
    }
    // Errors inside extension contexts always count. On PeoplePerHour pages only ours count:
    // the site throws its own React hydration errors, which are not ours to fix.
    const inExtension = message.sessionId && extensionSessions.has(message.sessionId);
    const ours = text => inExtension || text.includes('PPH Job Radar') || text.includes('chrome-extension://');
    if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params.exceptionDetails;
      const text = `${d.exception?.description ?? d.text} ${d.url ?? ''}`;
      if (ours(text)) problems.push(`exception: ${text}`);
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      if (['error', 'warning'].includes(message.params.type) && ours(text)) problems.push(`console.${message.params.type}: ${text}`);
    }
  });
  const watched = new Set();
  async function watch(info) {
    if (watched.has(info.targetId)) return;
    watched.add(info.targetId);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
    if (info.url.startsWith('chrome-extension://')) extensionSessions.add(sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
  }
  await cdp.send('Target.setDiscoverTargets', { discover: true });

  ({ id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: SRC.replaceAll('\\', '/') }));
  check('extension loads unpacked', /^[a-p]{32}$/.test(extensionId), extensionId);

  const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/ui/options.html` });
  const { sessionId: ext } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await sleep(800);
  const run = expr => evaluate(cdp, ext, expr);
  const message = msg => run(`chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
  const state = () => run(`chrome.storage.local.get(null)`);
  const alarm = name => run(`chrome.alarms.get(${JSON.stringify(name)}).then(a => a ? a.scheduledTime : null)`);

  const installed = await state();
  check('install saves settings', installed.settings?.enabled === true);
  const firstTick = await alarm('tick');
  check('first check armed ~30 s after install', firstTick && firstTick - Date.now() < 35_000, `${Math.round((firstTick - Date.now()) / 1000)} s`);

  // ---- automatic first cycle ----
  log('waiting for the first automatic check (about 60 s)...');
  const firstOk = await waitFor(async () => {
    const s = await state();
    return s.stats?.status === 'OK' ? s : (s.stats?.status && !['RUNNING', 'IDLE'].includes(s.stats.status) ? s : null);
  }, 150_000);
  check('first automatic check completes OK', firstOk?.stats?.status === 'OK', firstOk?.stats?.status ?? 'timeout');
  if (firstOk?.stats?.status !== 'OK') return;

  const pinned = await run(`chrome.tabs.query({ pinned: true, url: 'https://www.peopleperhour.com/*' }).then(t => t.map(x => x.url))`);
  check('extension opened exactly one pinned jobs tab', pinned.length === 1 && pinned[0].includes('/freelance-jobs'), JSON.stringify(pinned));
  const jobs = firstOk.lastJobs ?? [];
  check('read 5 real jobs with numeric ids and PPH urls', jobs.length === 5 &&
    jobs.every(j => /^\d+$/.test(j.id) && j.url?.startsWith('https://www.peopleperhour.com/')),
    jobs.map(j => `${j.id}:${Math.round((firstOk.stats.lastRunMs - j.postedMs) / 60000)}m`).join(' '));
  check('log records the cycle', firstOk.log?.[0]?.status === 'OK', firstOk.log?.[0]?.note);
  const next = await alarm('tick');
  const gap = (next - firstOk.stats.lastRunMs) / 60000;
  check('next check scheduled 5-10 min after cycle start', gap >= 4.99 && gap <= 10.01, `${gap.toFixed(2)} min`);

  // ---- live interval change ----
  const every3 = await message({ type: 'APPLY_PRESET', preset: 'every3' });
  await sleep(500);
  const after3 = await alarm('tick');
  const expected3 = Math.max(firstOk.stats.lastRunMs + 3 * 60_000, Date.now() + 30_000);
  check('switching to every 3 min moves the next check up at once', every3?.preset === 'every3' && Math.abs(after3 - expected3) < 3000,
    `${Math.round((after3 - Date.now()) / 1000)} s from now`);
  await message({ type: 'APPLY_PRESET', preset: 'every10' });
  await sleep(500);
  const after10 = await alarm('tick');
  check('switching to every 10 min moves it out', Math.abs(after10 - (firstOk.stats.lastRunMs + 10 * 60_000)) < 3000,
    `${Math.round((after10 - Date.now()) / 1000)} s from now`);

  // ---- other tabs untouched ----
  const other = await cdp.send('Target.createTarget', { url: 'https://www.peopleperhour.com/freelance-jobs', background: true });

  if (!skipAlerts) await alertScenario({ run, message, state });

  await sleep(3000);
  const tabs = await run(`chrome.tabs.query({ url: 'https://www.peopleperhour.com/*' }).then(t => t.map(x => ({ pinned: x.pinned, url: x.url })))`);
  check('user tab left alone, still one pinned monitor tab', tabs.filter(t => t.pinned).length === 1 && tabs.length === 2, JSON.stringify(tabs));
  await cdp.send('Target.closeTarget', { targetId: other.targetId });
}

async function alertScenario({ run, message, state }) {
  const hasAlerts = await run(`fetch(chrome.runtime.getURL('offscreen/offscreen.html')).then(r => r.ok, () => false)`);
  if (!hasAlerts) { log('alerts not built yet, skipping alert scenario'); return; }

  await message({ type: 'SAVE_SETTINGS', patch: { debug: true, freshWindowMin: 60, autoWidenFreshWindow: true, topN: 5 } });
  await message({ type: 'CLEAR_SEEN' });
  const before = await state();
  const wait = Math.max(0, before.stats.lastRunMs + 31_000 - Date.now());
  log(`waiting ${Math.round(wait / 1000)} s for the force-check rate limit...`);
  await sleep(wait);
  const forced = await message({ type: 'FORCE_CHECK', settleSec: 4 });
  check('Check now starts a cycle', forced?.started === true, JSON.stringify(forced));

  let offscreenSeen = false;
  const done = await waitFor(async () => {
    if (!offscreenSeen) {
      offscreenSeen = await run(`chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then(c => c.length > 0)`);
    }
    const s = await state();
    return s.stats?.lastRunMs > before.stats.lastRunMs && s.stats.status !== 'RUNNING' ? s : null;
  }, 60_000);
  check('forced check completes OK', done?.stats?.status === 'OK', done?.stats?.status ?? 'timeout');
  const alertsNow = (done?.stats?.totalAlerts ?? 0) - (before.stats.totalAlerts ?? 0);
  const fresh = (done?.lastJobs ?? []).filter(j => done.stats.lastRunMs - j.postedMs < 60 * 60_000).length;
  const shown = await run(`chrome.notifications.getAll().then(n => Object.keys(n))`);
  check('fresh jobs raise notifications (capped + summary)', fresh === 0 ? shown.length === 0 : shown.length >= 1 && shown.length <= 4,
    `${fresh} jobs under 60 min, ${shown.length} notifications: ${shown.join(', ')}`);
  check('alert counters updated', fresh === 0 || alertsNow > 0, `+${alertsNow}`);
  check('sound played through the offscreen document', fresh === 0 || offscreenSeen || done?.log?.[0]?.note?.includes('sound'),
    done?.log?.[0]?.note);

  await run(`chrome.notifications.getAll().then(n => Promise.all(Object.keys(n).map(id => chrome.notifications.clear(id))))`);
  await sleep(31_000);
  await message({ type: 'FORCE_CHECK', settleSec: 4 });
  const again = await waitFor(async () => {
    const s = await state();
    return s.stats?.lastRunMs > done.stats.lastRunMs && s.stats.status !== 'RUNNING' ? s : null;
  }, 60_000);
  const repeat = await run(`chrome.notifications.getAll().then(n => Object.keys(n))`);
  check('same jobs never alert twice', again?.stats?.status === 'OK' && repeat.filter(id => !id.startsWith('pph-summary')).length === 0,
    `${repeat.length} notifications on second check`);

  const test = await message({ type: 'TEST_NOTIFICATION' });
  check('Test notification works', test?.ok === true);
  const sound = await message({ type: 'TEST_SOUND', file: 'sounds/chime.wav', volume: 0.1 });
  check('Test sound works', sound?.ok === true, JSON.stringify(sound));
}

async function waitFor(probe, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await probe().catch(() => null);
    if (value) return value;
    await sleep(2000);
  }
  return null;
}

try {
  await main();
} catch (e) {
  check('e2e run completed without crashing', false, e.message);
} finally {
  await sleep(500);
  proc.kill();
  await sleep(1000);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
}

const unexpected = problems;
check('no extension errors in any context', unexpected.length === 0, unexpected.slice(0, 5).join(' | '));
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('stderr tail:', stderr().split('\n').slice(-5).join('\n'));
  process.exit(1);
}
