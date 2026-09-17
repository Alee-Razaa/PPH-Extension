// U3, U4, U5. SPEC 3.2 to 3.6, 22.1, 25.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStateJson, jobsFromState, jobsFromCards, idFromUrl } from '../src/core/parser.js';
import { checkGates, isPphUrl } from '../src/core/validate.js';
import { ageMatchesText, UNKNOWN_AGE_MS } from '../src/core/time.js';
import { LIMITS } from '../src/core/constants.js';
import {
  IDS, SERVER_TIME_MS, makeState, makeRaw, makeCard, jobUrl, loadRealFixture, REAL_SKIP
} from './fixtures/synthetic.js';

const real = loadRealFixture();
const realOpts = { skip: real ? false : REAL_SKIP };
const MIN = 60_000;

// ---------------- U3: extractStateJson ----------------

test('U3 extractStateJson slices initialState and serverTime without touching the data literal', () => {
  const state = makeState();
  const out = extractStateJson(makeRaw(state));
  assert.ok(out);
  assert.equal(out.serverTimeMs, SERVER_TIME_MS);
  assert.deepEqual(JSON.parse(out.json), state);
});

test('U3 extractStateJson accepts a double quoted serverTime and whitespace', () => {
  const raw = `window.PPHReact = {};\nwindow.PPHReact.initialState = {"a":1} ;\n window.PPHReact.data = {x:1};\nwindow.PPHReact.serverTime = "${SERVER_TIME_MS}";`;
  assert.deepEqual(extractStateJson(raw), { json: '{"a":1}', serverTimeMs: SERVER_TIME_MS });
});

test('U3 extractStateJson returns null for anything malformed', () => {
  const good = makeRaw(makeState());
  const cases = {
    'not a string': null,
    'a number': 42,
    'no initialState': good.replace('window.PPHReact.initialState=', 'window.PPHReact.other='),
    'no data marker': good.replace('window.PPHReact.data=', 'window.PPHReact.stuff='),
    'no serverTime': good.replace(/window\.PPHReact\.serverTime=.*$/m, ''),
    'short serverTime': good.replace(`'${SERVER_TIME_MS}'`, "'12345'"),
    'unquoted serverTime': good.replace(`'${SERVER_TIME_MS}'`, String(SERVER_TIME_MS)),
    'oversized script': 'x'.repeat(LIMITS.MAX_SCRIPT_CHARS + 1)
  };
  for (const [name, raw] of Object.entries(cases)) assert.equal(extractStateJson(raw), null, name);
});

test('U3 real capture: script extracts, JSON parses, serverTime is epoch ms', realOpts, () => {
  const out = extractStateJson(real.raw);
  assert.ok(out, 'extractStateJson returned null on the real capture');
  assert.match(String(out.serverTimeMs), /^\d{13}$/);
  const state = JSON.parse(out.json);
  assert.ok(state.freelanceJobs.main.data.length >= 5);
});

// ---------------- U4: jobsFromState ----------------

test('U4 jobsFromState returns top N from main.data in order, sanitized', () => {
  const jobs = jobsFromState(makeState(), SERVER_TIME_MS, 5);
  assert.deepEqual(jobs.map(j => j.id), IDS.slice(0, 5));
  const [top] = jobs;
  assert.equal(top.title, 'Job 4521929');
  assert.equal(top.url, jobUrl('4521929'));
  assert.ok(Math.abs(top.ageMin - 4) < 0.02, `ageMin ${top.ageMin}`);
  assert.equal(top.budget, 88);
  assert.equal(top.currency, 'GBP');
  assert.equal(top.projectType, 'fixed_price');
  assert.equal(top.proposals, 8);
  assert.equal(top.state, 'open');
  assert.equal(top.locationType, 'remote');
  assert.equal(top.category, 'Technology & Programming');
  assert.equal(top.etiquettes.prefunded, true);
  assert.equal('client' in top, false, 'client data never leaves the parser');
  assert.equal(checkGates(jobs, SERVER_TIME_MS, SERVER_TIME_MS, 5).ok, true);
  for (let i = 1; i < jobs.length; i++) assert.ok(jobs[i - 1].postedMs > jobs[i].postedMs, 'newest first');
});

test('U4 jobsFromState ignores featured and completed lists', () => {
  const state = makeState(IDS, { featured: ['9999991'], completed: ['9999992'] });
  const ids = jobsFromState(state, SERVER_TIME_MS, 5).map(j => j.id);
  assert.deepEqual(ids, IDS.slice(0, 5));
});

