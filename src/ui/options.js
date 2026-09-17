// Options page. SPEC 14. Autosaves every change through the worker, which clamps and stores it.
import { MSG, STATUS } from '../core/constants.js';
import { presetOf } from '../core/settings.js';
import { reloadsThisHour } from '../core/cycle.js';
import * as store from '../platform/storage.js';
import * as on from '../platform/events.js';
import { h, $, ask, getStatus, viewFor, describeInterval, debounce } from './shared.js';

let status = null;
let showCustom = false;
const tags = { keywordsInclude: [], keywordsExclude: [] };

const RANGE_FORMAT = {
  freshWindowMin: v => `${v} min`,
  topN: v => `${v} jobs`,
  settleSec: v => `${v} s`,
  'sound-volume': v => `${Math.round(v * 100)}%`,
  maxNotificationsPerCycle: v => String(v),
  maxReloadsPerHour: v => `${v} / hour`
};

// ---------------------------------------------------------------- load and fill

async function load({ refill = true } = {}) {
  const next = await getStatus();
  if (!next || next.ok === false) {
    setTimeout(() => load({ refill }), 1000);
    return;
  }
  status = next;
  if (refill) fill(status.settings);
  renderReadouts();
  await renderLog();
}

function setValue(id, value) {
  const el = $(id);
  if (document.activeElement === el) return;                 // never overwrite what the user is typing
  if (el.type === 'checkbox') el.checked = Boolean(value);
  else el.value = value ?? '';
}

function fill(s) {
  setValue('enabled', s.enabled);
  setValue('debug', s.debug);
  setValue('intervalMode', s.intervalMode);
  setValue('minIntervalMin', s.minIntervalMin);
  setValue('maxIntervalMin', s.maxIntervalMin);
  setValue('freshWindowMin', s.freshWindowMin);
  setValue('autoWidenFreshWindow', s.autoWidenFreshWindow);
  setValue('topN', s.topN);
  setValue('settleSec', s.settleSec);
  setValue('useOwnTab', s.useOwnTab);
  setValue('pauseWhenLocked', s.pauseWhenLocked);
  setValue('maxReloadsPerHour', s.maxReloadsPerHour);
  setValue('maxNotificationsPerCycle', s.maxNotificationsPerCycle);
  setValue('requireInteraction', s.requireInteraction);
  setValue('sound-enabled', s.sound.enabled);
  setValue('sound-file', s.sound.file);
  setValue('sound-volume', s.sound.volume);
  setValue('highValueBudget', s.sound.highValueBudget);
  setValue('minBudget', s.filters.minBudget);
  setValue('maxProposals', s.filters.maxProposals);
  setValue('remoteOnly', s.filters.remoteOnly);
  setValue('prefundedOnly', s.filters.prefundedOnly);
  tags.keywordsInclude = [...s.filters.keywordsInclude];
  tags.keywordsExclude = [...s.filters.keywordsExclude];
  renderTags();
}

// ---------------------------------------------------------------- readouts

function renderReadouts() {
  const { settings: s, stats } = status;
  const preset = presetOf(s);
  for (const button of document.querySelectorAll('#presets [data-preset]')) {
    const selected = showCustom ? button.dataset.preset === 'custom' : button.dataset.preset === preset;
    button.setAttribute('aria-checked', String(selected));
  }
  $('custom-interval').hidden = !(showCustom || preset === 'custom');
  $('max-wrap').hidden = s.intervalMode !== 'random';
  $('min-label').textContent = s.intervalMode === 'random' ? 'Between' : 'Every';

  $('interval-text').textContent = `Checks ${describeInterval(s)}, about ${status.loadsPerHour} page loads an hour.`;
  $('interval-warning').hidden = s.minIntervalMin >= 3;
  $('interval-warning').textContent = `Checking this often loads the page about ${status.loadsPerHour} times an hour. PeoplePerHour may treat that as unusual.`;

  const widened = status.effectiveFreshMin > s.freshWindowMin;
  $('fresh-text').textContent = `New jobs up to ${status.effectiveFreshMin} minutes old will alert` +
    (widened ? `, widened from ${s.freshWindowMin} to cover the time between checks.` : '.');

  $('own-tab-warning').hidden = s.useOwnTab;
  const loads = reloadsThisHour(stats, Date.now());
  $('safety-text').textContent = `Effective limit: ${status.reloadCap} loads an hour (never lower than your interval needs). This hour so far: ${loads}.`;

  const active = [s.filters.keywordsInclude.length, s.filters.keywordsExclude.length, s.filters.minBudget > 0,
    s.filters.maxProposals !== null, s.filters.remoteOnly, s.filters.prefundedOnly].filter(Boolean).length;
  $('filters-summary').textContent = active ? `${active} active` : 'none';

  for (const [id, format] of Object.entries(RANGE_FORMAT)) {
    const input = $(id);
    const text = format(Number(input.value));
    $(`${id}-out`).textContent = text;
    input.setAttribute('aria-valuetext', text);
  }
}

