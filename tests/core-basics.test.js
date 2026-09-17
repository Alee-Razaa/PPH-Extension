// result.js and constants.js contracts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, err, attempt } from '../src/core/result.js';
import {
  deepFreeze, DEFAULTS, LIMITS, SELECTORS, STATUS, REASON, GATE, MSG, ALARM, TIME,
  SOUND_FILES, BASE_URL, PPH_ORIGIN, PPH_HOST, BLOCKED_TITLE_RE
} from '../src/core/constants.js';

test('result: ok, err, attempt', () => {
  assert.deepEqual(ok(3), { ok: true, value: 3 });
  assert.deepEqual(err(new Error('boom').message), { ok: false, error: 'boom' });
  assert.equal(err(42).error, '42');
  assert.ok(Object.isFrozen(ok(1)) && Object.isFrozen(err('x')));
  assert.deepEqual(attempt(() => JSON.parse('{"a":1}')), { ok: true, value: { a: 1 } });
  assert.equal(attempt(() => JSON.parse('{')).ok, false);
  assert.equal(attempt(() => { throw 'plain string'; }).error, 'plain string');
  assert.equal(attempt(() => { throw null; }).error, 'null');
});

test('constants: deepFreeze freezes plain data only', () => {
  const re = /x/g;
  const obj = deepFreeze({ a: { b: [1, { c: 2 }] }, re, n: null });
  assert.ok(Object.isFrozen(obj.a.b[1]));
  assert.equal(Object.isFrozen(re), false, 'RegExp instances keep a writable lastIndex');
  const already = Object.freeze({ inner: {} });
  deepFreeze(already);
  assert.equal(Object.isFrozen(already.inner), false, 'already frozen objects are not walked again');
  assert.equal(deepFreeze(5), 5);
});

test('constants: everything exported is frozen', () => {
  for (const c of [DEFAULTS, DEFAULTS.sound, DEFAULTS.filters, DEFAULTS.filters.keywordsInclude,
                   LIMITS, SELECTORS, STATUS, REASON, GATE, MSG, ALARM, TIME, SOUND_FILES])
    assert.ok(Object.isFrozen(c));
});

test('constants: enums map names to themselves', () => {
  for (const e of [STATUS, REASON, GATE, MSG])
    for (const [k, v] of Object.entries(e)) assert.equal(k, v);
});

test('constants: defaults match SPEC 9', () => {
  assert.equal(DEFAULTS.topN, 5);
  assert.equal(DEFAULTS.settleSec, 20);
  assert.equal(DEFAULTS.intervalMode, 'random');
  assert.equal(DEFAULTS.minIntervalMin, 5);
  assert.equal(DEFAULTS.maxIntervalMin, 10);
  assert.equal(DEFAULTS.freshWindowMin, 10);
  assert.ok(SOUND_FILES.includes(DEFAULTS.sound.file));
  assert.ok(SOUND_FILES.includes(DEFAULTS.sound.highValueFile));
});

test('constants: site contract', () => {
  assert.equal(BASE_URL, 'https://www.peopleperhour.com/freelance-jobs');
  assert.equal(new URL(PPH_ORIGIN).hostname, PPH_HOST);
  for (const sel of Object.values(SELECTORS)) assert.match(sel, /\*=/, `prefix match only: ${sel}`);
  assert.ok(BLOCKED_TITLE_RE.test('Just a moment...'));
  assert.equal(BLOCKED_TITLE_RE.test('Freelance Jobs | PeoplePerHour'), false);
});