test('U4 jobsFromState honours topN and short lists', () => {
  assert.equal(jobsFromState(makeState(), SERVER_TIME_MS, 3).length, 3);
  const short = jobsFromState(makeState(IDS.slice(0, 4)), SERVER_TIME_MS, 5);
  assert.equal(short.length, 4);
  assert.equal(checkGates(short, SERVER_TIME_MS, SERVER_TIME_MS, 5).error, 'GATE_COUNT', 'the gate catches it');
});

test('U4 jobsFromState keeps odd values for the gates to judge', () => {
  const state = makeState(IDS, { overrides: {
    '4521929': { posted_dt: 'garbage', item_state: 'closed' },
    '4521928': { proj_id: undefined, url: 'https://evil.com/', category: null, etiquettes: undefined }
  } });
  const [a, b] = jobsFromState(state, SERVER_TIME_MS, 5);
  assert.ok(Number.isNaN(a.postedMs));
  assert.equal(a.state, 'closed');
  assert.equal(b.id, '4521928', 'falls back to the ref id');
  assert.equal(b.url, null);
  assert.equal(b.category, '');
  assert.equal(b.etiquettes.prefunded, false);
});

test('U4 jobsFromState returns null for a wrong shape', () => {
  const missingEntity = makeState();
  delete missingEntity.entities.projects['4521927'];
  const nullRef = makeState();
  nullRef.freelanceJobs.main.data[1] = null;
  const cases = {
    'null state': null,
    'no freelanceJobs': { entities: { projects: {} } },
    'data not an array': { freelanceJobs: { main: { data: {} } }, entities: { projects: {} } },
    'no projects': { freelanceJobs: { main: { data: [] } }, entities: {} },
    'projects not an object': { freelanceJobs: { main: { data: [] } }, entities: { projects: 'x' } },
    'missing entity': missingEntity,
    'null ref': nullRef
  };
  for (const [name, state] of Object.entries(cases)) assert.equal(jobsFromState(state, SERVER_TIME_MS, 5), null, name);
});

test('U4 real capture: top 5 pass the gates, newest listing first, safe urls', realOpts, (t) => {
  const out = extractStateJson(real.raw);
  const jobs = jobsFromState(JSON.parse(out.json), out.serverTimeMs, 5);
  assert.ok(jobs, 'jobsFromState returned null on the real capture');
  const gate = checkGates(jobs, out.serverTimeMs, out.serverTimeMs, 5);
  assert.equal(gate.ok, true, `gate failed: ${gate.error}`);
  // Live finding 2026-09-17 (SPEC 3.3): list order is by project id (listing order), NOT strictly by posted_dt.
  // Job 4522017 (posted 09:02:26) is listed above 4522015 (posted 09:04:22).
  for (let i = 1; i < jobs.length; i++) assert.ok(Number(jobs[i - 1].id) > Number(jobs[i].id), 'ids strictly descending');
  const byPosted = jobs.every((j, i) => i === 0 || jobs[i - 1].postedMs >= j.postedMs);
  if (!byPosted) t.diagnostic('posted_dt order differs from list order in this capture (expected, see SPEC 3.3)');
  assert.equal(jobs[0].locationType, 'remote', 'location_type "remote_country" counts as remote');
  for (const j of jobs) {
    assert.ok(isPphUrl(j.url), `url not PPH: ${j.url}`);
    assert.ok(j.title.length > 0);
    assert.ok(j.ageMin > -1 && j.ageMin < 60 * 24 * 30, `implausible age ${j.ageMin}`);
  }
});

// ---------------- U5: jobsFromCards and idFromUrl ----------------

test('U5 idFromUrl extracts the numeric project id', () => {
  assert.equal(idFromUrl(jobUrl('4521929')), '4521929');
  assert.equal(idFromUrl(`${jobUrl('4521929')}/`), '4521929');
  assert.equal(idFromUrl(`${jobUrl('4521929')}?ref=list`), '4521929');
  assert.equal(idFromUrl(`${jobUrl('4521929')}#top`), '4521929');
  assert.equal(idFromUrl('https://www.peopleperhour.com/freelance-jobs'), '');
  assert.equal(idFromUrl('https://www.peopleperhour.com/job-1234'), '', 'under 5 digits is not an id');
  assert.equal(idFromUrl(null), '');
  assert.equal(idFromUrl(undefined), '');
});

test('U5 jobsFromCards reads plain card data', () => {
  const now = SERVER_TIME_MS;
  const cards = IDS.slice(0, 5).map((id, k) => makeCard(id, `${4 + k * 7} minutes ago`));
  const jobs = jobsFromCards(cards, now, 5);
  assert.deepEqual(jobs.map(j => j.id), IDS.slice(0, 5));
  const [top] = jobs;
  assert.equal(top.ageMin, 4);
  assert.equal(top.postedMs, now - 4 * MIN);
  assert.equal(top.budget, 88);
  assert.equal(top.currency, 'GBP');
  assert.equal(top.projectType, 'fixed_price');
  assert.equal(top.proposals, 8);
  assert.equal(top.state, 'open');
  assert.equal(top.locationType, 'remote');
  assert.equal(top.etiquettes.prefunded, true);
  assert.equal(checkGates(jobs, now, now, 5).ok, true);
});

