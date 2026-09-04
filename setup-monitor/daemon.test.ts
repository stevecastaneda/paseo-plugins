import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSetupProgressCache,
  createSetupStatusFetcher,
  parsePaseoFrame,
  readFreshSetupStatus,
  type DaemonPort,
} from "./daemon.server.ts";
import type { SetupSnapshot } from "./setup.shared.ts";

class FakePort implements DaemonPort {
  sent: string[] = [];
  private readonly listeners = new Set<(message: unknown) => void>();

  send(frame: string): void {
    this.sent.push(frame);
  }

  onMessage(handler: (message: unknown) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  emit(message: unknown): void {
    for (const listener of this.listeners) listener(message);
  }

  emitSession(type: string, payload: unknown): void {
    this.emit({
      type: "paseo_frame",
      isBinary: false,
      data: JSON.stringify({ type: "session", message: { type, payload } }),
    });
  }
}

function frame(type: string, payload: unknown) {
  return {
    type: "paseo_frame",
    isBinary: false,
    data: JSON.stringify({ type: "session", message: { type, payload } }),
  };
}

test("parsePaseoFrame unwraps session and bare messages", () => {
  assert.equal(parsePaseoFrame(null), null);
  assert.deepEqual(
    parsePaseoFrame(frame("workspace_setup_status_response", { requestId: "r1" })),
    { type: "workspace_setup_status_response", payload: { requestId: "r1" } },
  );
  assert.deepEqual(
    parsePaseoFrame({
      type: "paseo_frame",
      isBinary: false,
      data: JSON.stringify({ type: "workspace_setup_progress", payload: { workspaceId: "w1" } }),
    }),
    { type: "workspace_setup_progress", payload: { workspaceId: "w1" } },
  );
});

test("fetcher resolves a snapshot from the matching request id", async () => {
  const port = new FakePort();
  const fetchStatus = createSetupStatusFetcher(port, {
    timeoutMs: 200,
    createRequestId: () => "req-1",
  });
  const pending = fetchStatus("wks_1");
  assert.equal(port.sent.length, 1);
  const outbound = JSON.parse(port.sent[0] ?? "{}") as {
    message?: { type?: string; workspaceId?: string; requestId?: string };
  };
  assert.equal(outbound.message?.type, "workspace_setup_status_request");
  assert.equal(outbound.message?.workspaceId, "wks_1");
  assert.equal(outbound.message?.requestId, "req-1");

  port.emitSession("workspace_setup_status_response", {
    requestId: "req-1",
    workspaceId: "wks_1",
    snapshot: {
      status: "running",
      error: null,
      detail: {
        type: "worktree_setup",
        worktreePath: "/repo",
        branchName: "feat",
        log: "Installing dependencies...",
        commands: [
          {
            index: 1,
            command: "npm ci",
            cwd: "/repo",
            log: "Installing dependencies...",
            status: "running",
            exitCode: null,
          },
        ],
      },
    },
  });

  const snapshot = await pending;
  assert.equal(snapshot?.status, "running");
  assert.equal(snapshot?.detail.commands[0]?.command, "npm ci");
});

test("fetcher ignores other request ids and times out", async () => {
  const port = new FakePort();
  const fetchStatus = createSetupStatusFetcher(port, {
    timeoutMs: 30,
    createRequestId: () => "req-timeout",
  });
  const pending = fetchStatus("wks_2");
  port.emitSession("workspace_setup_status_response", {
    requestId: "someone-else",
    workspaceId: "wks_2",
    snapshot: null,
  });
  await assert.rejects(pending, /Timed out waiting for workspace setup status/);
});

function runningSnapshot(log: string): SetupSnapshot {
  return {
    status: "running",
    error: null,
    detail: {
      type: "worktree_setup",
      worktreePath: "/repo",
      branchName: "feat",
      log,
      commands: [
        {
          index: 1,
          command: "./scripts/worktree-setup.sh",
          cwd: "/repo",
          log,
          status: "running",
          exitCode: null,
        },
      ],
    },
  };
}

test("readFreshSetupStatus refetches instead of returning the first snapshot", async () => {
  const logs = ["Syncing with origin...", "Installing dependencies..."];
  let calls = 0;
  const cache = new Map<string, SetupSnapshot | null>();
  const snapshot = await readFreshSetupStatus(
    async () => runningSnapshot(logs[calls++] ?? ""),
    {
      get: (id) => cache.get(id),
      set: (id, value) => {
        cache.set(id, value);
      },
    },
    "wks_1",
  );
  const again = await readFreshSetupStatus(
    async () => runningSnapshot(logs[calls++] ?? ""),
    {
      get: (id) => cache.get(id),
      set: (id, value) => {
        cache.set(id, value);
      },
    },
    "wks_1",
  );
  assert.equal(snapshot?.detail.log, "Syncing with origin...");
  assert.equal(again?.detail.log, "Installing dependencies...");
  assert.equal(calls, 2);
});

test("readFreshSetupStatus falls back to cache when a refetch fails", async () => {
  const cache = new Map<string, SetupSnapshot | null>([["wks_1", runningSnapshot("cached log")]]);
  const snapshot = await readFreshSetupStatus(
    async () => {
      throw new Error("daemon busy");
    },
    {
      get: (id) => cache.get(id),
      set: (id, value) => {
        cache.set(id, value);
      },
    },
    "wks_1",
  );
  assert.equal(snapshot?.detail.log, "cached log");
});

test("progress cache stores the latest snapshot per workspace", () => {
  const port = new FakePort();
  const cache = createSetupProgressCache(port);
  assert.equal(cache.get("wks_1"), undefined);
  port.emitSession("workspace_setup_progress", {
    workspaceId: "wks_1",
    status: "failed",
    error: "npm ERR!",
    detail: {
      type: "worktree_setup",
      worktreePath: "/repo",
      branchName: "feat",
      log: "npm ERR!",
      commands: [
        {
          index: 1,
          command: "npm ci",
          cwd: "/repo",
          log: "npm ERR!",
          status: "failed",
          exitCode: 1,
        },
      ],
    },
  });
  assert.equal(cache.get("wks_1")?.status, "failed");
  assert.equal(cache.get("wks_1")?.error, "npm ERR!");
  cache.stop();
});
