// chrome.idle wrapper. Never throws. Defaults to 'active' so a failure never pauses monitoring.

/** @returns {Promise<'active' | 'idle' | 'locked'>} */
export async function queryState(detectionIntervalSec = 60) {
  try {
    return (await chrome.idle.queryState(detectionIntervalSec)) ?? 'active';
  } catch {
    return 'active';
  }
}
