// Several Paseo workspaces open on one folder: each gets its own dashboard,
// from the same progress file. Lines without a workspace are the folder's,
// as every line written before dashboards were per workspace is.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { AgentToolContext, PluginHandlerContext } from "@getpaseo/plugin/server";
import { parseProgress, reduceProgress } from "../shared/dashboard.ts";
import { parseWorkspaceId } from "../shared/workspace.ts";
import { runCli } from "./cli.ts";
import { handleGetAttention, handleGetDashboard, handleMarkPanelOpened, handleSetHistoryFolder } from "./dashboard.ts";
import { previewDeliverable } from "./open.ts";
import { panelDashboardAt } from "./paths.ts";
import { outsideDirectory } from "./store.ts";
import { progressTools } from "./tool.ts";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
const HOME = await realpath(await mkdtemp(join(tmpdir(), "progress-home-")));
process.env.HOME = HOME;
test.after(() => rm(HOME, { recursive: true, force: true }));
delete process.env.PASEO_WORKSPACE_ID;

const A = "wks_00000000000000aa";
const B = "wks_00000000000000bb";
// What a panel sends for a workspace ID Progress can't read: the folder's dashboard.
const FOLDER = "ws-1";
const context = { paseo: {} as PluginHandlerContext["paseo"] };
const T0 = Date.parse("2026-09-27T19:59:00.000Z");
const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));

