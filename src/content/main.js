// Content entry module. Phase 0: proves the dynamic import works and the page guard is right.
// Phase 1 replaces the body with the settle, readiness and parse flow (SPEC 25.7).

const BASE_PATH = '/freelance-jobs';

export async function start() {
  if (location.pathname !== BASE_PATH) return;   // job detail pages and other paths: do nothing (R13)
  console.info('[PPH Job Radar] loaded');
}
