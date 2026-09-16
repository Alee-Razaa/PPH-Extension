# PeoplePerHour New Job Alert Extension - Site Study + Build Plan

Target page: `https://www.peopleperhour.com/freelance-jobs`
Studied on: 2026-09-16 (live DOM + page state inspected)
Owner: XEMTECH

---

## 1. Goal

A Chrome extension that, while the browser is open:

1. Keeps the PeoplePerHour jobs page loaded.
2. Every 5 to 10 minutes: reloads the page, waits 20 seconds for full load, reads the top 5 jobs.
3. Compares each job's posted time with current time.
4. If a job is younger than 10 minutes and not alerted before, plays a sound and fires a desktop notification saying "Apply now - new job posted".
5. Does nothing when offline or when the page is not responsive.

---

## 2. Site structure findings (verified, not assumed)

### 2.1 Page type
- Server side rendered. No XHR/API call fires on load for the job list.
- Therefore a **full page reload is the only way to get fresh jobs**. This matches the required design.
- Canonical URL: `https://www.peopleperhour.com/freelance-jobs`
- Pagination is plain links: `/freelance-jobs?page=2`, `?page=3` ... up to ~37 pages.
- Total items at time of study: ~721 open jobs.

### 2.2 The gold source: inline page state
The page embeds a large inline `<script>` (approx 195 KB) whose text starts with `window.PPHReact`.
It contains three assignments:

```
window.PPHReact={};
window.PPHReact.initialState={ ...pure JSON... };
window.PPHReact.data={ ...JS object literal, NOT valid JSON... };
window.PPHReact.serverTime='1789584228635';
```

Extraction that works (tested live):

```js
const scriptEl = [...document.querySelectorAll('script')]
  .find(s => !s.src && (s.textContent || '').trim().startsWith('window.PPHReact'));

const raw = scriptEl.textContent;

const stateMatch = raw.match(
  /window\.PPHReact\.initialState\s*=\s*([\s\S]*?);\s*window\.PPHReact\.data\s*=/
);
const state = JSON.parse(stateMatch[1]);            // works

const serverTimeMs = Number(
  (raw.match(/window\.PPHReact\.serverTime\s*=\s*'(\d+)'/) || [])[1]
);
```

Important: do **not** try `JSON.parse` on the whole script, and do **not** try to read `window.PPHReact` from a content script. Content scripts run in an isolated world and cannot see page globals. Reading the script tag's **text** works from the isolated world, so no MAIN-world injection is needed.

### 2.3 Shape of the state we care about

```
state.freelanceJobs.main.data      -> array of 20 refs: [{ id: "4521929", type: "projects" }, ...]
state.freelanceJobs.main.meta      -> { total-pages, total-items, current-page, applied_filters }
state.entities.projects[id].attributes -> the actual job
```

`state.freelanceJobs.main.meta.applied_filters.sort` is **"latest" by default**. Verified that
`main.data` order is strictly descending by `posted_dt`. So index 0..4 = newest 5 jobs. No sort click needed.

`main.data` has exactly 20 items per page. `featured` and `completed` arrays were empty on the default view, but code must tolerate them being non empty and must never mix them into the top 5.

### 2.4 Job attribute fields (from `entities.projects[id].attributes`)

Full field list:
`proj_id, title, budget_bracket, currency, category, sub_category, proj_status, proj_desc, budget, budget_converted, set_budget_higher, isPreFundedJob, isUrgent, urgentPrice, isFeatured, url, hourlie_id, item_type, item_state, canAskQuestion, minimumDeposit, privacy, location_type, where_can_bid, project_type, posted_dt, completed_dt, delivery_date, hourlie, availableAddons, duration, inviteFreelancersUrl, open, underModeration, client_id, client, subcate_id, expiry_dt, dynamoData, available_actions, editable_fields, proposalCount, unredProposalCount, etiquettes, project_attachments`

The ones the extension uses:

| Field | Example | Use |
|---|---|---|
| `proj_id` | `4521929` | Unique id, dedupe key. Numeric and increasing, so also a "newness" tiebreaker |
| `title` | `I need a spiritual website made` | Notification title |
| `posted_dt` | `"2026-09-16 18:39:37"` | **UTC**, `YYYY-MM-DD HH:mm:ss`. See 2.5 |
| `url` | full absolute job URL | Click target of the notification |
| `budget` + `currency` | `88`, `GBP` | Notification body |
| `project_type` | `fixed_price` / `hourly` | Notification body |
| `proposalCount` | `8` | Useful filter, low count = better odds |
| `item_state` | `open` | Skip anything not `open` |
| `location_type` | `remote` / `onsite` | Optional filter |
| `etiquettes` | `{featured, opportunity, prefunded, urgent, nda}` | Optional priority flag |
| `category.cate_name`, `sub_category.subcate_name` | | Optional keyword filter |

### 2.5 Timestamps (the critical part)

- `posted_dt` is a **UTC** wall clock string with a space, not a `T`, and **no timezone suffix**.
- `Date.parse("2026-09-16 18:39:37")` in Chrome treats it as **local time**. In Asia/Karachi (UTC+5) that is 5 hours off and would silently break the 10 minute gate.
- Correct parse:

```js
const postedMs = Date.parse(posted_dt.replace(' ', 'T') + 'Z');
```

- Use `serverTime` (epoch ms, from the same page load) as "now", **not** `Date.now()`. This removes user clock skew and makes the age exact.

```js
const ageMinutes = (serverTimeMs - postedMs) / 60000;
```

Verified live: top job `posted_dt 2026-09-16 18:39:37`, serverTime `1789584228635` -> age 4 min, and the page itself rendered "4 minutes ago". Match confirmed.

### 2.6 DOM fallback (if the inline script ever changes)

Class names are CSS-module hashed with a `⤍Component⤚hash` suffix, for example
`item--container⤍ListItem⤚2wpiz`. The hash will change on deploys, so **always use
`[class*="..."]` prefix matching**, never the full class string.

| What | Selector |
|---|---|
| Job card | `[class*="item--container"]` (20 per page) |
| Title + link | `a[class*="item__url"]` (absolute `href`) |
| Description | `[class*="item__desc"]` |
| Price | `[class*="card__price"]` |
| Poster name | `[class*="card__username"]` |
| Badge (pre-funded / opportunity) | `[class*="etiquettes--"]` |
| Footer meta | `[class*="card__footer-left"]` |

Footer meta spans in order: `["4 minutes ago", "8 proposals", "Remote", "Remote"]`.

The time is **relative text only**, no `datetime` attribute. Moment style strings seen:
`a few seconds ago`, `a minute ago`, `N minutes ago`, `an hour ago`, `N hours ago`, `a day ago`.

That is still enough for a 10 minute gate:

```js
function isFreshFromText(t) {
  if (/a few seconds ago|^a minute ago$/.test(t)) return true;
  const m = t.match(/^(\d+)\s+minutes? ago$/);
  return !!m && Number(m[1]) < 10;
}
```

Extract `proj_id` from the card's `href` if needed, or fall back to hashing `href` as the dedupe key.

### 2.7 Things that will break a naive scraper
- Hashed class names change per deploy. Prefix match only.
- `posted_dt` is UTC without a `Z`. Parse explicitly.
- Content scripts cannot read `window.PPHReact`. Read the script tag text.
- `window.PPHReact.data` is not JSON. Never parse the whole script.
- Featured or promoted rows can be injected into the list. Trust `freelanceJobs.main.data` order, not DOM index.
- Page count and total items shift between reloads. Never cache "page 1 = these 20 ids" as a stable thing.

---

## 3. Extension architecture (Manifest V3)

