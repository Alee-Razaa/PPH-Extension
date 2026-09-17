// U7. SPEC 4.4, 11.1, 11.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextDelayMin, nextRunAt, effectiveFreshMin, reloadCap, hourBucket, maxIntervalOf, loadsPerHour,
  CYCLE_MARGIN_MIN, BACKOFF_LADDER_MIN, ALARM_FLOOR_MS
} from '../src/core/schedule.js';
import { applyPreset, clampSettings } from '../src/core/settings.js';
import { DEFAULTS } from '../src/core/constants.js';

const MIN = 60_000;
const low = () => 0;
const high = () => 0.999;
const every3 = applyPreset(DEFAULTS, 'every3');
const every10 = applyPreset(DEFAULTS, 'every10');
const random = applyPreset(DEFAULTS, 'random5to10');
const custom = (patch) => clampSettings({ ...DEFAULTS, ...patch });

test('U7 fixed presets always give their exact interval', () => {
  assert.equal(nextDelayMin(every3, 0, low), 3);
  assert.equal(nextDelayMin(every3, 0, high), 3);
  assert.equal(nextDelayMin(every10, 0, low), 10);
  assert.equal(nextDelayMin(every10, 0, high), 10);
});

test('U7 random range stays inside min..max', () => {
  assert.equal(nextDelayMin(random, 0, low), 5);
  const top = nextDelayMin(random, 0, high);
  assert.ok(top > 9.9 && top < 10, String(top));
  for (let i = 0; i < 200; i++) {
    const d = nextDelayMin(random, 0, Math.random);
    assert.ok(d >= 5 && d <= 10, String(d));
  }
});

test('U7 rand values outside 0..1 are clamped', () => {
  assert.equal(nextDelayMin(random, 0, () => -5), 5);
  assert.equal(nextDelayMin(random, 0, () => 7), 10);
  assert.equal(nextDelayMin(random, 0, () => NaN), 5);
});

test('U7 backoff ladder, never shorter than the user interval', () => {
  const expected = [3, 3, 10, 20, 40, 60, 60];
  expected.forEach((min, failures) => assert.equal(nextDelayMin(every3, failures, low), min, `failures=${failures}`));
  const every30 = custom({ intervalMode: 'fixed', minIntervalMin: 30 });
  assert.equal(nextDelayMin(every30, 2, low), 30, 'ladder 10 must not shorten a 30 min interval');
  assert.equal(nextDelayMin(every30, 5, low), 60);
  assert.equal(nextDelayMin(every3, -1, low), 3);
  assert.equal(nextDelayMin(every3, 'junk', low), 3);
  assert.deepEqual([...BACKOFF_LADDER_MIN], [0, 0, 10, 20, 40, 60]);
});

test('U7 effectiveFreshMin table from SPEC 4.4', () => {
  assert.equal(CYCLE_MARGIN_MIN, 2);
  assert.equal(effectiveFreshMin(every3), 10);
  assert.equal(effectiveFreshMin(random), 12);
  assert.equal(effectiveFreshMin(every10), 12);
  assert.equal(effectiveFreshMin(custom({ intervalMode: 'fixed', minIntervalMin: 30 })), 32);
  assert.equal(effectiveFreshMin({ ...every10, autoWidenFreshWindow: false }), 10, 'auto widen off keeps the floor');
  assert.equal(maxIntervalOf(every3), 3);
  assert.equal(maxIntervalOf(random), 10);
});

test('U7 nextRunAt anchors on cycle start and floors at 30 s', () => {
  const t0 = 1_789_600_000_000;
  assert.equal(ALARM_FLOOR_MS, 30_000);
  assert.equal(nextRunAt(t0, 3, t0 + 20_000), t0 + 3 * MIN, 'cadence from cycle start, not cycle end');
  assert.equal(nextRunAt(t0, 3, t0 + 4 * MIN), t0 + 4 * MIN + 30_000, 'overdue runs 30 s from now');
  assert.equal(nextRunAt(0, 5, t0), t0 + 30_000, 'no previous run');
});

test('U7 reloadCap never blocks the chosen interval', () => {
  assert.equal(reloadCap(custom({ intervalMode: 'fixed', minIntervalMin: 2 })), 34);
  assert.equal(reloadCap(every3), 24);
  assert.equal(reloadCap(random), 20, 'floor of maxReloadsPerHour wins at 5 min');
  assert.equal(reloadCap(every10), 20);
  assert.equal(reloadCap({ ...every10, maxReloadsPerHour: 6 }), 10);
});

test('U7 hourBucket and loadsPerHour', () => {
  const t = Date.UTC(2026, 8, 17, 9, 42, 13, 500);
  assert.equal(hourBucket(t), Date.UTC(2026, 8, 17, 9));
  assert.equal(hourBucket(Date.UTC(2026, 8, 17, 9)), Date.UTC(2026, 8, 17, 9));
  assert.equal(loadsPerHour(every3), 20);
  assert.equal(loadsPerHour(every10), 6);
  assert.equal(loadsPerHour(random), 8);
});
