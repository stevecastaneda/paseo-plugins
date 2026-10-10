import assert from "node:assert/strict";
import { test } from "node:test";
import type { PulseTest, RunSnapshot } from "./run.ts";
import { PILL_LINGER_MS, folderLabel, folders, formatTimeLeft, slowest, timeLeft, assignSlots, shownFailure, stepFailure, pillView, runBrief, attachmentKind, commandLine, counts, runningSlotCount, errorPreview, failureMessage, verdict, verdictNote, formatAgo, formatClock, formatDuration, runElapsed, testWhere, timeoutShare } from "./view.ts";

function pulseTest(overrides: Partial<PulseTest>): PulseTest {
  return { id: "t", title: "User edits a lead", titlePath: [], file: "e2e/a.spec.ts", line: 3, project: "", status: "passed", retry: 0, timeout: 60_000, attachments: [], ...overrides };
}

function run(tests: PulseTest[], overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return { v: 1, id: "r", pid: 1, root: "/", args: [], status: "running", startedAt: "2026-10-04T12:00:00.000Z", updatedAt: "2026-10-04T12:00:30.000Z", total: 5, projects: [], workers: 1, tests, errors: [], ...overrides };
}

test("counts passed, flaky, failed, skipped and running tests", () => {
  const tally = counts(run([
    pulseTest({ status: "passed" }),
    pulseTest({ status: "passed", outcome: "flaky" }),
    pulseTest({ status: "failed" }),
    pulseTest({ status: "timedOut" }),
    pulseTest({ status: "skipped" }),
    pulseTest({ status: "running" }),
  ]));
  assert.deepEqual(tally, { passed: 2, failed: 2, flaky: 1, skipped: 1, stopped: 0, running: 1, done: 5, total: 6 });
});

test("follows Playwright's verdict: expected failures pass, unexpected passes fail, stops are counted", () => {
  // test.fail() that failed: what the test expected.
  const expectedFailure = pulseTest({ status: "failed", outcome: "expected" });
  // test.fail() that passed: a failure.
  const unexpectedPass = pulseTest({ status: "passed", outcome: "unexpected" });
  const stopped = pulseTest({ status: "interrupted", outcome: "skipped" });
  // Failed a first try, then stopped during the retry: Playwright calls it failed.
  const failedThenStopped = pulseTest({ status: "interrupted", outcome: "unexpected" });
  const flaky = pulseTest({ status: "passed", outcome: "flaky", retry: 1 });
  const skipped = pulseTest({ status: "skipped", outcome: "skipped" });
  assert.deepEqual([expectedFailure, unexpectedPass, stopped, failedThenStopped, flaky, skipped].map(verdict),
    ["passed", "failed", "stopped", "failed", "flaky", "skipped"]);
  assert.equal(verdictNote(expectedFailure), "Failed, as expected");
  assert.equal(verdictNote(stopped), "Stopped before it finished");
  assert.equal(verdictNote(flaky), "Flaky: passed on retry 1");
  assert.equal(failureMessage(unexpectedPass, String), "Marked as expected to fail, but it passed.");
  assert.deepEqual(counts(run([expectedFailure, unexpectedPass, stopped, failedThenStopped, flaky, skipped])),
    { passed: 2, failed: 2, flaky: 1, skipped: 1, stopped: 1, running: 0, done: 6, total: 6 });
});

test("running tests keep their row; a new test takes the first free one", () => {
  assert.deepEqual(assignSlots([], ["a", "b"], 3), ["a", "b", null]);
  // a finished and c started: c takes a's row, b stays put.
  assert.deepEqual(assignSlots(["a", "b", null], ["b", "c"], 3), ["c", "b", null]);
  // Between tests the row stays, empty.
  assert.deepEqual(assignSlots(["c", "b", null], ["b"], 3), [null, "b", null]);
  // More running than rows (retries can overlap): add rows rather than drop a test.
  assert.deepEqual(assignSlots(["a"], ["a", "b"], 1), ["a", "b"]);
  const run = { workers: 4, total: 2 } as RunSnapshot;
  assert.equal(runningSlotCount(run, 0), 2);
  assert.equal(runningSlotCount({ ...run, total: 40 }, 1), 4);
});

