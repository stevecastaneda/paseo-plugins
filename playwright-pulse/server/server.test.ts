import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PulseTest, RunSnapshot } from "../shared/run.ts";
import { openCommand, openFile, previewImage } from "./attachments.ts";
import { removeReporter, reporterState, writeReporter } from "./reporter-install.ts";
import { locateRun, pruneRuns, readRun, runForPanel, type RunLocation } from "./run-file.ts";
import { LATEST_FILE_NAME, runFile } from "./pulse-reporter.mjs";
import { stopRun } from "./stop.ts";

const SOURCE = "// Written by the playwright-pulse Paseo plugin.\nexport default class {}\n";

function pulseTest(overrides: Partial<PulseTest>): PulseTest {
  return { id: "t1", title: "User edits a lead", titlePath: [], file: "e2e/a.spec.ts", line: 1, project: "", status: "passed", retry: 0, timeout: 60_000, attachments: [], ...overrides };
}

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    v: 1, id: "run1-4242", pid: 4242, root: "/repo", args: [], status: "running", startedAt: "2026-10-04T12:00:00.000Z",
    updatedAt: "2026-10-04T12:00:05.000Z", total: 2, projects: [], workers: 1, tests: [], errors: [], ...overrides,
  };
}

function worktree() {
  const root = mkdtempSync(join(tmpdir(), "pulse-wt-"));
  mkdirSync(join(root, ".git"));
  const home = mkdtempSync(join(tmpdir(), "pulse-home-"));
  const location = locateRun(join(root, "apps"), home);
  return { root, home, location };
}

// What the reporter does: write the run's own file, then point latest.json at it.
function writeRun(location: RunLocation, run: RunSnapshot, { latest = true } = {}) {
  mkdirSync(join(location.directory, "runs"), { recursive: true });
  writeFileSync(runFile(location.directory, run.id), JSON.stringify(run));
  if (latest) writeFileSync(join(location.directory, LATEST_FILE_NAME), JSON.stringify({ id: run.id }));
}

test("a run whose process is gone reads as interrupted, with its running test", () => {
  const run = snapshot({ tests: [pulseTest({ status: "running", step: { title: "Click", category: "pw:api", startedAt: "" } })] });
  const died = runForPanel(run, false);
  assert.equal(died.status, "interrupted");
  assert.equal(died.tests[0].status, "interrupted");
  assert.equal(died.tests[0].step, undefined);
  assert.equal(runForPanel(run, true).status, "running");
  // An ended run stays as it ended, process or not.
  assert.equal(runForPanel(snapshot({ status: "passed" }), false).status, "passed");
});

test("passed tests drop their step trail; failed ones keep it", () => {
  const trail = [{ title: "Click", duration: 10 }];
  const run = runForPanel(snapshot({ tests: [
    pulseTest({ id: "a", recentSteps: trail }),
    pulseTest({ id: "b", status: "failed", recentSteps: trail }),
   ] }), true);
  assert.equal(run.tests[0].recentSteps, undefined);
  assert.deepEqual(run.tests[1].recentSteps, trail);
});

test("reads the run file the reporter wrote for this worktree, from any folder in it", async () => {
  const { location, root } = worktree();
  assert.equal(location.root, root);
  assert.equal(await readRun(location), null);
  writeRun(location, snapshot({ status: "passed" }));
  assert.equal((await readRun(location))?.status, "passed");
});

test("shows the newest run, even while an older one is still writing", async () => {
  const { location } = worktree();
  writeRun(location, snapshot({ id: "old-1", status: "running", pid: process.pid }));
  writeRun(location, snapshot({ id: "new-2", status: "passed" }));
  // The older run writes again after the newer one started.
  writeRun(location, snapshot({ id: "old-1", status: "failed" }), { latest: false });
  assert.equal((await readRun(location))?.id, "new-2");
  // A pointer that names something other than a run is ignored.
  writeFileSync(join(location.directory, LATEST_FILE_NAME), JSON.stringify({ id: "../../etc/passwd" }));
  assert.equal(await readRun(location), null);
});

