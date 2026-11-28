// A long job's own progress on its ticket: what it reports, how the file keeps
// it short, and where the panel and `show` count it.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import type { AgentToolContext } from "@getpaseo/plugin/server";
import { runCli } from "./cli.ts";
import { compactRepeated, outsideDirectory, readProgress } from "./progress-file.ts";
import { progressTools } from "./tool.ts";
import { formatEta } from "../shared/format.ts";
import { isProgressReport, type ProgressEvent } from "../shared/events.ts";
import { parseWorkspaceId } from "../shared/workspace.ts";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
const HOME = await realpath(await mkdtemp(join(tmpdir(), "progress-home-")));
// Windows takes the home folder from USERPROFILE.
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
test.after(() => rm(HOME, { recursive: true, force: true }));
delete process.env.PASEO_WORKSPACE_ID;

// Inside Paseo every event names its workspace, and two workspaces on one folder share the file.
const A = "wks_00000000000000aa";
const B = "wks_00000000000000bb";

const T0 = Date.parse("2026-09-27T19:59:00.000Z");
const minutes = (count: number) => new Date(T0 + count * 60_000);

async function folder(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "progress-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await promisify(execFile)("git", ["init", "-q"], { cwd: directory });
  return directory;
}

async function worktree(t: TestContext) {
  return workspaceIn(await folder(t), A);
}

function workspaceIn(directory: string, workspace: string) {
  const store = outsideDirectory(directory);
  const at = { root: directory, workspace: parseWorkspaceId(workspace) };
  let clock = 0;
  return {
    directory,
    at(minute: number) {
      clock = minute;
    },
    async run(...argv: string[]) {
      const output: string[] = [];
      const code = await runCli(argv, {
        cwd: directory,
        now: () => minutes(clock),
        out: (line) => output.push(line),
        agentId: "agent-1",
        workspace: at.workspace,
      });
      return { code, text: output.join("\n") };
    },
    async lines() {
      return (await readFile(join(store, "progress.jsonl"), "utf8")).trimEnd().split("\n");
    },
    dashboard: (minute = clock) => readProgress(at, minutes(minute)).then((read) => read.dashboard),
    ticket: async (id: string, minute = clock) => (await readProgress(at, minutes(minute))).dashboard.tickets.find((ticket) => ticket.id === id)!,
  };
}

async function trainingRun(t: TestContext, w?: ReturnType<typeof workspaceIn>) {
  w ??= await worktree(t);
  await w.run("start", "Splats", "--item-label", "Step");
  await w.run("ticket", "add", "Step 01: Prepare", "--estimate", "30", "--status", "done");
  await w.run("ticket", "add", "Step 02: Train", "--estimate", "90", "--status", "working", "--stage", "Training");
  await w.run("ticket", "add", "Step 03: Export", "--estimate", "30");
  return w;
}

test("a job reports percent, ETA and a detail line on its ticket", async (t) => {
  const w = await trainingRun(t);
  w.at(10);
  const result = await w.run("ticket", "update", "T02", "--progress", "26000/36400", "--eta", "25m", "--detail", "Step 26000/36400");
  assert.equal(result.code, 0, result.text);
  assert.equal(result.text, `Updated T02: progress 71.4%, eta ${formatEta(minutes(35).toISOString(), minutes(10).getTime())}, detail Step 26000/36400`);
  assert.deepEqual((await w.ticket("T02")).progress, {
    percent: 71.4,
    eta: minutes(35).toISOString(),
    detail: "Step 26000/36400",
    at: minutes(10).toISOString(),
  });

  w.at(11);
  await w.run("ticket", "update", "T02", "--progress", "73%");
  assert.deepEqual(
    (await w.ticket("T02")).progress,
    { percent: 73, eta: minutes(35).toISOString(), detail: "Step 26000/36400", at: minutes(11).toISOString() },
    "a report changes only what it names",
  );

  await w.run("ticket", "update", "T02", "--detail", "");
  await w.run("ticket", "update", "T02", "--eta", "");
  assert.deepEqual((await w.ticket("T02")).progress, { percent: 73, at: minutes(11).toISOString() }, '"" clears a field');
  await w.run("ticket", "update", "T02", "--progress", "");
  assert.equal((await w.ticket("T02")).progress, undefined, "nothing left is no progress");
});