async function renderLog() {
  const { log = [] } = await store.getLocal(['log']);
  const { stats } = status;
  const view = viewFor(stats.status);
  const last = Number.isFinite(stats.lastRunMs) ? new Date(stats.lastRunMs).toLocaleTimeString() : 'never';
  $('log-summary').textContent = `Status: ${view.label}. Last check: ${last}. Alerts so far: ${stats.totalAlerts ?? 0}.`;

  const rows = log.map(entry => {
    const tone = entry.status === STATUS.OK ? 'ok' : viewFor(entry.status).tone;
    const details = [entry.note, ...(entry.failures ?? [])].filter(Boolean).join(' · ');
    return h('tr', {},
      h('td', { text: new Date(entry.ts).toLocaleString() }),
      h('td', {}, h('span', { class: `pill tone-${tone}`, text: entry.status === STATUS.OK ? 'Checked' : viewFor(entry.status).label })),
      h('td', { text: entry.source ?? '' }),
      h('td', { text: details }));
  });
  $('log-body').replaceChildren(...(rows.length ? rows : [h('tr', { class: 'empty-row' }, h('td', { colspan: 4, text: 'No checks yet.' }))]));
}

// ---------------------------------------------------------------- tags

function renderTags() {
  for (const box of document.querySelectorAll('.tags')) {
    const field = box.dataset.field;
    box.querySelector('.tags__list').replaceChildren(...tags[field].map((word, index) => h('li', { class: 'tag' },
      h('span', { text: word }),
      h('button', { type: 'button', 'aria-label': `Remove ${word}`, text: '×', onClick: () => {
        tags[field].splice(index, 1);
        renderTags();
        save();
      } }))));
  }
}

function wireTagInput(box) {
  const field = box.dataset.field;
  const input = box.querySelector('.tags__input');
  const commit = () => {
    const words = input.value.split(',').map(w => w.trim()).filter(Boolean);
    const known = new Set(tags[field].map(w => w.toLowerCase()));
    for (const word of words) if (!known.has(word.toLowerCase())) { tags[field].push(word); known.add(word.toLowerCase()); }
    input.value = '';
    if (words.length) { renderTags(); save(); }
  };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); commit(); }
    if (event.key === 'Backspace' && input.value === '' && tags[field].length) { tags[field].pop(); renderTags(); save(); }
  });
  input.addEventListener('blur', commit);
}

// ---------------------------------------------------------------- saving

function numberOrUndefined(id) {
  const raw = $(id).value.trim();
  return raw === '' ? undefined : Number(raw);
}

function collect() {
  const maxProposals = $('maxProposals').value.trim();
  return {
    enabled: $('enabled').checked,
    debug: $('debug').checked,
    intervalMode: $('intervalMode').value,
    minIntervalMin: numberOrUndefined('minIntervalMin'),
    maxIntervalMin: numberOrUndefined('maxIntervalMin'),
    freshWindowMin: numberOrUndefined('freshWindowMin'),
    autoWidenFreshWindow: $('autoWidenFreshWindow').checked,
    topN: numberOrUndefined('topN'),
    settleSec: numberOrUndefined('settleSec'),
    useOwnTab: $('useOwnTab').checked,
    pauseWhenLocked: $('pauseWhenLocked').checked,
    maxReloadsPerHour: numberOrUndefined('maxReloadsPerHour'),
    maxNotificationsPerCycle: numberOrUndefined('maxNotificationsPerCycle'),
    requireInteraction: $('requireInteraction').checked,
    sound: {
      enabled: $('sound-enabled').checked,
      file: $('sound-file').value,
      volume: numberOrUndefined('sound-volume'),
      highValueBudget: numberOrUndefined('highValueBudget') ?? 0
    },
    filters: {
      keywordsInclude: [...tags.keywordsInclude],
      keywordsExclude: [...tags.keywordsExclude],
      minBudget: numberOrUndefined('minBudget') ?? 0,
      maxProposals: maxProposals === '' ? null : Number(maxProposals),
      remoteOnly: $('remoteOnly').checked,
      prefundedOnly: $('prefundedOnly').checked
    }
  };
}