test("the header pill shows while tests run and briefly after", () => {
  const now = Date.parse("2026-10-05T12:00:00.000Z");
  const live = runBrief(run([pulseTest({ status: "passed" }), pulseTest({ status: "running" })], { total: 40 }));
  assert.deepEqual(pillView(live, now), { label: "Tests 1/40", tone: "running", progress: "1/40", failed: 0 });
  const failing = runBrief(run([pulseTest({ status: "failed" })], { total: 40 }));
  assert.deepEqual(pillView(failing, now), { label: "1 failed · 1/40", tone: "failing", progress: "1/40", failed: 1 });
  const ended = runBrief(run([pulseTest({ status: "failed" })], { status: "failed", endedAt: "2026-10-05T11:59:00.000Z" }));
  assert.deepEqual(pillView(ended, now), { label: "1 failed", tone: "failed", progress: null, failed: 1 });
  assert.equal(pillView(ended, now + PILL_LINGER_MS), null);
  assert.equal(pillView(null, now), null);
  // Killed without an end: it ended at its last write.
  const killed = runBrief(run([], { status: "interrupted", updatedAt: "2026-10-05T11:59:30.000Z" }));
  assert.deepEqual(pillView(killed, now), { label: "Tests stopped", tone: "stopped", progress: null, failed: 0 });
});

test("failures show one at a time, cycling, and stay put as new ones arrive", () => {
  const ids = ["a", "b", "c"];
  assert.equal(shownFailure(ids, null), 0);
  assert.equal(stepFailure(ids, null, 1), "b");
  assert.equal(stepFailure(ids, "c", 1), "a");
  assert.equal(stepFailure(ids, "a", -1), "c");
  // A new failure is added; the one on show stays on show.
  assert.equal(shownFailure([...ids, "d"], "b"), 1);
  // A new run: the one picked is gone, so the first shows.
  assert.equal(shownFailure(["x"], "b"), 0);
  assert.equal(stepFailure([], "b", 1), null);
});

test("groups the suite by folder, including folders that haven't started", () => {
  const plan = [
    { file: "e2e/leads/edit.spec.ts", count: 2 },
    { file: "e2e/leads/delete.spec.ts", count: 1 },
    { file: "e2e/billing/plans.spec.ts", count: 3 },
  ];
  const tests = [
    pulseTest({ id: "a", file: "e2e/leads/edit.spec.ts", duration: 1000 }),
    pulseTest({ id: "b", file: "e2e/leads/edit.spec.ts", status: "failed", duration: 2000 }),
    pulseTest({ id: "c", file: "e2e/leads/delete.spec.ts", status: "running" }),
  ];
  const [leads, billing] = folders(run(tests, { plan, total: 6 }));
  assert.deepEqual({ ...leads, tests: leads.tests.length },
    { name: "leads", kind: "folder", total: 3, done: 2, passed: 1, failed: 1, flaky: 0, skipped: 0, stopped: 0, running: 1, duration: 3000, tests: 3 });
  assert.deepEqual([billing.name, billing.total, billing.done], ["billing", 3, 0]);
  assert.equal(folderLabel(folders(run(tests, { plan }))), "Folders");
  // Spec files in one folder: each file is its own row, and the tab says Files.
  const flat = folders(run([], { plan: [{ file: "smoke/e2e/watch.spec.mjs", count: 1 }, { file: "smoke/e2e/demo.spec.mjs", count: 1 }] }));
  assert.deepEqual(flat.map((folder) => folder.name), ["watch", "demo"]);
  assert.equal(folderLabel(flat), "Files");
  // Older runs have no plan: folders come from the tests seen.
  assert.deepEqual(folders(run([pulseTest({ file: "e2e/auth/login.spec.ts" })])).map((folder) => [folder.name, folder.total]), [["login", 1]]);
});

