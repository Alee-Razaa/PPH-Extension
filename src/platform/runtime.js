// chrome.runtime wrappers. Never throw. SPEC 10.

/**
 * Send a message to the service worker. Resolves to the reply, or null on no listener,
 * invalidated extension context, rejection, or timeout.
 */
export async function sendToWorker(msg, timeoutMs = 3000) {
  let timer;
  try {
    const reply = await Promise.race([
      chrome.runtime.sendMessage(msg).catch(() => null),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })
    ]);
    return reply ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Answer one message type (from the worker to this context). Returns an unsubscribe function.
 * The handler's resolved value is the reply. A throw or rejection replies null.
 */
export function onWorkerMessage(type, handler) {
  const listener = (msg, _sender, sendResponse) => {
    if (msg?.type !== type) return false;
    Promise.resolve()
      .then(() => handler(msg))
      .then(sendResponse, () => sendResponse(null));
    return true;
  };
  try {
    chrome.runtime.onMessage.addListener(listener);
  } catch {
    return () => {};
  }
  return () => {
    try { chrome.runtime.onMessage.removeListener(listener); } catch { /* context already gone */ }
  };
}

export function getURL(path) {
  try {
    return chrome.runtime.getURL(path);
  } catch {
    return null;
  }
}
