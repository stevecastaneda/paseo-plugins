// End to end: run the agent's commands in a throwaway worktree, then read the
// dashboard the panel would get.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readlink, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { runCli } from "./cli.ts";
import { handleGetAttention, handleGetDashboard, markPanelOpened, readDashboard } from "./dashboard.ts";
import { formatHours, formatMinutes } from "../shared/format.ts";
import { headlineText } from "../shared/dashboard.ts";
import { defaultLauncherPath, installLauncher, launcherStatus } from "./launcher.ts";
import { defaultSkillPaths, installSkill, skillSource, skillStatus } from "./skill.ts";
import { attachmentPath, MAX_PREVIEW_BYTES, MAX_PREVIEW_TEXT_BYTES, openCommand, openDeliverable, previewDeliverable } from "./open.ts";
import { imageMimeType } from "../shared/preview.ts";
import { SCRATCH_GITIGNORE } from "./scratch.ts";
import { ticketStory } from "../shared/ticket-story.ts";

const T0 = Date.parse("2026-09-27T19:59:00.000Z");
const minutes = (count: number) => new Date(T0 + count * 60_000);

async function worktree(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "progress-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, ".git"), "gitdir: elsewhere\n");
  let clock = 0;
  const output: string[] = [];
  return {
    directory,
    output,
    at(minute: number) { clock = minute; },
    async run(...argv: string[]) {
      output.length = 0;
      const code = await runCli(argv, { cwd: directory, now: () => minutes(clock), out: (line) => output.push(line) });
      return { code, text: output.join("\n") };
    },
    // Read at the current clock, or at a given minute.
    dashboard: (minute = clock) => readDashboard(directory, minutes(minute)),
  };
}

