# Test log

Manual and integration results per phase (SPEC 23 step 5). Newest first.

| Date | Phase | Test | Chrome version | Result | Notes |
|---|---|---|---|---|---|
| 2026-09-17 | 1 | 10 live reloads, ages vs page text | built-in browser | pass | 10 reloads ~21 s apart, 09:13 to 09:17 UTC. Snapshots (serverTime, posted_dt, card text) run through `src/core/time.js`: 50/50 match. Parsed ages round to exactly the page's minutes |
| 2026-09-17 | 1 | Live finding: list order | built-in browser | noted | Order is newest listing (id desc), not strictly `posted_dt`. SPEC 3.3 corrected, U4 updated, risk "Job listed late" added for Phase 3 |
| 2026-09-17 | 1 | Live finding: `location_type` | built-in browser | fixed | `remote_country` seen live. Now counts as remote. U6 + U4 real test cover it |
| 2026-09-17 | 1 | Real fixture captured | built-in browser | pass | `tests/fixtures/pph-sample.json`, 10 jobs, captured 09:11:09 UTC, SHA-256 verified against the browser copy |
| 2026-09-17 | 1 | `npm test` + `npm run coverage` | n/a | pass | 52 pass, 0 skipped. `src/core` 100% lines, branches, functions |
| 2026-09-17 | 0 | Job detail page logs nothing | 153.0.8010.47 | pass | Pathname guard works. Confirmed by owner |
| 2026-09-17 | 0 | Jobs page console shows `[PPH Job Radar] loaded` | 153.0.8010.47 | pass | Dynamic import works with `use_dynamic_url: true`. Confirmed by owner |
| 2026-09-17 | 0 | Load unpacked from `src/`, zero errors on card | 153.0.8010.47 | pass | Confirmed by owner |
| 2026-09-17 | 0 | `npm test` (U10 purity + manifest) | n/a | pass | 9/9. Deliberate violations verified to fail |

Note: the Phase 1 live check ran the project's core code on live page data captured in Claude's built-in browser, not inside the installed extension. The extension's own console table (`ALL MATCH`) in Chrome was not observed. It uses the same modules, and Phase 0 proved the module import path works.
