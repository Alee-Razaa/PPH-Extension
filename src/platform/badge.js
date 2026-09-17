// Toolbar badge. Mapping lives in core/cycle.js badgeFor. Never throws.
import { badgeFor } from '../core/cycle.js';

export async function paint(status, unreadAlerts = 0) {
  const { text, color } = badgeFor(status, unreadAlerts);
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    return true;
  } catch {
    return false;
  }
}
