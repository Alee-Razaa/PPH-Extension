// Popup: status, countdown, newest jobs, interval presets, Check now / Pause. SPEC 13.
import { MSG, STATUS, TIME } from '../core/constants.js';
import { formatAge } from '../core/time.js';
import { formatMoney } from '../core/alerts.js';
import { isPphUrl } from '../core/validate.js';
import { presetOf } from '../core/settings.js';
import { openOptionsPage } from '../platform/runtime.js';
import * as on from '../platform/events.js';
import { h, $, ask, getStatus, viewFor, clock, PRESET_LABELS, describeInterval, debounce } from './shared.js';

let status = null;
let fetchedAt = 0;
let busy = false;

// ---------------------------------------------------------------- data

async function refresh() {
  const next = await getStatus();
  if (!next || next.ok === false) {
    renderUnavailable();
    return;
  }
  status = next;
  fetchedAt = Date.now();
  render();
}
const refreshSoon = debounce(refresh, 150);

// ---------------------------------------------------------------- render

function render() {
  const { stats, settings } = status;
  const view = status.running ? viewFor(STATUS.RUNNING) : viewFor(stats.status);

  $('dot').className = `dot dot--${view.shape} tone-${view.tone}`;
  $('status-label').textContent = view.label;
  renderCountdown();
  renderNotice();
  renderJobs();
  renderPresets();

  const checking = status.running || busy;
  $('check-now').disabled = checking || stats.status === STATUS.BLOCKED;
  $('check-now').textContent = checking ? 'Checking…' : 'Check now';
  $('pause').textContent = settings.enabled ? 'Pause' : 'Resume';
}

function renderCountdown() {
  if (!status) return;
  const { stats, settings } = status;
  let text = '';
  if (status.running) text = 'checking now';
  else if (!settings.enabled) text = 'paused';
  else if (stats.status === STATUS.BLOCKED) text = 'stopped';
  else if (Number.isFinite(stats.nextRunMs)) text = `next check in ${clock(stats.nextRunMs - Date.now())}`;
  $('countdown').textContent = text;
}

function renderNotice() {
  const { stats, settings } = status;
  const actions = [];
  let text = '';

  if (!settings.enabled) {
    text = viewFor(STATUS.PAUSED).note;
  } else if (!status.running && stats.status && stats.status !== STATUS.OK && stats.status !== STATUS.IDLE) {
    text = viewFor(stats.status).note;
    if (stats.status === STATUS.PARSE_FAILED && stats.consecutiveParseFailures >= 2) {
      text = 'Could not read the page twice in a row. The site layout may have changed.';
      actions.push(h('button', { class: 'btn btn--link', type: 'button', text: 'View log', onClick: () => openOptionsPage() }));
    }
    if (stats.status === STATUS.NO_TAB) {
      actions.push(h('button', { class: 'btn', type: 'button', text: 'Reopen tab', onClick: openMonitorTab }));
    }
    if (stats.status === STATUS.BLOCKED) {
      actions.push(h('button', { class: 'btn', type: 'button', text: 'Open tab', onClick: openMonitorTab }));
      actions.push(h('button', { class: 'btn btn--primary', type: 'button', text: 'I cleared it, resume', onClick: resume }));
    }
  } else if (stats.overflow) {
    text = 'Busy right now: every job on the list was new. Check more often or read more jobs to miss nothing.';
  }

  $('notice').hidden = !text;
  $('notice-text').textContent = text;
  $('notice-actions').replaceChildren(...actions);
}

function renderJobs() {
  const { lastJobs = [], settings, stats } = status;
  const list = $('jobs');
  if (!lastJobs.length) {
    const hasTab = status.monitorTabId !== null;
    const message = !settings.enabled
      ? 'Paused. Resume to start watching for new jobs.'
      : hasTab || stats.nextRunMs
        ? 'Watching. The first jobs appear here after the first check.'
        : 'Not watching yet. Open the monitor tab to start.';
    list.replaceChildren(h('div', { class: 'empty' },
      h('p', { text: message }),
      !hasTab && settings.enabled ? h('button', { class: 'btn', type: 'button', text: 'Open monitor tab', onClick: openMonitorTab }) : null
    ));
    return;
  }
  list.replaceChildren(...lastJobs.slice(0, settings.topN).map(jobCard));
}

