// chrome.tabs wrappers. Never throw. Works without the "tabs" permission: host permissions expose
// tab.url for PeoplePerHour pages, which is all we need (SPEC 6).
import { ok, err } from '../core/result.js';
import { isBaseJobsUrl } from '../core/validate.js';

/** @returns {Promise<chrome.tabs.Tab | null>} */
export async function get(tabId) {
  if (typeof tabId !== 'number') return null;
  try {
    return (await chrome.tabs.get(tabId)) ?? null;
  } catch {
    return null;
  }
}

/** Open the monitor tab pinned in the background. @returns {Promise<number | null>} tab id */
export async function createPinned(url, { active = false } = {}) {
  try {
    const tab = await chrome.tabs.create({ url, pinned: true, active });
    return typeof tab?.id === 'number' ? tab.id : null;
  } catch (e) {
    console.error('[PPH Job Radar] could not open monitor tab', e);
    return null;
  }
}

/** First open tab already showing the jobs list (for the "use my own tab" option). */
export async function findJobsTab(matchPattern) {
  try {
    const found = await chrome.tabs.query({ url: matchPattern });
    return found.find(t => isBaseJobsUrl(t.url)) ?? found[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Reload the tab if it already shows the first jobs page, otherwise navigate it back there.
 * @returns {Promise<import('../core/constants.js').Result>}
 */
export async function reloadTo(tabId, url) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isBaseJobsUrl(tab?.url)) {
      await chrome.tabs.reload(tabId, { bypassCache: true });
      return ok('reloaded');
    }
    await chrome.tabs.update(tabId, { url });
    return ok('navigated');
  } catch (e) {
    return err(e?.message ?? e);
  }
}

/** Open a URL in a new foreground tab. Callers validate the URL first. */
export async function openUrl(url) {
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    return typeof tab?.id === 'number' ? tab.id : null;
  } catch {
    return null;
  }
}

export async function focus(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (typeof tab?.windowId === 'number') await chrome.windows?.update?.(tab.windowId, { focused: true });
    return true;
  } catch {
    return false;
  }
}

/** Message a content script. Resolves null on no listener, error, or timeout. */
export async function sendWithTimeout(tabId, msg, ms = 3000) {
  let timer;
  try {
    const reply = await Promise.race([
      chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => null),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })
    ]);
    return reply ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
