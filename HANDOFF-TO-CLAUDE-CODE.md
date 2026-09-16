# Handoff: PPH Job Radar in Claude Code

**What this is:** everything needed to build the PeoplePerHour job alert extension on this machine, in Claude Code, from a clean start.

**Revision 2 (2026-09-17).** Reviewed and replanned. SPEC.md is now revision 2. Its change table (top of SPEC) lists 17 problems found in revision 1 and how each is fixed. The code in SPEC Appendix A and the three-timezone test were run on this machine (Node 24, Windows) and pass.

**Owner:** XEMTECH

---

## 1. What the extension does

- Keeps a pinned PeoplePerHour jobs tab.
- Reloads it on **your** interval: every 3 min, every 10 min, randomly 5 to 10 min, or any custom value from 2 to 60 min. Change it any time from the popup, and it applies immediately.
- Waits for the page to settle, reads the newest jobs.
- If a job is new and recent: desktop notification + sound. Never the same job twice.
- Installed locally with **Load unpacked**. Never uploaded to the Chrome Web Store.

---

## 2. Files in place

```
E:\PPH-Extention\
├── CLAUDE.md                     rulebook Claude Code reads every turn (rev 2)
├── HANDOFF-TO-CLAUDE-CODE.md     this file
└── docs\
    ├── SPEC.md                   build contract, revision 2
    └── RESEARCH.md               original live site study, reference only
```

---

## 3. One time setup (already checked on this machine)

| Tool | Status |
|---|---|
| git | 2.52 installed |
| gh | 2.86, logged in as `Alee-Razaa`, `repo` scope |
| node | 24.11, `node --test` works |

Repo setup (PowerShell, from `E:\PPH-Extention`):

```powershell
git init -b main
git add -A
git commit -m "docs: spec rev 2, CLAUDE.md, handoff"
gh repo create PPH-Extension --private --source=. --remote=origin --push
```

Then start Claude Code in this folder (or keep using the desktop app pointed at it).

---

## 4. Kickoff prompt

Paste this as the first message. It builds **Phase 0 only** and stops, so you can confirm the extension loads before any parser work.

```
Read CLAUDE.md and docs/SPEC.md fully before writing anything. SPEC is revision 2.
Pay special attention to: the rev 2 change table, 4.4 timing model, 5 structure,
6 manifest, 22.1 tests, 23 phases, 25 Appendix A.

Build Phase 0 only (SPEC 23), on branch phase-0-scaffold:
- package.json, .gitignore, .editorconfig, .gitattributes, README.md exactly per SPEC 5 and 23
- src/manifest.json exactly per SPEC 6
- tools/make-icons.mjs (Node built-ins only), run it, commit src/icons/*.png
- src/platform/events.js and a stub src/background.js that logs on install through it
- stub src/ui/popup.html and src/ui/options.html so every manifest path exists
- src/content/content.js bootstrap per SPEC 25.6
- src/content/main.js that only logs "[PPH Job Radar] loaded" when
  location.pathname === '/freelance-jobs'
- tests/purity.test.js (U10) per SPEC 22.1
- docs/TESTLOG.md with a header row

Then:
1. Run npm test and show the output.
2. Tell me the exact steps to Load unpacked from E:\PPH-Extention\src and what I
   should see on the extension card and in the page console.
3. Stop. Do not start Phase 1 until I confirm the Phase 0 acceptance criteria.
```

**Prompt for Phase 1** (after Phase 0 is accepted):

```
Phase 0 accepted. Merge it per CLAUDE.md, then build Phase 1 (SPEC 23) on phase-1-parser.
Tests first. core/constants.js, result.js, time.js, validate.js, parser.js per SPEC 25,
content/dom.js and content/main.js in debug mode per SPEC 8.1 and 25.7,
tools/capture-fixture.js per SPEC 22.1, tests U1 to U6.
U1 must be exactly the shape in SPEC 22.1 including the control assertion.
When tools/capture-fixture.js exists, stop and ask me to capture the real fixture.
Do not invent it. Finish with npm test, npm run coverage, and the 10-reload live check
instructions. Stop at the end of the phase.
```

Later phases: "Phase N-1 accepted. Merge it, then build Phase N per SPEC 23. Stop at the end."

