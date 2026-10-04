import assert from "node:assert/strict";
import { test } from "node:test";
import type { PulseTest, RunSnapshot } from "./run.ts";
import { attachmentKind, commandLine, counts, errorPreview, failureMessage, verdict, verdictNote, formatAgo, formatClock, formatDuration, runElapsed, testWhere, timeoutShare } from "./view.ts";

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