test("a live process id reused by a later process doesn't keep a dead run alive", async () => {
  const { location } = worktree();
  const startedAt = "2026-10-04T12:00:00.000Z";
  writeRun(location, snapshot({ pid: process.pid, startedAt }));
  const startedLater = async () => Date.parse(startedAt) + 60_000;
  const startedBefore = async () => Date.parse(startedAt) - 1_000;
  assert.equal((await readRun(location, startedLater))?.status, "interrupted");
  assert.equal((await readRun(location, startedBefore))?.status, "running");
  // Without ps, a live process id is taken at its word.
  assert.equal((await readRun(location, async () => null))?.status, "running");
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
  // Something unreadable at the path is left alone too.
  const folder = join(directory, "folder.mjs");
  mkdirSync(folder);
  assert.equal(await reporterState(folder, SOURCE), "foreign");
  await assert.rejects(writeReporter(folder, SOURCE), /was not written by this plugin/);
});

test("opens only attachments of the latest run that sit inside the worktree", async () => {
  const { location, root } = worktree();
  const screenshot = join(root, "test-results", "shot.png");
  mkdirSync(join(screenshot, ".."), { recursive: true });
  writeFileSync(screenshot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const elsewhere = join(mkdtempSync(join(tmpdir(), "pulse-out-")), "secret.png");
  writeFileSync(elsewhere, "x");
  writeRun(location, snapshot({ tests: [pulseTest({ attachments: [
    { name: "screenshot", contentType: "image/png", path: screenshot },
    { name: "screenshot", contentType: "image/png", path: elsewhere },
  ] })] }));
  const ref = { runId: "run1-4242", testId: "t1" };
  const first = { ...ref, index: 0, path: screenshot };

  const preview = await previewImage(location, first);
  assert.equal(preview.dataUri, "data:image/png;base64,iVBORw==");
  await assert.rejects(previewImage(location, { ...ref, index: 1, path: elsewhere }), /outside this worktree/);
  await assert.rejects(previewImage(location, { ...ref, index: 2, path: screenshot }), /No such attachment/);
  await assert.rejects(previewImage(location, { ...first, runId: "older" }), /newer one/);
  // A retry put another file at that position: the old reference is refused.
  await assert.rejects(previewImage(location, { ...first, path: join(root, "test-results", "retry0.png") }), /A retry replaced/);

  const opened: string[][] = [];
  await openFile(location, first, async ({ command, args }) => { opened.push([command, ...args]); });
  assert.equal(opened[0].at(-1), (await import("node:fs")).realpathSync(screenshot));
});

test("traces open in the worktree's own Playwright trace viewer", () => {
  const trace = { name: "trace", contentType: "application/zip", path: "/repo/test-results/trace.zip" };
  assert.deepEqual(openCommand(trace, trace.path, "/repo", "darwin"),
    { command: "/repo/node_modules/.bin/playwright", args: ["show-trace", trace.path], detached: true, needs: "/repo/node_modules/.bin/playwright" });
  // On Windows, no .cmd shim and no shell: node runs the viewer's script, and
  // the path, even one with "&" in it, stays one argument.
  const odd = "C:\\repo\\test-results\\a & b\\trace.zip";
  const windows = openCommand({ ...trace, path: odd }, odd, "C:\\repo", "win32");
  assert.equal(windows.command, "node");
  assert.match(windows.args[0], /@playwright[\\/]test[\\/]cli\.js$/);
  assert.deepEqual(windows.args.slice(1), ["show-trace", odd]);
  const video = { name: "video", contentType: "video/webm", path: "/repo/test-results/video.webm" };
  assert.deepEqual(openCommand(video, video.path, "/repo", "darwin"), { command: "open", args: [video.path], detached: false });
});

test("stops only a live run whose process is still Playwright and started with the run", async () => {
  const { location } = worktree();
  const signalled: number[] = [];
  const signal = (pid: number) => { signalled.push(pid); };
  const playwright = async () => "node node_modules/@playwright/test/cli.js test -g edits";
  const startedAt = "2026-10-04T12:00:00.000Z";
  const startTimeOf = async () => Date.parse(startedAt) - 1_000;
  // The test process itself stands in for a live run.
  writeRun(location, snapshot({ pid: process.pid, startedAt }));

  assert.deepEqual(await stopRun(location, "run1-4242", { command: playwright, signal, startTimeOf }), { stopped: true });
  assert.deepEqual(signalled, [process.pid]);

  await assert.rejects(stopRun(location, "older", { command: playwright, signal, startTimeOf }), /newer one/);
  // An id the system reused for something else is left alone.
  await assert.rejects(stopRun(location, "run1-4242", { command: async () => "/usr/bin/vim notes.txt", signal, startTimeOf }), /already exited/);
  // So is one reused by another Playwright run that started later.
  await assert.rejects(stopRun(location, "run1-4242", { command: playwright, signal, startTimeOf: async () => Date.parse(startedAt) + 5_000 }), /already exited/);
  // And when ps can't say when it started.
  await assert.rejects(stopRun(location, "run1-4242", { command: playwright, signal, startTimeOf: async () => null }), /already exited/);
  writeRun(location, snapshot({ pid: process.pid, status: "passed" }));
  await assert.rejects(stopRun(location, "run1-4242", { command: playwright, signal, startTimeOf }), /already ended/);
  assert.equal(signalled.length, 1);
});

test("stopping the plugin removes its reporter, but never someone else's file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pulse-reporter-"));
  const path = join(directory, "reporter.mjs");
  assert.equal(await removeReporter(path), false);
  await writeReporter(path, SOURCE);
  assert.equal(await removeReporter(path), true);
  assert.equal(existsSync(path), false);
  writeFileSync(path, "export default class Mine {}\n");
  assert.equal(await removeReporter(path), false);
  assert.equal(readFileSync(path, "utf8"), "export default class Mine {}\n");
});