test("finish closes the run only once everything is settled, and keeps it on the dashboard", async (t) => {
  const w = await worktree(t);
  assert.equal((await w.run("finish", "Nothing yet")).code, 1, "no run to finish");
  await w.run("start", "Export");
  await w.run("ticket", "add", "Ticket 01", "--estimate", "30");
  await w.run("question", "ask", "Format", "CSV or JSON?", "--default", "CSV");
  await w.run("stuck", "set", "Staging is down");
  const refused = await w.run("finish", "Shipped");
  assert.equal(refused.code, 1);
  assert.match(refused.text, /Can't finish yet\. Still open: open questions Q1 .*; tickets not done or skipped: T01; flagged blockers S1/);

  await w.run("question", "answer", "Q1", "CSV");
  await w.run("ticket", "update", "T01", "--status", "done");
  await w.run("stuck", "clear", "S1");
  await w.run("ticker", "set", "Wrapping up");
  assert.deepEqual(await w.run("finish", "Shipped the CSV export"), { code: 0, text: "Finished run: Export" });

  w.at(120);
  const { dashboard } = await w.dashboard();
  assert.equal(dashboard.run?.title, "Export", "the finished run stays on the dashboard");
  assert.equal(dashboard.run?.finished?.outcome, "Shipped the CSV export");
  assert.equal(dashboard.ticker, null);
  assert.equal(dashboard.stale, false);
  assert.match((await w.run("show")).text, /Finished .*: Shipped the CSV export\nThis run is closed/);

  const after = await w.run("ticket", "add", "Ticket 02", "--estimate", "10");
  assert.equal(after.code, 1);
  assert.match(after.text, /The run "Export" is finished\. Start new work with: paseo-progress start/);
  assert.equal((await w.run("start", "Next job")).code, 0);
  assert.equal((await w.dashboard()).dashboard.run?.finished, undefined, "a new run starts open");
});

test("a ticket's story: its stages with durations, and what belongs to it exactly or by time", async (t) => {
  const w = await worktree(t);
  await w.run("start", "Export");
  await w.run("ticket", "add", "Ticket 01: CSV", "--estimate", "30");
  await w.run("ticket", "add", "Ticket 02: JSON", "--estimate", "30");
  await w.run("activity", "add", "Run-wide kickoff");
  w.at(10);
  await w.run("ticket", "update", "T01", "--status", "working", "--stage", "Build");
  w.at(15);
  await w.run("activity", "add", "Untagged, while T01 worked");
  assert.match((await w.run("activity", "add", "Tagged to T01", "--ticket", "t01")).text, /^Logged A3 on T01: /);
  await w.run("question", "ask", "Delimiter", "Comma or tab?", "--default", "Comma", "--ticket", "T01");
  await w.run("deliverable", "add", "Sample", "https://example.com/sample.csv", "--ticket", "T01");
  assert.equal((await w.run("activity", "add", "Bad tag", "--ticket", "T09")).code, 1, "an unknown ticket is refused");
  w.at(25);
  await w.run("ticket", "update", "T01", "--stage", "Review", "--note", "Build went fast");
  w.at(40);
  await w.run("ticket", "update", "T01", "--status", "done");
  await w.run("ticket", "update", "T02", "--status", "working");
  await w.run("activity", "add", "Tagged to T01 later", "--ticket", "T01");
  await w.run("activity", "add", "Untagged, while T02 worked");

  const { dashboard } = await w.dashboard(50);
  const t01 = dashboard.tickets.find((ticket) => ticket.id === "T01")!;
  const story = ticketStory(t01, {
    deliverables: dashboard.deliverables,
    questions: [...dashboard.questions.open, ...dashboard.questions.answered],
    activity: [...dashboard.activity].reverse(),
  }, minutes(50).getTime());
  assert.deepEqual(story.timeline.map((step) => [step.label, step.minutes === null ? null : Math.round(step.minutes)]), [
    ["Added", 10], ["Build stage", 15], ["Review stage", 15], ["Done", null],
  ]);
  assert.deepEqual(story.timeline[2].notes, ["Build went fast"]);
  assert.equal(Math.round(story.workedMin), 30);
  assert.deepEqual(story.activity.map((entry) => [entry.text, entry.link]), [
    ["Untagged, while T01 worked", "by-time"],
    ["Tagged to T01", "tagged"],
    ["Tagged to T01 later", "tagged"],
  ]);
  assert.deepEqual(story.questions.map((question) => [question.id, question.link]), [["Q1", "tagged"]]);
  assert.deepEqual(story.deliverables.map((deliverable) => deliverable.id), ["D1"]);

  const t02 = dashboard.tickets.find((ticket) => ticket.id === "T02")!;
  const current = ticketStory(t02, { deliverables: [], questions: [], activity: [...dashboard.activity].reverse() }, minutes(50).getTime());
  assert.deepEqual(current.timeline.map((step) => [step.label, Math.round(step.minutes!)]), [["Added", 40], ["Working", 10]], "the step still going runs to now");
  assert.deepEqual(current.activity.map((entry) => entry.text), ["Untagged, while T02 worked"], "tags to another ticket never match by time");
});

test("a ticket waiting for another is not stuck, even if marked blocked, until that one is done", async (t) => {
  const w = await worktree(t);
  await w.run("start", "Release");
  await w.run("ticket", "add", "Ticket 01: Build", "--estimate", "30");
  assert.match((await w.run("ticket", "add", "Ship", "--estimate", "10", "--waits-for", "t01")).text, /waits for T01$/);
  await w.run("ticket", "add", "Docs", "--estimate", "10");
  assert.equal((await w.run("ticket", "update", "T02", "--waits-for", "T02")).code, 1, "can't wait for itself");
  assert.equal((await w.run("ticket", "update", "T03", "--waits-for", "T09")).code, 1, "must name a ticket in the run");
  await w.run("ticket", "update", "T02", "--status", "blocked", "--note", "Waits on Ticket 01");
  await w.run("ticket", "update", "T03", "--status", "blocked", "--note", "Staging is down");

  let { dashboard } = await w.dashboard();
  assert.deepEqual(dashboard.tickets.find((ticket) => ticket.id === "T02")?.waitingFor, { id: "T01", title: "Ticket 01: Build" });
  assert.deepEqual(dashboard.stuck.map((item) => item.key), ["blocked:T03"], "only the outside blocker is stuck");
  assert.equal(dashboard.progress.segments.find((segment) => segment.id === "T02")?.waiting, true);
  assert.match((await w.run("show")).text, /T02 {2}Waiting for T01/);

  await w.run("ticket", "update", "T01", "--status", "done");
  ({ dashboard } = await w.dashboard());
  assert.equal(dashboard.tickets.find((ticket) => ticket.id === "T02")?.waitingFor, undefined, "done unblocks the wait");
  assert.deepEqual(dashboard.stuck.map((item) => item.key), ["blocked:T02", "blocked:T03"], "still marked blocked after it: now that's stuck");
  await w.run("ticket", "update", "T02", "--waits-for", "");
  assert.equal((await w.dashboard()).dashboard.tickets.find((ticket) => ticket.id === "T02")?.waitsFor, undefined, "an empty value clears it");
});

test("opening the panel is remembered in the worktree", async (t) => {
  const w = await worktree(t);
  await w.run("start", "Export");
  assert.equal((await w.dashboard()).panelOpened, false);
  await markPanelOpened(w.directory);
  assert.equal((await w.dashboard()).panelOpened, true);
  await w.run("start", "Another run");
  assert.equal((await w.dashboard()).panelOpened, true, "a new run doesn't bring the pill back");
});

test("a worktree without a progress file reads as not configured", async (t) => {
  const w = await worktree(t);
  const result = await w.dashboard();
  assert.equal(result.configured, false);
  assert.deepEqual(result.dashboard.tickets, []);
});

test("tickets added and updated by the agent show up with ids, statuses, and the headline", async (t) => {
  const w = await worktree(t);
  assert.deepEqual(await w.run("start", "Loan Options", "--subtitle", "Frozen links"), { code: 0, text: "Started run: Loan Options" });
  assert.equal((await w.run("ticket", "add", "Ticket 01: Saved table", "--estimate", "120")).text, "Added T01: Ticket 01: Saved table (120 min)");
  await w.run("ticket", "add", "Ticket 02: Copy Link", "--estimate", "150");
  await w.run("ticket", "add", "Ticket 03: Frozen links", "--estimate", "120");
  await w.run("ticket", "add", "Ticket 04: Time zones", "--estimate", "75");
  w.at(30);
  await w.run("ticket", "update", "t01", "--status", "done");
  await w.run("ticket", "update", "T02", "--status", "done");
  assert.equal((await w.run("ticket", "update", "T03", "--status", "working", "--note", "Fixes after review")).code, 0);

  const { configured, dashboard } = await w.dashboard();
  assert.equal(configured, true);
  assert.deepEqual(dashboard.run, { title: "Loan Options", subtitle: "Frozen links", itemLabel: "Ticket", startedAt: minutes(0).toISOString() });
  assert.equal(headlineText(dashboard), "2 of 4 tickets done");
  assert.equal(dashboard.updatedAt, minutes(30).toISOString());
  assert.deepEqual(
    dashboard.tickets.map(({ id, status, estimateMin }) => [id, status, estimateMin]),
    [["T01", "done", 120], ["T02", "done", 150], ["T03", "working", 120], ["T04", "not_started", 75]],
  );
  assert.equal(dashboard.tickets[2].note, "Fixes after review");
  assert.deepEqual(dashboard.issues, []);
});

test("removed tickets leave the dashboard and their ids are never reused", async (t) => {
  const w = await worktree(t);
  await w.run("start", "Run");
  await w.run("ticket", "add", "One", "--estimate", "10");
  await w.run("ticket", "add", "Two", "--estimate", "10");
  assert.equal((await w.run("ticket", "remove", "T02")).text, "Removed T02: Two");
  assert.match((await w.run("ticket", "add", "Three", "--estimate", "10")).text, /^Added T03/);
  await w.run("ticket", "update", "T03", "--status", "skipped");
  const { dashboard } = await w.dashboard();
  assert.deepEqual(dashboard.tickets.map((ticket) => ticket.id), ["T01", "T03"]);
  assert.equal(headlineText(dashboard), "0 of 1 ticket done", "skipped tickets are not counted");
});

test("bad input fails with a clear message and writes nothing", async (t) => {
  const w = await worktree(t);
  await w.run("start", "Run");
  await w.run("ticket", "add", "One", "--estimate", "10");
  const before = await readFile(join(w.directory, ".scratch/progress.jsonl"), "utf8");
  const cases: Array<[string[], RegExp]> = [
    [["ticket", "add", "--estimate", "10"], /Missing ticket title/],
    [["ticket", "add", "Two"], /Missing --estimate/],
    [["ticket", "add", "Two", "--estimate", "ninety"], /whole number of minutes/],
    [["ticket", "update", "T01", "--status", "finished"], /--status must be one of: not_started, working, blocked, done, skipped/],
    [["ticket", "update", "T09", "--status", "done"], /No ticket T09 in this run\. Tickets: T01/],
    [["ticket", "update", "T01"], /Nothing to change/],
    [["ticket", "add", "Two", "--estimate", "10", "--colour", "red"], /Unknown option '--colour'/],
    [["tickets", "add"], /Unknown command: tickets add/],
  ];
  for (const [argv, message] of cases) {
    const result = await w.run(...argv);
    assert.equal(result.code, 1, argv.join(" "));
    assert.match(result.text, message);
  }
  assert.equal(await readFile(join(w.directory, ".scratch/progress.jsonl"), "utf8"), before);
});

test("commands find the worktree root from a subdirectory", async (t) => {
  const w = await worktree(t);
  const nested = join(w.directory, "packages", "app");
  await mkdir(nested, { recursive: true });
  assert.equal(await runCli(["start", "From below"], { cwd: nested, out: () => {} }), 0);
  assert.equal((await w.dashboard()).dashboard.run?.title, "From below");
});

test("the handler reads the requested workspace directory without calling Paseo", async (t) => {
  const w = await worktree(t);
  await w.run("start", "Run");
  const paseo = new Proxy({} as PluginHandlerContext["paseo"], { get() { throw new Error("must not call paseo"); } });
  const result = await handleGetDashboard({ workspaceId: "ws-1", workspaceDirectory: w.directory }, { paseo });
  assert.ok("dashboard" in result);
  assert.equal(result.dashboard.run?.title, "Run");
});

test("the first write adds a .gitignore for the plugin's own files and never replaces one", async (t) => {
  const w = await worktree(t);
  await w.run("start", "Run");
  assert.equal(await readFile(join(w.directory, ".scratch", ".gitignore"), "utf8"), SCRATCH_GITIGNORE);
  const other = await worktree(t);
  await mkdir(join(other.directory, ".scratch"), { recursive: true });
  await writeFile(join(other.directory, ".scratch", ".gitignore"), "mine\n");
  await other.run("start", "Run");
  await markPanelOpened(other.directory);
  assert.equal(await readFile(join(other.directory, ".scratch", ".gitignore"), "utf8"), "mine\n", "an existing one is the user's");
  const third = await worktree(t);
  await markPanelOpened(third.directory);
  assert.equal(await readFile(join(third.directory, ".scratch", ".gitignore"), "utf8"), SCRATCH_GITIGNORE, "opening the panel first adds it too");
});

test("a poll with the current version gets a short unchanged reply until the file changes", async (t) => {
  const w = await worktree(t);
  await w.run("start", "Run");
  const context = { paseo: {} as PluginHandlerContext["paseo"] };
  const input = { workspaceId: "ws-1", workspaceDirectory: w.directory };
  const first = await handleGetDashboard(input, context);
  assert.ok("dashboard" in first);
  assert.deepEqual(await handleGetDashboard({ ...input, since: first.version }, context), { unchanged: true, version: first.version });
  await w.run("ticket", "add", "Ticket 01: Next", "--estimate", "10");
  const second = await handleGetDashboard({ ...input, since: first.version }, context);
  assert.ok("dashboard" in second, "a change to the file sends the new dashboard");
  assert.equal(second.dashboard.tickets.length, 1);
  assert.notEqual(second.version, first.version);
});

test("the pill check returns only counts and run state", async (t) => {
  const w = await worktree(t);
  const context = { paseo: {} as PluginHandlerContext["paseo"] };
  const input = { workspaceId: "ws-1", workspaceDirectory: w.directory };
  assert.deepEqual(await handleGetAttention(input, context), { configured: false, questions: 0, stuck: 0, runOpen: false, panelOpened: false });
  await w.run("start", "Run");
  await w.run("question", "ask", "Spacing", "Tighter?", "--option", "A=Yes | tighter", "--option", "B=No | as is", "--default", "A");
  assert.deepEqual(await handleGetAttention(input, context), { configured: true, questions: 1, stuck: 0, runOpen: true, panelOpened: false });
});

test("the command runs as a script and stamps the real time", async (t) => {
  const w = await worktree(t);
  const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
  const before = Date.now();
  const { stdout } = await promisify(execFile)(process.execPath, [cli, "start", "Real clock"], { cwd: w.directory });
  assert.equal(stdout.trim(), "Started run: Real clock");
  const updatedAt = Date.parse((await w.dashboard()).dashboard.updatedAt ?? "");
  assert.ok(updatedAt >= before - 1000 && updatedAt <= Date.now() + 1000);
});

async function screenshotRun(t: TestContext) {
  const w = await worktree(t);
  await w.run("start", "Loan Options");
  await w.run("ticket", "add", "Ticket 01", "--estimate", "120");
  await w.run("ticket", "add", "Ticket 02", "--estimate", "150");
  await w.run("ticket", "add", "Ticket 03", "--estimate", "120");
  await w.run("ticket", "add", "Ticket 04", "--estimate", "75");
  await w.run("ticket", "update", "T01", "--status", "done");
  await w.run("ticket", "update", "T02", "--status", "done");
  await w.run("ticket", "update", "T03", "--status", "working");
  return w;
}

test("progress matches the reference dashboard: 58% and 4.5 h of 7.8 h", async (t) => {
  const w = await screenshotRun(t);
  const { progress } = (await w.dashboard()).dashboard;
  assert.equal(progress.percent, 58);
  assert.equal(formatHours(progress.doneMin), "4.5 h");
  assert.equal(formatHours(progress.totalMin), "7.8 h");
  assert.deepEqual(
    progress.segments.map(({ id, estimateMin, status }) => `${id}:${estimateMin}:${status}`),
    ["T01:120:done", "T02:150:done", "T03:120:working", "T04:75:not_started"],
  );
});

test("skipped tickets leave the progress bar and the totals", async (t) => {
  const w = await screenshotRun(t);
  await w.run("ticket", "update", "T04", "--status", "skipped");
  const { progress } = (await w.dashboard()).dashboard;
  assert.equal(progress.totalMin, 390);
  assert.equal(progress.percent, 69);
  assert.deepEqual(progress.segments.map((segment) => segment.id), ["T01", "T02", "T03"]);
});

test("the dashboard turns stale exactly 15 minutes after the last event", async (t) => {
  const w = await screenshotRun(t);
  w.at(10);
  await w.run("ticket", "update", "T03", "--note", "Still going");
  assert.equal((await w.dashboard(24)).dashboard.stale, false);
  assert.equal((await w.dashboard(25)).dashboard.stale, true);
  w.at(26);
  await w.run("ticket", "update", "T03", "--note", "Back");
  assert.equal((await w.dashboard(26)).dashboard.stale, false, "a new event clears it");
});

test("a run whose tickets are all done or skipped never turns stale", async (t) => {
  const w = await screenshotRun(t);
  w.at(10);
  for (const id of ["T01", "T02", "T03"]) await w.run("ticket", "update", id, "--status", "done");
  await w.run("ticket", "update", "T04", "--status", "skipped");
  assert.equal((await w.dashboard(60)).dashboard.stale, false);
});

test("display helpers format durations and hours the way the panel shows them", () => {
  assert.equal(formatMinutes(0.5), "<1 min");
  assert.equal(formatMinutes(12), "12 min");
  assert.equal(formatMinutes(602), "10 h 2 min");
  assert.equal(formatMinutes(120), "2 h");
  assert.equal(formatHours(465), "7.8 h");
  assert.equal(formatHours(120), "2 h");
});

test("a working ticket shows its stage and when that stage started", async (t) => {
  const w = await screenshotRun(t);
  w.at(5);
  await w.run("ticket", "update", "T03", "--stage", "Build");
  w.at(40);
  await w.run("ticket", "update", "T03", "--stage", "Fixes");
  w.at(45);
  await w.run("ticket", "update", "T03", "--stage", "Fixes", "--note", "Same stage, no restart");
  const ticket = (await w.dashboard()).dashboard.tickets.find((candidate) => candidate.id === "T03");
  assert.equal(ticket?.stage, "Fixes");
  assert.equal(ticket?.stageSince, minutes(40).toISOString());
  assert.equal(ticket?.workingSince, minutes(0).toISOString());
  await w.run("ticket", "update", "T03", "--stage", "");
  const cleared = (await w.dashboard()).dashboard.tickets.find((candidate) => candidate.id === "T03");
  assert.equal(cleared?.stage, undefined);
});

test("a working ticket becomes stuck once it runs past its estimate", async (t) => {
  const w = await screenshotRun(t);
  assert.deepEqual((await w.dashboard(120)).dashboard.stuck, [], "exactly at the estimate is not stuck");
  const { dashboard } = await w.dashboard(617);
  assert.deepEqual(dashboard.stuck, [{
    kind: "overdue", key: "overdue:T03", ticketId: "T03", title: "Ticket 03",
    since: minutes(0).toISOString(), estimateMin: 120, overMin: 497,
  }]);
  assert.equal(headlineText(dashboard), "2 of 4 tickets done, 1 stuck");
  assert.deepEqual(dashboard.headline.at(-1), { text: "1 stuck", tone: "danger" });
});

test("blocked tickets and flagged blockers are stuck until cleared", async (t) => {
  const w = await screenshotRun(t);
  w.at(3);
  await w.run("ticket", "update", "T04", "--status", "blocked", "--note", "Waiting on the API key");
  assert.equal((await w.run("stuck", "set", "Staging is down", "--ticket", "t03")).text, "Flagged S1: Staging is down");
  const { dashboard } = await w.dashboard();
  assert.deepEqual(dashboard.stuck.map((item) => item.key), ["blocked:T04", "manual:S1"]);
  assert.equal(dashboard.stuck[0].since, minutes(3).toISOString());
  assert.equal(dashboard.stuck[1].title, "Ticket 03");
  assert.equal((await w.run("stuck", "clear", "s1")).text, "Cleared S1: Staging is down");
  assert.match((await w.run("stuck", "clear", "S1")).text, /No flagged blocker S1\. Flagged: none/);
  await w.run("ticket", "update", "T04", "--status", "working");
  assert.deepEqual((await w.dashboard()).dashboard.stuck, []);
  assert.match((await w.run("stuck", "set", "Again")).text, /^Flagged S2/, "ids are not reused");
});

test("questions are asked with lettered options and a default, then answered by reference", async (t) => {
  const w = await screenshotRun(t);
  const ask = await w.run("question", "ask", "Row spacing", "Should we even out the spacing?",
    "--option", "A=Even it out | Cards look balanced",
    "--option", "b=Leave it | No change",
    "--default", "b",
    "--background", "13px left, 20px right.",
    "--file", ".scratch/shots/row.png=Before",
    "--raised-by", "Ticket 01 design review");
  assert.deepEqual(ask, { code: 0, text: "Asked Q1 (Row spacing). Default: B" });
  assert.equal((await w.run("question", "ask", "PDF check", "Do the PDFs match the page?", "--default", "Your check", "--waits")).text, "Asked Q2 (PDF check). Default: Your check (waiting for the answer)");
  let { dashboard } = await w.dashboard();
  assert.equal(headlineText(dashboard), "2 of 4 tickets done, 2 questions waiting for you");
  assert.deepEqual(dashboard.questions.open.map((question) => [question.id, question.default, question.waits]), [["Q1", "B", false], ["Q2", "Your check", true]]);
  assert.deepEqual(dashboard.questions.open[0].options[1], { letter: "B", label: "Leave it", consequence: "No change" });
  assert.deepEqual(dashboard.questions.open[0].files, [{ path: ".scratch/shots/row.png", label: "Before" }]);

  assert.equal((await w.run("question", "update", "Q1", "--background", "Walkthrough: 13px left, 20px right.", "--file", "shots/after.png=After")).text, "Updated Q1 (Row spacing)");
  ({ dashboard } = await w.dashboard());
  assert.equal(dashboard.questions.open[0].background, "Walkthrough: 13px left, 20px right.");
  assert.deepEqual(dashboard.questions.open[0].files.map((file) => file.label), ["Before", "After"]);
  assert.equal(dashboard.questions.open[0].default, "B", "updates keep the default");
  assert.match((await w.run("question", "update", "Q1")).text, /Nothing to change/);
  w.at(20);
  assert.equal((await w.run("question", "answer", "q1", "b", "--words", "Leave it alone.")).text, "Answered Q1: B (same as the default)");
  w.at(21);
  assert.equal((await w.run("question", "answer", "Q2", "Looks right")).text, "Answered Q2: Looks right (differs from default Your check: change course)");
  ({ dashboard } = await w.dashboard());
  assert.deepEqual(dashboard.questions.open, []);
  assert.deepEqual(dashboard.questions.answered.map((question) => question.id), ["Q2", "Q1"], "most recent answer first");
  assert.deepEqual(dashboard.questions.answered[1].answer, { choice: "B", words: "Leave it alone.", changedCourse: false, at: minutes(20).toISOString() });
  assert.equal(headlineText(dashboard), "2 of 4 tickets done");
});

test("question references are never reused and bad questions are refused", async (t) => {
  const w = await screenshotRun(t);
  await w.run("question", "ask", "One", "First?", "--default", "Yes");
  assert.equal((await w.run("question", "remove", "Q1")).text, "Removed Q1 (One)");
  assert.match((await w.run("question", "ask", "Two", "Second?", "--default", "Yes")).text, /^Asked Q2/);
  await w.run("start", "Next run");
  assert.match((await w.run("question", "ask", "Three", "Third?", "--default", "Yes")).text, /^Asked Q3/, "references stay unique across runs");
  const cases: Array<[string[], RegExp]> = [
    [["question", "ask", "T", "Q?", "--option", "A=One", "--option", "B=Two", "--default", "C"], /--default must be one of the option letters: A, B/],
    [["question", "ask", "T", "Q?", "--option", "A=One", "--option", "a=Again", "--default", "A"], /Option A is given twice/],
    [["question", "ask", "T", "Q?", "--option", "One", "--default", "A"], /--option must look like/],
    [["question", "ask", "T", "Q?"], /Missing --default/],
    [["question", "answer", "Q9", "A"], /No question Q9 in this run/],
    [["question", "remove", "Q1"], /No question Q1/],
  ];
  for (const [argv, message] of cases) {
    const result = await w.run(...argv);
    assert.equal(result.code, 1, argv.join(" "));
    assert.match(result.text, message);
  }
  await w.run("question", "ask", "Four", "Pick?", "--option", "A=One", "--option", "B=Two", "--default", "A");
  assert.match((await w.run("question", "answer", "Q4", "C")).text, /Q4 has options A, B, not C/);
});

test("deliverables are listed newest first with root-relative paths, their ticket, and a kind", async (t) => {
  const w = await screenshotRun(t);
  await mkdir(join(w.directory, ".scratch", "shots"), { recursive: true });
  const nested = join(w.directory, "packages", "app");
  await mkdir(nested, { recursive: true });
  assert.equal((await w.run("deliverable", "add", "Browser check screenshots", ".scratch/shots", "--ticket", "T03")).text, "Added D1: Browser check screenshots");
  const fromBelow = await runCli(["deliverable", "add", "Review report", "report.html", "--kind", "report"], { cwd: nested, now: () => minutes(1), out: () => {} });
  assert.equal(fromBelow, 0);
  await w.run("deliverable", "add", "Preview", "https://example.com/preview");
  await w.run("deliverable", "add", "Outside", "/tmp/elsewhere.png");
  const { dashboard } = await w.dashboard();
  assert.deepEqual(dashboard.deliverables.map(({ id, path, url, kind, ticketLabel }) => ({ id, path, url, kind, ticketLabel })), [
    { id: "D4", path: "/tmp/elsewhere.png", url: undefined, kind: "screenshot", ticketLabel: undefined },
    { id: "D3", path: undefined, url: "https://example.com/preview", kind: "link", ticketLabel: undefined },
    { id: "D2", path: "packages/app/report.html", url: undefined, kind: "report", ticketLabel: undefined },
    { id: "D1", path: ".scratch/shots", url: undefined, kind: "folder", ticketLabel: "Ticket 03" },
  ]);
  assert.equal((await w.run("deliverable", "remove", "d2")).text, "Removed D2: Review report");
  assert.deepEqual((await w.dashboard()).dashboard.deliverables.map((deliverable) => deliverable.id), ["D4", "D3", "D1"]);
  for (const [argv, message] of [
    [["deliverable", "add", "Bad", "ftp://example.com/x"], /Only http\(s\) URLs/],
    [["deliverable", "add", "Bad", "x.txt", "--kind", "video"], /--kind must be one of/],
    [["deliverable", "add", "Bad", "x.txt", "--ticket", "T09"], /No ticket T09/],
    [["deliverable", "remove", "D2"], /No deliverable D2/],
  ] as Array<[string[], RegExp]>) {
    const result = await w.run(...argv);
    assert.equal(result.code, 1, argv.join(" "));
    assert.match(result.text, message);
  }
});

test("activity notes list newest first and can be reworded or removed; the ticker sets and clears", async (t) => {
  const w = await screenshotRun(t);
  assert.equal((await w.run("activity", "add", "Dashboard set up.")).text, "Logged A1: Dashboard set up.");
  w.at(5);
  await w.run("activity", "add", "Ticket 03 moved to Fixes.");
  w.at(6);
  await w.run("activity", "add", "Typo");
  assert.equal((await w.run("activity", "update", "a2", "Ticket 03 moved to its Fixes stage.")).code, 0);
  await w.run("activity", "remove", "A3");
  assert.equal((await w.run("ticker", "set", "Running the browser check")).text, "Ticker: Running the browser check");
  let { dashboard } = await w.dashboard();
  assert.deepEqual(dashboard.activity.map(({ id, text, at }) => [id, text, at]), [
    ["A2", "Ticket 03 moved to its Fixes stage.", minutes(5).toISOString()],
    ["A1", "Dashboard set up.", minutes(0).toISOString()],
  ]);
  assert.deepEqual(dashboard.ticker, { text: "Running the browser check", since: minutes(6).toISOString() });
  await w.run("ticker", "clear");
  ({ dashboard } = await w.dashboard());
  assert.equal(dashboard.ticker, null);
  assert.match((await w.run("activity", "update", "A3", "Back")).text, /No activity A3 in this run\. Activity: A2, A1/);
  assert.match((await w.run("activity", "add", "Next")).text, /^Logged A4/);
});

test("bad lines are skipped and named while the rest of the dashboard renders", async (t) => {
  const w = await screenshotRun(t);
  const file = join(w.directory, ".scratch/progress.jsonl");
  const lines = (await readFile(file, "utf8")).split("\n");
  lines.splice(2, 0, "{not json", JSON.stringify({ v: 2, ts: minutes(0).toISOString(), type: "ticket.add" }), JSON.stringify({ v: 1, ts: "yesterday", type: "ticket.add" }), "[]");
  const text = lines.join("\n") + JSON.stringify({ v: 1, ts: minutes(1).toISOString(), type: "ticket.update", id: "T09", status: "done" }) + "\n";
  await writeFile(file, `${text}{"v":1,"ts":"2026-09-27T20:00:00.000Z","type":"ticket.upd`);
  const { dashboard } = await w.dashboard();
  assert.equal(dashboard.progress.percent, 58, "good lines still count");
  assert.deepEqual(dashboard.issues, [
    { line: 3, reason: "not valid JSON" },
    { line: 4, reason: "written by a newer version of the plugin (v2)" },
    { line: 5, reason: "invalid ticket.add event" },
    { line: 6, reason: "not a progress event" },
    { line: 13, reason: "unknown ticket T09" },
  ], "the unfinished last line is skipped without an issue");
});

test("a new run shows a fresh dashboard while the old history stays in the file", async (t) => {
  const w = await screenshotRun(t);
  await w.run("question", "ask", "Old", "Old question?", "--default", "Yes");
  w.at(30);
  await w.run("start", "Second run");
  const { dashboard } = await w.dashboard();
  assert.equal(dashboard.run?.title, "Second run");
  assert.deepEqual([dashboard.tickets, dashboard.questions.open, dashboard.stuck], [[], [], []]);
  assert.match((await w.run("ticket", "add", "Fresh", "--estimate", "5")).text, /^Added T01/, "ticket ids restart per run");
  const history = await readFile(join(w.directory, ".scratch/progress.jsonl"), "utf8");
  assert.match(history, /"title":"Loan Options"/);
});

test("concurrent writers never share an id or produce a broken line", async (t) => {
  const w = await worktree(t);
  await w.run("start", "Busy");
  const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
  const spawned = Array.from({ length: 6 }, (_, index) =>
    promisify(execFile)(process.execPath, [cli, "ticket", "add", `Spawned ${index}`, "--estimate", "5"], { cwd: w.directory }));
  const inProcess = Array.from({ length: 14 }, (_, index) =>
    runCli(["ticket", "add", `Local ${index}`, "--estimate", "5"], { cwd: w.directory, out: () => {} }));
  await Promise.all([...spawned, ...inProcess]);
  const { dashboard } = await w.dashboard();
  const ids = dashboard.tickets.map((ticket) => ticket.id);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20, "every ticket got its own id");
  assert.deepEqual(dashboard.issues, []);
  const text = await readFile(join(w.directory, ".scratch/progress.jsonl"), "utf8");
  assert.ok(text.endsWith("\n") && text.trim().split("\n").every((line) => JSON.parse(line)));
});

