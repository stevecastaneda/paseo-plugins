import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RunSnapshot } from "../shared/run.ts";
import PulseReporter, { findRoot, pulseDirectory } from "./pulse-reporter.mjs";

// Shapes Playwright hands a reporter, cut down to what the reporter reads.
function fakeTest(root: string, id: string, title: string, outcome = "expected") {
  const project = { name: "authenticated" };
  return {
    id,
    title,
    timeout: 60_000,
    location: { file: join(root, "e2e", "leads", "leads.spec.ts"), line: 12 },
    parent: { project: () => project },
    titlePath: () => ["", "authenticated", "leads/leads.spec.ts", "Leads", title],
    outcome: () => outcome,
  };
}

function step(title: string, category: string, extra: Record<string, unknown> = {}) {
  return { title, category, startTime: new Date("2026-10-04T12:00:00Z"), duration: 120, ...extra };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "pulse-root-"));
  mkdirSync(join(root, ".git"));
  const directory = join(root, "store");
  const reporter = new PulseReporter({ cwd: root, directory });
  const read = () => JSON.parse(readFileSync(join(directory, "run.json"), "utf8")) as RunSnapshot;
  return { root, reporter, read };
}

test("writes Starting up as soon as Playwright builds the reporter", () => {
  const { read } = setup();
  const snapshot = read();
  assert.equal(snapshot.status, "starting");
  assert.equal(snapshot.pid, process.pid);
  assert.deepEqual(snapshot.tests, []);
});

test("tracks a passing test with its live step and context", async () => {
  const { root, reporter, read } = setup();
  const one = fakeTest(root, "t1", "User edits a lead");
  reporter.onBegin({ workers: 1 }, { allTests: () => [one, fakeTest(root, "t2", "User deletes a lead")] });
  assert.equal(read().status, "running");
  assert.equal(read().total, 2);
  assert.deepEqual(read().projects, ["authenticated"]);

  reporter.onTestBegin(one, { retry: 0, startTime: new Date() });
  const wrapper = step("Open the lead", "test.step");
  const click = step("Click", "pw:api", { subtitle: "getByTestId('save')", parent: wrapper });
  reporter.onStepBegin(one, {}, wrapper);
  reporter.onStepBegin(one, {}, step("page", "fixture"));
  reporter.onStepBegin(one, {}, click);
  // Steps are written in batches; onExit writes whatever is waiting.
  await reporter.onExit();
  const live = read().tests[0];
  assert.equal(live.status, "running");
  assert.equal(live.file, join("e2e", "leads", "leads.spec.ts"));
  assert.deepEqual(live.titlePath, ["Leads"]);
  assert.deepEqual(live.step && { title: live.step.title, subtitle: live.step.subtitle, context: live.step.context },
    { title: "Click", subtitle: "getByTestId('save')", context: "Open the lead" });

  reporter.onStepEnd(one, {}, click);
  reporter.onTestEnd(one, { status: "passed", retry: 0, duration: 4200, errors: [], attachments: [] });
  const done = read().tests[0];
  assert.equal(done.status, "passed");
  assert.equal(done.duration, 4200);
  assert.equal(done.step, undefined);
  assert.deepEqual(done.recentSteps, [{ title: "Click", subtitle: "getByTestId('save')", duration: 120 }]);
});

test("keeps a failure's error, failing step and files, without terminal colors", () => {
  const { root, reporter, read } = setup();
  const one = fakeTest(root, "t1", "User saves a scenario", "unexpected");
  reporter.onBegin({ workers: 1 }, { allTests: () => [one] });
  reporter.onTestBegin(one, { retry: 0, startTime: new Date() });
  const expectStep = step("Expect \"toBeVisible\"", "expect", { subtitle: "getByText('Saved')", error: { message: "boom" } });
  reporter.onStepBegin(one, {}, expectStep);
  reporter.onStepEnd(one, {}, expectStep);
  reporter.onTestEnd(one, {
    status: "failed",
    retry: 0,
    duration: 9000,
    errors: [{ message: "\u001b[31mError: expect(locator).toBeVisible() failed\u001b[39m", snippet: "\u001b[2m> 12 |\u001b[22m await expect(saved)", location: { file: join(root, "e2e", "leads", "leads.spec.ts"), line: 12 } }],
    attachments: [
      { name: "screenshot", contentType: "image/png", path: join(root, ".context", "test-results", "a", "test-failed-1.png") },
      { name: "trace", contentType: "application/zip", body: Buffer.from("") },
    ],
  });
  reporter.onEnd({ status: "failed" });
  const snapshot = read();
  assert.equal(snapshot.status, "failed");
  assert.ok(snapshot.endedAt);
  const failed = snapshot.tests[0];
  assert.equal(failed.outcome, "unexpected");
  assert.equal(failed.error?.message, "Error: expect(locator).toBeVisible() failed");
  assert.equal(failed.error?.snippet, "> 12 | await expect(saved)");
  assert.deepEqual(failed.error?.location, { file: join("e2e", "leads", "leads.spec.ts"), line: 12 });
  assert.equal(failed.failedStep, "Expect \"toBeVisible\" · getByText('Saved')");
  // Only attachments saved to disk can be opened later.
  assert.deepEqual(failed.attachments.map((attachment) => attachment.name), ["screenshot"]);
});

test("a retry reuses the test's row, and an interrupted run closes running tests", () => {
  const { root, reporter, read } = setup();
  const one = fakeTest(root, "t1", "User edits a lead", "flaky");
  reporter.onBegin({ workers: 1 }, { allTests: () => [one] });
  reporter.onTestBegin(one, { retry: 0, startTime: new Date() });
  reporter.onTestEnd(one, { status: "failed", retry: 0, duration: 10, errors: [{ message: "first try" }], attachments: [] });
  reporter.onTestBegin(one, { retry: 1, startTime: new Date() });
  assert.equal(read().tests.length, 1);
  assert.equal(read().tests[0].error, undefined);
  assert.equal(read().tests[0].retry, 1);
  reporter.onEnd({ status: "interrupted" });
  assert.equal(read().status, "interrupted");
  assert.equal(read().tests[0].status, "interrupted");
});

test("a write that fails never throws into Playwright", () => {
  const root = mkdtempSync(join(tmpdir(), "pulse-root-"));
  const blocker = join(root, "file");
  writeFileSync(blocker, "");
  // The store folder would have to live inside a file.
  const reporter = new PulseReporter({ cwd: root, directory: join(blocker, "store") });
  assert.doesNotThrow(() => reporter.onEnd({ status: "passed" }));
});

test("finds the worktree root and names its folder after it", () => {
  const root = mkdtempSync(join(tmpdir(), "pulse-root-"));
  writeFileSync(join(root, ".git"), "gitdir: elsewhere\n");
  mkdirSync(join(root, "apps", "web"), { recursive: true });
  assert.equal(findRoot(join(root, "apps", "web")), root);
  const folder = pulseDirectory(root, "/home/me");
  assert.match(folder, /^\/home\/me\/\.local\/state\/playwright-pulse\/pulse-root-\w+-[0-9a-f]{8}$/);
});