test("the run's bar counts a ticket not done yet with its reported share, and says 100% only once all are done", async (t) => {
  const w = await trainingRun(t);
  // 30 of 150 minutes done before any report.
  assert.equal((await w.dashboard()).progress.percent, 20);
  await w.run("ticket", "update", "T02", "--progress", "50");
  const { progress } = await w.dashboard();
  assert.equal(progress.doneMin, 75);
  assert.equal(progress.percent, 50);
  assert.deepEqual(
    progress.segments.map((segment) => segment.reported),
    [undefined, 0.5, undefined],
  );
  await w.run("ticket", "update", "T03", "--status", "skipped");
  await w.run("ticket", "update", "T02", "--progress", "99.9");
  assert.equal((await w.dashboard()).progress.percent, 99, "a report rounding to 100 isn't the work done");
  await w.run("ticket", "update", "T02", "--status", "done");
  const done = await w.dashboard();
  assert.equal(done.progress.percent, 100);
  assert.equal(done.tickets.find((ticket) => ticket.id === "T02")!.progress, undefined, "done drops the progress");
  assert.equal(done.progress.segments[1].reported, undefined);
});

test("reports stay out of the ticket's history, and keep it from turning stuck", async (t) => {
  const w = await trainingRun(t);
  for (let minute = 10; minute <= 200; minute += 10) {
    w.at(minute);
    await w.run("ticket", "update", "T02", "--progress", String(minute / 2.5), "--detail", `Minute ${minute}`);
  }
  const ticket = await w.ticket("T02", 205);
  assert.deepEqual(
    ticket.history.map((change) => change.status),
    ["working"],
    "only the status it was added with",
  );
  assert.deepEqual((await w.dashboard(205)).stuck, [], "past the 90m estimate since it started, but it reported 5 minutes ago");
  assert.equal((await w.dashboard(291)).stuck[0]?.kind, "overdue", "silent for longer than its estimate");
});

test("a report replaces the last one while nothing else is recorded in between", async (t) => {
  const w = await trainingRun(t);
  await w.run("ticket", "add", "Step 04: Second training", "--estimate", "90", "--status", "working");
  const before = (await w.lines()).length;
  for (let minute = 1; minute <= 30; minute++) {
    w.at(minute);
    await w.run("ticket", "update", "T02", "--progress", String(minute), "--eta", "1h");
    // Two jobs reporting side by side still keep one line each.
    await w.run("ticket", "update", "T04", "--progress", String(minute * 2));
  }
  assert.equal((await w.lines()).length, before + 2);
  w.at(31);
  await w.run("ticket", "update", "T02", "--detail", "Step 100");
  assert.equal((await w.lines()).length, before + 2);
  assert.deepEqual(JSON.parse((await w.lines()).at(-1)!), {
    v: 1,
    ts: minutes(31).toISOString(),
    by: "agent-1",
    ws: A,
    type: "ticket.update",
    id: "T02",
    progress: 30,
    eta: minutes(90).toISOString(),
    detail: "Step 100",
  });

  // Anything else is kept, and the next report starts a new line.
  await w.run("activity", "add", "Halfway", "--ticket", "T02");
  await w.run("ticket", "update", "T02", "--progress", "40");
  await w.run("ticket", "update", "T02", "--progress", "41", "--stage", "Densify");
  await w.run("ticket", "update", "T02", "--progress", "42");
  assert.equal((await w.lines()).length, before + 6);
  const ticket = await w.ticket("T02");
  assert.equal(ticket.progress?.percent, 42);
  assert.equal(ticket.progress?.detail, "Step 100");
  assert.equal(ticket.stage, "Densify", "an update with a real change stays its own line");
});

test("a ticker line set beside each report replaces the last one too", async (t) => {
  const w = await trainingRun(t);
  const before = (await w.lines()).length;
  for (let minute = 1; minute <= 30; minute++) {
    w.at(minute);
    await w.run("ticker", "set", `Training: ${minute}%`);
    await w.run("ticket", "update", "T02", "--progress", String(minute), "--detail", `Step ${minute}`);
  }
  assert.equal((await w.lines()).length, before + 2);
  const dashboard = await w.dashboard();
  assert.deepEqual(dashboard.ticker, { text: "Training: 30%", since: minutes(30).toISOString(), by: "agent-1" });
  assert.equal(dashboard.tickets.find((ticket) => ticket.id === "T02")!.progress?.percent, 30);

  // Anything else, a cleared ticker included, keeps what came before it.
  await w.run("ticker", "clear");
  await w.run("ticker", "set", "Exporting");
  await w.run("ticket", "update", "T02", "--progress", "31");
  assert.equal((await w.lines()).length, before + 5);
  assert.equal((await w.dashboard()).ticker?.text, "Exporting");
});

