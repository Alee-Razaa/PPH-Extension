# PPH Job Radar

A personal Chrome extension that watches the PeoplePerHour jobs page and alerts you with a desktop notification and a sound when a new job is posted.

- You choose how often it checks: every 3 min, every 10 min, a random 5 to 10 min range, or custom.
- It only reads the public jobs page. It never applies, never signs in, and never touches your account.
- Nothing leaves your machine. No servers, no analytics, no network calls of its own.
- Installed locally with **Load unpacked**. It is not on the Chrome Web Store.

> **Status:** Phase 0 (scaffold) accepted on Chrome 153. Checking and alerts arrive in Phases 1 to 3. See `docs/SPEC.md` section 23.

Repository: [Alee-Razaa/PPH-Extension](https://github.com/Alee-Razaa/PPH-Extension) (private). Owner: XEMTECH.

## Install (local, unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose the **`src`** folder: `E:\PPH-Extention\src`
   (not the repo root)
4. Pin the PPH Job Radar icon to the toolbar

Keep the folder where it is. Moving or deleting it breaks the extension.
Do not pack a `.crx`. Chrome blocks side-loaded `.crx` files. Load unpacked is the supported path.

## Check the Phase 0 build

1. The PPH Job Radar card on `chrome://extensions` shows no **Errors** button.
2. Open `https://www.peopleperhour.com/freelance-jobs`, press F12, open **Console**, and in the context dropdown (top left, usually "top") choose **PPH Job Radar**. You should see `[PPH Job Radar] loaded`.
3. Open any job detail page. Nothing is logged there.

If step 2 shows `Failed to fetch dynamically imported module`, set `"use_dynamic_url": false` in `src/manifest.json`, reload the extension and the page, and note your Chrome version in `docs/SPEC.md` section 6.

## Update after changes

1. Pull or merge the new code into `E:\PPH-Extention`
2. `chrome://extensions` -> click the **reload** arrow on the PPH Job Radar card
3. Reload any open PeoplePerHour jobs tab

Settings and alert history live in Chrome's extension storage and survive reloads.

## Development

Requires Node 22 or newer. There are no dependencies to install.

| Command | What it does |
|---|---|
| `npm test` | Runs all unit tests, including the purity and manifest checks |
| `npm run coverage` | Enforces 100% line coverage on `src/core/` (from Phase 1) |
| `npm run icons` | Regenerates `src/icons/*.png` |
| `npm run sounds` | Regenerates `src/sounds/*.wav` (from Phase 3) |

- `docs/SPEC.md` is the build contract. `CLAUDE.md` holds the hard rules.
- `src/` is the extension. `tests/` and `tools/` never ship.
- Manual test results go in `docs/TESTLOG.md`.

## Privacy

The extension reads `https://www.peopleperhour.com/freelance-jobs` in a tab you can see, stores settings and seen job ids in local extension storage, and shows notifications. It has no telemetry and makes no requests of its own.

XEMTECH
