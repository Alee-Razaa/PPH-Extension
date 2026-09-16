// Event registration wrappers. Call these synchronously at the top level of background.js (SPEC 20).
// Handlers may be sync or async. A throwing or rejecting handler is logged, never propagated.

const TAG = '[PPH Job Radar]';

function report(where, error) {
  console.error(TAG, `handler failed: ${where}`, error);
}

function safe(where, handler) {
  return (...args) => {
    try {
      const out = handler(...args);
      if (out && typeof out.then === 'function') out.then(undefined, e => report(where, e));
    } catch (e) {
      report(where, e);
    }
  };
}

export const installed = handler => chrome.runtime.onInstalled.addListener(safe('onInstalled', handler));
export const startup = handler => chrome.runtime.onStartup.addListener(safe('onStartup', handler));
export const alarm = handler => chrome.alarms.onAlarm.addListener(safe('onAlarm', handler));
export const tabRemoved = handler => chrome.tabs.onRemoved.addListener(safe('tabs.onRemoved', handler));
export const notificationClicked = handler =>
  chrome.notifications.onClicked.addListener(safe('notifications.onClicked', handler));
export const storageChanged = handler => chrome.storage.onChanged.addListener(safe('storage.onChanged', handler));

/**
 * Route runtime messages by `type` to a handler map (SPEC 10).
 * Ignores other extensions and unknown types (returns false so other listeners can answer).
 * A handler's resolved value is the reply. A rejection replies { ok: false }.
 * @param {Record<string, (msg: any, sender: chrome.runtime.MessageSender) => any>} handlers
 */
export function message(handlers) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return false;
    const type = msg?.type;
    if (typeof type !== 'string' || !Object.hasOwn(handlers, type)) return false;
    Promise.resolve()
      .then(() => handlers[type](msg, sender))
      .then(
        reply => sendResponse(reply ?? { ok: true }),
        error => { report(`message ${type}`, error); sendResponse({ ok: false }); }
      );
    return true;
  });
}