test("two workspaces on one folder each fold their own reports and ticker, and leave the other's alone", async (t) => {
  const directory = await folder(t);
  const a = await trainingRun(t, workspaceIn(directory, A));
  const b = await trainingRun(t, workspaceIn(directory, B));
  const before = (await a.lines()).length;
  for (let minute = 1; minute <= 5; minute++) {
    a.at(minute);
    b.at(minute);
    await a.run("ticker", "set", `Training the model: ${minute}%`);
    await a.run("ticket", "update", "T02", "--progress", String(minute));
    await b.run("ticker", "set", `Exporting the mesh: ${minute}%`);
    await b.run("ticket", "update", "T02", "--progress", String(minute * 2), "--eta", "1h", "--detail", `Mesh ${minute}`);
  }
  assert.equal((await a.lines()).length, before + 4, "one ticker line and one report per workspace");
  const [shownA, shownB] = [await a.dashboard(), await b.dashboard()];
  assert.equal(shownA.ticker?.text, "Training the model: 5%");
  assert.equal(shownB.ticker?.text, "Exporting the mesh: 5%");
  assert.deepEqual(
    shownA.tickets.find((ticket) => ticket.id === "T02")!.progress,
    { percent: 5, at: minutes(5).toISOString() },
    "no ETA or detail from B's T02",
  );
  assert.deepEqual(shownB.tickets.find((ticket) => ticket.id === "T02")!.progress, {
    percent: 10,
    eta: minutes(65).toISOString(),
    detail: "Mesh 5",
    at: minutes(5).toISOString(),
  });
});

test("a report doesn't move a line past where a workspace split off the folder's run", () => {
  const line = (event: object) => JSON.stringify({ v: 1, ts: minutes(0).toISOString(), type: "ticket.update", id: "T01", ...event });
  const report = (ws?: string): ProgressEvent => ({
    v: 1,
    ts: minutes(1).toISOString(),
    type: "ticket.update",
    id: "T01",
    progress: 6,
    ...(ws ? { ws: parseWorkspaceId(ws)! } : {}),
  });
  assert.equal(compactRepeated(`${line({ progress: 5 })}\n${line({ progress: 5, ws: A })}\n`, report()), null, "a folder report stays before A's lines");
  assert.equal(compactRepeated(`${line({ progress: 5, ws: A })}\n${line({ status: "done" })}\n`, report(A)), null, "A's first line marks its split");
  const compacted = compactRepeated(
    `${line({ stage: "x", ws: A })}\n${line({ progress: 5, ws: A })}\n${line({ progress: 1, ws: B })}\n${line({ status: "done" })}\n`,
    report(A),
  );
  assert.deepEqual(
    compacted
      ?.trimEnd()
      .split("\n")
      .map((entry) => JSON.parse(entry)),
    [JSON.parse(line({ stage: "x", ws: A })), JSON.parse(line({ progress: 1, ws: B })), JSON.parse(line({ status: "done" })), report(A)],
    "lines of B and of the folder in between don't count",
  );
});

test("only progress-only updates are reports, and a file that doesn't end in a full line is appended to", () => {
  const base = { v: 1 as const, ts: minutes(0).toISOString(), type: "ticket.update" as const, id: "T01" };
  assert.equal(isProgressReport({ ...base, progress: 5 }), true);
  assert.equal(isProgressReport({ ...base, detail: "" }), true);
  assert.equal(isProgressReport({ ...base, progress: 5, note: "x" }), false);
  assert.equal(isProgressReport({ ...base, status: "working" }), false);
  const report: ProgressEvent = { ...base, progress: 6 };
  const line = JSON.stringify({ ...base, progress: 5 });
  assert.equal(compactRepeated(`${line}\n`, report), `${JSON.stringify({ ...base, progress: 6 })}\n`);
  assert.equal(compactRepeated(line, report), null);
  assert.equal(compactRepeated(`${line}\nnot json\n`, report), null);
  assert.equal(compactRepeated(`${line}\n`, { ...base, progress: 6, stage: "x" }), null);
});

