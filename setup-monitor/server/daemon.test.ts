import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSetupClock,
  createSetupRunner,
  createSetupProgressCache,
  createSetupStatusFetcher,
  parsePaseoFrame,
  readFreshSetupStatus,
  type DaemonPort,
} from "./daemon.ts";
import type { SetupSnapshot } from "../shared/setup.ts";

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

function setupAt(status: SetupSnapshot["status"], durations: (number | undefined)[]): SetupSnapshot {
  return {
    status,
    error: null,
    detail: {
      type: "worktree_setup",
      worktreePath: "/repo",
      branchName: "feat",
      log: "",
      commands: durations.map((durationMs, i) => ({
        index: i + 1,
        command: `step ${i + 1}`,
        cwd: "/repo",
        log: "",
        status: durationMs === undefined ? "running" : "completed",
        exitCode: durationMs === undefined ? null : 0,
        ...(durationMs === undefined ? {} : { durationMs }),
      })),
    },
  };
}

test("the setup clock keeps counting from when the server first saw setup run", () => {
  const clock = createSetupClock();
  clock.observe("wks_1", setupAt("running", [undefined]), 1_000);
  clock.observe("wks_1", setupAt("running", [5_000, undefined]), 7_000);
  assert.equal(clock.runningForMs("wks_1", 31_000), 30_000, "a later look doesn't restart it");
  clock.observe("wks_1", setupAt("completed", [5_000, 20_000]), 32_000);
  assert.equal(clock.runningForMs("wks_1", 33_000), null, "finished setup has no running clock");
  clock.observe("wks_1", setupAt("running", [undefined]), 40_000);
  assert.equal(clock.runningForMs("wks_1", 41_000), 1_000, "a rerun starts a new clock");
});

test("a setup first seen partway through counts its finished steps as time already run", () => {
  const clock = createSetupClock();
  clock.observe("wks_2", setupAt("running", [11_000, 5_000, undefined]), 100_000);
  assert.equal(clock.runningForMs("wks_2", 100_000), 16_000);
  assert.equal(clock.runningForMs("unknown", 100_000), null);
});

test("progress events start the setup clock", () => {
  const port = new FakePort();
  const seen: string[] = [];
  const cache = createSetupProgressCache(port, (workspaceId, snapshot) => seen.push(`${workspaceId}:${snapshot.status}`));
  port.emitSession("workspace_setup_progress", { workspaceId: "wks_3", ...setupAt("running", [undefined]) });
  assert.deepEqual(seen, ["wks_3:running"]);
  cache.stop();
});

test("a blocked setup comes through, with where its pull request is from", async () => {
  const port = new FakePort();
  const fetchStatus = createSetupStatusFetcher(port, { timeoutMs: 200, createRequestId: () => "req-b" });
  const pending = fetchStatus("wks_b");
  port.emitSession("workspace_setup_status_response", {
    requestId: "req-b",
    workspaceId: "wks_b",
    snapshot: {
      ...setupAt("blocked", []),
      blockedSource: { kind: "change_request", forge: "github", number: 42, headRepository: "acme-contrib/billing-api" },
    },
  });
  const snapshot = await pending;
  assert.equal(snapshot?.status, "blocked");
  assert.equal(snapshot?.blockedSource?.headRepository, "acme-contrib/billing-api");
});

test("a blocked setup reported the old way, as a failure, still reads as blocked", async () => {
  const port = new FakePort();
  const fetchStatus = createSetupStatusFetcher(port, { timeoutMs: 200, createRequestId: () => "req-old" });
  const pending = fetchStatus("wks_old");
  port.emitSession("workspace_setup_status_response", {
    requestId: "req-old",
    workspaceId: "wks_old",
    snapshot: {
      ...setupAt("failed", []),
      error: "Workspace setup is blocked pending approval of code from a fork pull request. Update Paseo to review and run setup.",
    },
  });
  const snapshot = await pending;
  assert.equal(snapshot?.status, "blocked");
  assert.equal(snapshot?.error, null);
});

test("Run setup asks the daemon to run the workspace's setup", async () => {
  const port = new FakePort();
  const run = createSetupRunner(port, { timeoutMs: 200, createRequestId: () => "req-run" });
  const pending = run("wks_r");
  const outbound = JSON.parse(port.sent[0] ?? "{}") as { type?: string; message?: { type?: string; workspaceId?: string; requestId?: string } };
  assert.deepEqual(outbound, { type: "session", message: { type: "workspace.setup.run.request", workspaceId: "wks_r", requestId: "req-run" } });
  port.emitSession("workspace.setup.run.response", { requestId: "req-run", workspaceId: "wks_r", started: true, error: null });
  assert.deepEqual(await pending, { started: true, error: null });
});
