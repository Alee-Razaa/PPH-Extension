# PPH Job Radar

A Chrome extension that watches the PeoplePerHour jobs page and alerts you with a **desktop notification and a sound** the moment a new job is posted, so you can be one of the first to apply.

- **You choose how often it checks:** every 3 minutes, every 10 minutes, randomly every 5 to 10 minutes (default), or any custom time from 2 to 60 minutes. Changes apply instantly.
- **Never alerts the same job twice.**
- **Filters:** keywords to require or block, minimum budget, maximum proposals, remote only, pre-funded only.
- **Private:** it only reads the public jobs page. It never applies, never signs in, never touches your account, and sends nothing anywhere.

Version 1.0.0 · Owner: XEMTECH · Repository: [Alee-Razaa/PPH-Extension](https://github.com/Alee-Razaa/PPH-Extension) (private)

---

## Install (2 minutes)

1. Unzip `pph-job-radar-1.0.0.zip` into a folder you will keep, for example `C:\PPH Job Radar`.
   (Or use the `src` folder of this repository directly.)
2. Open Chrome and go to `chrome://extensions`
3. Turn on **Developer mode** (switch in the top right corner)
4. Click **Load unpacked** and choose the folder from step 1 (the one that contains `manifest.json`)
5. Click the puzzle-piece icon in the Chrome toolbar and **pin PPH Job Radar**

Within about 30 seconds a small **pinned PeoplePerHour tab** opens on the left of your tab bar. That tab is the extension's own. Leave it open; it reloads itself on your schedule.

**First-time setup (recommended):** right-click the PPH Job Radar icon → **Options** → press **Test sound** and **Test notification**. If no notification appears, allow notifications for Google Chrome in Windows Settings → System → Notifications.

Do not move or delete the folder after installing. Chrome loads the extension from it.

## Everyday use

Click the PPH Job Radar icon in the toolbar:

| You see | Meaning |
|---|---|
| **Watching** · next check in 4:12 | Working normally |
| Job cards with a green **NEW** tag | Jobs posted recently. Click a card to open the job |
| **Check every: 3 min / 5–10 min / 10 min / …** | Change how often it checks. Takes effect immediately |
| **Check now** | Check right away |
| **Pause / Resume** | Stop or restart checking |
| ⚙ | All settings |

When a new job appears you get a notification with the title, budget, number of proposals and how long ago it was posted. Click it to open the job.

Toolbar badge: a **number** = new jobs since you last opened the popup · **···** = checking now · **II** = paused · **off** = no internet · **!** (red) = PeoplePerHour wants a human check (open the pinned tab, clear it, then press **I cleared it, resume** in the popup).

## Updating

1. Replace the folder contents with the new version (or `git pull`)
2. `chrome://extensions` → click the round **reload** arrow on PPH Job Radar

Your settings and alert history are kept.

---

## For developers

Requires Node 22+. There are no dependencies to install.

| Command | What it does |
|---|---|
| `npm test` | All unit and worker-integration tests (fake Chrome) |
| `npm run coverage` | Enforces 100% coverage on `src/core/` |
| `npm run e2e` | Loads the extension into a throwaway real Chrome profile and tests it against the live site (about 2 minutes, ~4 page loads) |
| `npm run build` | Runs the tests and writes `dist/pph-job-radar-<version>.zip` |
| `npm run icons` / `npm run sounds` | Regenerate icons and alert sounds |

- `docs/SPEC.md` is the build contract, `CLAUDE.md` holds the hard rules, `docs/TESTLOG.md` records every verification.
- `src/` is the extension. `tests/` and `tools/` never ship.
- `node tools/screenshots.mjs <dir>` captures the popup and options page (light and dark) from a real Chrome.

### Publishing

This build is designed to be loaded unpacked. The zip is also valid for the Chrome Web Store, but publishing is a separate decision: it needs a store listing, a privacy statement (the privacy text above covers it), and a check of PeoplePerHour's terms, since the extension reloads their jobs page automatically.

## Privacy

The extension reads `https://www.peopleperhour.com/freelance-jobs` in a tab you can see, stores its settings, the ids of jobs it has seen (for 6 hours) and a short activity log in Chrome's local extension storage, and shows notifications. It has no telemetry, no server, and makes no network requests of its own.