const persist = debounce(async () => {
  const reply = await ask(MSG.SAVE_SETTINGS, { patch: collect() });
  if (!reply?.ok) return;
  flashSaved();
  await load({ refill: false });
  fill(reply.settings);                                        // show clamped values, except the focused field
}, 400);

function save() {
  if (status) {                                                // instant readouts while the save is pending
    status = { ...status, settings: { ...status.settings, ...collect(), sound: { ...status.settings.sound, ...collect().sound } } };
    renderReadouts();
  }
  persist();
}

let savedTimer = null;
function flashSaved() {
  $('saved').classList.add('is-visible');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('saved').classList.remove('is-visible'), 1500);
}

// ---------------------------------------------------------------- actions

async function choosePreset(preset) {
  if (preset === 'custom') {
    showCustom = true;
    renderReadouts();
    $('minIntervalMin').focus();
    return;
  }
  showCustom = false;
  const reply = await ask(MSG.APPLY_PRESET, { preset });
  if (reply?.ok) { flashSaved(); await load(); }
}

async function testSound() {
  $('test-result').textContent = 'Playing…';
  const reply = await ask(MSG.TEST_SOUND, { file: $('sound-file').value, volume: Number($('sound-volume').value) }, 8000);
  $('test-result').textContent = reply?.ok
    ? 'Sound played. If you heard nothing, check your system volume.'
    : `Sound did not play (${reply?.error ?? 'no reply'}). Press Test sound again.`;
}

async function testNotification() {
  const reply = await ask(MSG.TEST_NOTIFICATION);
  $('test-result').textContent = reply?.ok
    ? 'Notification sent. If none appeared, allow notifications for Chrome in your system settings.'
    : 'Notification could not be shown. Check that Chrome notifications are allowed.';
}

async function copyLog() {
  const { log = [] } = await store.getLocal(['log']);
  try {
    await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
    $('log-summary').textContent = `Copied ${log.length} log entries.`;
  } catch {
    $('log-summary').textContent = 'Could not copy. Try again.';
  }
}

async function confirmAndSend(question, type) {
  if (!window.confirm(question)) return;
  await ask(type);
  flashSaved();
  await load();
}

// ---------------------------------------------------------------- start

for (const el of document.querySelectorAll('main input:not(.tags__input), main select')) {
  el.addEventListener(el.type === 'number' ? 'change' : 'input', save);
  if (el.type === 'number') el.addEventListener('input', () => { if ($(el.id).value !== '') save(); });
}
for (const button of document.querySelectorAll('#presets [data-preset]')) {
  button.addEventListener('click', () => choosePreset(button.dataset.preset));
}
document.querySelectorAll('.tags').forEach(wireTagInput);

$('open-tab').addEventListener('click', () => ask(MSG.OPEN_MONITOR_TAB, {}, 10_000));
$('test-sound').addEventListener('click', testSound);
$('test-notification').addEventListener('click', testNotification);
$('copy-log').addEventListener('click', copyLog);
$('clear-log').addEventListener('click', () => confirmAndSend('Clear the activity log?', MSG.CLEAR_LOG));
$('clear-seen').addEventListener('click', () => confirmAndSend('Clear alert history? Recent jobs may alert once more.', MSG.CLEAR_SEEN));
$('reset').addEventListener('click', () => confirmAndSend('Reset every setting to its default?', MSG.RESET_SETTINGS));

const refreshFromStorage = debounce(changes => load({ refill: Boolean(changes.settings) }), 300);
on.storageChanged((changes, area) => {
  if (area === 'local' && (changes.settings || changes.stats || changes.log)) refreshFromStorage(changes);
});

if (location.hash === '#filters') $('filters-card').open = true;
load();
