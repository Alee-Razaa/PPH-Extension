// Screenshots of the popup and options page from a real Chrome with live data. Dev tool, Node built-ins only.
// Usage: node tools/screenshots.mjs <outDir>
// Waits for one real check so the popup shows real jobs, then captures light and dark versions.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, evaluate, sleep } from './cdp.mjs';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const outDir = resolve(process.argv[2] ?? 'screenshots');
mkdirSync(outDir, { recursive: true });

const { proc, cdp, profile } = launchChrome({ headless: true });
const errors = [];

async function openPage(url, width, height) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await sleep(1500);
  return { targetId, sessionId };
}

async function shoot(sessionId, name, { fullPage = false, dark = false } = {}) {
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] }, sessionId);
  await sleep(400);
  let clip;
  if (fullPage) {
    const size = await evaluate(cdp, sessionId, `({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })`);
    clip = { x: 0, y: 0, width: size.w, height: size.h, scale: 1 };
  } else {
    const size = await evaluate(cdp, sessionId, `({ w: document.body.getBoundingClientRect().width, h: document.body.getBoundingClientRect().height })`);
    clip = { x: 0, y: 0, width: Math.ceil(size.w), height: Math.ceil(size.h), scale: 1 };
  }
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true }, sessionId);
  const file = join(outDir, `${name}${dark ? '-dark' : ''}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('wrote', file);
}

try {
  await sleep(1500);
  cdp.on(m => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: SRC.replaceAll('\\', '/') });
  const base = `chrome-extension://${id}/ui/`;

  const options = await openPage(`${base}options.html`, 900, 900);
  console.log('waiting for a real check...');
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const s = await evaluate(cdp, options.sessionId, `chrome.storage.local.get(['stats']).then(x => x.stats?.status ?? '')`);
    if (s === 'OK' || s === 'UNRESPONSIVE' || s === 'PARSE_FAILED') { console.log('status', s); break; }
    await sleep(3000);
  }

  const popup = await openPage(`${base}popup.html`, 340, 600);
  await sleep(1000);
  await shoot(popup.sessionId, 'popup');
  await shoot(popup.sessionId, 'popup', { dark: true });
  await cdp.send('Target.closeTarget', { targetId: popup.targetId });

  await cdp.send('Page.reload', {}, options.sessionId);
  await sleep(2000);
  await shoot(options.sessionId, 'options', { fullPage: true });
  await shoot(options.sessionId, 'options', { fullPage: true, dark: true });

  const narrow = await openPage(`${base}options.html`, 375, 800);
  await shoot(narrow.sessionId, 'options-mobile-width', { fullPage: true });
  const overflow = await evaluate(cdp, narrow.sessionId, `document.documentElement.scrollWidth > window.innerWidth`);
  console.log('options horizontal overflow at 375px:', overflow);
  console.log('page errors:', errors.length ? errors : 'none');
} finally {
  proc.kill();
  await sleep(1000);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
