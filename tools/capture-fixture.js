// Captures tests/fixtures/pph-sample.json from the live jobs page. SPEC 22.1.
//
// How to use:
//   1. Open https://www.peopleperhour.com/freelance-jobs and wait for it to load
//   2. F12 -> Console. Set the context dropdown to "top" (NOT "PPH Job Radar")
//   3. Paste this whole file and press Enter
//   4. It copies JSON to your clipboard. Save it as tests/fixtures/pph-sample.json
//
// It keeps the first 10 jobs and drops client details, descriptions, attachments and dynamoData.
// Job titles, budgets and URLs are public listing data.
(() => {
  const TAG = '[capture-fixture]';
  const raw = [...document.querySelectorAll('script:not([src])')]
    .map(s => s.textContent || '')
    .find(t => t.trimStart().startsWith('window.PPHReact'));
  if (!raw) return console.error(TAG, 'window.PPHReact script not found. Is this the /freelance-jobs page?');

  const stateMatch = raw.match(/window\.PPHReact\.initialState\s*=\s*([\s\S]*?);\s*window\.PPHReact\.data\s*=/);
  const timeMatch = raw.match(/window\.PPHReact\.serverTime\s*=\s*['"](\d+)['"]/);
  if (!stateMatch || !timeMatch) return console.error(TAG, 'initialState or serverTime not found. Site shape changed?');

  const state = JSON.parse(stateMatch[1]);
  const refs = state.freelanceJobs.main.data.slice(0, 10);
  const DROP = ['client', 'client_id', 'proj_desc', 'project_attachments', 'dynamoData',
                'available_actions', 'editable_fields', 'inviteFreelancersUrl'];
  const projects = {};
  for (const { id } of refs) {
    const attributes = { ...state.entities.projects[id].attributes };
    for (const key of DROP) delete attributes[key];
    projects[id] = { id, type: 'projects', attributes };
  }
  const trimmed = {
    freelanceJobs: {
      main: { data: refs, meta: state.freelanceJobs.main.meta },
      featured: { data: [] },
      completed: { data: [] }
    },
    entities: { projects }
  };

  const cards = [...document.querySelectorAll('[class*="item--container"]')].slice(0, 10).map(card => {
    const link = card.querySelector('a[class*="item__url"]');
    return {
      href: link?.href || '',
      title: (link?.textContent || '').trim(),
      price: (card.querySelector('[class*="card__price"]')?.textContent || '').trim(),
      footer: [...card.querySelectorAll('[class*="card__footer-left"] span')].map(s => (s.textContent || '').trim()),
      badges: [...card.querySelectorAll('[class*="etiquettes--"]')].map(b => (b.textContent || '').trim())
    };
  });

  const fixture = {
    capturedAt: new Date().toISOString(),
    note: 'Trimmed real capture. data literal replaced with a non-JSON stand-in. See SPEC 22.1.',
    raw: `window.PPHReact={};window.PPHReact.initialState=${JSON.stringify(trimmed)};` +
         `window.PPHReact.data={notJson:true,fn:function(){return "a;b"}};` +
         `window.PPHReact.serverTime='${timeMatch[1]}';`,
    cards
  };

  const json = JSON.stringify(fixture, null, 2);
  if (typeof copy === 'function') {
    copy(json);
    console.log(TAG, `Copied ${json.length} chars. Save as tests/fixtures/pph-sample.json`);
  } else {
    console.log(json);
    console.log(TAG, 'copy() unavailable, copy the JSON above');
  }
  console.log(TAG, 'first card:', cards[0]);
  console.log(TAG, 'top state job posted_dt:', projects[refs[0].id].attributes.posted_dt, 'serverTime:', timeMatch[1]);
})();
