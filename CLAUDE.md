# PPH Job Radar

Chrome MV3 extension. Alerts me (notification + sound) when a new job is posted on PeoplePerHour.
Checks on an interval I choose (every 3 min, every 10 min, a random range, or custom).
Local only. Loaded unpacked from `src/`. Never packed, never published.

## The spec

`docs/SPEC.md` (revision 2) is the contract. Read the relevant section before writing code.
`docs/RESEARCH.md` is the original live site study, kept for reference. Where it disagrees, SPEC wins.
If something in the spec is wrong, stop, say so and propose a change. Do not silently deviate.
The rev 2 change table at the top of SPEC lists bugs already fixed. Do not reintroduce them.

## Layout

```
src/            <- Load unpacked from here. Only this folder ships
  core/         pure domain logic, 100% unit tested
  platform/     thin chrome.* wrappers
  content/      content.js (classic bootstrap), main.js, dom.js
  background.js offscreen/ ui/ sounds/ icons/
tests/          node:test, fixtures/
tools/          make-icons.mjs, make-sounds.mjs, capture-fixture.js (Node built-ins only)
docs/           SPEC.md, RESEARCH.md, TESTLOG.md
```

## Hard rules

1. **No build step.** Plain ES modules, no bundler, no TypeScript, no framework.
   Service worker uses `"type": "module"`. `content/content.js` is a classic script whose
   only job is `import(chrome.runtime.getURL('content/main.js'))`. Every file in that import
   graph must be listed in `web_accessible_resources`. SPEC 6.
2. **Zero dependencies.** Runtime and dev. Tests use Node's built-in `node:test`.
   No jsdom, no vitest, no eslint packages. Tools use Node built-ins only.
3. **`src/core/` is pure.** No `chrome.*`, `document`, `window`, `navigator`, `Date.now()`,
   `Math.random()`, `setTimeout`, or I/O. Time and randomness are passed in as arguments.
   Imports only from `core/`. 100 percent line coverage.
4. **`src/platform/` is the only place `chrome.*` is called.** Thin wrappers that never throw
   and return a Result or null. Sole exception: the one bootstrap line in `content/content.js`.
5. **Never `innerHTML` with site data.** `textContent` only. Site data is untrusted.
6. **Never `setTimeout`/`sleep` longer than 20 s in the service worker.** It dies at 30 s idle.
   The settle wait lives in the content script. No alarm shorter than 30 s. SPEC 4.2.
7. **All listeners registered synchronously at top level** of `background.js`, via `platform/events.js`.
8. **Selectors use prefix matching only** (`[class*="..."]`). Hashes change every deploy.
9. **Parse `posted_dt` as UTC** with `toUtcMs` in `core/time.js`. Never plain `Date.parse`.
   The three-timezone test switches `process.env.TZ` in-process and MUST keep its control
   assertion that the naive parse differs. Never set TZ from the shell or package.json.
10. **No network calls of our own.** No fetch, no CDN, no telemetry. Ever.
11. **Timing is data.** No interval, fresh window, settle time or cap hardcoded outside
    `DEFAULTS`. Every settings write goes through `clampSettings`. Timing changes re-arm the
    alarm live through `storage.onChanged`. Fresh window uses `effectiveFreshMin`. SPEC 4.4.
12. **State parser first, DOM second.** Both produce the same numeric id. Never gate the state
    parser on the card selector. The worker re-validates every `JOBS` message. SPEC 8.

Rules 3, 4, 5, 10 and the manifest checks are enforced by `tests/purity.test.js`. Never weaken it.

## Security

- Site data is untrusted input. Clamp every number, cap every string, `textContent` only.
- URLs pass `isPphUrl` (parsed URL, https, host exactly `www.peopleperhour.com`) before storing or opening.
- Only the locked monitor tab's top frame may report `JOBS`. Everything else is ignored.
- Sound files only from the `SOUND_FILES` allow list.
- `host_permissions` stays scoped to `https://www.peopleperhour.com/*`. Never `<all_urls>`.
  Permissions are exactly: storage, alarms, notifications, offscreen, idle.
- Manifest CSP stays `script-src 'self'; object-src 'self'`.
- No secrets in the repo. `.env*`, `*.pem`, `*.crx` gitignored. The repo stays private.

## Commands

- `npm test` runs all unit tests (`node --test "tests/**/*.test.js"`)
- `npm run coverage` enforces 100% lines on `src/core/**`
- `npm run icons` / `npm run sounds` regenerate assets (commit the output)
- Load unpacked: `chrome://extensions` -> Developer mode -> Load unpacked -> `E:\PPH-Extention\src`
- After changes: reload arrow on the extension card, then reload the monitor tab

Shell is Windows. Use PowerShell or Git Bash syntax, and quote globs.

## Build order

Follow SPEC section 23. One branch per phase (`phase-N-name`). Tests first for `core/`.
Do not move on until the phase acceptance criteria pass and results are in `docs/TESTLOG.md`.
Stop and report at the end of each phase.

```
Phase 0  scaffold                 <- start here
Phase 1  parser + tests + live cross check
Phase 2  scheduler + live timing
Phase 3  alerting (notification + sound)
Phase 4  popup (interval presets)
Phase 5  options
Phase 6  hardening
```

Never invent a "real" fixture. Ask me to run `tools/capture-fixture.js` in DevTools.

## Commit style

Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). One phase per branch,
squash merge to main, tag `v0.N.0` (Phase 0 is `v0.0.1`), keep `manifest.json` and `package.json` versions in step.

XEMTECH
