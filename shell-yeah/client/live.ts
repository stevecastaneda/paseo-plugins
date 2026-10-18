import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { LIMITS, type Limits } from "../shared/limits.ts";
import { isEnded, type LiveView, type RunRow } from "../shared/row.ts";
import type { ResolvedRun } from "../shared/view.ts";

export type TailRpc = (input: { runId: string; lines: number; since: number | null; waitMs: number }) =>
  Promise<{ state: "unknown" } | { state: "unchanged"; rev: number } | { state: "view"; view: LiveView }>;

// Per-run client state that must outlive a remount (web virtualizes rows after 100 items).
export interface LiveEntry {
  row: RunRow;
  view: LiveView | null;
  lostAt: number | null;
  clockOffset: number;
  expanded: boolean;
  following: boolean;
  // Saw it running in this session, so the settle flash is allowed.
  seenLive: boolean;
  subscribers: number;
  listeners: Set<() => void>;
  polling: boolean;
  // Bumped to make an in-flight poll's answer stale (expanded toggled, detached).
  token: number;
  refresh: boolean;
  touchedAt: number;
  // Bumped on every observable change; the hooks' store snapshot.
  version: number;
  // The entrance animation has played for this row in this session.
  entered: boolean;
}

export interface LiveStoreDeps {
  rpc: TailRpc;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  limits?: Partial<Limits>;
}

export interface LiveStore {
  attach(row: RunRow): () => void;
  update(row: RunRow): void;
  resolve(row: RunRow): ResolvedRun;
  entry(runId: string): LiveEntry;
  subscribe(runId: string, listener: () => void): () => void;
  setExpanded(runId: string, expanded: boolean): void;
  setFollowing(runId: string, following: boolean): void;
  markEntered(runId: string): void;
  setActive(active: boolean): void;
  readonly size: number;
}

export function createLiveStore(deps: LiveStoreDeps): LiveStore {
  const limits: Limits = { ...LIMITS, ...deps.limits };
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const entries = new Map<string, LiveEntry>();
  let active = true;

  function entry(runId: string, row?: RunRow): LiveEntry {
    let e = entries.get(runId);
    if (!e) {
      trim();
      e = { row: row!, view: null, lostAt: null, clockOffset: 0, expanded: false, following: true, seenLive: false, subscribers: 0, listeners: new Set(), polling: false, token: 0, refresh: false, touchedAt: now(), version: 0, entered: false };
      entries.set(runId, e);
    }
    if (row) e.row = row;
    e.touchedAt = now();
    return e;
  }

  function trim() {
    if (entries.size < limits.uiStoreEntries) return;
    const idle = [...entries.entries()].filter(([, e]) => e.subscribers === 0).sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    for (const [id] of idle.slice(0, entries.size - limits.uiStoreEntries + 1)) entries.delete(id);
  }

  function notify(e: LiveEntry) {
    e.version++;
    for (const listener of e.listeners) listener();
  }

  // Merge rule: the higher rev wins; an ended phase is final and wins a tie.
  function resolve(row: RunRow): ResolvedRun {
    const e = entry(row.runId, row);
    const v = e.view;
    const useView = v !== null && (v.rev > row.rev || (v.rev === row.rev && isEnded(v.phase)));
    const live = useView ? v : null;
    return {
      runId: row.runId, origin: row.origin, command: row.command, cwd: row.cwd, terminal: row.terminal === true,
      rev: live?.rev ?? row.rev,
      phase: live?.phase ?? row.phase,
      output: live?.output ?? row.output,
      sentAt: live?.sentAt ?? row.sentAt,
      lastOutputAt: live?.lastOutputAt ?? null,
      lostAt: (live?.phase ?? row.phase).kind === "running" ? e.lostAt : null,
      clockOffset: e.clockOffset,
    };
  }

  function shouldPoll(e: LiveEntry): boolean {
    return active && e.subscribers > 0 && e.lostAt === null && resolve(e.row).phase.kind === "running";
  }

  async function poll(e: LiveEntry) {
    if (e.polling) return;
    e.polling = true;
    let failures = 0;
    try {
      while (shouldPoll(e)) {
        e.seenLive = true;
        const token = e.token;
        const since = e.refresh ? null : (e.view?.rev ?? e.row.rev);
        e.refresh = false;
        try {
          const result = await deps.rpc({ runId: e.row.runId, lines: limits.scrollbackLines, since, waitMs: limits.tailWaitMs });
          failures = 0;
          if (token !== e.token) continue;
          if (result.state === "view") {
            if (result.view.rev >= (e.view?.rev ?? -1)) {
              e.view = result.view;
              e.clockOffset = result.view.serverNow - now();
              notify(e);
            }
          } else if (result.state === "unknown") {
            e.lostAt = now();
            notify(e);
          }
        } catch {
          await sleep(limits.pollBackoffMs[Math.min(failures++, limits.pollBackoffMs.length - 1)]);
        }
      }
    } finally {
      e.polling = false;
    }
  }

  function kick(e: LiveEntry) {
    if (shouldPoll(e)) void poll(e);
  }

  return {
    attach(row) {
      const e = entry(row.runId, row);
      e.subscribers++;
      kick(e);
      return () => {
        e.subscribers--;
        if (e.subscribers === 0) e.token++;
      };
    },
    update(row) {
      const e = entry(row.runId, row);
      kick(e);
    },
    resolve,
    entry: (runId) => entry(runId),
    subscribe(runId, listener) {
      const e = entry(runId);
      e.listeners.add(listener);
      return () => e.listeners.delete(listener);
    },
    setExpanded(runId, expanded) {
      const e = entry(runId);
      if (e.expanded === expanded) return;
      e.expanded = expanded;
      notify(e);
    },
    setFollowing(runId, following) {
      const e = entry(runId);
      if (e.following === following) return;
      e.following = following;
      notify(e);
    },
    markEntered(runId) {
      entry(runId).entered = true;
    },
    setActive(value) {
      active = value;
      if (active) for (const e of entries.values()) kick(e);
    },
    get size() {
      return entries.size;
    },
  };
}