test("a lock left behind by a crashed command is taken over", async (t) => {
  const w = await worktree(t);
  const lock = join(w.directory, ".scratch/progress.jsonl.lock");
  await mkdir(lock, { recursive: true });
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  assert.equal((await w.run("start", "After crash")).code, 0);
});

test("show prints the dashboard as text for the agent", async (t) => {
  const w = await screenshotRun(t);
  await w.run("ticket", "update", "T03", "--stage", "Fixes");
  await w.run("question", "ask", "Row spacing", "Even out the spacing?", "--option", "A=Yes", "--option", "B=No", "--default", "B");
  await w.run("deliverable", "add", "Screenshots", ".scratch/shots/", "--ticket", "T03");
  await w.run("activity", "add", "Ticket 03 moved to Fixes.");
  const { code, text } = await runShow(w, 617);
  assert.equal(code, 0);
  assert.ok(text.startsWith(`Worktree: ${w.directory}\n`), "show names the worktree it read");
  for (const expected of [
    "Loan Options",
    "2 of 4 tickets done, 1 question waiting for you, 1 stuck",
    "58% of estimated work done, 4.5 h of 7.8 h",
    "POSSIBLY STALE: no update for 10 h 17 min.",
    "Ticket 03 (8 h 17 min past its 2 h estimate)",
    "T03  Working, Fixes stage  120 min  Ticket 03",
    "Q1 (Row spacing): Even out the spacing? Default B",
    "      B) No",
    "D1  Screenshots: .scratch/shots/, Ticket 03",
    "A1  Ticket 03 moved to Fixes.",
  ]) assert.ok(text.includes(expected), `missing: ${expected}\n\n${text}`);
});

