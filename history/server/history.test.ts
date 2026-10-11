import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { handleReadHistory } from "./history.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "raw-history-handler-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// The daemon env points at an empty directory so a test only passes when the
// handler reads the directory it is meant to.
async function daemonEnv(t: { after(fn: () => Promise<void>): void }, name: "CLAUDE_CONFIG_DIR" | "CODEX_HOME") {
  const dir = await fixture(t);
  const previous = process.env[name];
  process.env[name] = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
  return dir;
}

function context(provider: string, providers: Record<string, unknown> = {}) {
  const agent = { provider, persistence: { sessionId: "session-123" } };
  const paseo = {
    agents: { ref: () => ({ refresh: async () => {}, current: () => agent }) },
    config: { get: async () => ({ requestId: "test", config: { providers } }) },
  };
  return { paseo } as unknown as PluginHandlerContext;
}

test("reads a derived Claude provider's log from the config dir in its env", async (t) => {
  await daemonEnv(t, "CLAUDE_CONFIG_DIR");
  const dir = await fixture(t);
  await mkdir(join(dir, "projects", "project"), { recursive: true });
  const path = join(dir, "projects", "project", "session-123.jsonl");
  await writeFile(path, "{}\n");
  const result = await handleReadHistory({ agentId: "agent", offset: 0 }, context("claude-my", {
    "claude-my": { extends: "claude", label: "Claude My", env: { CLAUDE_CONFIG_DIR: dir } },
  }));
  assert.equal(result.path, path);
  assert.equal(result.provider, "claude");
});

test("reads a derived Codex provider's log from the CODEX_HOME in its env", async (t) => {
  await daemonEnv(t, "CODEX_HOME");
  const dir = await fixture(t);
  await mkdir(join(dir, "sessions", "2026"), { recursive: true });
  const path = join(dir, "sessions", "2026", "rollout-2026-10-11-session-123.jsonl");
  await writeFile(path, "{}\n");
  const result = await handleReadHistory({ agentId: "agent", offset: 0 }, context("codex-full-access", {
    "codex-full-access": { extends: "codex", label: "Codex Full Access", env: { CODEX_HOME: dir } },
  }));
  assert.equal(result.path, path);
  assert.equal(result.provider, "codex");
});

test("a derived provider without its own config dir falls back to the daemon env", async (t) => {
  const dir = await daemonEnv(t, "CLAUDE_CONFIG_DIR");
  await mkdir(join(dir, "projects", "project"), { recursive: true });
  const path = join(dir, "projects", "project", "session-123.jsonl");
  await writeFile(path, "{}\n");
  const result = await handleReadHistory({ agentId: "agent", offset: 0 }, context("claude-work", {
    "claude-work": { extends: "claude", label: "Claude Work" },
  }));
  assert.equal(result.path, path);
});

test("the built-in Claude provider honours a config dir set on its own entry", async (t) => {
  await daemonEnv(t, "CLAUDE_CONFIG_DIR");
  const dir = await fixture(t);
  await mkdir(join(dir, "projects", "project"), { recursive: true });
  const path = join(dir, "projects", "project", "session-123.jsonl");
  await writeFile(path, "{}\n");
  const result = await handleReadHistory({ agentId: "agent", offset: 0 }, context("claude", {
    claude: { env: { CLAUDE_CONFIG_DIR: dir } },
  }));
  assert.equal(result.path, path);
});

test("still rejects providers that extend an unsupported harness", async () => {
  await assert.rejects(
    handleReadHistory({ agentId: "agent", offset: 0 }, context("my-copilot", {
      "my-copilot": { extends: "copilot", label: "My Copilot" },
    })),
    /Raw history is not supported for my-copilot yet/,
  );
});
