// What to show and play for a cycle's new jobs. SPEC 15. Pure: platform/ does the showing.
import { formatAge } from './time.js';

const SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };

export function truncate(text, max) {
  const s = String(text ?? '').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function formatMoney(job) {
  if (!(job.budget > 0)) return job.projectType === 'hourly' ? 'Hourly' : 'Fixed price';
  const symbol = SYMBOLS[job.currency] ?? (job.currency ? `${job.currency} ` : '');
  const amount = Math.round(job.budget).toLocaleString('en-US');
  return `${symbol}${amount}${job.projectType === 'hourly' ? '/hr' : ' fixed'}`;
}

/** "£88 fixed · 8 proposals · posted 4 min ago" */
export function jobLine(job, nowMs) {
  const proposals = `${job.proposals} proposal${job.proposals === 1 ? '' : 's'}`;
  const age = `posted ${formatAge(Math.max(0, nowMs - job.postedMs))} ago`;
  return [formatMoney(job), proposals, age].join(' · ');
}

export const notificationIdFor = job => `pph-${job.id}`;

/**
 * @returns {{
 *   notifications: { id: string, jobId: string, url: string|null, title: string, message: string, contextMessage: string }[],
 *   summary: { id: string, title: string, message: string, contextMessage: string } | null,
 *   sound: { file: string, volume: number } | null,
 *   highValue: boolean
 * }}
 */
export function planAlerts(fresh, settings, nowMs) {
  const jobs = Array.isArray(fresh) ? fresh : [];
  const shown = jobs.slice(0, settings.maxNotificationsPerCycle);
  const rest = jobs.length - shown.length;

  const notifications = shown.map(job => ({
    id: notificationIdFor(job),
    jobId: job.id,
    url: job.url ?? null,
    title: truncate(job.title || 'New job on PeoplePerHour', 80),
    message: jobLine(job, nowMs),
    contextMessage: job.category ? `${truncate(job.category, 40)} · PeoplePerHour` : 'PeoplePerHour'
  }));

  const summary = rest > 0 ? {
    id: `pph-summary-${nowMs}`,
    title: `${rest} more new job${rest === 1 ? '' : 's'}`,
    message: 'Open PPH Job Radar to see all of them.',
    contextMessage: 'PeoplePerHour'
  } : null;

  const s = settings.sound;
  const highValue = s.highValueBudget > 0 && jobs.some(job => job.budget >= s.highValueBudget);
  const sound = jobs.length > 0 && s.enabled ? { file: highValue ? s.highValueFile : s.file, volume: s.volume } : null;

  return { notifications, summary, sound, highValue };
}

export const SYSTEM_NOTICES = Object.freeze({
  layout: Object.freeze({
    id: 'pph-layout',
    title: 'PPH Job Radar could not read the jobs page',
    message: 'PeoplePerHour may have changed its layout. The extension keeps trying and will recover on its own if it can.',
    contextMessage: 'PPH Job Radar'
  }),
  blocked: Object.freeze({
    id: 'pph-blocked',
    title: 'PeoplePerHour is asking for a check',
    message: 'Checking is paused. Open the pinned PeoplePerHour tab, clear the check, then press Resume in PPH Job Radar.',
    contextMessage: 'PPH Job Radar'
  }),
  test: Object.freeze({
    id: 'pph-test',
    title: 'Notifications are working',
    message: 'New jobs will appear like this, with the budget, proposals and how long ago they were posted.',
    contextMessage: 'PPH Job Radar'
  })
});