function jobCard(job) {
  const ageMs = Date.now() - job.postedMs;
  const fresh = ageMs < status.effectiveFreshMin * TIME.MINUTE_MS;
  const badges = [];
  if (job.etiquettes?.prefunded) badges.push(h('span', { class: 'pill badge tone-ok', text: 'pre-funded' }));
  if (job.etiquettes?.urgent) badges.push(h('span', { class: 'pill badge tone-warn', text: 'urgent' }));
  if (job.etiquettes?.opportunity) badges.push(h('span', { class: 'pill badge tone-accent', text: 'opportunity' }));

  const children = [
    h('div', { class: 'card__top' },
      fresh ? h('span', { class: 'pill card__new', text: 'New' }) : null,
      h('span', { class: 'js-age', 'data-posted': job.postedMs, text: `${formatAge(Math.max(0, ageMs))} ago` })),
    h('p', { class: 'card__title', text: job.title || 'Untitled job' }),
    h('div', { class: 'card__meta' },
      h('span', { text: formatMoney(job) }),
      h('span', { text: `${job.proposals} proposal${job.proposals === 1 ? '' : 's'}` }),
      job.category ? h('span', { text: job.category }) : null,
      ...badges)
  ];
  const cls = `card${fresh ? ' card--fresh' : ''}`;
  return isPphUrl(job.url)
    ? h('a', { class: cls, href: job.url, target: '_blank', rel: 'noopener noreferrer' }, ...children)
    : h('div', { class: cls }, ...children);
}

function renderPresets() {
  const { settings } = status;
  const current = presetOf(settings);
  const buttons = Object.entries(PRESET_LABELS).map(([preset, label]) => h('button', {
    type: 'button',
    role: 'radio',
    'aria-checked': String(current === preset),
    class: preset === 'every3' ? 'is-fast' : undefined,
    title: preset === 'random5to10' ? 'Randomly every 5 to 10 minutes (default)' : `Every ${label}`,
    text: label,
    onClick: () => applyPreset(preset)
  }));
  buttons.push(h('button', {
    type: 'button',
    role: 'radio',
    'aria-checked': String(current === 'custom'),
    title: current === 'custom' ? `Custom: ${describeInterval(settings)}. Change in settings.` : 'Custom interval in settings',
    'aria-label': current === 'custom' ? `Custom: ${describeInterval(settings)}` : 'Custom interval',
    text: current === 'custom' ? `${settings.minIntervalMin}${settings.intervalMode === 'random' ? `–${settings.maxIntervalMin}` : ''} min` : '…',
    onClick: () => openOptionsPage()
  }));
  $('presets').replaceChildren(...buttons);
}

function renderUnavailable() {
  $('dot').className = 'dot dot--triangle tone-warn';
  $('status-label').textContent = 'Starting up';
  $('countdown').textContent = '';
  $('notice').hidden = false;
  $('notice-text').textContent = 'The extension is waking up. This window refreshes on its own.';
  $('notice-actions').replaceChildren();
  setTimeout(refresh, 1000);
}

/** Once a second: countdown and job ages only, so nothing jumps. */
function tick() {
  renderCountdown();
  for (const el of document.querySelectorAll('.js-age')) {
    const posted = Number(el.dataset.posted);
    if (Number.isFinite(posted)) el.textContent = `${formatAge(Math.max(0, Date.now() - posted))} ago`;
  }
  if (status && Number.isFinite(status.stats.nextRunMs) && Date.now() > status.stats.nextRunMs + 2000 && Date.now() - fetchedAt > 3000) {
    refresh();
  }
}

// ---------------------------------------------------------------- actions

async function withBusy(task) {
  busy = true;
  if (status) render();
  try { await task(); } finally { busy = false; await refresh(); }
}

async function checkNow(event) {
  const settleSec = event.shiftKey && status?.settings.debug ? 3 : undefined;
  await withBusy(async () => {
    const reply = await ask(MSG.FORCE_CHECK, { settleSec }, 10_000);
    if (reply?.reason === 'TOO_SOON') flash('Just checked. Try again in a few seconds.');
  });
}

const togglePause = () => withBusy(() => ask(MSG.SET_ENABLED, { enabled: !status?.settings.enabled }));
const applyPreset = preset => withBusy(() => ask(MSG.APPLY_PRESET, { preset }));
const openMonitorTab = () => withBusy(() => ask(MSG.OPEN_MONITOR_TAB, {}, 10_000));
const resume = () => withBusy(() => ask(MSG.RESUME_FROM_BLOCK));

function flash(text) {
  $('notice').hidden = false;
  $('notice-text').textContent = text;
  $('notice-actions').replaceChildren();
}

// ---------------------------------------------------------------- start

$('check-now').addEventListener('click', checkNow);
$('pause').addEventListener('click', togglePause);
$('settings').addEventListener('click', () => openOptionsPage());
on.storageChanged((changes, area) => {
  if (area === 'local' && (changes.stats || changes.lastJobs || changes.settings)) refreshSoon();
});
setInterval(tick, 1000);

ask(MSG.CLEAR_UNREAD).finally(refresh);