test("the ETA is the time left, a clock time, or an ISO time, and stored as an exact moment", async (t) => {
  const w = await trainingRun(t);
  w.at(0);
  const eta = async (value: string) => {
    const result = await w.run("ticket", "update", "T02", "--eta", value);
    return result.code === 0 ? (await w.ticket("T02")).progress?.eta : result.text.split("\n")[0];
  };
  assert.equal(await eta("1h 20m"), minutes(80).toISOString());
  assert.equal(await eta("1h20m"), minutes(80).toISOString());
  assert.equal(await eta("90s"), new Date(T0 + 90_000).toISOString());
  assert.equal(await eta("45min"), minutes(45).toISOString());
  assert.equal(await eta("2026-09-27T23:10:00+02:00"), "2026-09-27T21:10:00.000Z");
  // A clock time is the next one to come on this computer.
  const later = new Date(minutes(30));
  assert.equal(await eta(`${later.getHours()}:${String(later.getMinutes()).padStart(2, "0")}`), minutes(30).toISOString());
  const earlier = new Date(minutes(-30));
  assert.equal(await eta(`${earlier.getHours()}:${String(earlier.getMinutes()).padStart(2, "0")}`), minutes(24 * 60 - 30).toISOString());
  for (const bad of ["soon", "25", "24:00", "2026-09-27T23:10"]) {
    assert.match(String(await eta(bad)), /^--eta must be the time left like 25m/, bad);
  }
  assert.match(String(await eta("2400000000h")), /^--eta must be within a year/, "no RangeError");
  assert.equal(await eta("8760h"), minutes(365 * 24 * 60).toISOString());
  const started = performance.now();
  assert.match(String(await eta(`1h${" ".repeat(40_000)}x`)), /^--eta must be the time left like 25m/);
  assert.ok(performance.now() - started < 200, "a long value is refused before the pattern runs");
});

test("progress is a percent or a count, and only on a ticket that isn't done or skipped", async (t) => {
  const w = await trainingRun(t);
  for (const bad of ["101", "-3", "abc", "5/0", "40000/36400"]) {
    const result = await w.run("ticket", "update", "T02", `--progress=${bad}`);
    assert.equal(result.code, 1, bad);
    assert.match(result.text, /^--progress must be a percent from 0 to 100/, bad);
  }
  const done = await w.run("ticket", "update", "T01", "--progress", "50");
  assert.equal(done.code, 1);
  assert.match(done.text, /^T01 is done\. Progress shows only on a ticket that isn't done or skipped\./);
  const finishing = await w.run("ticket", "update", "T02", "--status", "done", "--detail", "Last step");
  assert.equal(finishing.code, 1, "nor on one this update finishes");
  assert.equal((await w.run("ticket", "update", "T01", "--progress", "")).code, 0, "clearing is always fine");
});

test("the detail is one line of at most 200 characters", async (t) => {
  const w = await trainingRun(t);
  await w.run("ticket", "update", "T02", "--detail", "Step 4\n  T03  Looks like a ticket\r\n");
  assert.equal((await w.ticket("T02")).progress?.detail, "Step 4 T03 Looks like a ticket");
  await w.run("ticket", "update", "T02", "--detail", "x".repeat(500));
  assert.equal((await w.ticket("T02")).progress?.detail, `${"x".repeat(199)}…`);
});

test("show prints a ticket's progress for the agent", async (t) => {
  const w = await trainingRun(t);
  w.at(10);
  await w.run("ticket", "update", "T02", "--progress", "73", "--eta", "16m", "--detail", "Step 26000/36400");
  w.at(12);
  const { text } = await w.run("show");
  assert.match(
    text,
    new RegExp(`\\n {6}Progress: 73% done, ETA ${escape(formatEta(minutes(26).toISOString(), minutes(12).getTime()))}, Step 26000/36400, reported 2m ago\\n`),
  );
  assert.match(text, /64% of estimated work done/);
});

test("the ticket update tool passes progress, ETA and detail to the command", async (t) => {
  const w = await trainingRun(t);
  const tool = progressTools.find((candidate) => candidate.name === "progress_ticket_update")!;
  const context = {
    agent: { id: "agent-7", workspaceId: A, parentAgentId: null, provider: "claude", cwd: w.directory, title: null, background: false, metadata: {} },
    paseo: {} as AgentToolContext["paseo"],
    signal: new AbortController().signal,
  };
  const result = await tool.execute(tool.input.parse({ id: "T02", progress: 40, eta: "2026-09-28T10:00:00Z", detail: "-- step 4" }), context);
  assert.equal(result.isError, false, result.text);
  const ticket = await w.ticket("T02");
  assert.deepEqual(
    { percent: ticket.progress?.percent, eta: ticket.progress?.eta, detail: ticket.progress?.detail },
    { percent: 40, eta: "2026-09-28T10:00:00.000Z", detail: "-- step 4" },
  );
  assert.equal((await tool.execute(tool.input.parse({ id: "T02", progress: "" }), context)).isError, false);
  assert.equal((await w.ticket("T02")).progress?.percent, undefined);
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
