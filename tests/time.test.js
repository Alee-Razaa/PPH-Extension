// U1 and U2. SPEC 22.1, 3.5, 3.6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toUtcMs, ageMinutes, relToMs, ageMatchesText, formatAge, UNKNOWN_AGE_MS
} from '../src/core/time.js';

const POSTED = '2026-09-16 18:39:37';
const EXPECTED_MS = 1789583977000;
const SERVER_TIME_MS = 1789584228635;
const ZONES = ['UTC', 'Asia/Karachi', 'America/Los_Angeles'];

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

function inZone(zone, fn) {
  const had = Object.hasOwn(process.env, 'TZ'), prev = process.env.TZ;
  process.env.TZ = zone;                       // Node resets its tz cache on assignment
  try { return fn(); }
  finally { if (had) process.env.TZ = prev; else delete process.env.TZ; }
}

// ---------------- U1: the most important test in the project ----------------

test('U1 posted_dt is parsed as UTC in every timezone', () => {
  const naive = ZONES.map(z => inZone(z, () => Date.parse(POSTED)));
  const fixed = ZONES.map(z => inZone(z, () => toUtcMs(POSTED)));

  // Control: proves the timezone switch really happened. Without this the test can pass vacuously.
  assert.equal(new Set(naive).size, 3, 'TZ switching had no effect, test is invalid');

  assert.deepEqual(fixed, [EXPECTED_MS, EXPECTED_MS, EXPECTED_MS]);
});

test('U1 spec example age is about 4 minutes', () => {
  const age = ageMinutes(SERVER_TIME_MS, toUtcMs(POSTED));
  assert.ok(age > 4.1 && age < 4.3, `age was ${age}`);
});

test('U1 toUtcMs rejects malformed input', () => {
  for (const bad of [null, undefined, 42, '', '2026-09-16', '16/09/2026 18:39:37', '2026-09-16 18:39:37Z',
                     '2026-09-16T18:39:37', ' 2026-09-16 18:39:37', {}])
    assert.ok(Number.isNaN(toUtcMs(bad)), String(bad));
});

// ---------------- U2: relative text ----------------

test('U2 relToMs maps every moment.js variant', () => {
  const cases = [
    ['a few seconds ago', 0],
    ['in a few seconds', 0],
    ['just now', 0],
    ['a minute ago', MIN],
    ['1 minute ago', MIN],
    ['4 minutes ago', 4 * MIN],
    ['44 minutes ago', 44 * MIN],
    ['  4   Minutes AGO ', 4 * MIN],
    ['an hour ago', HOUR],
    ['2 hours ago', 2 * HOUR],
    ['a day ago', DAY],
    ['3 days ago', 3 * DAY]
  ];
  for (const [text, ms] of cases) assert.equal(relToMs(text), ms, text);
});

test('U2 relToMs returns UNKNOWN_AGE_MS for anything else', () => {
  assert.ok(Number.isFinite(UNKNOWN_AGE_MS) && UNKNOWN_AGE_MS >= 30 * DAY);
  for (const text of ['', null, undefined, 42, 'yesterday', '4 weeks ago', 'a month ago', '12345 minutes ago', 'minutes ago'])
    assert.equal(relToMs(text), UNKNOWN_AGE_MS, String(text));
});

test('U2 ageMatchesText tolerates moment rounding, not real mismatches', () => {
  assert.equal(ageMatchesText(4.19 * MIN, '4 minutes ago'), true);
  assert.equal(ageMatchesText(5 * MIN, '4 minutes ago'), true, '+1 min boundary is inclusive');
  assert.equal(ageMatchesText(3 * MIN, '4 minutes ago'), true, '-1 min boundary is inclusive');
  assert.equal(ageMatchesText(5.5 * MIN, '4 minutes ago'), false);
  assert.equal(ageMatchesText(2.5 * MIN, '4 minutes ago'), false);
  assert.equal(ageMatchesText(30_000, 'a few seconds ago'), true);
  assert.equal(ageMatchesText(70_000, 'a minute ago'), true);
  assert.equal(ageMatchesText(70 * MIN, 'an hour ago'), true, 'hour buckets allow 30 min');
  assert.equal(ageMatchesText(100 * MIN, 'an hour ago'), false);
  assert.equal(ageMatchesText(6.5 * MIN, '4 minutes ago', 3), true, 'custom tolerance');
  assert.equal(ageMatchesText(4 * MIN, 'yesterday'), false, 'unknown text never matches');
  assert.equal(ageMatchesText(NaN, '4 minutes ago'), false);
});

test('U2 formatAge', () => {
  assert.equal(formatAge(NaN), '?');
  assert.equal(formatAge(-1), '?');
  assert.equal(formatAge(0), '<1 min');
  assert.equal(formatAge(59_999), '<1 min');
  assert.equal(formatAge(4.19 * MIN), '4 min');
  assert.equal(formatAge(2 * HOUR), '2 h');
  assert.equal(formatAge(3 * DAY), '3 d');
});

test('ageMinutes', () => {
  assert.equal(ageMinutes(10 * MIN, 4 * MIN), 6);
  assert.equal(ageMinutes(0, MIN), -1);
});
