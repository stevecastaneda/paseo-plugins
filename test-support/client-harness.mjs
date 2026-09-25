import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

// Execute the real client contribution with only the host boundary mocked.
export function clientHarness(pluginDirectory, modules = {}) {
  const require = createRequire(resolve(pluginDirectory, 'package.json'));
  const ts = require('typescript');
  const cache = new Map();
  const timers = new Map();
  const registrations = [];
  const requests = [];
  const watches = new Map();
  const opened = [];
  const responses = { 'time-since.last-reply.list': { lastReplyAt: {} } };
  let nextTimer = 0;
  function timer(callback, delay, repeat = false) { const id = ++nextTimer; timers.set(id, { callback, delay, repeat }); return id; }
  function load(path) {
    path = resolve(pluginDirectory, path);
    if (!existsSync(path)) path += existsSync(path + '.ts') ? '.ts' : '.tsx';
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} };
    cache.set(path, module);
    const source = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const localRequire = (name) => {
      if (name.startsWith('.')) return load(resolve(dirname(path), name));
      if (Object.hasOwn(modules, name)) return modules[name];
      if (name === '@getpaseo/plugin') return { defineRpc: (contract) => contract };
      if (name === '@getpaseo/plugin/client') return { openExternalUrl: async (url) => { opened.push(url); } };
      if ( name === '@getpaseo/plugin/client/react-native' || name === 'react-native') return {};
      return require(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {
      console, Date, setTimeout: timer, setInterval: (callback, delay) => timer(callback, delay, true),
      clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id),
    })(localRequire, module, module.exports);
    return module.exports;
  }
  // Mirrors Paseo 0.9's owned list subscription: list({ subscribe: {} })
  // resolves with a handle whose observers get the first page as a snapshot,
  // a fresh snapshot after each reconnect, and directory update messages.
  function directory(type) {
    const observers = new Set();
    let pending;
    let current;
    const state = {
      calls: 0,
      released: 0,
      get listenerCount() { return observers.size; },
      list(options = {}) {
        state.calls++;
        return new Promise((resolve, reject) => { pending = { resolve, reject, subscribe: Boolean(options.subscribe) }; });
      },
      fail() { pending.reject(new Error("Connection unavailable")); },
      bootstrap(entries = [], pageInfo = { hasMore: false }) {
        if (!pending.subscribe) return pending.resolve({ entries, pageInfo });
        const snapshot = { entries, pageInfo, subscriptionId: `sub-${state.calls}` };
        let released = false;
        const mine = new Set();
        current = {
          snapshot,
          mine,
          subscription: {
            subscriptionId: snapshot.subscriptionId,
            ready: Promise.resolve(snapshot),
            subscribe(observer) {
              if (released) throw new Error("Subscription released");
              mine.add(observer); observers.add(observer);
              observer.snapshot(current.snapshot);
              return () => { mine.delete(observer); observers.delete(observer); };
            },
            async release() {
              if (released) return;
              released = true; state.released++;
              for (const observer of mine) observers.delete(observer);
              mine.clear();
            },
          },
        };
        pending.resolve({ ...snapshot, subscription: current.subscription });
      },
      reconnect(entries = [], pageInfo = { hasMore: false }) {
        current.snapshot = { entries, pageInfo, subscriptionId: `${current.snapshot.subscriptionId}-r` };
        for (const observer of current.mine) observer.snapshot(current.snapshot);
      },
      update(payload) { for (const observer of observers) observer.update({ type, payload }); },
    };
    return state;
  }
  const agents = directory('agent_update');
  const workspaces = directory('workspace_update');
  function add(target) {
    const entry = { ...target, updates: 0, removed: false };
    registrations.push(entry);
    return { update(patch) { entry.updates++; Object.assign(entry.button, patch); }, remove() { entry.removed = true; } };
  }
  const client = {
    paseo: {
      agents: { list: agents.list, ref: (id) => ({ timeline: { subscribe(callback) {
        watches.set(id, callback); return () => watches.delete(id);
      } } }) },
      workspaces: { list: workspaces.list },
    },
    addComposerPill: (target) => add({ ...target, placement: 'composer' }),
    addHeaderButton: (target) => add({ ...target, placement: 'header' }),
    openPanel() {},
    async rpc(contract, input) {
      requests.push({ name: contract.name, input });
      if (contract.name === 'time-since.settings.get') return { showIcon: true, showAgo: false };
      if (Object.hasOwn(responses, contract.name)) return responses[contract.name];
      if (contract.name === 'workspace-links.shortcut.get') return { placement: 'composer', headerShowsLabel: false };
      if (contract.name === 'setup-monitor.status.get') return { snapshot: null };
      throw new Error(`Unexpected RPC ${contract.name}`);
    },
  };
  return { client, load, agents, workspaces, registrations, requests, watches, opened, timers, responses,
    async flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); },
    async tick(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { if (!timer.repeat) timers.delete(id); await timer.callback(); } },
  };
}
