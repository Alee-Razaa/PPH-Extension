// U9. SPEC 4.4 and 9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSettings, clampSettings, timingChanged, applyPreset, presetOf, PRESETS, KEYWORDS_MAX
} from '../src/core/settings.js';
import { DEFAULTS } from '../src/core/constants.js';

test('U9 mergeSettings keeps user values, adds new keys, deep merges nested objects', () => {
  const stored = { minIntervalMin: 3, sound: { volume: 0.2 }, filters: { keywordsInclude: ['wordpress'] } };
  const merged = mergeSettings(DEFAULTS, stored);
  assert.equal(merged.minIntervalMin, 3);
  assert.equal(merged.maxIntervalMin, DEFAULTS.maxIntervalMin, 'missing keys come from defaults');
  assert.equal(merged.sound.volume, 0.2);
  assert.equal(merged.sound.file, DEFAULTS.sound.file);
  assert.deepEqual(merged.filters.keywordsInclude, ['wordpress']);
  assert.equal(merged.filters.remoteOnly, false);
  assert.equal(Object.isFrozen(merged), false, 'result is a fresh writable object');
  merged.filters.keywordsExclude.push('x');
  assert.equal(DEFAULTS.filters.keywordsExclude.length, 0, 'defaults are never mutated');
});

test('U9 mergeSettings drops unknown and hostile keys', () => {
  const hostile = JSON.parse('{"__proto__": {"polluted": true}, "evil": 1, "sound": {"constructor": 5}}');
  const merged = mergeSettings(DEFAULTS, hostile);
  assert.equal('evil' in merged, false);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.hasOwn(merged.sound, 'constructor'), false);
  assert.deepEqual(mergeSettings(DEFAULTS, null), mergeSettings(DEFAULTS, {}));
  assert.equal(mergeSettings(DEFAULTS, { sound: 'nope' }).sound.volume, DEFAULTS.sound.volume);
});

test('U9 clampSettings clamps intervals and keeps max >= min', () => {
  assert.equal(clampSettings({ minIntervalMin: 1 }).minIntervalMin, 2, 'floor is 2 minutes');
  assert.equal(clampSettings({ minIntervalMin: 500 }).minIntervalMin, 60);
  const inverted = clampSettings({ minIntervalMin: 12, maxIntervalMin: 7 });
  assert.equal(inverted.maxIntervalMin, 12);
  assert.equal(clampSettings({ minIntervalMin: '7' }).minIntervalMin, 7, 'numeric strings accepted');
  assert.equal(clampSettings({ minIntervalMin: 3.4 }).minIntervalMin, 3, 'rounded');
  assert.equal(clampSettings({ settleSec: 1 }).settleSec, 5);
  assert.equal(clampSettings({ topN: 99 }).topN, 20);
  assert.equal(clampSettings({ freshWindowMin: 0 }).freshWindowMin, 2);
  assert.equal(clampSettings({ maxReloadsPerHour: 1000 }).maxReloadsPerHour, 40);
  assert.equal(clampSettings({ maxNotificationsPerCycle: 0 }).maxNotificationsPerCycle, 1);
});

test('U9 clampSettings falls back to defaults on wrong types', () => {
  const s = clampSettings({
    enabled: 'yes', intervalMode: 'sometimes', minIntervalMin: 'abc', settleSec: null, topN: '',
    sound: { file: 'https://evil.example/x.mp3', volume: 'loud', highValueFile: '../../etc', highValueBudget: -3 },
    filters: { keywordsInclude: 'wordpress', minBudget: 'lots', maxProposals: 'few', remoteOnly: 1 }
  });
  assert.equal(s.enabled, DEFAULTS.enabled);
  assert.equal(s.intervalMode, DEFAULTS.intervalMode);
  assert.equal(s.minIntervalMin, DEFAULTS.minIntervalMin);
  assert.equal(s.settleSec, DEFAULTS.settleSec);
  assert.equal(s.topN, DEFAULTS.topN);
  assert.equal(s.sound.file, DEFAULTS.sound.file, 'sound files only from the allow list');
  assert.equal(s.sound.highValueFile, DEFAULTS.sound.highValueFile);
  assert.equal(s.sound.volume, DEFAULTS.sound.volume);
  assert.equal(s.sound.highValueBudget, 0);
  assert.deepEqual(s.filters.keywordsInclude, []);
  assert.equal(s.filters.minBudget, 0);
  assert.equal(s.filters.maxProposals, null);
  assert.equal(s.filters.remoteOnly, false);
});

test('U9 clampSettings keeps valid values and fractional volume', () => {
  const s = clampSettings({ ...DEFAULTS, enabled: false, sound: { ...DEFAULTS.sound, volume: 0.35, file: 'sounds/ping.wav' },
    filters: { ...DEFAULTS.filters, maxProposals: 10 } });
  assert.equal(s.enabled, false);
  assert.equal(s.sound.volume, 0.35);
  assert.equal(s.sound.file, 'sounds/ping.wav');
  assert.equal(s.filters.maxProposals, 10);
  assert.deepEqual(clampSettings(DEFAULTS), mergeSettings(DEFAULTS, {}), 'defaults are already valid');
  assert.deepEqual(clampSettings(undefined), clampSettings(DEFAULTS));
});

test('U9 keyword lists are trimmed, deduped, capped', () => {
  const many = Array.from({ length: 80 }, (_, i) => `k${i}`);
  const s = clampSettings({ filters: {
    keywordsInclude: ['  WordPress ', 'wordpress', '', 42, null, 'x'.repeat(80), 'Shopify'],
    keywordsExclude: many
  } });
  assert.deepEqual(s.filters.keywordsInclude, ['WordPress', 'x'.repeat(50), 'Shopify']);
  assert.equal(s.filters.keywordsExclude.length, KEYWORDS_MAX);
});

test('U9 timingChanged only for timing keys, never on first write', () => {
  const a = clampSettings(DEFAULTS);
  assert.equal(timingChanged(a, { ...a, minIntervalMin: 3 }), true);
  assert.equal(timingChanged(a, { ...a, intervalMode: 'fixed' }), true);
  assert.equal(timingChanged(a, { ...a, maxIntervalMin: 11 }), true);
  assert.equal(timingChanged(a, { ...a, enabled: false }), true);
  assert.equal(timingChanged(a, { ...a, topN: 7, debug: true }), false);
  assert.equal(timingChanged(undefined, a), false);
  assert.equal(timingChanged(a, null), false);
});

test('U9 presets apply and are recognised', () => {
  const base = clampSettings(DEFAULTS);
  const every3 = applyPreset(base, 'every3');
  assert.equal(every3.intervalMode, 'fixed');
  assert.equal(every3.minIntervalMin, 3);
  assert.equal(presetOf(every3), 'every3');
  assert.equal(presetOf(applyPreset(base, 'every10')), 'every10');
  assert.equal(presetOf(applyPreset(every3, 'random5to10')), 'random5to10');
  assert.equal(presetOf(base), 'random5to10', 'defaults are the 5 to 10 preset');
  assert.equal(presetOf(clampSettings({ intervalMode: 'fixed', minIntervalMin: 7 })), 'custom');
  assert.equal(applyPreset(base, 'nonsense'), base);
  assert.equal(applyPreset(base, 'toString'), base, 'prototype names are not presets');
  assert.deepEqual(Object.keys(PRESETS), ['every3', 'random5to10', 'every10']);
});
