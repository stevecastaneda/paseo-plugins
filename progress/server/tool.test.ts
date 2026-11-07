// The Progress tools Paseo 0.14 hands to agents: each runs the paseo-progress
// command, so it records and answers exactly what the command would.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import type { AgentToolContext, PluginServerContext, PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import { readProgress } from "./progress-file.ts";
import { outsideDirectory } from "./store.ts";
import { agentToolsSupported, attachProgressTools, progressTools, toolsState } from "./tool.ts";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
const HOME = await realpath(await mkdtemp(join(tmpdir(), "progress-home-")));
process.env.HOME = HOME;
test.after(() => rm(HOME, { recursive: true, force: true }));

async function worktree(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "progress-tools-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await promisify(execFile)("git", ["init", "-q"], { cwd: directory });
  const context = (cwd: string) => ({
    agent: { id: "agent-7", workspaceId: "w", parentAgentId: null, provider: "claude", cwd, title: null },
    paseo: {} as AgentToolContext["paseo"],
    signal: new AbortController().signal,
  });
  return {
    directory,
    async call(name: string, input: unknown, cwd = directory) {
      const tool = progressTools.find((candidate) => candidate.name === name);
      assert.ok(tool, `${name} is attached`);
      const parsed = tool.input.parse(input);
      return tool.execute(parsed, context(cwd));
    },
    async dashboard() {
      return (await readProgress(outsideDirectory(directory), new Date())).dashboard;
    },
  };
}

test("each Progress tool records what its command would, under the calling agent", async (t) => {
  const w = await worktree(t);
  assert.equal((await w.call("progress_start", { title: "Export", subtitle: "CSV and PDF", itemLabel: "Step" })).isError, false);
  assert.match((await w.call("progress_ticket_add", { title: "Step 01: Button", estimateMinutes: 30 })).text!, /^Added T01: Step 01: Button \(30m\)/);
  await w.call("progress_ticket_add", {
    title: "Step 02: File",
    estimateMinutes: 90,
    status: "not_started",
    waitsFor: "t01",
    source: "https://example.com/issues/4",
  });
  await mkdir(join(w.directory, "shots"));
  await writeFile(join(w.directory, "shots", "after.png"), "png");
  const update = await w.call("progress_ticket_update", { id: "T01", status: "working", stage: "Build", note: "--dry-run first" }, join(w.directory, "shots"));
  assert.equal(update.isError, false, update.text);

  let dashboard = await w.dashboard();
  assert.deepEqual(dashboard.run && { title: dashboard.run.title, subtitle: dashboard.run.subtitle, itemLabel: dashboard.run.itemLabel }, {
    title: "Export",
    subtitle: "CSV and PDF",
    itemLabel: "Step",
  });
  const [first, second] = dashboard.tickets;
  assert.deepEqual(
    { status: first.status, stage: first.stage, note: first.note, agentId: first.agentId },
    { status: "working", stage: "Build", note: "--dry-run first", agentId: "agent-7" },
    "a value starting with dashes stays a value",
  );
  assert.deepEqual(
    { estimateMin: second.estimateMin, waitsFor: second.waitsFor, source: second.source },
    { estimateMin: 90, waitsFor: "T01", source: { url: "https://example.com/issues/4" } },
  );

  // Relative paths resolve against the agent's folder, like the command run there.
  const asked = await w.call(
    "progress_question_ask",
    {
      title: "Button color",
      question: "Which color should the export button be?",
      options: [
        { letter: "A", label: "Blue", consequence: "Matches the toolbar" },
        { letter: "b", label: "Green", consequence: "Stands out" },
      ],
      recommend: "A",
      files: [{ target: "after.png", label: "Current button" }],
      ticket: "T01",
    },
    join(w.directory, "shots"),
  );
  assert.match(asked.text!, /^Asked Q1 \(Button color\)\. You recommend A\. Mode: Work around\./);
  assert.match(
    (await w.call("progress_question_answer", { id: "q1", choice: "b", words: "green please" })).text!,
    /^Answered Q1: B \(not your recommendation, A\)/,
  );
  await w.call("progress_deliverable_add", { title: "Screenshot", target: "after.png", ticket: "T01", kind: "report" }, join(w.directory, "shots"));
  assert.match((await w.call("progress_activity_add", { text: "Button built", ticket: "T01" })).text!, /^Logged A1 on T01: Button built/);
  await w.call("progress_ticker", { text: "Exporting a sample" });
  assert.deepEqual((await w.dashboard()).ticker?.by, "agent-7");

  dashboard = await w.dashboard();
  const [answered] = dashboard.questions.answered;
  assert.deepEqual(
    answered.options.map((option) => [option.letter, option.label, option.consequence]),
    [
      ["A", "Blue", "Matches the toolbar"],
      ["B", "Green", "Stands out"],
    ],
  );
  assert.deepEqual(
    { files: answered.files, ticketId: answered.ticketId, answer: answered.answer?.choice, words: answered.answer?.words },
    { files: [{ path: "shots/after.png", label: "Current button" }], ticketId: "T01", answer: "B", words: "green please" },
  );
  assert.deepEqual(
    dashboard.deliverables.map(({ title, path, kind, ticketId }) => ({ title, path, kind, ticketId })),
    [{ title: "Screenshot", path: "shots/after.png", kind: "report", ticketId: "T01" }],
  );
  assert.deepEqual(
    dashboard.activity.map(({ text, ticketId }) => ({ text, ticketId })),
    [{ text: "Button built", ticketId: "T01" }],
  );

  assert.equal((await w.call("progress_ticker", { text: " " })).text, "Ticker cleared", "an empty ticker hides it");
  assert.equal((await w.dashboard()).ticker, null);
  assert.match((await w.call("progress_show", {})).text!, /Export/);

  const early = await w.call("progress_finish", { outcome: "Shipped" });
  assert.equal(early.isError, true);
  assert.match(early.text!, /^Can't finish yet\. Still open: steps not done or skipped: T01, T02\./);
  await w.call("progress_ticket_update", { id: "T01", status: "done" });
  await w.call("progress_ticket_update", { id: "T02", status: "skipped" });
  assert.equal((await w.call("progress_finish", { outcome: "Shipped" })).text, "Finished run: Export");
  assert.equal((await w.dashboard()).run?.finished?.outcome, "Shipped");
});

test("a bad input comes back as an error with the command's message, and records nothing", async (t) => {
  const w = await worktree(t);
  await w.call("progress_start", { title: "Export" });
  const before = await w.dashboard();

  const unknown = await w.call("progress_ticket_update", { id: "T09", status: "done" });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text!, /^No ticket T09 in this run\. Tickets: none\.\nUsage: paseo-progress ticket update/);
  const zero = await w.call("progress_ticket_add", { title: "Ticket 01: Button", estimateMinutes: 0 });
  assert.equal(zero.isError, true);
  assert.match(zero.text!, /^--estimate must be a whole number of minutes, like 90\./);
  const letter = await w.call("progress_question_ask", {
    title: "Color",
    question: "Which?",
    options: [{ letter: "A", label: "Blue", consequence: "" }],
    recommend: "C",
  });
  assert.equal(letter.isError, true);
  assert.match(letter.text!, /^--recommend must be one of the option letters: A\./);
  assert.deepEqual(await w.dashboard(), before);

  const status = progressTools.find((tool) => tool.name === "progress_ticket_update")!.input.safeParse({ id: "T01", status: "in_progress" });
  assert.equal(status.success, false, "Paseo turns away a status the command doesn't know before it runs");
  const kind = progressTools.find((tool) => tool.name === "progress_deliverable_add")!.input.safeParse({ title: "x", target: "x", kind: "image" });
  assert.equal(kind.success, false);
});

