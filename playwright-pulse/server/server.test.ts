import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PulseTest, RunSnapshot } from "../shared/run.ts";
import { openCommand, openFile, previewImage } from "./attachments.ts";
import { reporterState, writeReporter } from "./reporter-install.ts";
import { locateRun, readRun, runForPanel } from "./run-file.ts";
import { stopRun } from "./stop.ts";

const SOURCE = "// Written by the playwright-pulse Paseo plugin.\nexport default class {}\n";

function pulseTest(overrides: Partial<PulseTest>): PulseTest {
  return { id: "t1", title: "User edits a lead", titlePath: [], file: "e2e/a.spec.ts", line: 1, project: "", status: "passed", retry: 0, timeout: 60_000, attachments: [], ...overrides };
}

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    v: 1, id: "run-1", pid: 4242, root: "/repo", args: [], status: "running", startedAt: "2026-10-04T12:00:00.000Z",
    updatedAt: "2026-10-04T12:00:05.000Z", total: 2, projects: [], workers: 1, tests: [], errors: [], ...overrides,
  };
}

function worktree() {
  const root = mkdtempSync(join(tmpdir(), "pulse-wt-"));
  mkdirSync(join(root, ".git"));
  const home = mkdtempSync(join(tmpdir(), "pulse-home-"));
  const location = locateRun(join(root, "apps"), home);
  mkdirSync(join(location.file, ".."), { recursive: true });
  return { root, home, location };
}

test("a run whose process is gone reads as interrupted, with its running test", () => {
  const run = snapshot({ tests: [pulseTest({ status: "running", step: { title: "Click", category: "pw:api", startedAt: "" } })] });
  const died = runForPanel(run, () => false);
  assert.equal(died.status, "interrupted");
  assert.equal(died.tests[0].status, "interrupted");
  assert.equal(died.tests[0].step, undefined);
  assert.equal(runForPanel(run, () => true).status, "running");
  // An ended run stays as it ended, process or not.
  assert.equal(runForPanel(snapshot({ status: "passed" }), () => false).status, "passed");
});

test("passed tests drop their step trail; failed ones keep it", () => {
  const trail = [{ title: "Click", duration: 10 }];
  const run = runForPanel(snapshot({ tests: [
    pulseTest({ id: "a", recentSteps: trail }),
    pulseTest({ id: "b", status: "failed", recentSteps: trail }),
  ] }), () => true);
  assert.equal(run.tests[0].recentSteps, undefined);
  assert.deepEqual(run.tests[1].recentSteps, trail);
});

test("reads the run file the reporter wrote for this worktree, from any folder in it", async () => {
  const { location, root } = worktree();
  assert.equal(location.root, root);
  assert.equal(await readRun(location), null);
  writeFileSync(location.file, JSON.stringify(snapshot({ status: "passed" })));
  assert.equal((await readRun(location))?.status, "passed");
});

test("installs the reporter, updates its own copy, and leaves anyone else's alone", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pulse-reporter-"));
  const path = join(directory, "nested", "reporter.mjs");
  assert.equal(await reporterState(path, SOURCE), "missing");
  assert.equal(await writeReporter(path, SOURCE), "current");
  assert.equal(readFileSync(path, "utf8"), SOURCE);
  const newer = `${SOURCE}// v2\n`;
  assert.equal(await reporterState(path, newer), "outdated");
  assert.equal(await writeReporter(path, newer), "current");
  writeFileSync(path, "export default class Mine {}\n");
  assert.equal(await reporterState(path, newer), "foreign");
  await assert.rejects(writeReporter(path, newer), /was not written by this plugin/);
});

test("opens only attachments of the latest run that sit inside the worktree", async () => {
  const { location, root } = worktree();
  const screenshot = join(root, "test-results", "shot.png");
  mkdirSync(join(screenshot, ".."), { recursive: true });
  writeFileSync(screenshot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const elsewhere = join(mkdtempSync(join(tmpdir(), "pulse-out-")), "secret.png");
  writeFileSync(elsewhere, "x");
  writeFileSync(location.file, JSON.stringify(snapshot({ tests: [pulseTest({ attachments: [
    { name: "screenshot", contentType: "image/png", path: screenshot },
    { name: "screenshot", contentType: "image/png", path: elsewhere },
  ] })] })));
  const ref = { runId: "run-1", testId: "t1" };

  const preview = await previewImage(location, { ...ref, index: 0 });
  assert.equal(preview.dataUri, "data:image/png;base64,iVBORw==");
  await assert.rejects(previewImage(location, { ...ref, index: 1 }), /outside this worktree/);
  await assert.rejects(previewImage(location, { ...ref, index: 2 }), /No such attachment/);
  await assert.rejects(previewImage(location, { ...ref, runId: "older", index: 0 }), /newer one/);

  const opened: string[][] = [];
  await openFile(location, { ...ref, index: 0 }, async ({ command, args }) => { opened.push([command, ...args]); });
  assert.equal(opened[0].at(-1), (await import("node:fs")).realpathSync(screenshot));
});

test("traces open in the worktree's own Playwright trace viewer", () => {
  const trace = { name: "trace", contentType: "application/zip", path: "/repo/test-results/trace.zip" };
  assert.deepEqual(openCommand(trace, trace.path, "/repo", "darwin"),
    { command: "/repo/node_modules/.bin/playwright", args: ["show-trace", trace.path], detached: true });
  const video = { name: "video", contentType: "video/webm", path: "/repo/test-results/video.webm" };
  assert.deepEqual(openCommand(video, video.path, "/repo", "darwin"), { command: "open", args: [video.path], detached: false });
});

test("stops only a live run whose process is still Playwright", async () => {
  const { location } = worktree();
  const signalled: number[] = [];
  const signal = (pid: number) => { signalled.push(pid); };
  const playwright = async () => "node node_modules/@playwright/test/cli.js test -g edits";
  // The test process itself stands in for a live run.
  writeFileSync(location.file, JSON.stringify(snapshot({ pid: process.pid })));

  assert.deepEqual(await stopRun(location, "run-1", { command: playwright, signal }), { stopped: true });
  assert.deepEqual(signalled, [process.pid]);

  await assert.rejects(stopRun(location, "older", { command: playwright, signal }), /newer one/);
  // An id the system reused for something else is left alone.
  await assert.rejects(stopRun(location, "run-1", { command: async () => "/usr/bin/vim notes.txt", signal }), /already exited/);
  writeFileSync(location.file, JSON.stringify(snapshot({ pid: process.pid, status: "passed" })));
  await assert.rejects(stopRun(location, "run-1", { command: playwright, signal }), /already ended/);
  assert.equal(signalled.length, 1);
});
