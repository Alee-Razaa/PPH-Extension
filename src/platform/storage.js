// chrome.storage wrappers. Never throw: reads return {} and writes return false on failure. SPEC 9.

async function get(area, keys) {
  try {
    return (await chrome.storage[area].get(keys)) ?? {};
  } catch (e) {
    console.error('[PPH Job Radar] storage get failed', area, e);
    return {};
  }
}

async function set(area, items) {
  try {
    await chrome.storage[area].set(items);
    return true;
  } catch (e) {
    console.error('[PPH Job Radar] storage set failed', area, e);
    return false;
  }
}

async function remove(area, keys) {
  try {
    await chrome.storage[area].remove(keys);
    return true;
  } catch (e) {
    console.error('[PPH Job Radar] storage remove failed', area, e);
    return false;
  }
}

export const getLocal = keys => get('local', keys);
export const setLocal = items => set('local', items);
export const removeLocal = keys => remove('local', keys);

export const getSession = keys => get('session', keys);
export const setSession = items => set('session', items);
export const removeSession = keys => remove('session', keys);
