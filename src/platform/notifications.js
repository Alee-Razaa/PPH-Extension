// chrome.notifications wrappers. Never throw. SPEC 15.1.

export async function show(id, { title, message, contextMessage = '', requireInteraction = false }) {
  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/notif-128.png'),
      title: String(title),
      message: String(message),
      contextMessage: String(contextMessage),
      priority: 2,
      requireInteraction: Boolean(requireInteraction),
      silent: true                                   // our own sound plays instead
    });
    return true;
  } catch (e) {
    console.error('[PPH Job Radar] notification failed', e);
    return false;
  }
}

export async function clear(id) {
  try {
    return (await chrome.notifications.clear(id)) === true;
  } catch {
    return false;
  }
}
