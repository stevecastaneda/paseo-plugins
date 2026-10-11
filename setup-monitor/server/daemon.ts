import { randomUUID } from "node:crypto";
import type { SetupSnapshot } from "../shared/setup.ts";
import { setupSnapshotSchema } from "../shared/setup.ts";
import { completedDurationMs, trimSnapshot } from "../shared/snapshot.ts";

export interface DaemonPort {
  send(frame: string): void;
  onMessage(handler: (message: unknown) => void): () => void;
}

const processMessageHandlers = new Set<(message: unknown) => void>();
let processMessageAttached = false;

function dispatchProcessMessage(message: unknown): void {
  for (const handler of processMessageHandlers) handler(message);
}

export const defaultPort: DaemonPort = {
  send(frame: string): void {
    if (typeof process.send === "function") {
      process.send({ type: "paseo_frame", data: frame, isBinary: false });
    }
  },
  onMessage(handler: (message: unknown) => void): () => void {
    processMessageHandlers.add(handler);
    if (!processMessageAttached) {
      processMessageAttached = true;
      process.on("message", dispatchProcessMessage);
    }
    return () => {
      processMessageHandlers.delete(handler);
    };
  },
};

interface ParsedFrame {
  type: string;
  payload: unknown;
}

export function parsePaseoFrame(raw: unknown): ParsedFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const envelope = raw as { type?: unknown; isBinary?: unknown; data?: unknown };
  if (envelope.type !== "paseo_frame" || envelope.isBinary !== false || typeof envelope.data !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope.data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const data = parsed as { type?: unknown; message?: unknown; payload?: unknown };
  if (data.message && typeof data.message === "object") {
    const message = data.message as { type?: unknown; payload?: unknown };
    if (typeof message.type === "string") {
      return { type: message.type, payload: message.payload };
    }
  }
  if (typeof data.type === "string") {
    return { type: data.type, payload: data.payload };
  }
  return null;
}

// A connection that doesn't say it understands "blocked" gets a blocked setup
// as a failure with this message instead.
const BLOCKED_AS_FAILED = "Workspace setup is blocked pending approval";

function parseSnapshot(value: unknown): SetupSnapshot | null {
  const parsed = setupSnapshotSchema.safeParse(value);
  if (!parsed.success) return null;
  const snapshot = parsed.data;
  if (snapshot.status === "failed" && snapshot.error?.startsWith(BLOCKED_AS_FAILED)) {
    return trimSnapshot({ ...snapshot, status: "blocked", error: null });
  }
  return trimSnapshot(snapshot);
}

interface RequestOptions {
  timeoutMs?: number;
  createRequestId?: () => string;
}

// Sends one session request to the daemon and resolves with the payload of its
// response, matched by request id.
function requestFromDaemon(
  port: DaemonPort,
  message: { type: string; workspaceId: string },
  responseType: string,
  timeoutMessage: string,
  options?: RequestOptions,
): Promise<Record<string, unknown>> {
  const timeoutMs = options?.timeoutMs ?? 8_000;
  const requestId = (options?.createRequestId ?? (() => `setup-monitor-${randomUUID()}`))();
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      finish();
    };
    const unsubscribe = port.onMessage((raw) => {
      const frame = parsePaseoFrame(raw);
      if (!frame || !frame.payload || typeof frame.payload !== "object") return;
      const payload = frame.payload as Record<string, unknown>;
      if (payload.requestId !== requestId) return;
      if (frame.type === responseType) settle(() => resolve(payload));
      else if (frame.type === "rpc_error") {
        const error = typeof payload.error === "string" && payload.error.length > 0 ? payload.error : "RPC error";
        settle(() => reject(new Error(error)));
      }
    });
    const timer = setTimeout(() => settle(() => reject(new Error(timeoutMessage))), timeoutMs);
    try {
      port.send(JSON.stringify({ type: "session", message: { ...message, requestId } }));
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}

function requireWorkspaceId(workspaceId: unknown): asserts workspaceId is string {
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new TypeError("workspaceId must be a non-empty string");
  }
}

export function createSetupStatusFetcher(
  port: DaemonPort,
  options?: RequestOptions,
): (workspaceId: string) => Promise<SetupSnapshot | null> {
  return async (workspaceId: string): Promise<SetupSnapshot | null> => {
    requireWorkspaceId(workspaceId);
    const payload = await requestFromDaemon(
      port,
      { type: "workspace_setup_status_request", workspaceId },
      "workspace_setup_status_response",
      "Timed out waiting for workspace setup status",
      options,
    );
    return parseSnapshot(payload.snapshot);
  };
}

// Runs a blocked setup, as Paseo's own Setup panel does once you approve it.
export function createSetupRunner(
  port: DaemonPort,
  options?: RequestOptions,
): (workspaceId: string) => Promise<{ started: boolean; error: string | null }> {
  return async (workspaceId: string) => {
    requireWorkspaceId(workspaceId);
    const payload = await requestFromDaemon(
      port,
      { type: "workspace.setup.run.request", workspaceId },
      "workspace.setup.run.response",
      "Timed out waiting for setup to start",
      options,
    );
    return {
      started: payload.started === true,
      error: typeof payload.error === "string" && payload.error.length > 0 ? payload.error : null,
    };
  };
}