async function runShow(w: Awaited<ReturnType<typeof worktree>>, minute: number) {
  const output: string[] = [];
  const code = await runCli(["show"], { cwd: w.directory, now: () => minutes(minute), out: (line) => output.push(line) });
  return { code, text: output.join("\n") };
}

test("the launcher runs the command from the plugin folder Paseo reports", async (t) => {
  const w = await worktree(t);
  const target = join(w.directory, "bin", "paseo-progress");
  assert.equal((await runCli(["install-launcher", target], { cwd: w.directory, out: () => {} })), 0);
  const output: string[] = [];
  await runCli(["install-launcher", target], { cwd: w.directory, out: (line) => output.push(line) });
  assert.match(output[0], /already current/);
  const pluginDir = fileURLToPath(new URL("..", import.meta.url));
  const { stdout } = await promisify(execFile)(target, ["start", "Via launcher"], {
    cwd: w.directory,
    env: { ...process.env, PASEO_PROGRESS_PLUGIN_DIR: pluginDir },
  });
  assert.equal(stdout.trim(), "Started run: Via launcher");
  await assert.rejects(
    promisify(execFile)(target, ["show"], { cwd: w.directory, env: { ...process.env, PASEO_PROGRESS_PLUGIN_DIR: join(w.directory, "nowhere") } }),
    /not installed in Paseo/,
  );
});

