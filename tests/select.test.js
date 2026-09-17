// U8 plus alert planning. SPEC 8.5, 15.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passesFilters, pickFresh, markSeen, pruneSeen, highestSeenId } from '../src/core/select.js';
import { planAlerts, jobLine, formatMoney, truncate, notificationIdFor, SYSTEM_NOTICES } from '../src/core/alerts.js';
import { clampSettings, applyPreset } from '../src/core/settings.js';
import { DEFAULTS } from '../src/core/constants.js';

const MIN = 60_000;
const NOW = Date.UTC(2026, 8, 17, 12, 0);
const settings = clampSettings(DEFAULTS);                 // random 5-10, window 12 min effective
const job = (id, ageMin, patch = {}) => ({
  id: String(id), title: `Job ${id}`, url: `https://www.peopleperhour.com/freelance-jobs/x/job-${id}`,
  postedMs: NOW - ageMin * MIN, ageMin, budget: 100, currency: 'GBP', projectType: 'fixed_price', proposals: 3,
  state: 'open', locationType: 'remote', category: 'Web Development',
  etiquettes: { featured: false, opportunity: false, prefunded: false, urgent: false, nda: false }, ...patch
});
const filters = patch => ({ ...settings.filters, ...patch });

test('U8 passesFilters truth table', () => {
  const j = job(1, 1, { title: 'WordPress site fix', category: 'Web', budget: 200, proposals: 5 });
  assert.equal(passesFilters(j, filters({})), true);
  assert.equal(passesFilters(j, filters({ keywordsInclude: ['wordpress'] })), true, 'case insensitive include');
  assert.equal(passesFilters(j, filters({ keywordsInclude: ['shopify'] })), false);
  assert.equal(passesFilters(j, filters({ keywordsInclude: ['web'] })), true, 'matches category too');
  assert.equal(passesFilters(j, filters({ keywordsExclude: ['FIX'] })), false);
  assert.equal(passesFilters(j, filters({ keywordsInclude: ['wordpress'], keywordsExclude: ['fix'] })), false, 'exclude wins');
  assert.equal(passesFilters(j, filters({ minBudget: 200 })), true);
  assert.equal(passesFilters(j, filters({ minBudget: 201 })), false);
  assert.equal(passesFilters(j, filters({ maxProposals: 5 })), true);
  assert.equal(passesFilters(j, filters({ maxProposals: 4 })), false);
  assert.equal(passesFilters(j, filters({ maxProposals: 0 })), false, '0 is a real limit, not "any"');
  assert.equal(passesFilters(j, filters({ remoteOnly: true })), true);
  assert.equal(passesFilters({ ...j, locationType: 'onsite' }, filters({ remoteOnly: true })), false);
  assert.equal(passesFilters(j, filters({ prefundedOnly: true })), false);
  assert.equal(passesFilters({ ...j, etiquettes: { prefunded: true } }, filters({ prefundedOnly: true })), true);
  assert.equal(passesFilters({ ...j, etiquettes: undefined }, filters({ prefundedOnly: true })), false);
  assert.equal(passesFilters(j, undefined), true, 'missing filters allow everything');
  assert.equal(passesFilters(j, { keywordsInclude: 'x', keywordsExclude: null }), true, 'junk filter lists are ignored');
});

test('U8 pickFresh: window, seen, open, filters', () => {
  const jobs = [job(10, 3), job(9, 11.9), job(8, 12.1), job(7, 2, { state: 'closed' }), job(6, 1, { title: 'Logo' })];
  const seen = { 6: NOW - 5 * MIN, 99: NOW - 5 * MIN };        // 99: a higher id already seen, so no late-listing
  const { fresh, overflow } = pickFresh(jobs, NOW, { ...settings, filters: filters({ keywordsExclude: ['nothing'] }) }, seen);
  assert.deepEqual(fresh.map(j => j.id), ['10', '9'], '12.1 min is outside the 12 min window, closed and seen are skipped');
  assert.equal(overflow, false);
  assert.deepEqual(pickFresh(jobs, NOW, applyPreset(settings, 'every3'), {}).fresh.map(j => j.id), ['10', '6'],
    'every 3 min uses the 10 min floor (11.9 min is out), and the first cycle has no late-listing baseline');
});

test('U8 pickFresh: late listing alerts an unseen higher id under an hour old', () => {
  const seen = { 4522017: NOW - 20 * MIN, 4522015: NOW - 20 * MIN };
  const jobs = [job(4522044, 25), job(4522042, 70), job(4522016, 25), job(4522017, 30)];
  const { fresh } = pickFresh(jobs, NOW, settings, seen);
  assert.deepEqual(fresh.map(j => j.id), ['4522044'],
    '25 min old but listed after everything seen; 70 min is too old; 4522016 is below the highest seen id');
  assert.deepEqual(pickFresh(jobs, NOW, settings, {}).fresh, [], 'no baseline on the very first cycle');
});