/**
 * When each worktree's setup started. The server keeps it, so every window and
 * every reload shows the same clock. Paseo's snapshot has no start time, so the
 * clock starts the first time the server sees setup running; if that's partway
 * through (the plugin restarted), the finished steps count as time already run.
 */
export function createSetupClock(): {
  observe(workspaceId: string, snapshot: SetupSnapshot | null, nowMs: number): void;
  runningForMs(workspaceId: string, nowMs: number): number | null;
} {
  const startedAt = new Map<string, number>();
  return {
    observe(workspaceId, snapshot, nowMs) {
      if (snapshot?.status !== "running") startedAt.delete(workspaceId);
      else if (!startedAt.has(workspaceId)) {
        startedAt.set(workspaceId, nowMs - completedDurationMs(snapshot.detail.commands));
      }
    },
    runningForMs(workspaceId, nowMs) {
      const start = startedAt.get(workspaceId);
      return start === undefined ? null : Math.max(0, nowMs - start);
    },
  };
}

export function createSetupProgressCache(
  port: DaemonPort,
  onSnapshot?: (workspaceId: string, snapshot: SetupSnapshot) => void,
): {
  get(workspaceId: string): SetupSnapshot | null | undefined;
  set(workspaceId: string, snapshot: SetupSnapshot | null): void;
  stop(): void;
} {
  const cache = new Map<string, SetupSnapshot | null>();
  const stop = port.onMessage((raw) => {
    const frame = parsePaseoFrame(raw);
    if (frame?.type !== "workspace_setup_progress") return;
    if (!frame.payload || typeof frame.payload !== "object") return;
    const payload = frame.payload as {
      workspaceId?: unknown;
      status?: unknown;
      detail?: unknown;
      error?: unknown;
      blockedSource?: unknown;
    };
    if (typeof payload.workspaceId !== "string" || payload.workspaceId.length === 0) return;
    const snapshot = parseSnapshot({
      status: payload.status,
      detail: payload.detail,
      error: payload.error ?? null,
      blockedSource: payload.blockedSource,
    });
    if (!snapshot) return;
    cache.set(payload.workspaceId, snapshot);
    onSnapshot?.(payload.workspaceId, snapshot);
  });
  return {
    get(workspaceId: string) {
      return cache.get(workspaceId);
    },
    set(workspaceId: string, snapshot: SetupSnapshot | null) {
      cache.set(workspaceId, snapshot);
    },
    stop,
  };
}

export async function readFreshSetupStatus(
  fetchStatus: (workspaceId: string) => Promise<SetupSnapshot | null>,
  cache: {
    get(workspaceId: string): SetupSnapshot | null | undefined;
    set(workspaceId: string, snapshot: SetupSnapshot | null): void;
  },
  workspaceId: string,
): Promise<SetupSnapshot | null> {
  try {
    const snapshot = await fetchStatus(workspaceId);
    cache.set(workspaceId, snapshot);
    return snapshot;
  } catch (error) {
    const cached = cache.get(workspaceId);
    if (cached !== undefined) return cached;
    throw error;
  }
}

const runtimePort = defaultPort;
const runtimeClock = createSetupClock();
const runtimeCache = createSetupProgressCache(runtimePort, (workspaceId, snapshot) =>
  runtimeClock.observe(workspaceId, snapshot, Date.now()),
);
const runtimeFetch = createSetupStatusFetcher(runtimePort);
const runtimeRun = createSetupRunner(runtimePort);

export async function handleRunSetup(input: { workspaceId: string }): Promise<{ started: boolean; error: string | null }> {
  try {
    return await runtimeRun(input.workspaceId);
  } catch (error) {
    return { started: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function readSetupStatus(workspaceId: string): Promise<SetupSnapshot | null> {
  return readFreshSetupStatus(runtimeFetch, runtimeCache, workspaceId);
}

export async function handleGetSetupStatus(input: { workspaceId: string }): Promise<{
  snapshot: SetupSnapshot | null;
  error: string | null;
  runningForMs: number | null;
}> {
  if (typeof process.send !== "function") {
    return { snapshot: null, error: "Plugin process has no daemon channel", runningForMs: null };
  }
  try {
    const snapshot = await readSetupStatus(input.workspaceId);
    const now = Date.now();
    runtimeClock.observe(input.workspaceId, snapshot, now);
    return { snapshot, error: null, runningForMs: runtimeClock.runningForMs(input.workspaceId, now) };
  } catch (error) {
    return {
      snapshot: null,
      error: error instanceof Error ? error.message : String(error),
      runningForMs: null,
    };
  }
}

export function stopSetupProgressWatch(): void {
  runtimeCache.stop();
}
