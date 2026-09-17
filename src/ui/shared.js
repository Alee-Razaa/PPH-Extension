// Helpers shared by the popup and options page. DOM is built with textContent only (CLAUDE.md rule 5).
import { MSG } from '../core/constants.js';
import { sendToWorker } from '../platform/runtime.js';

/** Create an element. `text` sets textContent; functions on `on*` keys become listeners. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (typeof value === 'boolean') el.toggleAttribute(key, value);
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const $ = id => document.getElementById(id);

/** Ask the worker. Resolves null when the worker does not answer in time. */
export function ask(type, payload = {}, timeoutMs = 5000) {
  return sendToWorker({ type, ...payload }, timeoutMs);
}

export const getStatus = () => ask(MSG.GET_STATUS);

/** Plain-language view of each status (SPEC 12.3, 13.4). */
export const STATUS_VIEW = Object.freeze({
  IDLE: { label: 'Starting', tone: 'idle', shape: 'hollow', note: '' },
  RUNNING: { label: 'Checking…', tone: 'accent', shape: 'pulse', note: '' },
  OK: { label: 'Watching', tone: 'ok', shape: 'filled', note: '' },
  PAUSED: { label: 'Paused', tone: 'idle', shape: 'hollow', note: 'Checking is paused. Press Resume to start again.' },
  OFFLINE: { label: 'Offline', tone: 'warn', shape: 'slash', note: 'No internet. It will try again, and sooner once you reconnect.' },
  UNRESPONSIVE: { label: 'No response', tone: 'warn', shape: 'triangle', note: 'The jobs page did not load in time. It will retry soon.' },
  PARSE_FAILED: { label: 'Could not read', tone: 'warn', shape: 'triangle', note: 'Could not read the jobs page. It will retry soon.' },
  NO_TAB: { label: 'No tab', tone: 'idle', shape: 'hollow', note: 'The monitor tab was closed.' },
  CAPPED: { label: 'Hourly limit', tone: 'warn', shape: 'triangle', note: 'Hourly page-load limit reached. Checking resumes next hour.' },
  BLOCKED: { label: 'Needs you', tone: 'danger', shape: 'octagon', note: 'PeoplePerHour is asking for a check. Open the pinned tab, clear it, then resume.' }
});

export const viewFor = status => STATUS_VIEW[status] ?? STATUS_VIEW.IDLE;

/** "4:05" for a countdown in ms. */
export function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export const PRESET_LABELS = Object.freeze({ every3: '3 min', random5to10: '5–10 min', every10: '10 min' });

export function describeInterval(s) {
  return s.intervalMode === 'fixed'
    ? `every ${s.minIntervalMin} minute${s.minIntervalMin === 1 ? '' : 's'}`
    : `randomly every ${s.minIntervalMin} to ${s.maxIntervalMin} minutes`;
}

/** Run fn at most once per `ms` while calls keep coming, using the latest arguments. */
export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