test("the catch-all tool takes the command's own arguments", async (t) => {
  const w = await worktree(t);
  await w.call("paseo_progress", { args: ["start", "Export"] });
  assert.match((await w.call("paseo_progress", { args: ["stuck", "set", "Staging is down"] })).text!, /^Flagged S1: Staging is down/);
  const help = await w.call("paseo_progress", { args: ["--help"] });
  assert.equal(help.isError, false);
  assert.match(help.text!, /^Usage: paseo-progress <command>/);
});

function sessionOpen(server: { hook?: (input: { request: PluginSessionOpenRequest }) => unknown }, request: Partial<PluginSessionOpenRequest>) {
  attachProgressTools({
    before: (_name: string, hook: typeof server.hook) => {
      server.hook = hook;
      return () => {};
    },
  } as unknown as PluginServerContext);
  return server.hook!({
    request: {
      agentId: "a",
      workspaceId: "w",
      provider: "claude",
      cwd: "/w",
      reason: "create",
      purpose: "interactive",
      title: null,
      labels: {},
      env: {},
      mcpServers: {},
      ...request,
    } as PluginSessionOpenRequest,
  });
}

test("on Paseo 0.14 every agent gets the Progress tools; on 0.13, which has no tools list, the session opens unchanged", () => {
  const added = sessionOpen(
    {},
    { tools: [{ name: "other", description: "", input: progressTools[0].input, execute: () => ({}) }] },
  ) as PluginSessionOpenRequest;
  assert.deepEqual(
    added.tools.map((tool) => tool.name),
    [
      "other",
      "progress_show",
      "progress_start",
      "progress_ticket_add",
      "progress_ticket_update",
      "progress_question_ask",
      "progress_question_answer",
      "progress_deliverable_add",
      "progress_activity_add",
      "progress_ticker",
      "progress_finish",
      "paseo_progress",
    ],
  );
  assert.equal(added.env && Object.keys(added.env).length, 0, "nothing else changes");
  assert.equal(sessionOpen({}, { tools: undefined }), undefined);
});

test("tools describe themselves with the command's help text", () => {
  const ask = progressTools.find((tool) => tool.name === "progress_question_ask")!;
  assert.match(ask.description, /A question is big when one of these holds, and only then/);
  assert.match(progressTools.find((tool) => tool.name === "progress_ticket_update")!.description, /Statuses: not_started, working, blocked, done, skipped\./);
});

test("the panel learns whether agents get the tools: Paseo 0.13, or the host's Enable Paseo tools setting", async () => {
  const paseo = (mcp: { enabled?: boolean; injectIntoAgents: boolean }) => ({ config: { get: async () => ({ requestId: "r", config: { mcp } }) } }) as never;
  assert.equal(agentToolsSupported, true, "this SDK is Paseo 0.14's");
  assert.equal(await toolsState(false, { config: { get: () => assert.fail("0.13 has no setting to read") } } as never), "unsupported");
  assert.equal(await toolsState(true, paseo({ injectIntoAgents: true })), "on");
  assert.equal(await toolsState(true, paseo({ enabled: true, injectIntoAgents: false })), "off");
  assert.equal(await toolsState(true, paseo({ enabled: false, injectIntoAgents: true })), "off", "Paseo's tools themselves are off");
});