test("drops the runs of worktrees that were deleted, and keeps the rest", async () => {
  const kept = worktree();
  const gone = worktree();
  const home = kept.home;
  // Both worktrees' runs under one home.
  const goneLocation = locateRun(gone.root, home);
  // The reporter records the resolved root.
  writeRun(kept.location, snapshot({ root: realpathSync(kept.root) }));
  writeRun(goneLocation, snapshot({ root: realpathSync(gone.root) }));
  rmSync(gone.root, { recursive: true });
  const removed = await pruneRuns(home);
  assert.deepEqual(removed, [goneLocation.directory]);
  assert.equal(existsSync(goneLocation.directory), false);
  assert.equal(existsSync(join(kept.location.directory, LATEST_FILE_NAME)), true);
});

test("pruning leaves a folder alone unless it's plainly a gone worktree's runs", async () => {
  const { home } = worktree();
  const vanished = realpathSync(mkdtempSync(join(tmpdir(), "pulse-wt-")));
  rmSync(vanished, { recursive: true });
  // A run naming a gone worktree, in a folder named for another one.
  const other = worktree();
  const elsewhere = locateRun(other.root, home);
  writeRun(elsewhere, snapshot({ root: vanished }));
  // A gone worktree's folder with someone else's file in it.
  const crowded = locateRun(vanished, home);
  writeRun(crowded, snapshot({ root: vanished }));
  writeFileSync(join(crowded.directory, "notes.txt"), "mine");
  assert.deepEqual(await pruneRuns(home), []);
  assert.equal(existsSync(join(elsewhere.directory, LATEST_FILE_NAME)), true);
  assert.equal(readFileSync(join(crowded.directory, "notes.txt"), "utf8"), "mine");
});