async function folder(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "progress-workspaces-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await promisify(execFile)("git", ["init", "-q"], { cwd: directory });
  const file = join(outsideDirectory(directory), "progress.jsonl");
  const output: string[] = [];
  return {
    directory,
    file,
    // `workspace` null runs the command outside Paseo, which writes the lines
    // every earlier version wrote.
    async run(workspace: string | null, ...argv: string[]) {
      output.length = 0;
      const code = await runCli(argv, { cwd: directory, now: () => new Date(T0), out: (line) => output.push(line), workspace: parseWorkspaceId(workspace) });
      return { code, text: output.join("\n") };
    },
    async panel(workspaceId: string, since?: string) {
      return handleGetDashboard({ workspaceId, workspaceDirectory: directory, since }, context);
    },
    async dashboard(workspaceId: string) {
      const result = await handleGetDashboard({ workspaceId, workspaceDirectory: directory }, context);
      assert.ok("dashboard" in result);
      return result;
    },
    async title(workspaceId: string) {
      const result = await this.dashboard(workspaceId);
      return result.configured ? (result.dashboard.run?.title ?? null) : "no dashboard";
    },
    async ticket(workspaceId: string, id: string) {
      return (await this.dashboard(workspaceId)).dashboard.tickets.find((ticket) => ticket.id === id)?.status;
    },
    async lines(): Promise<Array<{ type: string; ws?: string; title?: string }>> {
      return (await readFile(file, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    },
  };
}

test("two workspaces on one folder each keep their own run, in one file", async (t) => {
  const f = await folder(t);
  assert.equal((await f.run(A, "start", "Run in A")).code, 0);
  assert.equal((await f.run(B, "start", "Run in B")).code, 0);
  assert.equal(await f.title(A), "Run in A");
  assert.equal(await f.title(B), "Run in B", "B's start doesn't replace A's run");
  assert.deepEqual(
    (await f.lines()).map((line) => [line.ws, line.title]),
    [
      [A, "Run in A"],
      [B, "Run in B"],
    ],
  );
  assert.deepEqual((await readdir(outsideDirectory(f.directory))).toSorted(), ["progress.jsonl"], "no folder per workspace");
});

test("a run from before the update shows in every workspace, and an open panel doesn't redraw", async (t) => {
  const f = await folder(t);
  await f.run(null, "start", "Old run");
  await f.run(null, "ticket", "add", "Ticket 01: Login", "--estimate", "30");
  // How 1.16.3 versioned the folder's dashboard for its panel.
  const text = await readFile(f.file, "utf8");
  const read = { configured: true, dashboard: reduceProgress(parseProgress(text), new Date()).dashboard, panelOpened: false };
  const shown = (await f.dashboard(A)).file;
  const before = createHash("sha1")
    .update(JSON.stringify(read) + JSON.stringify([false, shown, null, true, ""]))
    .digest("base64url");

  for (const workspace of [A, B, FOLDER]) {
    assert.equal(await f.title(workspace), "Old run");
    assert.deepEqual(await f.panel(workspace, before), { unchanged: true, version: before }, `${workspace} keeps the version its panel has`);
  }
  assert.equal((await f.run(A, "ticket", "update", "T01", "--status", "working")).code, 0, "and A carries the run on");
  assert.equal(await f.ticket(A, "T01"), "working");
});

test("a workspace that carries on the old run takes it along", async (t) => {
  const f = await folder(t);
  await f.run(null, "start", "Old run");
  await f.run(null, "ticket", "add", "Ticket 01: Login", "--estimate", "30");
  assert.equal((await f.run(A, "ticket", "update", "T01", "--status", "done")).code, 0);
  assert.equal(await f.ticket(A, "T01"), "done");
  assert.equal(await f.title(B), "no dashboard", "B no longer shows A's run");
  assert.equal(await f.ticket(FOLDER, "T01"), "not_started", "the folder's own run is as it was");
  const update = await f.run(B, "ticket", "update", "T01", "--status", "working");
  assert.equal(update.code, 0, "an agent in B that was on the run can still carry it on");
  assert.equal(await f.ticket(B, "T01"), "working");
  assert.equal(await f.ticket(A, "T01"), "done");
});

test("a workspace that starts fresh leaves an unfinished old run to the others", async (t) => {
  const f = await folder(t);
  await f.run(null, "start", "Old run");
  await f.run(null, "ticket", "add", "Ticket 01: Login", "--estimate", "30");
  await f.run(null, "ticket", "add", "Ticket 02: Logout", "--estimate", "30");
  assert.equal((await f.run(A, "start", "New in A")).code, 0);
  assert.equal(await f.title(A), "New in A");
  assert.equal(await f.title(B), "Old run", "its agent may still be waiting on an answer");
  const update = await f.run(B, "ticket", "update", "T02", "--status", "done");
  assert.equal(update.code, 0, update.text);
  assert.equal(await f.title(B), "Old run");
  assert.equal(await f.ticket(B, "T02"), "done");
  assert.equal(await f.title(A), "New in A");
});

test("a finished old run leaves the workspaces without lines once any workspace has its own", async (t) => {
  const f = await folder(t);
  await f.run(null, "start", "Old run");
  await f.run(null, "finish", "Shipped");
  assert.equal(await f.title(A), "Old run", "shown while no workspace has lines of its own");
  assert.equal(await f.title(B), "Old run");
  await f.run(A, "start", "New in A");
  assert.equal(await f.title(B), "no dashboard");
  assert.deepEqual(await handleGetAttention({ workspaceId: B, workspaceDirectory: f.directory }, context), {
    configured: false,
    questions: 0,
    stuck: 0,
    run: "closed",
    panelOpened: false,
  });
  assert.equal(await f.title(FOLDER), "Old run", "the folder's own dashboard still shows it");
});

test("ids count per workspace, and a change in one leaves the other's alone", async (t) => {
  const f = await folder(t);
  await f.run(A, "start", "Run in A");
  await f.run(B, "start", "Run in B");
  assert.match((await f.run(A, "ticket", "add", "Ticket 01: A", "--estimate", "30")).text, /^Added T01: Ticket 01: A/);
  assert.match((await f.run(B, "ticket", "add", "Ticket 01: B", "--estimate", "30")).text, /^Added T01: Ticket 01: B/);
  await f.run(A, "ticket", "update", "T01", "--status", "done");
  assert.equal(await f.ticket(A, "T01"), "done");
  assert.equal(await f.ticket(B, "T01"), "not_started");
});

test("a shell's update after a workspace carried the run on doesn't reach the workspace", async (t) => {
  const f = await folder(t);
  await f.run(null, "start", "Old run");
  await f.run(null, "ticket", "add", "Ticket 01: Login", "--estimate", "30");
  await f.run(A, "ticket", "update", "T01", "--status", "working");
  assert.equal((await f.run(null, "ticket", "update", "T01", "--status", "done")).code, 0);
  assert.equal(await f.ticket(A, "T01"), "working");
  assert.equal(await f.ticket(FOLDER, "T01"), "done");
});

test("ten first commands at once in one workspace get ten ids", async (t) => {
  const f = await folder(t);
  await f.run(null, "start", "Old run");
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      runCli(["ticket", "add", `Ticket ${index}`, "--estimate", "5"], { cwd: f.directory, out: () => {}, workspace: parseWorkspaceId(A) }),
    ),
  );
  assert.deepEqual(results, Array(10).fill(0));
  const ids = (await f.dashboard(A)).dashboard.tickets.map((ticket) => ticket.id).toSorted();
  assert.deepEqual(ids, ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10"]);
});

test("the tools and the command agree on a workspace's dashboard", async (t) => {
  const f = await folder(t);
  const tool = progressTools.find((candidate) => candidate.name === "progress_start")!;
  const agent = { id: "agent-7", workspaceId: A, parentAgentId: null, provider: "claude", cwd: f.directory, title: null, background: false, metadata: {} };
  const started = await tool.execute(tool.input.parse({ title: "From the tool" }), {
    agent,
    paseo: {} as AgentToolContext["paseo"],
    signal: new AbortController().signal,
  });
  assert.equal(started.isError, false, started.text);
  const show = async (env: NodeJS.ProcessEnv) =>
    (await promisify(execFile)(process.execPath, [CLI, "show"], { cwd: f.directory, env: { ...process.env, ...env } })).stdout;
  assert.match(await show({ PASEO_WORKSPACE_ID: A }), /From the tool/);
  assert.doesNotMatch(await show({ PASEO_WORKSPACE_ID: B }), /From the tool/);
});

test("a deliverable's reference resolves on the workspace's own dashboard", async (t) => {
  const f = await folder(t);
  await writeFile(join(f.directory, "a.md"), "# A");
  await writeFile(join(f.directory, "b.md"), "# B");
  await f.run(A, "start", "Run in A");
  await f.run(A, "deliverable", "add", "Notes", "a.md");
  await f.run(B, "start", "Run in B");
  await f.run(B, "deliverable", "add", "Notes", "b.md");
  const preview = (workspaceId: string) => previewDeliverable(panelDashboardAt({ workspaceId, workspaceDirectory: f.directory }), "D1");
  assert.deepEqual(await preview(A), { kind: "markdown", markdown: "# A", bytes: 3, truncated: false });
  assert.deepEqual(await preview(B), { kind: "markdown", markdown: "# B", bytes: 3, truncated: false });
});

test("each workspace's run saves to its own history file", async (t) => {
  const f = await folder(t);
  await handleSetHistoryFolder({ workspaceId: A, workspaceDirectory: f.directory, folder: "history" }, context);
  await f.run(A, "start", "Run in A");
  await f.run(B, "start", "Run in B");
  await f.run(A, "activity", "add", "Step in A");
  await f.run(B, "activity", "add", "Step in B");
  const history = join(f.directory, "history");
  const files = (await readdir(history)).toSorted();
  assert.deepEqual(files, ["20260927-195900-run-in-a.jsonl", "20260927-195900-run-in-b.jsonl"]);
  const saved = (await readFile(join(history, files[0]), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    saved.map((line) => [line.ws, line.type]),
    [
      [A, "run.start"],
      [A, "activity.add"],
    ],
  );
});

test("opening the panel in one workspace counts for the folder", async (t) => {
  const f = await folder(t);
  await f.run(A, "start", "Run in A");
  await f.run(B, "start", "Run in B");
  await handleMarkPanelOpened({ workspaceId: A, workspaceDirectory: f.directory }, context);
  assert.equal((await handleGetAttention({ workspaceId: B, workspaceDirectory: f.directory }, context)).panelOpened, true);
});
