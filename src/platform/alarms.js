// chrome.alarms wrappers. Never throw. Callers keep delays at or above 30 s (SPEC 2, 11.5).

export async function createAt(name, whenMs) {
  try {
    await chrome.alarms.create(name, { when: whenMs });
    return true;
  } catch (e) {
    console.error('[PPH Job Radar] alarm create failed', name, e);
    return false;
  }
}

export async function createIn(name, delayInMinutes) {
  try {
    await chrome.alarms.create(name, { delayInMinutes });
    return true;
  } catch (e) {
    console.error('[PPH Job Radar] alarm create failed', name, e);
    return false;
  }
}

export async function clear(name) {
  try {
    return (await chrome.alarms.clear(name)) === true;
  } catch {
    return false;
  }
}

/** @returns {Promise<chrome.alarms.Alarm | null>} */
export async function get(name) {
  try {
    return (await chrome.alarms.get(name)) ?? null;
  } catch {
    return null;
  }
}