```
pph-alert/
  manifest.json
  background.js          # service worker: scheduler, state machine, notifications
  content.js             # runs on the jobs page: parse + reload on command
  offscreen.html         # needed to play audio (service workers cannot)
  offscreen.js
  options.html / options.js
  popup.html / popup.js  # status + last 5 jobs + pause toggle
  sounds/alert.mp3
  icons/
```

### 3.1 manifest.json

```json
{
  "manifest_version": 3,
  "name": "PPH New Job Alert",
  "version": "1.0.0",
  "permissions": ["storage", "alarms", "notifications", "tabs", "scripting", "offscreen", "idle"],
  "host_permissions": ["https://www.peopleperhour.com/*"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    {
      "matches": ["https://www.peopleperhour.com/freelance-jobs*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": { "default_popup": "popup.html" },
  "options_page": "options.html"
}
```

Why these permissions:
- `alarms` - the 5 to 10 min tick. Service workers get killed, `setInterval` does not survive. `chrome.alarms` does.
- `tabs` + `scripting` - find the jobs tab, reload it, inject the parser if the content script is not there.
- `offscreen` - the only reliable way to play a sound from MV3.
- `idle` - optional, to pause when the machine is locked.

### 3.2 Why a dedicated tab
Reloading the tab the user is reading destroys their scroll position and any half typed proposal.
**Recommended default:** the extension manages its **own pinned tab** on `/freelance-jobs`.
Option in settings: "use my current jobs tab instead" for users who prefer that.

The popup shows a button: "Open monitor tab". Store its `tabId` in `chrome.storage.session`.

---

## 4. The cycle (state machine)

```
IDLE
 -> tick (alarm fires)
 -> PRECHECK
 -> RELOAD
 -> SETTLE (20s)
 -> PARSE
 -> COMPARE
 -> ALERT (only if new fresh jobs)
 -> IDLE (schedule next tick with jitter)
```

### 4.1 PRECHECK - do not run when
Abort the tick, log a skip reason, keep the schedule alive:

1. `navigator.onLine === false` (checked in the content script, the service worker's value is less reliable).
2. Monitor tab missing or closed -> reopen it if auto mode is on, else skip.
3. Tab URL is no longer `/freelance-jobs*` (user navigated away or PPH redirected to login).
4. Previous cycle still in flight (a `cycleInProgress` lock in `chrome.storage.session`).
5. Extension is paused by the user.
6. A ping to the content script does not answer within 3 seconds -> page is unresponsive, skip this tick.
7. Optional: `chrome.idle.queryState(60) === "locked"` and "pause when locked" is on.

### 4.2 RELOAD
```js
await chrome.tabs.reload(tabId, { bypassCache: true });
```
`bypassCache: true` avoids a stale cached HTML page.

### 4.3 SETTLE - 20 second wait
Required by spec, and genuinely needed because the page is heavy.
Implement as **20s minimum + a readiness check**, not a blind 20s:

```js
await sleep(20000);
const ready = await pingContent(tabId);   // content script replies { ready: true }
```

If not ready after 20s, retry the ping every 2s up to 10 more seconds. Still no reply -> mark the
cycle as `UNRESPONSIVE`, skip, and apply backoff (4.7).

The content script confirms readiness with:
```js
document.readyState === 'complete' &&
document.querySelectorAll('[class*="item--container"]').length >= 5
```

### 4.4 PARSE
Content script runs the extraction from 2.2, then:

```js
const order = state.freelanceJobs.main.data.map(d => d.id);
const top5 = order.slice(0, 5).map(id => {
  const a = state.entities.projects[id].attributes;
  return {
    id: String(a.proj_id),
    title: a.title,
    url: a.url,
    postedMs: Date.parse(a.posted_dt.replace(' ', 'T') + 'Z'),
    budget: a.budget,
    currency: a.currency,
    projectType: a.project_type,
    proposals: a.proposalCount,
    state: a.item_state,
    locationType: a.location_type,
    etiquettes: a.etiquettes,
    category: a.category && a.category.cate_name
  };
});
return { ok: true, serverTimeMs, top5 };
```

Sanity gates before trusting the result:
- `top5.length === 5`
- every `postedMs` is a finite number
- `serverTimeMs` is within 24h of `Date.now()` (guards against a garbage parse)
- `serverTimeMs - postedMs >= -60000` (small negative allowed for clock jitter, large negative = parse bug)

If any gate fails -> fall back to the DOM parser (2.6). If that also fails -> `PARSE_FAILED`, skip, backoff, and surface a warning badge on the icon so the user knows the site changed.

### 4.5 COMPARE
```js
const FRESH_MS = 10 * 60 * 1000;   // configurable 5 - 30 min
const fresh = top5.filter(j =>
  j.state === 'open' &&
  (serverTimeMs - j.postedMs) < FRESH_MS &&
  !seenIds.has(j.id)
);
```

`seenIds` lives in `chrome.storage.local` as a map `{ [projId]: alertedAtMs }`.
Prune entries older than 6 hours on every cycle so it never grows without bound.

Optional user filters applied before alerting:
- keyword allow list / block list on `title` + `category`
- minimum budget
- max `proposalCount` (for example alert only if under 10 proposals)
- `location_type === 'remote'` only
- only `etiquettes.prefunded === true`

### 4.6 ALERT
For each fresh job (cap at 3 notifications per cycle to avoid a flood):

```js
chrome.notifications.create(`pph-${job.id}`, {
  type: 'basic',
  iconUrl: 'icons/128.png',
  title: `Apply now: ${job.title}`,
  message: `${job.currency} ${job.budget} - ${job.proposals} proposals - posted ${mins} min ago`,
  contextMessage: 'PeoplePerHour',
  priority: 2,
  requireInteraction: true
});
```

Click handler opens `job.url` in a new tab.

Sound: MV3 service workers have no DOM, so use an offscreen document.

```js
await chrome.offscreen.createDocument({
  url: 'offscreen.html',
  reasons: ['AUDIO_PLAYBACK'],
  justification: 'Play an alert sound for new freelance jobs'
});
chrome.runtime.sendMessage({ type: 'PLAY_SOUND' });
```
Close the offscreen document after playback, or keep one alive and reuse it.
Note: Chrome may block autoplay until the user has interacted with the extension once. The options
page should have a "Test sound" button, which both verifies the file and satisfies that gesture.

Then mark all 5 top ids as seen (not only the fresh ones) so a job that ages past 10 minutes and
reappears is never re-alerted.

### 4.7 Scheduling and backoff

```js
chrome.alarms.create('tick', { periodInMinutes: 5 });
```

`chrome.alarms` has a 1 minute minimum in released extensions, so 5 is safe.
For the "5 to 10 minute" requirement, use a **jittered one shot alarm** instead of a fixed period.
Random jitter also makes the traffic look human:

```js
function scheduleNext(baseMin = 5, spanMin = 5) {
  const delay = baseMin + Math.random() * spanMin;   // 5.00 - 10.00 min
  chrome.alarms.create('tick', { delayInMinutes: delay });
}
```

Backoff on consecutive failures (offline, unresponsive, parse failed):

| Consecutive failures | Next delay |
|---|---|
| 1 | normal (5-10 min) |
| 2 | 10 min |
| 3 | 20 min |
| 4 | 40 min |
| 5+ | 60 min, cap |

Reset the counter to 0 on any successful cycle.
Also listen to `window.online` in the content script / `navigator.onLine` transitions and fire an
immediate tick when the connection returns.

---

## 5. Storage schema

`chrome.storage.local`
```jsonc
{
  "settings": {
    "enabled": true,
    "freshWindowMin": 10,
    "minIntervalMin": 5,
    "maxIntervalMin": 10,
    "settleSec": 20,
    "topN": 5,
    "sound": true,
    "soundFile": "sounds/alert.mp3",
    "volume": 0.8,
    "useOwnTab": true,
    "pauseWhenLocked": false,
    "maxNotificationsPerCycle": 3,
    "filters": {
      "keywordsInclude": [],
      "keywordsExclude": [],
      "minBudget": 0,
      "maxProposals": null,
      "remoteOnly": false,
      "prefundedOnly": false
    }
  },
  "seen": { "4521929": 1789584228635 },
  "stats": {
    "lastRunMs": 0,
    "lastStatus": "OK | OFFLINE | UNRESPONSIVE | PARSE_FAILED | SKIPPED",
    "consecutiveFailures": 0,
    "totalAlerts": 0
  },
  "log": [ { "ts": 0, "status": "OK", "note": "2 fresh" } ]   // ring buffer, last 50
}
```

`chrome.storage.session`: `monitorTabId`, `cycleInProgress`.

---

## 6. Message protocol (background <-> content)

| Message | Direction | Payload | Reply |
|---|---|---|---|
| `PING` | bg -> content | - | `{ ready, online, itemCount, url }` |
| `PARSE` | bg -> content | `{ topN }` | `{ ok, serverTimeMs, top5, source: "state" \| "dom" }` |
| `PLAY_SOUND` | bg -> offscreen | `{ volume }` | - |
| `STATUS` | popup -> bg | - | `{ stats, nextRunMs, lastTop5 }` |
| `FORCE_CHECK` | popup -> bg | - | runs a cycle now |
| `TOGGLE` | popup -> bg | `{ enabled }` | - |

All `sendMessage` calls wrapped with a timeout so a dead content script cannot hang the cycle.

---

## 7. Politeness and safety

- One page load per 5 to 10 minutes is about 6 to 12 requests an hour. That is light, but keep it that way.
- Never parallel load multiple pages. Page 1 only. The spec says stick to this page.
- Jitter the interval so it is not a perfect metronome.
- Hard cap: never more than 20 reloads per hour, enforced by a counter in storage.
- Full stop when the tab shows a login wall, a captcha, or a non 200 page. Detect by:
  `document.querySelectorAll('[class*="item--container"]').length === 0` plus a title check.
  On this condition, set status `BLOCKED`, notify the user once, and pause until they resume manually.
- No credentials, no auto apply, no form submission. Notification only.
- Check PeoplePerHour's terms before wide distribution. Personal monitoring of a page you are
  already allowed to view is normally fine, but automated interaction is a different thing.

---

## 8. Edge cases checklist

| Case | Handling |
|---|---|
| Laptop sleeps, wakes after 2 hours | Alarm fires late, cycle runs once, not a burst |
| Internet drops mid reload | `PING` times out -> `UNRESPONSIVE`, backoff |
| PPH deploys new class hashes | State parser still works, DOM fallback degrades, badge warning |
| PPH removes the inline state script | DOM fallback takes over automatically |
| Same job re appears after an edit | Deduped by `proj_id` |
| Job posted 9 min ago, next tick it is 15 min | Already marked seen, no duplicate alert |
| 5 jobs all posted in the last 10 min | Cap at 3 notifications, one summary notification for the rest |
| User is on page 2 in the monitor tab | Force the tab back to the base URL before reload |
| Clock skew on the user's machine | `serverTime` is used, not `Date.now()` |
| Chrome blocks autoplay | Options page "Test sound" button satisfies the gesture |
| Two monitor tabs open | Keep the first, close or ignore the rest |

---

## 9. Build phases

**Phase 1 - parser (half a day)**
Content script only. Extract top 5 with `posted_dt`, ages, and log to console. Verify the UTC math
against the page's own "N minutes ago" text on at least 10 reloads.

**Phase 2 - scheduler (half a day)**
Background service worker, jittered alarm, reload + 20s settle + ping, cycle lock, skip conditions.

**Phase 3 - alerting (half a day)**
Dedupe store, notification, click to open, offscreen audio, per cycle cap.

**Phase 4 - UI (1 day)**
Popup with status, next run countdown, last 5 jobs, pause toggle, force check.
Options page with interval, fresh window, filters, sound test.

**Phase 5 - hardening (half a day)**
Backoff, DOM fallback, blocked/captcha detection, hourly request cap, ring buffer log, seen store pruning.

---

## 10. Test plan

1. **Age math:** for 10 consecutive reloads, assert parsed age in minutes matches the rendered
   relative text bucket. Zero mismatches allowed.
2. **UTC trap:** temporarily set the machine to UTC-8 and UTC+5, ages must be identical.
3. **Offline:** disable network, force a tick, assert status `OFFLINE`, no reload attempted, backoff applied.
4. **Unresponsive:** throttle the tab to "Slow 3G" in DevTools, assert the 20s settle extends and
   then times out cleanly instead of parsing a half rendered page.
5. **Dedupe:** run 4 cycles inside 20 minutes, assert each job id alerts at most once.
6. **Fresh gate:** temporarily set `freshWindowMin` to 240, confirm it alerts, set it back to 10,
   confirm the same jobs do not re alert.
7. **Fallback:** stub out the inline script in a local copy of the page, confirm the DOM parser
   produces the same 5 ids.
8. **Cap:** simulate 5 fresh jobs, assert 3 notifications plus 1 summary.
9. **Long run:** leave it running 8 hours, review the log ring buffer for unexpected statuses and
   confirm the reload count stays under the hourly cap.

---

## 11. Reference snippet - the whole parse in one function

```js
function parsePPHJobs(topN = 5) {
  if (!navigator.onLine) return { ok: false, reason: 'OFFLINE' };
  if (document.readyState !== 'complete') return { ok: false, reason: 'NOT_READY' };

  const el = [...document.querySelectorAll('script')]
    .find(s => !s.src && (s.textContent || '').trim().startsWith('window.PPHReact'));

  if (el) {
    const raw = el.textContent;
    const m = raw.match(/window\.PPHReact\.initialState\s*=\s*([\s\S]*?);\s*window\.PPHReact\.data\s*=/);
    const st = Number((raw.match(/window\.PPHReact\.serverTime\s*=\s*'(\d+)'/) || [])[1]);
    if (m && st) {
      try {
        const s = JSON.parse(m[1]);
        const ids = s.freelanceJobs.main.data.map(d => d.id).slice(0, topN);
        const jobs = ids.map(id => {
          const a = s.entities.projects[id].attributes;
          return {
            id: String(a.proj_id),
            title: a.title,
            url: a.url,
            postedMs: Date.parse(a.posted_dt.replace(' ', 'T') + 'Z'),
            ageMin: (st - Date.parse(a.posted_dt.replace(' ', 'T') + 'Z')) / 60000,
            budget: a.budget,
            currency: a.currency,
            projectType: a.project_type,
            proposals: a.proposalCount,
            state: a.item_state,
            locationType: a.location_type,
            etiquettes: a.etiquettes,
            category: a.category && a.category.cate_name
          };
        });
        if (jobs.length === topN && jobs.every(j => Number.isFinite(j.postedMs))) {
          return { ok: true, source: 'state', serverTimeMs: st, jobs };
        }
      } catch (e) { /* fall through to DOM */ }
    }
  }

  // DOM fallback
  const cards = [...document.querySelectorAll('[class*="item--container"]')].slice(0, topN);
  if (cards.length < topN) return { ok: false, reason: 'NO_CARDS' };
  const jobs = cards.map(c => {
    const a = c.querySelector('a[class*="item__url"]');
    const spans = [...c.querySelectorAll('[class*="card__footer-left"] span')].map(s => s.textContent.trim());
    return {
      id: (a.getAttribute('href') || '').split('/').pop(),
      title: a.textContent.trim(),
      url: a.href,
      relativeTime: spans[0] || '',
      proposals: parseInt(spans[1], 10) || 0
    };
  });
  return { ok: true, source: 'dom', serverTimeMs: Date.now(), jobs };
}
```

---

XEMTECH Team
