import { randomUUID } from "node:crypto";
import type { SetupSnapshot } from "./setup.shared.ts";
import { setupSnapshotSchema } from "./setup.shared.ts";
import { trimSnapshot } from "./snapshot.ts";

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

function parseSnapshot(value: unknown): SetupSnapshot | null {
  const parsed = setupSnapshotSchema.safeParse(value);
  return parsed.success ? trimSnapshot(parsed.data) : null;
}

export function createSetupStatusFetcher(
  port: DaemonPort,
  options?: { timeoutMs?: number; createRequestId?: () => string },
): (workspaceId: string) => Promise<SetupSnapshot | null> {
  const timeoutMs = options?.timeoutMs ?? 8_000;
  const createRequestId = options?.createRequestId ?? (() => `setup-monitor-${randomUUID()}`);

  return (workspaceId: string): Promise<SetupSnapshot | null> => {
    if (typeof workspaceId !== "string" || workspaceId.length === 0) {
      throw new TypeError("workspaceId must be a non-empty string");
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe: (() => void) | undefined;

      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {
            // Listener already gone.
          }
          unsubscribe = undefined;
        }
      };

      const settleOk = (snapshot: SetupSnapshot | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(snapshot);
      };

      const settleErr = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const requestId = createRequestId();
      unsubscribe = port.onMessage((raw) => {
        const frame = parsePaseoFrame(raw);
        if (!frame || !frame.payload || typeof frame.payload !== "object") return;
        const payload = frame.payload as { requestId?: unknown; snapshot?: unknown; error?: unknown };
        if (payload.requestId !== requestId) return;
        if (frame.type === "workspace_setup_status_response") {
          settleOk(parseSnapshot(payload.snapshot));
          return;
        }
        if (frame.type === "rpc_error") {
          const message =
            typeof payload.error === "string" && payload.error.length > 0
              ? payload.error
              : "RPC error";
          settleErr(new Error(message));
        }
      });

      timer = setTimeout(() => {
        settleErr(new Error("Timed out waiting for workspace setup status"));
      }, timeoutMs);

      const outbound = JSON.stringify({
        type: "session",
        message: {
          type: "workspace_setup_status_request",
          workspaceId,
          requestId,
        },
      });

      try {
        port.send(outbound);
      } catch (error) {
        settleErr(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
}

export function createSetupProgressCache(port: DaemonPort): {
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
    };
    if (typeof payload.workspaceId !== "string" || payload.workspaceId.length === 0) return;
    const snapshot = parseSnapshot({
      status: payload.status,
      detail: payload.detail,
      error: payload.error ?? null,
    });
    if (snapshot) cache.set(payload.workspaceId, snapshot);
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
const runtimeCache = createSetupProgressCache(runtimePort);
const runtimeFetch = createSetupStatusFetcher(runtimePort);

export async function readSetupStatus(workspaceId: string): Promise<SetupSnapshot | null> {
  return readFreshSetupStatus(runtimeFetch, runtimeCache, workspaceId);
}

export async function handleGetSetupStatus(input: { workspaceId: string }): Promise<{
  snapshot: SetupSnapshot | null;
  error: string | null;
}> {
  if (typeof process.send !== "function") {
    return { snapshot: null, error: "Plugin process has no daemon channel" };
  }
  try {
    return { snapshot: await readSetupStatus(input.workspaceId), error: null };
  } catch (error) {
    return {
      snapshot: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function stopSetupProgressWatch(): void {
  runtimeCache.stop();
}
