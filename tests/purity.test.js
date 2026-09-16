// U10: static enforcement of CLAUDE.md rules 1, 3, 4, 5, 10 and the manifest contract. SPEC 22.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const PPH_ORIGIN = 'https://www.peopleperhour.com';

const EXPECTED_PERMISSIONS = ['alarms', 'idle', 'notifications', 'offscreen', 'storage'];
const EXPECTED_HOSTS = [`${PPH_ORIGIN}/*`];
const EXPECTED_CSP = "script-src 'self'; object-src 'self'";

const CORE_BANNED = [
  /\b(chrome|document|window|navigator)\s*\./,
  /\bDate\.now\s*\(/,
  /\bMath\.random\s*\(/,
  /\b(fetch|setTimeout|setInterval)\s*\(/
];
const SRC_BANNED = [
  /\b(innerHTML|outerHTML)\b/,
  /\binsertAdjacentHTML\b/,
  /\beval\s*\(/,
  /\bnew\s+Function\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bjavascript:/i
];
const CHROME_CALL = /\bchrome\s*\./;
const URL_RE = /\b(?:https?|wss?|ftp):\/\/[^\s'"`)<>]*/gi;
const IMPORT_RE =
  /\bimport\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bexport\s+[^'";]*?\s+from\s+['"]([^'"]+)['"]|\bgetURL\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const walk = dir => !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const rel = p => relative(SRC, p).split('\\').join('/');
const read = p => readFileSync(p, 'utf8');
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const specifiers = code => [...code.matchAll(IMPORT_RE)].map(m => m[1] ?? m[2] ?? m[3] ?? m[4]);
const isAllowedUrl = u => u === PPH_ORIGIN || u.startsWith(`${PPH_ORIGIN}/`);
const globToRe = g => new RegExp(`^${g.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

const srcFiles = walk(SRC);
const jsFiles = srcFiles.filter(p => p.endsWith('.js'));
const htmlFiles = srcFiles.filter(p => p.endsWith('.html'));
const manifest = JSON.parse(read(join(SRC, 'manifest.json')));

test('control: rule patterns catch violations and allow legitimate code', () => {
  const bad = ['chrome.runtime.id', 'document.title', 'window.x', 'navigator.onLine',
               'Date.now()', 'Math.random()', 'fetch(u)', 'setTimeout(f, 1)'];
  for (const s of bad) assert.ok(CORE_BANNED.some(r => r.test(s)), `core rule missed: ${s}`);
  assert.ok(!CORE_BANNED.some(r => r.test(String.raw`/window\.PPHReact\.initialState/`)), 'regex text must not trip');
  assert.ok(!CORE_BANNED.some(r => r.test('Date.parse(s)')));

  for (const s of ['el.innerHTML = x', 'eval(x)', 'new Function("x")', 'fetch(url)', 'new XMLHttpRequest()', 'javascript:void 0'])
    assert.ok(SRC_BANNED.some(r => r.test(s)), `src rule missed: ${s}`);
  assert.ok(!SRC_BANNED.some(r => r.test('el.textContent = x')));

  assert.equal(stripComments('a // chrome.x\nb /* chrome.y */ c'), 'a \nb  c');
  assert.equal(stripComments("'https://www.peopleperhour.com/'"), "'https://www.peopleperhour.com/'");
  assert.deepEqual(specifiers(`import a from './a.js'; import './b.js'; import('./c.js'); export { x } from './d.js'; getURL('e.js')`),
    ['./a.js', './b.js', './c.js', './d.js', 'e.js']);

  assert.ok(isAllowedUrl(`${PPH_ORIGIN}/freelance-jobs`));
  assert.ok(!isAllowedUrl(`${PPH_ORIGIN}.evil.com/`));
  assert.ok(!isAllowedUrl('http://www.peopleperhour.com/'));
  assert.ok(globToRe('core/*.js').test('core/time.js'));
  assert.ok(!globToRe('core/*.js').test('core/sub/time.js'));
});

test('src/core is pure and imports only core', () => {
  const core = jsFiles.filter(p => rel(p).startsWith('core/'));
  for (const file of core) {
    const code = stripComments(read(file));
    for (const rule of CORE_BANNED) assert.ok(!rule.test(code), `${rel(file)} breaks purity: ${rule}`);
    for (const spec of specifiers(code)) assert.ok(spec.startsWith('./'), `${rel(file)} imports outside core: ${spec}`);
  }
});

test('no dangerous APIs anywhere in src', () => {
  for (const file of [...jsFiles, ...htmlFiles]) {
    const code = stripComments(read(file));
    for (const rule of SRC_BANNED) assert.ok(!rule.test(code), `${rel(file)} uses banned API: ${rule}`);
  }
});

test('no URLs in src other than the PeoplePerHour origin', () => {
  for (const file of srcFiles.filter(p => /\.(js|html|css|json)$/.test(p))) {
    for (const [url] of read(file).matchAll(URL_RE))
      assert.ok(isAllowedUrl(url), `${rel(file)} contains foreign URL: ${url}`);
  }
});

test('chrome.* only in platform/ and the single content bootstrap line', () => {
  for (const file of jsFiles) {
    const path = rel(file);
    if (path.startsWith('platform/')) continue;
    const lines = stripComments(read(file)).split('\n').filter(l => CHROME_CALL.test(l));
    if (path === 'content/content.js') {
      assert.ok(lines.length <= 1, `content/content.js may call chrome.* on one line only, found ${lines.length}`);
      assert.ok(lines.every(l => /chrome\.runtime\.getURL\(/.test(l) && /\bimport\(/.test(l)),
        'the bootstrap line may only import(chrome.runtime.getURL(...))');
    } else {
      assert.equal(lines.length, 0, `${path} calls chrome.* outside platform/`);
    }
  }
});

test('html pages have no inline scripts or inline handlers', () => {
  for (const file of htmlFiles) {
    const html = read(file);
    assert.ok(!/<script(?![^>]*\bsrc\s*=)[^>]*>/i.test(html), `${rel(file)} has an inline <script>`);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${rel(file)} has an inline event handler`);
  }
});

test('manifest: permissions, hosts, CSP, worker, content script', () => {
  const text = read(join(SRC, 'manifest.json'));
  assert.ok(!text.includes('<all_urls>'), 'manifest must never use <all_urls>');
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), EXPECTED_PERMISSIONS);
  assert.deepEqual(manifest.host_permissions, EXPECTED_HOSTS);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.content_security_policy?.extension_pages, EXPECTED_CSP);
  assert.equal(manifest.background?.type, 'module');

  assert.equal(manifest.content_scripts.length, 1);
  const [cs] = manifest.content_scripts;
  assert.deepEqual(cs.js, ['content/content.js'], 'only the classic bootstrap is injected (SPEC 6, R2)');
  assert.equal(cs.css, undefined);
  assert.ok(cs.matches.every(isAllowedUrl));

  for (const war of manifest.web_accessible_resources ?? [])
    assert.ok(war.matches.every(isAllowedUrl), 'web accessible resources exposed only to PeoplePerHour');
});

test('manifest: every referenced file exists', () => {
  const paths = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap(c => c.js),
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];
  for (const p of paths) assert.ok(existsSync(join(SRC, p)), `manifest references missing file: ${p}`);
});

test('content script import graph is web accessible and resolves', () => {
  const globs = (manifest.web_accessible_resources ?? []).flatMap(w => w.resources).map(globToRe);
  const seen = new Set();
  const visit = (path, isBootstrap) => {
    const file = join(SRC, path);
    assert.ok(existsSync(file), `import target missing: ${path}`);
    for (const spec of specifiers(stripComments(read(file)))) {
      const target = isBootstrap ? spec : posix.normalize(posix.join(posix.dirname(path), spec));
      assert.ok(!target.startsWith('..'), `import escapes src: ${target}`);
      assert.ok(globs.some(g => g.test(target)), `${target} (imported by ${path}) is not in web_accessible_resources`);
      if (!seen.has(target)) { seen.add(target); visit(target, false); }
    }
  };
  visit('content/content.js', true);
  assert.ok(seen.has('content/main.js'), 'bootstrap must import content/main.js');
});