test('U8 pickFresh: overflow when every job is new', () => {
  const jobs = [job(5, 1), job(4, 2), job(3, 3)];
  assert.equal(pickFresh(jobs, NOW, settings, {}).overflow, true);
  assert.equal(pickFresh(jobs, NOW, settings, { 3: NOW }).overflow, false);
  assert.equal(pickFresh([], NOW, settings, {}).overflow, false);
  assert.deepEqual(pickFresh(jobs, NOW, settings, null).fresh.length, 3, 'null seen store is treated as empty');
});

test('U8 highestSeenId, markSeen, pruneSeen', () => {
  assert.equal(highestSeenId({}), null);
  assert.equal(highestSeenId(undefined), null);
  assert.equal(highestSeenId({ 12: 1, 900: 1, abc: 1, 45: 1 }), 900);
  const marked = markSeen({ 1: 100 }, [job(1, 0), job(2, 0)], 500);
  assert.deepEqual(marked, { 1: 100, 2: 500 }, 'first-seen time kept');
  assert.deepEqual(markSeen(undefined, [job(3, 0)], 7), { 3: 7 });
  const sixHours = 6 * 60 * MIN;
  assert.deepEqual(pruneSeen({ a: NOW - sixHours, b: NOW - sixHours + 1, c: 'junk' }, NOW), { b: NOW - sixHours + 1 });
  assert.deepEqual(pruneSeen(null, NOW), {});
});

test('alerts: money, line and truncation', () => {
  assert.equal(formatMoney(job(1, 0, { budget: 1250.4 })), '£1,250 fixed');
  assert.equal(formatMoney(job(1, 0, { budget: 25, currency: 'USD', projectType: 'hourly' })), '$25/hr');
  assert.equal(formatMoney(job(1, 0, { budget: 80, currency: 'EUR' })), '€80 fixed');
  assert.equal(formatMoney(job(1, 0, { budget: 80, currency: 'AUD' })), 'AUD 80 fixed');
  assert.equal(formatMoney(job(1, 0, { budget: 80, currency: '' })), '80 fixed');
  assert.equal(formatMoney(job(1, 0, { budget: 0 })), 'Fixed price');
  assert.equal(formatMoney(job(1, 0, { budget: 0, projectType: 'hourly' })), 'Hourly');
  assert.equal(jobLine(job(1, 4.2, { proposals: 1 }), NOW), '£100 fixed · 1 proposal · posted 4 min ago');
  assert.equal(jobLine(job(1, -1), NOW), '£100 fixed · 3 proposals · posted <1 min ago', 'clock jitter never shows a negative age');
  assert.equal(truncate('  abc  ', 10), 'abc');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
  assert.equal(truncate(null, 5), '');
  assert.equal(notificationIdFor(job(42, 0)), 'pph-42');
});

test('alerts: planAlerts caps notifications, adds a summary, plays one sound', () => {
  const fresh = [job(5, 1, { budget: 50 }), job(4, 2), job(3, 3), job(2, 4), job(1, 5, { title: '', category: '' })];
  const plan = planAlerts(fresh, settings, NOW);
  assert.deepEqual(plan.notifications.map(n => n.id), ['pph-5', 'pph-4', 'pph-3']);
  assert.equal(plan.notifications[0].title, 'Job 5');
  assert.equal(plan.notifications[0].url, fresh[0].url);
  assert.equal(plan.notifications[0].contextMessage, 'Web Development · PeoplePerHour');
  assert.deepEqual(plan.summary, { id: `pph-summary-${NOW}`, title: '2 more new jobs', message: 'Open PPH Job Radar to see all of them.', contextMessage: 'PeoplePerHour' });
  assert.deepEqual(plan.sound, { file: 'sounds/chime.wav', volume: 0.8 });
  assert.equal(plan.highValue, false);

  const one = planAlerts([job(1, 1, { title: '', category: '', url: undefined })], { ...settings, maxNotificationsPerCycle: 1 }, NOW);
  assert.equal(one.summary, null);
  assert.equal(one.notifications[0].title, 'New job on PeoplePerHour');
  assert.equal(one.notifications[0].contextMessage, 'PeoplePerHour');
  assert.equal(one.notifications[0].url, null);

  const summaryOfOne = planAlerts([job(2, 1), job(1, 1)], { ...settings, maxNotificationsPerCycle: 1 }, NOW);
  assert.equal(summaryOfOne.summary.title, '1 more new job');
});

test('alerts: high value sound, sound off, nothing new', () => {
  const big = planAlerts([job(1, 1, { budget: 500 })], settings, NOW);
  assert.equal(big.highValue, true);
  assert.equal(big.sound.file, 'sounds/alarm.wav');
  const thresholdOff = { ...settings, sound: { ...settings.sound, highValueBudget: 0 } };
  assert.equal(planAlerts([job(1, 1, { budget: 9999 })], thresholdOff, NOW).sound.file, 'sounds/chime.wav');
  const muted = { ...settings, sound: { ...settings.sound, enabled: false } };
  assert.equal(planAlerts([job(1, 1)], muted, NOW).sound, null);
  const none = planAlerts([], settings, NOW);
  assert.deepEqual(none, { notifications: [], summary: null, sound: null, highValue: false });
  assert.deepEqual(planAlerts(undefined, settings, NOW).notifications, []);
  for (const notice of Object.values(SYSTEM_NOTICES)) assert.match(notice.id, /^pph-/);
});
