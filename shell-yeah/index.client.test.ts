import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { clientHarness } from "../test-support/client-harness.mjs";
import type { Phase, RunRow } from "./shared/row.ts";

const directory = fileURLToPath(new URL(".", import.meta.url));
const T0 = 1_700_000_000_000;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function row(phase: Phase): RunRow {
  return { runId: "run000000001", rev: 1, origin: "claude", command: "npm test", cwd: "/w", phase, output: { lines: ["a", [["b", "1;31"]]], total: 2 }, sentAt: null };
}

const agent = { id: "agent-1", cwd: "/w/proj" };

test("registers /sh for agents, the run v1 renderer, and the Command output attachment source", () => {
  const h = clientHarness(directory);
  const stop = h.load("index.client.tsx").default(h.client);
  const [sh] = h.slashCommands;
  assert.deepEqual(plain([sh.name, sh.context, sh.argumentHint]), ["sh", "agent", "<command>"]);
  assert.match(sh.description, /The agent sees the output only if you send it/);
  const [renderer] = h.timelineRenderers;
  assert.deepEqual(plain([renderer.kind, renderer.version]), ["run", 1]);
  assert.equal(typeof renderer.Component, "function");
  const [source] = h.attachmentSources;
  assert.deepEqual(plain([source.id, source.title, source.search.name]), ["command-output", "Command output", "shell-yeah.attach.search"]);
  stop();
  assert.ok([...h.slashCommands, ...h.timelineRenderers, ...h.attachmentSources].every((entry) => entry.removed));
});

test("the renderer's schema accepts a row in every phase and rejects garbage", () => {
  const h = clientHarness(directory);
  h.load("index.client.tsx").default(h.client);
  const { schema } = h.timelineRenderers[0];
  const phases: Phase[] = [
    { kind: "proposed" },
    { kind: "running", startedAt: T0, stopRequestedAt: null },
    { kind: "running", startedAt: T0, stopRequestedAt: T0 + 5 },
    { kind: "ok", startedAt: T0, endedAt: T0 + 1 },
    { kind: "failed", startedAt: T0, endedAt: T0 + 1, exitCode: 1, signal: null, message: null },
    { kind: "failed", startedAt: T0, endedAt: T0 + 1, exitCode: null, signal: "SIGKILL", message: null },
    { kind: "failed", startedAt: T0, endedAt: T0, exitCode: null, signal: null, message: "Folder not found: /x" },
    { kind: "stopped", startedAt: T0, endedAt: T0 + 1, exitCode: 130, signal: null },
    { kind: "interrupted", startedAt: T0, endedAt: T0 + 1 },
    { kind: "dismissed" },
  ];
  for (const phase of phases) assert.equal(schema.safeParse(plain(row(phase))).success, true, phase.kind);
  assert.equal(schema.safeParse({ runId: "x", phase: { kind: "flying" } }).success, false);
  assert.equal(schema.safeParse(plain({ ...row({ kind: "proposed" }), output: { lines: [["bad"]], total: 0 } })).success, false, "a segment needs text and sgr");
});

test("/sh with a command starts it in the agent's folder as the user; a pasted prompt is stripped", async () => {
  const h = clientHarness(directory);
  h.load("index.client.tsx").default(h.client);
  h.responses["shell-yeah.start"] = { runId: "abcdef123456" };
  const { onSubmit } = h.slashCommands[0];
  await onSubmit({ args: "npm test", agent, rpc: h.client.rpc });
  await onSubmit({ args: "! git status", agent, rpc: h.client.rpc });
  await onSubmit({ args: "$ ls -la", agent, rpc: h.client.rpc });
  assert.deepEqual(plain(h.requests), [
    { name: "shell-yeah.start", input: { agentId: "agent-1", cwd: "/w/proj", command: "npm test", origin: "user" } },
    { name: "shell-yeah.start", input: { agentId: "agent-1", cwd: "/w/proj", command: "git status", origin: "user" } },
    { name: "shell-yeah.start", input: { agentId: "agent-1", cwd: "/w/proj", command: "ls -la", origin: "user" } },
  ]);
});

test("/sh alone rescans Claude's latest reply", async () => {
  const h = clientHarness(directory);
  h.load("index.client.tsx").default(h.client);
  h.responses["shell-yeah.scan"] = { found: 1 };
  await h.slashCommands[0].onSubmit({ args: "", agent, rpc: h.client.rpc });
  assert.deepEqual(plain(h.requests), [{ name: "shell-yeah.scan", input: { agentId: "agent-1" } }]);
  h.responses["shell-yeah.scan"] = Promise.reject(new Error("The last reply has no commands to run. Type /sh and a command to run one."));
  await assert.rejects(h.slashCommands[0].onSubmit({ args: "  ", agent, rpc: h.client.rpc }), /has no commands/);
});

test("a failure to start names the command, since the composer already cleared it", async () => {
  const h = clientHarness(directory);
  h.load("index.client.tsx").default(h.client);
  h.responses["shell-yeah.start"] = Promise.reject(new Error("Folder not found: /w/proj"));
  const long = "x".repeat(80);
  await assert.rejects(h.slashCommands[0].onSubmit({ args: long, agent, rpc: h.client.rpc }), (error: Error) => {
    assert.equal(error.message, `Couldn't run "${"x".repeat(47)}…": Folder not found: /w/proj`);
    return true;
  });
});

test("every chat gets one Run pill that opens the Run window; updates keep it, so an open window stays open", async () => {
  const h = clientHarness(directory);
  const stop = h.load("index.client.tsx").default(h.client);
  h.agents.bootstrap([{ agent: { id: "a1", workspaceId: "w1" } }, { agent: { id: "a2", workspaceId: "w1" } }, { agent: { id: "a3", workspaceId: null } }]);
  await h.flush();
  type Pill = { removed: boolean; placement: string; agentId: string; workspaceId: string; button: { label: string; behavior: { kind: string } } };
  const pills = () => (h.registrations as unknown as Pill[]).filter((entry) => !entry.removed);
  assert.deepEqual(plain(pills().map((entry) => [entry.placement, entry.agentId, entry.workspaceId, entry.button.label, entry.button.behavior.kind])), [["composer", "a1", "w1", "Run", "popover"], ["composer", "a2", "w1", "Run", "popover"]]);
  h.agents.update({ kind: "upsert", agent: { id: "a1", workspaceId: "w1", status: "running" } });
  assert.equal(h.registrations.length, 2, "an update doesn't replace the pill");
  h.agents.update({ kind: "upsert", agent: { id: "a4", workspaceId: "w2" } });
  h.agents.update({ kind: "remove", agentId: "a2" });
  assert.deepEqual(pills().map((entry) => entry.agentId), ["a1", "a4"]);
  stop();
  assert.equal(pills().length, 0);
  assert.equal(h.agents.listenerCount, 0);
});
