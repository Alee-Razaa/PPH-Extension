// Pure parsers. SPEC 3.2 to 3.6 and 25.4. No DOM: content/dom.js reads the page and passes plain data in.
import { toUtcMs, relToMs } from './time.js';
import { sanitizeJob } from './validate.js';
import { LIMITS, TIME } from './constants.js';

const STATE_RE = /window\.PPHReact\.initialState\s*=\s*([\s\S]*?);\s*window\.PPHReact\.data\s*=/;
const SERVER_TIME_RE = /window\.PPHReact\.serverTime\s*=\s*['"](\d{12,14})['"]/;
const ID_RE = /(\d{5,20})(?:[/?#]|$)/;
const CURRENCY = { '£': 'GBP', '$': 'USD', '€': 'EUR' };

/**
 * Slice the initialState JSON out of the inline script text. Never parses the whole script:
 * window.PPHReact.data is a JS object literal, not JSON.
 * @returns {{ json: string, serverTimeMs: number } | null}
 */
export function extractStateJson(raw) {
  if (typeof raw !== 'string' || raw.length > LIMITS.MAX_SCRIPT_CHARS) return null;
  const state = raw.match(STATE_RE);
  const serverTime = raw.match(SERVER_TIME_RE);
  if (!state || !serverTime) return null;
  return { json: state[1].trim(), serverTimeMs: Number(serverTime[1]) };
}

/**
 * Top N jobs from freelanceJobs.main only (featured and completed are ignored).
 * @returns {import('./constants.js').Job[] | null}
 */
export function jobsFromState(state, serverTimeMs, topN) {
  const refs = state?.freelanceJobs?.main?.data;
  const projects = state?.entities?.projects;
  if (!Array.isArray(refs) || !projects || typeof projects !== 'object') return null;

  const jobs = [];
  for (const ref of refs.slice(0, topN)) {
    const a = projects[ref?.id]?.attributes;
    if (!a) return null;
    const postedMs = toUtcMs(a.posted_dt);
    jobs.push(sanitizeJob({
      id: a.proj_id ?? ref.id,
      title: a.title,
      url: a.url,
      postedMs,
      ageMin: (serverTimeMs - postedMs) / TIME.MINUTE_MS,
      budget: a.budget,
      currency: a.currency,
      projectType: a.project_type,
      proposals: a.proposalCount,
      state: a.item_state,
      locationType: a.location_type,
      category: a.category?.cate_name,
      etiquettes: a.etiquettes
    }));
  }
  return jobs;
}

/** Numeric project id at the end of a job URL: the same key as proj_id (R12). '' when absent. */
export function idFromUrl(href) {
  const m = String(href ?? '').match(ID_RE);
  return m ? m[1] : '';
}

/**
 * DOM fallback on plain card data. Ages come from rounded relative text, so they are approximate.
 * @param {import('./constants.js').CardData[]} cards
 * @returns {import('./constants.js').Job[] | null}
 */
export function jobsFromCards(cards, nowMs, topN) {
  if (!Array.isArray(cards) || cards.length < topN) return null;
  return cards.slice(0, topN).map(c => {
    const footer = Array.isArray(c?.footer) ? c.footer : [];
    const price = String(c?.price ?? '');
    const ageMs = relToMs(footer[0]);
    return sanitizeJob({
      id: idFromUrl(c?.href),
      title: c?.title,
      url: c?.href,
      postedMs: nowMs - ageMs,
      ageMin: ageMs / TIME.MINUTE_MS,
      budget: parseFloat(price.replace(/[^\d.]/g, '')),
      currency: CURRENCY[price.trim()[0]] ?? '',
      projectType: /\/\s*h(ou)?r/i.test(price) ? 'hourly' : 'fixed_price',
      proposals: parseInt(footer[1], 10),
      state: 'open',
      locationType: /remote/i.test(footer[2] ?? '') ? 'remote' : 'onsite',
      category: '',
      etiquettes: Object.fromEntries((Array.isArray(c?.badges) ? c.badges : [])
        .map(b => [String(b).replace(/[^a-z]/gi, '').toLowerCase(), true]))
    });
  });
}
