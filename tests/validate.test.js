// U6. SPEC 8.4, 18, 25.3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPphUrl, sanitizeJob, checkGates } from '../src/core/validate.js';
import { jobsFromState } from '../src/core/parser.js';
import { makeState, SERVER_TIME_MS, jobUrl } from './fixtures/synthetic.js';

const clean = () => jobsFromState(makeState(), SERVER_TIME_MS, 5);
const gate = (jobs, st = SERVER_TIME_MS, now = SERVER_TIME_MS, n = 5) => checkGates(jobs, st, now, n);

test('U6 isPphUrl accepts only https on the exact PeoplePerHour host', () => {
  for (const u of ['https://www.peopleperhour.com/', 'https://www.peopleperhour.com/freelance-jobs', jobUrl('4521929')])
    assert.equal(isPphUrl(u), true, u);
  for (const u of [
    'http://www.peopleperhour.com/',
    'javascript:alert(1)',
    'https://www.peopleperhour.com.evil.com/',
    'https://evil.com/?u=https://www.peopleperhour.com/',
    'https://peopleperhour.com/',
    'https://user:pass@www.peopleperhour.com/',
    'https://user@www.peopleperhour.com/',
    `https://www.peopleperhour.com/${'a'.repeat(500)}`,
    'not a url', '', null, undefined, 42, {}
  ]) assert.equal(isPphUrl(u), false, String(u));
});

test('U6 sanitizeJob clamps, caps and coerces', () => {
  const j = sanitizeJob({
    id: 4521929,
    title: `  ${'T'.repeat(400)}`,
    url: 'javascript:alert(1)',
    postedMs: NaN,
    ageMin: '4',
    budget: 1e9,
    currency: 'g$bp',
    projectType: 'weird',
    proposals: 3.6,
    state: 'x'.repeat(50),
    locationType: 'hybrid',
    category: 'c'.repeat(200),
    etiquettes: 'not an object'
  });
  assert.equal(j.id, '4521929');
  assert.equal(j.title.length, 300, 'trimmed first, then capped');
  assert.ok(j.title.startsWith('T'));
  assert.equal(j.url, null);
  assert.ok(Number.isNaN(j.postedMs), 'postedMs must not be clamped');
  assert.equal(j.ageMin, 4);
  assert.equal(j.budget, 10_000_000);
  assert.equal(j.currency, 'GB');
  assert.equal(j.projectType, 'fixed_price');
  assert.equal(j.proposals, 4);
  assert.equal(j.state.length, 20);
  assert.equal(j.locationType, 'onsite');
  assert.equal(j.category.length, 100);
  assert.deepEqual(j.etiquettes, { featured: false, opportunity: false, prefunded: false, urgent: false, nda: false });
});

test('U6 sanitizeJob keeps good values and never throws on junk', () => {
  const good = sanitizeJob({
    id: '4521929', title: 'Build a site', url: jobUrl('4521929'), postedMs: 1, ageMin: 2, budget: 88,
    currency: 'GBP', projectType: 'hourly', proposals: 8, state: 'open', locationType: 'remote',
    category: 'Web', etiquettes: { prefunded: true, urgent: 1 }
  });
  assert.equal(good.url, jobUrl('4521929'));
  assert.equal(good.projectType, 'hourly');
  assert.equal(good.locationType, 'remote');
  assert.equal(sanitizeJob({ locationType: 'remote_country' }).locationType, 'remote', 'seen live on PPH');
  assert.equal(sanitizeJob({ locationType: 'onsite' }).locationType, 'onsite');
  assert.equal(sanitizeJob({ locationType: 42 }).locationType, 'onsite');
  assert.deepEqual(good.etiquettes, { featured: false, opportunity: false, prefunded: true, urgent: true, nda: false });

  const empty = sanitizeJob();
  assert.equal(empty.id, '');
  assert.equal(empty.budget, 0);
  assert.equal(empty.proposals, 0);
  assert.equal(sanitizeJob({ id: { evil: true }, budget: -5, proposals: -1, etiquettes: null }).id, '');
  assert.equal(sanitizeJob({ budget: -5 }).budget, 0);
  assert.equal(sanitizeJob({ proposals: 20_000 }).proposals, 10_000);
});

test('U6 checkGates accepts a clean parse', () => {
  const r = gate(clean());
  assert.equal(r.ok, true);
});

test('U6 checkGates rejects each failure with a named error', () => {
  const jobs = clean();
  const withJob = (i, patch) => jobs.map((j, k) => (k === i ? { ...j, ...patch } : j));

  assert.equal(gate(null).error, 'GATE_COUNT');
  assert.equal(gate(jobs.slice(0, 4)).error, 'GATE_COUNT', '4 jobs');
  assert.equal(gate(jobs, NaN).error, 'GATE_SERVER_TIME');
  assert.equal(gate(jobs, SERVER_TIME_MS, SERVER_TIME_MS + 25 * 3_600_000).error, 'GATE_SERVER_TIME', '25 h clock gap');
  assert.equal(gate(withJob(2, { postedMs: NaN })).error, 'GATE_NAN_TIME');
  assert.equal(gate(withJob(0, { postedMs: SERVER_TIME_MS + 2 * 60_000 })).error, 'GATE_FUTURE', '2 min in the future');
  assert.equal(gate(withJob(1, { id: '' })).error, 'GATE_ID');
  assert.equal(gate(withJob(1, { id: 'd123' })).error, 'GATE_ID');
  assert.equal(gate(withJob(4, { id: jobs[0].id })).error, 'GATE_DUP_ID');
});

test('U6 checkGates tolerates small clock jitter', () => {
  const jobs = clean().map((j, k) => (k === 0 ? { ...j, postedMs: SERVER_TIME_MS + 30_000 } : j));
  assert.equal(gate(jobs).ok, true, '30 s in the future is jitter, not a parse bug');
  assert.equal(gate(clean(), SERVER_TIME_MS, SERVER_TIME_MS + 23 * 3_600_000).ok, true);
});
