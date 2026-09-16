# Test log

Manual and integration results per phase (SPEC 23 step 5). Newest first.

| Date | Phase | Test | Chrome version | Result | Notes |
|---|---|---|---|---|---|
| 2026-09-17 | 0 | Job detail page logs nothing | 153.0.8010.47 | pass | Pathname guard works. Confirmed by owner |
| 2026-09-17 | 0 | Jobs page console shows `[PPH Job Radar] loaded` | 153.0.8010.47 | pass | Dynamic import works with `use_dynamic_url: true`. Confirmed by owner |
| 2026-09-17 | 0 | Load unpacked from `src/`, zero errors on card | 153.0.8010.47 | pass | Confirmed by owner |
| 2026-09-17 | 0 | `npm test` (U10 purity + manifest) | n/a | pass | 9/9. Deliberate violations verified to fail |