test("the launcher is installed only on request, updated when stale, and never replaces another file", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "progress-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = defaultLauncherPath(home);
  assert.equal(path, join(home, ".local", "bin", "paseo-progress"));
  const bin = join(home, ".local", "bin");
  assert.deepEqual(await launcherStatus(path, `/usr/bin:${bin}/`), { path, state: "missing", onPath: true });
  assert.equal(await installLauncher(path), true);
  assert.deepEqual(await launcherStatus(path, "/usr/bin"), { path, state: "current", onPath: false });
  assert.equal(await installLauncher(path), false, "a current launcher is left as is");
  await writeFile(path, `#!/usr/bin/env node\n// Written by the progress Paseo plugin. old\n`);
  assert.equal((await launcherStatus(path)).state, "outdated");
  assert.equal(await installLauncher(path), true);
  const other = join(bin, "other");
  await writeFile(other, "#!/bin/sh\necho mine\n");
  assert.equal((await launcherStatus(other)).state, "foreign");
  await assert.rejects(installLauncher(other), /was not written by this plugin/);
  assert.equal(await readFile(other, "utf8"), "#!/bin/sh\necho mine\n");
});

test("a local deliverable opens on the daemon host by id, only inside the worktree", async (t) => {
  const w = await screenshotRun(t);
  await mkdir(join(w.directory, "reports"), { recursive: true });
  await writeFile(join(w.directory, "reports", "review.html"), "<h1>Review</h1>");
  await w.run("deliverable", "add", "Review", "reports/review.html");
  await w.run("deliverable", "add", "Gone", "reports/missing.html");
  await w.run("deliverable", "add", "Outside", tmpdir());
  await w.run("deliverable", "add", "Preview", "https://example.com");
  const opened: string[] = [];
  const opener = async (path: string) => { opened.push(path); };
  const root = await realpath(w.directory);
  assert.deepEqual(await openDeliverable(w.directory, "D1", opener), { opened: join(root, "reports", "review.html") });
  assert.deepEqual(opened, [join(root, "reports", "review.html")]);
  await assert.rejects(openDeliverable(w.directory, "D2", opener), /reports\/missing\.html no longer exists/);
  await assert.rejects(openDeliverable(w.directory, "D3", opener), /is outside this worktree/);
  await assert.rejects(openDeliverable(w.directory, "D4", opener), /No local deliverable D4/, "web links are not opened on the host");
  await assert.rejects(openDeliverable(w.directory, "D9", opener), /No local deliverable D9/);
  assert.equal(opened.length, 1);
});

