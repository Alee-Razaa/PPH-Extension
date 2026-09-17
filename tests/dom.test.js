// content/dom.js wiring, against a minimal fake document (no jsdom: CLAUDE.md rule 2).
// Covers SPEC 8.3 readiness, 3.7 blocked detection and 8.4 state-first-then-DOM ordering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePPH, isReady, isBlocked, readCards, findStateScriptText } from '../src/content/dom.js';
import { SELECTORS } from '../src/core/constants.js';
import { IDS, SERVER_TIME_MS, makeState, makeRaw, jobUrl } from './fixtures/synthetic.js';

const el = (props = {}, children = {}) => ({
  ...props,
  querySelector: sel => (children[sel] ?? [])[0] ?? null,
  querySelectorAll: sel => children[sel] ?? []
});

const card = (id, age) => el({}, {
  [SELECTORS.TITLE_LINK]: [el({ href: jobUrl(id), textContent: ` Job ${id} ` })],
  [SELECTORS.PRICE]: [el({ textContent: '£88' })],
  [SELECTORS.FOOTER_SPANS]: [age, '8 proposals', 'Remote'].map(t => el({ textContent: t })),
  [SELECTORS.BADGE]: [el({ textContent: 'Pre-funded' })]
});

function fakeDoc({ raw = null, cards = 0, readyState = 'complete', title = 'Freelance Jobs', captcha = false, cardAge = '4 minutes ago' } = {}) {
  const scripts = [el({ src: 'https://cdn.example/app.js', textContent: '' }), el({ textContent: '  var x = 1;' })];
  if (raw !== null) scripts.push(el({ textContent: `\n${raw}` }));
  return el({ readyState, title }, {
    'script:not([src])': scripts.filter(s => !s.src),
    [SELECTORS.CARD]: IDS.slice(0, cards).map(id => card(id, cardAge)),
    [SELECTORS.CAPTCHA_FRAME]: captcha ? [el()] : []
  });
}

const RAW = makeRaw(makeState());

test('dom: findStateScriptText and readCards', () => {
  assert.equal(findStateScriptText(fakeDoc()), null);
  assert.ok(findStateScriptText(fakeDoc({ raw: RAW })).includes('window.PPHReact.serverTime'));
  const [first] = readCards(fakeDoc({ cards: 3 }), 2);
  assert.deepEqual(first, {
    href: jobUrl(IDS[0]), title: `Job ${IDS[0]}`, price: '£88',
    footer: ['4 minutes ago', '8 proposals', 'Remote'], badges: ['Pre-funded']
  });
  assert.equal(readCards(fakeDoc({ cards: 7 }), 5).length, 5);
});

test('dom: isReady prefers the state script over cards (R6)', () => {
  assert.equal(isReady(fakeDoc({ raw: RAW, cards: 0 }), 5), true, 'state script alone is enough');
  assert.equal(isReady(fakeDoc({ cards: 5 }), 5), true);
  assert.equal(isReady(fakeDoc({ cards: 4 }), 5), false);
  assert.equal(isReady(fakeDoc({ raw: RAW, readyState: 'interactive' }), 5), false);
});

test('dom: isBlocked only when there is no state, no cards, and a wall', () => {
  assert.equal(isBlocked(fakeDoc({ title: 'Just a moment...' })), true);
  assert.equal(isBlocked(fakeDoc({ captcha: true })), true);
  assert.equal(isBlocked(fakeDoc({ title: 'Freelance Jobs' })), false);
  assert.equal(isBlocked(fakeDoc({ raw: RAW, title: 'Log in' })), false);
  assert.equal(isBlocked(fakeDoc({ cards: 1, title: 'Log in' })), false);
});

test('dom: parsePPH uses the state script first', () => {
  const r = parsePPH(fakeDoc({ raw: RAW, cards: 7 }), 5, SERVER_TIME_MS, true);
  assert.equal(r.ok, true);
  assert.equal(r.source, 'state');
  assert.equal(r.serverTimeMs, SERVER_TIME_MS);
  assert.deepEqual(r.jobs.map(j => j.id), IDS.slice(0, 5));
  assert.deepEqual(r.failures, []);
});

test('dom: parsePPH falls back to cards and records why', () => {
  const now = SERVER_TIME_MS;
  const missing = parsePPH(fakeDoc({ cards: 7 }), 5, now, true);
  assert.equal(missing.source, 'dom');
  assert.deepEqual(missing.failures, ['state:MISSING']);

  const badJson = parsePPH(fakeDoc({ raw: RAW.replace('initialState={', 'initialState={oops'), cards: 7 }), 5, now, true);
  assert.equal(badJson.source, 'dom');
  assert.deepEqual(badJson.failures, ['state:JSON']);

  const staleClock = parsePPH(fakeDoc({ raw: RAW, cards: 7 }), 5, now + 48 * 3_600_000, true);
  assert.equal(staleClock.source, 'dom');
  assert.deepEqual(staleClock.failures, ['state:GATE_SERVER_TIME']);
});

test('dom: parsePPH failure reasons', () => {
  const now = SERVER_TIME_MS;
  assert.equal(parsePPH(fakeDoc({ raw: RAW }), 5, now, false).reason, 'OFFLINE');
  assert.equal(parsePPH(fakeDoc({ raw: RAW, readyState: 'loading' }), 5, now, true).reason, 'NOT_READY');
  assert.equal(parsePPH(fakeDoc({ title: 'Access denied' }), 5, now, true).reason, 'BLOCKED');
  assert.equal(parsePPH(fakeDoc(), 5, now, true).reason, 'NO_CARDS');
  const few = parsePPH(fakeDoc({ cards: 3 }), 5, now, true);
  assert.equal(few.reason, 'PARSE_FAILED');
  assert.deepEqual(few.failures, ['state:MISSING', 'dom:GATE_COUNT']);
});
