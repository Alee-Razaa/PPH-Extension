// Content entry module. SPEC 8.1, 8.3, 25.7.
// Asks the worker (HELLO) whether this tab is the monitor tab in a live cycle. Only then does it settle,
// parse and report JOBS. Any other PeoplePerHour tab does nothing, unless settings.debug is on, in which
// case it parses and console.tables each job's age next to the page's own text without reporting.
import { DEFAULTS, LIMITS, MSG, BASE_PATH, REASON, TIME } from '../core/constants.js';
import { formatAge, ageMatchesText } from '../core/time.js';
import { idFromUrl } from '../core/parser.js';
import { sendToWorker, onWorkerMessage } from '../platform/runtime.js';
import { parsePPH, isReady, readCards } from './dom.js';

const TAG = '[PPH Job Radar]';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function start() {
  if (location.pathname !== BASE_PATH) return;                  // job detail pages etc. (R13)

  const offPing = onWorkerMessage(MSG.PING, () =>
    ({ ready: isReady(document, 1), online: navigator.onLine, url: location.href }));
  const onOnline = () => { sendToWorker({ type: MSG.NET_BACK }); };
  addEventListener('online', onOnline);
  addEventListener('pagehide', () => { offPing(); removeEventListener('online', onOnline); }, { once: true });

  const hello = await sendToWorker({ type: MSG.HELLO }, LIMITS.MESSAGE_TIMEOUT_MS);
  if (!hello) return;                                             // worker unreachable: never act alone
  const debug = hello.debug === true;
  if (!hello.isMonitor && !debug) return;                         // not the monitor tab: do nothing (R13)

  const topN = Number.isInteger(hello.topN) ? hello.topN : DEFAULTS.topN;
  const settleSec = Number.isFinite(hello.settleSec) ? hello.settleSec : DEFAULTS.settleSec;
  if (debug) console.info(TAG, `debug parse in ${settleSec}s (top ${topN})`);
  await sleep(settleSec * TIME.SECOND_MS);

  let ready = isReady(document, topN);
  for (let i = 0; !ready && i < LIMITS.READY_RETRIES; i++) {
    await sleep(LIMITS.READY_RETRY_MS);
    ready = isReady(document, topN);
  }
  const result = ready
    ? parsePPH(document, topN, Date.now(), navigator.onLine)
    : { ok: false, reason: REASON.NOT_READY, failures: [] };

  if (debug) logCrossCheck(result);
  if (hello.isMonitor) await sendToWorker({ type: MSG.JOBS, result }, LIMITS.MESSAGE_TIMEOUT_MS);
}

/** Phase 1 acceptance: our computed age vs the page's rounded "N minutes ago", matched by job id. */
function logCrossCheck(result) {
  if (!result.ok) {
    console.warn(TAG, 'parse failed:', result.reason, result.failures);
    return;
  }
  const pageText = new Map(
    readCards(document, LIMITS.CROSS_CHECK_CARDS).map(card => [idFromUrl(card.href), card.footer[0] ?? ''])
  );
  const rows = result.jobs.map(job => {
    const text = pageText.get(job.id) ?? '(card not found)';
    const ageMs = job.ageMin * TIME.MINUTE_MS;
    return {
      id: job.id,
      age: formatAge(ageMs),
      ageMin: Number(job.ageMin.toFixed(2)),
      pageText: text,
      match: ageMatchesText(ageMs, text),
      title: job.title.slice(0, 60)
    };
  });
  const allMatch = rows.every(r => r.match);
  console.info(TAG, `source=${result.source}`, allMatch ? 'ALL MATCH' : 'MISMATCH, see table', result.failures);
  console.table(rows);
}