test('U5 jobsFromCards gives the same ids as jobsFromState (R12)', () => {
  const fromState = jobsFromState(makeState(), SERVER_TIME_MS, 5).map(j => j.id);
  const fromCards = jobsFromCards(IDS.map(id => makeCard(id, '4 minutes ago')), SERVER_TIME_MS, 5).map(j => j.id);
  assert.deepEqual(fromCards, fromState);
});

test('U5 jobsFromCards price, location and missing fields', () => {
  const now = SERVER_TIME_MS;
  const [hourly, euro, empty, onsite, bare] = jobsFromCards([
    makeCard('1000001', 'a few seconds ago', { price: '$25/hr' }),
    makeCard('1000002', 'an hour ago', { price: '€1,200' }),
    makeCard('1000003', 'yesterday', { price: '' }),
    makeCard('1000004', '2 minutes ago', { footer: ['2 minutes ago', 'no proposals yet', 'On-site'], badges: ['Urgent', 'NDA'] }),
    { href: jobUrl('1000005') }
  ], now, 5);
  assert.equal(hourly.projectType, 'hourly');
  assert.equal(hourly.currency, 'USD');
  assert.equal(hourly.budget, 25);
  assert.equal(hourly.ageMin, 0);
  assert.equal(euro.budget, 1200);
  assert.equal(euro.currency, 'EUR');
  assert.equal(empty.budget, 0);
  assert.equal(empty.currency, '');
  assert.equal(empty.ageMin, UNKNOWN_AGE_MS / MIN, 'unknown age is very old, never fresh');
  assert.equal(onsite.locationType, 'onsite');
  assert.equal(onsite.proposals, 0);
  assert.equal(onsite.etiquettes.urgent, true);
  assert.equal(onsite.etiquettes.nda, true);
  assert.equal(bare.id, '1000005');
  assert.equal(bare.title, '');
  assert.equal(bare.proposals, 0);
});

test('U5 jobsFromCards returns null when there are not enough cards', () => {
  assert.equal(jobsFromCards(null, SERVER_TIME_MS, 5), null);
  assert.equal(jobsFromCards({}, SERVER_TIME_MS, 5), null);
  assert.equal(jobsFromCards([makeCard('1000001', 'a minute ago')], SERVER_TIME_MS, 5), null);
});

test('U5 jobsFromCards survives null entries, and the gate rejects them', () => {
  const cards = [null, ...IDS.slice(1, 5).map(id => makeCard(id, '4 minutes ago'))];
  const jobs = jobsFromCards(cards, SERVER_TIME_MS, 5);
  assert.equal(jobs[0].id, '');
  assert.equal(checkGates(jobs, SERVER_TIME_MS, SERVER_TIME_MS, 5).error, 'GATE_ID');
});

test('U5 real capture: card ids match state ids and ages agree with page text', realOpts, (t) => {
  const out = extractStateJson(real.raw);
  const stateJobs = jobsFromState(JSON.parse(out.json), out.serverTimeMs, 5);
  const cardIds = real.cards.map(c => idFromUrl(c.href));
  for (const id of cardIds) assert.match(id, /^\d{5,20}$/, 'every card href yields a numeric id');

  const topCardIds = cardIds.slice(0, 5);
  const stateIds = stateJobs.map(j => j.id);
  if (JSON.stringify(topCardIds) !== JSON.stringify(stateIds)) {
    // Featured rows can be injected into the DOM list (RESEARCH 2.7). Order may differ, membership may not.
    t.diagnostic(`DOM order differs from state order: dom=${topCardIds} state=${stateIds}`);
  }
  for (const id of stateIds) assert.ok(cardIds.includes(id), `state job ${id} has no card in the capture`);

  const textById = new Map(real.cards.map(c => [idFromUrl(c.href), c.footer?.[0] ?? '']));
  for (const j of stateJobs) {
    const text = textById.get(j.id);
    assert.ok(ageMatchesText(j.ageMin * MIN, text), `job ${j.id}: parsed ${j.ageMin.toFixed(2)} min vs page "${text}"`);
  }

  const domJobs = jobsFromCards(real.cards, out.serverTimeMs, 5);
  assert.equal(checkGates(domJobs, out.serverTimeMs, out.serverTimeMs, 5).ok, true, 'DOM fallback also passes the gates');
});
