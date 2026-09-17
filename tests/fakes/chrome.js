// In-memory stand-in for the chrome.* APIs background.js uses. Test-only, no dependencies.
// Behaves like Chrome where it matters: async APIs, storage.onChanged with old/new values,
// tabs.get throwing for closed tabs, one-shot alarms, and message listeners that return true.

export const EXTENSION_ID = 'pphjobradartestextensionid';
export const EXTENSION_BASE = `chrome-extension://${EXTENSION_ID}/`;

const clone = v => (v === undefined ? undefined : structuredClone(v));

export function createFakeChrome({ ping = { online: true, ready: true }, idleState = 'active' } = {}) {
  const listeners = new Map();
  const calls = [];
  const areas = { local: new Map(), session: new Map() };
  const alarms = new Map();
  const tabs = new Map();
  const badge = { text: '', color: '' };
  let nextTabId = 500;

  const event = name => ({
    addListener: fn => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    removeListener: fn => listeners.set(name, (listeners.get(name) ?? []).filter(f => f !== fn))
  });
  const emit = (name, ...args) => { for (const fn of listeners.get(name) ?? []) fn(...args); };

  const area = name => ({
    async get(keys) {
      const store = areas[name];
      const wanted = keys == null ? [...store.keys()] : [].concat(keys);
      return Object.fromEntries(wanted.filter(k => store.has(k)).map(k => [k, clone(store.get(k))]));
    },
    async set(items) {
      const store = areas[name];
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: clone(store.get(k)), newValue: clone(v) };
        store.set(k, clone(v));
      }
      emit('storage.onChanged', changes, name);
    },
    async remove(keys) {
      for (const k of [].concat(keys)) areas[name].delete(k);
    }
  });

  const api = {
    runtime: {
      id: EXTENSION_ID,
      getURL: path => `${EXTENSION_BASE}${path}`,
      onInstalled: event('runtime.onInstalled'),
      onStartup: event('runtime.onStartup'),
      onMessage: event('runtime.onMessage'),
      sendMessage: async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); }
    },
    storage: { local: area('local'), session: area('session'), onChanged: event('storage.onChanged') },
    alarms: {
      async create(name, info) {
        const scheduledTime = info.when ?? Date.now() + info.delayInMinutes * 60_000;
        alarms.set(name, { name, scheduledTime });
        calls.push(['alarm', name, scheduledTime]);
      },
      async clear(name) { return alarms.delete(name); },
      async get(name) { return clone(alarms.get(name)); },
      onAlarm: event('alarms.onAlarm')
    },
    tabs: {
      async get(id) {
        if (!tabs.has(id)) throw new Error(`No tab with id: ${id}.`);
        return { ...tabs.get(id) };
      },
      async create({ url, pinned = false, active = true }) {
        const tab = { id: nextTabId++, url, pinned, active, windowId: 1 };
        tabs.set(tab.id, tab);
        calls.push(['create', tab.id, url, { pinned, active }]);
        return { ...tab };
      },
      async reload(id, props) {
        if (!tabs.has(id)) throw new Error(`No tab with id: ${id}.`);
        calls.push(['reload', id, props]);
      },
      async update(id, props) {
        const tab = tabs.get(id);
        if (!tab) throw new Error(`No tab with id: ${id}.`);
        Object.assign(tab, props);
        calls.push(['update', id, props]);
        return { ...tab };
      },
      async query() { return [...tabs.values()].map(t => ({ ...t })); },
      async sendMessage(id, msg) {
        calls.push(['sendMessage', id, msg.type]);
        const reply = typeof ping === 'function' ? ping(id, msg) : ping;
        if (reply instanceof Error) throw reply;
        return clone(reply);
      },
      onRemoved: event('tabs.onRemoved')
    },
    windows: { async update() {} },
    idle: { async queryState() { return idleState; } },
    action: {
      async setBadgeText({ text }) { badge.text = text; },
      async setBadgeBackgroundColor({ color }) { badge.color = color; }
    },
    notifications: { onClicked: event('notifications.onClicked') }
  };

  /** Open a tab directly, as the user would. */
  function openTab(url) {
    const tab = { id: nextTabId++, url, pinned: false, active: true, windowId: 1 };
    tabs.set(tab.id, tab);
    return tab.id;
  }

  function closeTab(id) {
    tabs.delete(id);
    emit('tabs.onRemoved', id, { windowId: 1, isWindowClosing: false });
  }

  /** Deliver a runtime message the way Chrome does and resolve with the reply. */
  function sendRuntime(msg, sender) {
    return new Promise(resolve => {
      const full = { id: EXTENSION_ID, ...sender };
      for (const fn of listeners.get('runtime.onMessage') ?? []) {
        if (fn(msg, full, resolve) === true) return;
      }
      resolve(undefined);
    });
  }

  return { api, areas, alarms, tabs, calls, badge, emit, openTab, closeTab, sendRuntime, listeners };
}

/** Let queued promise chains and immediate timers run. */
export async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve));
}
