// Hand-built fixtures for edge cases. The shape mirrors docs/RESEARCH.md 2.3 and SPEC 3.3.
// Real page data lives in pph-sample.json (captured with tools/capture-fixture.js), never here.
import { readFileSync, existsSync } from 'node:fs';

export const SERVER_TIME_MS = 1789584228635;          // SPEC 3.5 example
export const POSTED_TOP = '2026-09-16 18:39:37';      // 4.19 min before SERVER_TIME_MS
export const IDS = ['4521929', '4521928', '4521927', '4521926', '4521925', '4521924', '4521923'];

export const jobUrl = (id, slug = 'i-need-a-sample-website') =>
  `https://www.peopleperhour.com/freelance-jobs/technology-programming/website-development/${slug}-${id}`;

/** UTC wall clock "YYYY-MM-DD HH:mm:ss", the same format PPH ships. */
export const postedDtMinutesBefore = (serverTimeMs, minutes) =>
  new Date(serverTimeMs - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');

export function attributes(id, postedDt, overrides = {}) {
  return {
    proj_id: Number(id),
    title: `Job ${id}`,
    url: jobUrl(id),
    posted_dt: postedDt,
    budget: 88,
    currency: 'GBP',
    project_type: 'fixed_price',
    proposalCount: 8,
    item_state: 'open',
    location_type: 'remote',
    category: { cate_name: 'Technology & Programming' },
    sub_category: { subcate_name: 'Website Development' },
    etiquettes: { featured: false, opportunity: false, prefunded: true, urgent: false, nda: false },
    client: { name: 'never read by the parser' },
    ...overrides
  };
}

const ref = id => ({ id, type: 'projects' });

/** Job k is posted (4 + k * minutesApart) minutes before serverTimeMs. */
export function makeState(ids = IDS, {
  serverTimeMs = SERVER_TIME_MS, minutesApart = 7, featured = [], completed = [], overrides = {}
} = {}) {
  const projects = {};
  ids.forEach((id, k) => {
    projects[id] = {
      id, type: 'projects',
      attributes: attributes(id, postedDtMinutesBefore(serverTimeMs, 4 + k * minutesApart), overrides[id])
    };
  });
  for (const id of [...featured, ...completed]) {
    projects[id] ??= { id, type: 'projects', attributes: attributes(id, postedDtMinutesBefore(serverTimeMs, 0.5)) };
  }
  return {
    freelanceJobs: {
      main: { data: ids.map(ref), meta: { 'current-page': 1, applied_filters: { sort: 'latest' } } },
      featured: { data: featured.map(ref) },
      completed: { data: completed.map(ref) }
    },
    entities: { projects }
  };
}

/** Inline script text as the page ships it. `data` is deliberately NOT valid JSON. */
export function makeRaw(state, serverTimeMs = SERVER_TIME_MS) {
  return [
    'window.PPHReact={};',
    `window.PPHReact.initialState=${JSON.stringify(state)};`,
    'window.PPHReact.data={routes:[1,2],render:function(){return "a;b"},\'x\':undefined};',
    `window.PPHReact.serverTime='${serverTimeMs}';`
  ].join('\n');
}

export function makeCard(id, ageText, overrides = {}) {
  return {
    href: jobUrl(id),
    title: `Job ${id}`,
    price: '£88',
    footer: [ageText, '8 proposals', 'Remote', 'Remote'],
    badges: ['Pre-funded'],
    ...overrides
  };
}

// ---- real capture ----

const REAL_URL = new URL('./pph-sample.json', import.meta.url);
export const REAL_SKIP = 'capture tests/fixtures/pph-sample.json first (run tools/capture-fixture.js in DevTools)';

/** @returns {{ capturedAt: string, raw: string, cards: object[] } | null} */
export function loadRealFixture() {
  return existsSync(REAL_URL) ? JSON.parse(readFileSync(REAL_URL, 'utf8')) : null;
}
