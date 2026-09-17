// Minimal Chrome DevTools Protocol client over --remote-debugging-pipe. Node built-ins only. Dev tool.
// Used by tools/e2e.mjs to load the unpacked extension into a throwaway Chrome profile and drive it.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].filter(Boolean);

export function findChrome() {
  const found = CHROME_PATHS.find(p => existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH.');
  return found;
}

export class Cdp {
  #nextId = 0;
  #pending = new Map();
  #listeners = new Set();

  constructor(input, output) {
    this.input = input;
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    output.on('data', chunk => {
      buffer += decoder.write(chunk);
      let end;
      while ((end = buffer.indexOf('\0')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        this.#dispatch(message);
      }
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.#nextId;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    this.input.write(`${JSON.stringify(message)}\0`);
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject, method }));
  }

  on(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #dispatch(message) {
    const waiter = message.id !== undefined ? this.#pending.get(message.id) : undefined;
    if (waiter) {
      this.#pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.#listeners) listener(message);
  }
}

/** Launch Chrome with a fresh profile and a CDP pipe. */
export function launchChrome({ headless = true, extraArgs = [] } = {}) {
  const profile = mkdtempSync(join(process.env.E2E_TMP ?? tmpdir(), 'pph-e2e-'));
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    '--autoplay-policy=no-user-gesture-required',
    ...(headless ? ['--headless=new'] : []),
    ...extraArgs,
    'about:blank'
  ];
  const proc = spawn(findChrome(), args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const cdp = new Cdp(proc.stdio[3], proc.stdio[4]);
  let stderr = '';
  proc.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  return { proc, cdp, profile, stderr: () => stderr };
}

/** Evaluate an expression in an attached session, awaiting promises, returning by value. */
export async function evaluate(cdp, sessionId, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  }
  return r.result.value;
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
