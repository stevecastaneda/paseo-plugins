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
      if (name === '@getpaseo/plugin/client') return {};
      if ( name === '@getpaseo/plugin/client/react-native' || name === 'react-native') return {};
      return require(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {
      console, Date, setTimeout: timer, setInterval: (callback, delay) => timer(callback, delay, true),
      clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id),
    })(localRequire, module, module.exports);
    return module.exports;
  }
  function directory() {
    const listeners = new Set();
    let resolveList;
    let rejectList;
    const state = {
      calls: 0,
      get listenerCount() { return listeners.size; },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      list() {
        state.calls++;
        return new Promise((resolve, reject) => { resolveList = resolve; rejectList = reject; });
      },
      fail() { rejectList(new Error("Connection unavailable")); },
      bootstrap(entries = [], pageInfo = { hasMore: false }) {
        resolveList({ entries, pageInfo });
      },
      update(payload) { for (const listener of listeners) listener(payload); },
    };
    return state;
  }
  const agents = directory();
  const workspaces = directory();
  function add(target) {
    const entry = { ...target, updates: 0, removed: false };
    registrations.push(entry);
    return { update(patch) { entry.updates++; Object.assign(entry.button, patch); }, remove() { entry.removed = true; } };
  }
  const client = {
    paseo: {
      agents: { list: agents.list, subscribe: agents.subscribe, ref: (id) => ({ timeline: { subscribe(callback) {
        watches.set(id, callback); return () => watches.delete(id);
      } } }) },
      workspaces: { list: workspaces.list, subscribe: workspaces.subscribe },
    },
    addComposerPill: (target) => add({ ...target, placement: 'composer' }),
    addHeaderButton: (target) => add({ ...target, placement: 'header' }),
    openPanel() {},
    async rpc(contract, input) {
      requests.push({ name: contract.name, input });
      if (contract.name === 'time-since.settings.get') return { showIcon: true, showAgo: false };
      if (contract.name === 'time-since.last-thread-message.get') return { lastMessageAt: new Date(Date.now() - 600_000).toISOString() };
      if (contract.name === 'workspace-links.shortcut.get') return { placement: 'composer', headerShowsLabel: false };
      if (contract.name === 'setup-monitor.status.get') return { snapshot: null };
      throw new Error(`Unexpected RPC ${contract.name}`);
    },
  };
  return { client, load, agents, workspaces, registrations, requests, watches, timers,
    async flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); },
    async tick(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { if (!timer.repeat) timers.delete(id); await timer.callback(); } },
  };
}
