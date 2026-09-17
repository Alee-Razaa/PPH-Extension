// The only DOM reader. Selector reads and plain data out, no decisions beyond wiring core. SPEC 3.7, 8.3, 25.5.
import { SELECTORS, BLOCKED_TITLE_RE, REASON } from '../core/constants.js';
import { extractStateJson, jobsFromState, jobsFromCards } from '../core/parser.js';
import { checkGates } from '../core/validate.js';
import { attempt } from '../core/result.js';

export function findStateScriptText(doc) {
  for (const script of doc.querySelectorAll('script:not([src])')) {
    const text = script.textContent || '';
    if (text.trimStart().startsWith('window.PPHReact')) return text;
  }
  return null;
}

/** @returns {import('../core/constants.js').CardData[]} */
export function readCards(doc, max) {
  return [...doc.querySelectorAll(SELECTORS.CARD)].slice(0, max).map(card => {
    const link = card.querySelector(SELECTORS.TITLE_LINK);
    return {
      href: link?.href || '',
      title: (link?.textContent || '').trim(),
      price: (card.querySelector(SELECTORS.PRICE)?.textContent || '').trim(),
      footer: [...card.querySelectorAll(SELECTORS.FOOTER_SPANS)].map(s => (s.textContent || '').trim()),
      badges: [...card.querySelectorAll(SELECTORS.BADGE)].map(b => (b.textContent || '').trim())
    };
  });
}

/** Ready = loaded AND (state script present OR enough cards). State first (R6). */
export function isReady(doc, topN) {
  return doc.readyState === 'complete' &&
    (findStateScriptText(doc) !== null || doc.querySelectorAll(SELECTORS.CARD).length >= topN);
}

export function isBlocked(doc) {
  if (findStateScriptText(doc) !== null) return false;
  if (doc.querySelectorAll(SELECTORS.CARD).length > 0) return false;
  return BLOCKED_TITLE_RE.test(doc.title || '') || doc.querySelector(SELECTORS.CAPTCHA_FRAME) !== null;
}

/** @returns {import('../core/constants.js').ParseResult} state parser first, DOM fallback second */
export function parsePPH(doc, topN, nowMs, online) {
  if (!online) return { ok: false, reason: REASON.OFFLINE, failures: [] };
  if (doc.readyState !== 'complete') return { ok: false, reason: REASON.NOT_READY, failures: [] };
  if (isBlocked(doc)) return { ok: false, reason: REASON.BLOCKED, failures: [] };

  const failures = [];
  const extracted = extractStateJson(findStateScriptText(doc));
  if (extracted) {
    const parsed = attempt(() => JSON.parse(extracted.json));
    const jobs = parsed.ok ? jobsFromState(parsed.value, extracted.serverTimeMs, topN) : null;
    const gate = checkGates(jobs, extracted.serverTimeMs, nowMs, topN);
    if (gate.ok) return { ok: true, source: 'state', serverTimeMs: extracted.serverTimeMs, jobs, failures };
    failures.push(`state:${parsed.ok ? gate.error : 'JSON'}`);
  } else {
    failures.push('state:MISSING');
  }

  const cards = readCards(doc, topN);
  const jobs = jobsFromCards(cards, nowMs, topN);
  const gate = checkGates(jobs, nowMs, nowMs, topN);
  if (gate.ok) return { ok: true, source: 'dom', serverTimeMs: nowMs, jobs, failures };
  failures.push(`dom:${gate.error}`);

  return { ok: false, reason: cards.length ? REASON.PARSE_FAILED : REASON.NO_CARDS, failures };
}