test("lists the slowest finished tests and estimates the time left", () => {
  const tests = [1, 5, 3, 9, 2, 7].map((seconds, index) => pulseTest({ id: `t${index}`, duration: seconds * 1000 }));
  assert.deepEqual(slowest(run([...tests, pulseTest({ status: "running" })]), 3).map((test) => test.duration), [9000, 7000, 5000]);
  const live = run(tests, { total: 12, testsStartedAt: "2026-10-04T12:00:00.000Z" });
  // Six done in a minute: six more take about another minute.
  assert.equal(timeLeft(live, Date.parse("2026-10-04T12:01:00.000Z")), 60_000);
  assert.equal(timeLeft(run(tests.slice(0, 2), { total: 12, testsStartedAt: "2026-10-04T12:00:00.000Z" }), Date.now()), null);
  assert.equal(formatTimeLeft(20_000), "under a minute left");
  assert.equal(formatTimeLeft(4 * 60_000), "about 4 min left");
  assert.equal(formatTimeLeft(65 * 60_000), "about 1 h 05 min left");
});

test("durations read naturally at every scale", () => {
  assert.equal(formatDuration(420), "0.4s");
  assert.equal(formatDuration(9_960), "9.9s");
  assert.equal(formatDuration(12_400), "12s");
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDuration(3_725_000), "1h 02m");
  assert.equal(formatClock(7_000), "0:07");
  assert.equal(formatClock(252_000), "4:12");
  assert.equal(formatClock(3_729_000), "1:02:09");
});

test("says how long ago a run ended", () => {
  const now = Date.parse("2026-10-04T13:00:00Z");
  assert.equal(formatAgo("2026-10-04T12:59:30Z", now), "just now");
  assert.equal(formatAgo("2026-10-04T12:48:00Z", now), "12 min ago");
  assert.equal(formatAgo("2026-10-04T10:00:00Z", now), "3 h ago");
});

test("a live run's clock keeps going; an ended one stops at its end", () => {
  const now = Date.parse("2026-10-04T12:01:00Z");
  assert.equal(runElapsed(run([]), now), 60_000);
  assert.equal(runElapsed(run([], { status: "passed", endedAt: "2026-10-04T12:00:42.000Z" }), now), 42_000);
  // Killed without an end: stop at the last write.
  assert.equal(runElapsed(run([], { status: "interrupted" }), now), 30_000);
});

test("shows the command as typed", () => {
  assert.equal(commandLine(["e2e/leads", "-g", "User edits a lead", "--project=authenticated"]),
    'playwright test e2e/leads -g "User edits a lead" --project=authenticated');
  assert.equal(commandLine([]), "playwright test");
});

test("previews the first lines of an error", () => {
  assert.deepEqual(errorPreview("a\nb\nc\nd\ne\n"), { text: "a\nb\nc\nd", more: true });
  assert.deepEqual(errorPreview("only line\n\n"), { text: "only line", more: false });
});

test("sorts attachments into screenshot, video and trace", () => {
  assert.equal(attachmentKind({ name: "screenshot", contentType: "image/png", path: "/a.png" }), "screenshot");
  assert.equal(attachmentKind({ name: "video", contentType: "video/webm", path: "/a.webm" }), "video");
  assert.equal(attachmentKind({ name: "trace", contentType: "application/zip", path: "/trace.zip" }), "trace");
  assert.equal(attachmentKind({ name: "error-context", contentType: "text/markdown", path: "/e.md" }), "other");
});

test("places a test and measures it against its timeout", () => {
  assert.equal(testWhere(pulseTest({ titlePath: ["Leads", "Editing"] })), "Leads › Editing › e2e/a.spec.ts:3");
  const started = pulseTest({ status: "running", startedAt: "2026-10-04T12:00:00.000Z", timeout: 60_000 });
  assert.equal(timeoutShare(started, Date.parse("2026-10-04T12:00:15Z")), 0.25);
  assert.equal(timeoutShare({ ...started, timeout: 0 }, Date.now()), null);
});
