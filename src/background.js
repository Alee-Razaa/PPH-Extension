// Service worker (type: module). Phase 0 stub: proves the module worker loads and listeners register.
// Wiring only. Decisions will live in core/, chrome.* calls in platform/ (SPEC 26).
import * as on from './platform/events.js';

// ---- listeners registered SYNCHRONOUSLY at top level (SPEC 20) ----
on.installed(({ reason, previousVersion }) => {
  console.info('[PPH Job Radar] installed', { reason, previousVersion });
});
on.startup(() => {
  console.info('[PPH Job Radar] browser startup');
});