---

## 5. Architecture decisions already made

Do not relitigate these. They are settled and the spec assumes them.

| Decision | Reason |
|---|---|
| No bundler, no TypeScript | Small personal tool. A build step doubles the friction |
| Zero dependencies, dev included | Nothing to audit, nothing to update, no supply chain surface |
| `core/` pure, `platform/` wraps chrome | Almost all logic unit tested with plain Node |
| Time and randomness injected into `core/` | Deterministic tests for scheduling and age maths |
| Parser split into pure functions + one DOM reader | Pure parts test without jsdom |
| Classic `content.js` + dynamic `import()` | Manifest content scripts cannot be ES modules |
| Settle wait in the content script | The service worker dies after 30 s idle. SPEC 4.2 |
| `HELLO` handshake, lock matched by tab id | A reloaded page cannot know a cycle id. Other tabs stay untouched |
| Unanswered `PING` does not block the reload | Tabs opened before the extension loaded have no content script |
| Watchdog alarm at 90 s | Recovers a cycle where the page never reports back |
| Interval is a setting with presets, re-armed live | You want 3 min sometimes and 10 min other times |
| Fresh window auto widens to interval + 2 min | Otherwise jobs posted right after a check are missed |
| Hourly cap derived from the interval | The safety cap must never block the interval you chose |
| Dedicated pinned monitor tab by default | Reloading your own tab destroys your work |
| Result type instead of throwing | Exceptions in MV3 event handlers are silently swallowed |
| WAV sounds and PNG icons generated by Node scripts | No dependencies, no downloads, committed output |
| Load unpacked only | Personal tool. No Web Store, no `.crx` |

---

## 6. Build order

SPEC 23 has the full acceptance criteria. One branch per phase, stop after each.

```
Phase 0  scaffold               manifest, bootstrap import proven, icons, purity test
Phase 1  parser                 core time/validate/parser, live 10-reload cross check
Phase 2  scheduler + timing     alarms, lock, watchdog, HELLO/JOBS, live interval re-arm
Phase 3  alerting               notifications, one sound per cycle, dedupe, filters
Phase 4  popup                  status, countdown, job cards, interval presets
Phase 5  options                all settings, timing readouts, test buttons, log
Phase 6  hardening              backoff, blocked detection, cap, migration, overflow
```

---

## 7. Security rules most likely to slip

- Site data is untrusted. Clamp numbers, cap strings, `textContent` only.
- URLs pass `isPphUrl` (parsed, https, exact host) before storing or opening.
- The worker re-validates every `JOBS` message and accepts it only from the locked monitor tab.
- Sound files only from the allow list.
- `host_permissions` only `https://www.peopleperhour.com/*`. Never `<all_urls>`.
- CSP stays `script-src 'self'; object-src 'self'`.
- `.env*`, `*.pem`, `*.crx` gitignored. Repo private.
- `tests/purity.test.js` enforces most of this. Never weaken it to make something pass.

---

## 8. Sanity checks

**After Phase 0**
1. `npm test` green.
2. `chrome://extensions` -> Developer mode -> Load unpacked -> `E:\PPH-Extention\src`. Zero errors on the card.
3. Open `https://www.peopleperhour.com/freelance-jobs` -> F12 -> Console -> context dropdown -> **PPH Job Radar** -> `[PPH Job Radar] loaded`.
4. Open any job detail page: nothing logged.

**After Phase 1 (the one that matters most)**
1. `npm test` and `npm run coverage` green. The timezone test has its control assertion.
2. Reload the jobs page 10 times. Each time the console table shows the top 5 with `age`, `pageText` and `match`.
3. Every row must show `match: true`. The tolerance is ±1 minute, because the page rounds its "N minutes ago" text.
4. If any row is `false`, stop. It is a time handling bug. Fix it before anything else.

**After Phase 2 (timing)**
There is no popup yet, so switch presets from the options stub page console: `chrome.runtime.sendMessage({ type: 'APPLY_PRESET', preset: 'every3' })`. Watch `stats.nextRunMs` in the service worker console.
1. Switch to `every3`: the next check moves up at once.
2. Switch to `every10`: the next check moves out.
3. Your own PeoplePerHour tabs are never reloaded.

---

XEMTECH Team