test("image and text deliverables preview, only inside the worktree", async (t) => {
  const w = await screenshotRun(t);
  await mkdir(join(w.directory, "shots"), { recursive: true });
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  await writeFile(join(w.directory, "shots", "home.PNG"), png);
  await writeFile(join(w.directory, "shots", "notes.md"), "# Notes");
  await writeFile(join(w.directory, "shots", "huge.jpg"), Buffer.alloc(MAX_PREVIEW_BYTES + 1));
  await w.run("deliverable", "add", "Home", "shots/home.PNG");
  await w.run("deliverable", "add", "Notes", "shots/notes.md");
  await w.run("deliverable", "add", "Huge", "shots/huge.jpg");
  await w.run("deliverable", "add", "Outside", join(tmpdir(), "elsewhere.png"));
  assert.deepEqual(await previewDeliverable(w.directory, "D1"), { kind: "image", dataUri: `data:image/png;base64,${png.toString("base64")}`, bytes: png.length });
  assert.deepEqual(await previewDeliverable(w.directory, "D2"), { kind: "text", text: "# Notes", bytes: 7, truncated: false });
  await writeFile(join(w.directory, "shots", "page.html"), "<h1>Hi</h1>");
  await w.run("deliverable", "add", "Page", "shots/page.html");
  await assert.rejects(previewDeliverable(w.directory, "D5"), /isn't an image or text file/, "HTML is left to the browser");
  await assert.rejects(previewDeliverable(w.directory, "D3"), /too large to preview/);
  await assert.rejects(previewDeliverable(w.directory, "D4"), /no longer exists|outside this worktree/);
  const longLog = "x".repeat(MAX_PREVIEW_TEXT_BYTES + 10);
  await writeFile(join(w.directory, "shots", "long.log"), longLog);
  await writeFile(join(w.directory, "shots", "empty.txt"), "");
  await w.run("deliverable", "add", "Long", "shots/long.log");
  await w.run("deliverable", "add", "Empty", "shots/empty.txt");
  assert.deepEqual(await previewDeliverable(w.directory, "D6"), { kind: "text", text: longLog.slice(0, MAX_PREVIEW_TEXT_BYTES), bytes: longLog.length, truncated: true });
  assert.deepEqual(await previewDeliverable(w.directory, "D7"), { kind: "text", text: "", bytes: 0, truncated: false });
  assert.equal(imageMimeType("a/b.jpeg"), "image/jpeg");
  assert.equal(imageMimeType("report.html"), null);
});

test("question attachments take paths or links, and open and preview like deliverables", async (t) => {
  const w = await screenshotRun(t);
  await mkdir(join(w.directory, "shots"), { recursive: true });
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  await writeFile(join(w.directory, "shots", "before.png"), png);
  await w.run("question", "ask", "Header", "Which header?", "--option", "A=Old", "--option", "B=New", "--default", "A",
    "--file", "shots/before.png=Before", "--file", "https://example.com/preview?id=7&tab=2=Live preview", "--file", "https://example.com/?q=1");
  const { dashboard } = await readDashboard(w.directory);
  assert.deepEqual(dashboard.questions.open[0].files, [
    { path: "shots/before.png", label: "Before" },
    { url: "https://example.com/preview?id=7&tab=2", label: "Live preview" },
    { url: "https://example.com/?q=1" },
  ], "an = after a query key stays in the URL");
  assert.equal(attachmentPath(dashboard, "Q1.1"), "shots/before.png");
  assert.equal(attachmentPath(dashboard, "Q1.2"), null, "links are not opened on the host");
  assert.deepEqual(await previewDeliverable(w.directory, "Q1.1"), { kind: "image", dataUri: `data:image/png;base64,${png.toString("base64")}`, bytes: png.length });
  const opened: string[] = [];
  await openDeliverable(w.directory, "Q1.1", async (path) => { opened.push(path); });
  assert.deepEqual(opened, [join(await realpath(w.directory), "shots", "before.png")]);
  await assert.rejects(openDeliverable(w.directory, "Q1.9", async () => {}), /No local attachment Q1\.9/);
  const ftp = await w.run("question", "update", "Q1", "--file", "ftp://example.com/x");
  assert.equal(ftp.code, 1);
  assert.match(ftp.text, /Only http\(s\) URLs/);
});

test("plain-text deliverables open in the default browser; everything else in its usual app", () => {
  assert.deepEqual(openCommand("/w/spec.md", "darwin", "com.google.chrome"), ["open", ["-b", "com.google.chrome", "/w/spec.md"]]);
  assert.deepEqual(openCommand("/w/NOTES.TXT", "darwin", null), ["open", ["-b", "com.apple.Safari", "/w/NOTES.TXT"]], "Safari when no default browser is set");
  assert.deepEqual(openCommand("/w/report.html", "darwin", "com.google.chrome"), ["open", ["/w/report.html"]]);
  assert.deepEqual(openCommand("/w/shots/", "darwin", "com.google.chrome"), ["open", ["/w/shots/"]]);
  assert.deepEqual(openCommand("/w/spec.md", "linux", null), ["xdg-open", ["/w/spec.md"]]);
});

test("the skill is linked for every agent only on request, follows the copy Paseo runs, and never replaces another file", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "progress-skill-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = defaultSkillPaths(home);
  assert.deepEqual(paths.map((path) => path.slice(home.length)), ["/.agents/skills/paseo-progress", "/.claude/skills/paseo-progress", "/.codex/skills/paseo-progress"]);
  const plugin = join(home, "plugin");
  assert.equal((await skillStatus(paths, plugin)).state, "missing");
  await mkdir(paths[2], { recursive: true });
  assert.equal(await installSkill(paths, plugin), true);
  assert.equal(await readlink(paths[0]), skillSource(plugin));
  assert.equal(await readlink(paths[1]), skillSource(plugin));
  assert.deepEqual(await skillStatus(paths, plugin), {
    state: "current",
    targets: [{ path: paths[0], state: "current" }, { path: paths[1], state: "current" }, { path: paths[2], state: "foreign" }],
  }, "someone else's skill folder is left alone");
  assert.equal(await installSkill(paths, plugin), false, "current links are left as is");
  const moved = join(home, "other-checkout");
  assert.equal((await skillStatus(paths, moved)).state, "outdated", "Paseo now runs another copy");
  assert.equal(await installSkill(paths, moved), true);
  assert.equal(await readlink(paths[1]), skillSource(moved));
  await assert.rejects(installSkill([paths[2]], plugin), /were not linked by this plugin/);
});