// ---- the hooks, over one module-level store ----

let shared: LiveStore | null = null;
let latestRpc: TailRpc | null = null;
let watchingApp = false;

function appStore(rpc: TailRpc): LiveStore {
  latestRpc = rpc;
  if (!shared) shared = createLiveStore({ rpc: (input) => latestRpc!(input) });
  if (!watchingApp) {
    watchingApp = true;
    if (Platform.OS === "web") {
      const doc = (globalThis as { document?: { addEventListener(type: string, fn: () => void): void; visibilityState: string } }).document;
      doc?.addEventListener("visibilitychange", () => shared?.setActive(doc.visibilityState === "visible"));
    } else {
      AppState?.addEventListener?.("change", (state) => shared?.setActive(state === "active"));
    }
  }
  return shared;
}

// The row's data merged with the freshest live reply. Keeps a long-poll loop alive only
// while the merged phase is running, something is mounted, and the app is active.
export function useResolvedRun(row: RunRow, rpc: TailRpc): ResolvedRun {
  const store = appStore(rpc);
  useSyncExternalStore((listener) => store.subscribe(row.runId, listener), () => store.entry(row.runId).version);
  useEffect(() => store.attach(row), [row.runId]);
  useEffect(() => store.update(row), [row]);
  return store.resolve(row);
}

export function useRunUi(runId: string, rpc: TailRpc): { expanded: boolean; setExpanded(v: boolean): void; following: boolean; setFollowing(v: boolean): void; seenLive: boolean; entered: boolean; markEntered(): void } {
  const store = appStore(rpc);
  useSyncExternalStore((listener) => store.subscribe(runId, listener), () => store.entry(runId).version);
  const { expanded, following, seenLive, entered } = store.entry(runId);
  return {
    expanded, following, seenLive, entered,
    markEntered: () => store.markEntered(runId),
    setExpanded: (v) => store.setExpanded(runId, v),
    setFollowing: (v) => store.setFollowing(runId, v),
  };
}
