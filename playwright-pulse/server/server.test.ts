import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { test } from "node:test";
import type { PulseTest, RunSnapshot } from "../shared/run.ts";
import { type Host, type HostCommand, MAX_PREVIEW_BYTES, type Opener, openFile, previewImage, systemOpener } from "./attachments.ts";
import { removeReporter, reporterState, writeReporter } from "./reporter-install.ts";
import { locateRun, pruneRuns, readRun, runForPanel, type RunLocation } from "./run-file.ts";
import { LATEST_FILE_NAME, runFile } from "./pulse-reporter.mjs";
import { stopRun } from "./stop.ts";
import { handleGetBriefs } from "./pulse.ts";

const SOURCE = "// Written by the playwright-pulse Paseo plugin.\nexport default class {}\n";

function pulseTest(overrides: Partial<PulseTest>): PulseTest {
  return {
    id: "t1",
    title: "User edits a lead",
    titlePath: [],
    file: "e2e/a.spec.ts",
    line: 1,
    project: "",
    status: "passed",
    retry: 0,
    timeout: 60_000,
    attachments: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    v: 1,
    id: "run1-4242",
    pid: 4242,
    root: "/repo",
    args: [],
    status: "running",
    startedAt: "2026-10-04T12:00:00.000Z",
    updatedAt: "2026-10-04T12:00:05.000Z",
    total: 2,
    projects: [],
    workers: 1,
    tests: [],
    errors: [],
    ...overrides,
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
  const run = runForPanel(
    snapshot({ tests: [pulseTest({ id: "a", recentSteps: trail }), pulseTest({ id: "b", status: "failed", recentSteps: trail })] }),
    true,
  );
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

test("briefs each workspace's newest run for the header pill", async () => {
  const { location, root, home } = worktree();
  const elsewhere = mkdtempSync(join(tmpdir(), "pulse-empty-"));
  writeRun(
    location,
    snapshot({ status: "failed", endedAt: "2026-10-04T12:01:00.000Z", total: 2, tests: [pulseTest({ status: "failed" }), pulseTest({ id: "t2" })] }),
  );
  const { briefs } = await handleGetBriefs({ directories: [root, join(root, "apps"), elsewhere] }, home);
  const brief = { runId: "run1-4242", status: "failed", done: 2, total: 2, failed: 1, endedAt: "2026-10-04T12:01:00.000Z" };
  assert.deepEqual(briefs, { [root]: brief, [join(root, "apps")]: brief, [elsewhere]: null });
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
  writeRun(
    location,
    snapshot({
      tests: [
        pulseTest({
          attachments: [
            { name: "screenshot", contentType: "image/png", path: screenshot },
            { name: "screenshot", contentType: "image/png", path: elsewhere },
          ],
        }),
      ],
    }),
  );
  const ref = { runId: "run1-4242", testId: "t1" };
  const first = { ...ref, index: 0, path: screenshot };

  const preview = await previewImage(location, first);
  assert.equal(preview.dataUri, "data:image/png;base64,iVBORw==");
  await assert.rejects(previewImage(location, { ...ref, index: 1, path: elsewhere }), /outside this worktree/);
  await assert.rejects(previewImage(location, { ...ref, index: 2, path: screenshot }), /No such attachment/);
  await assert.rejects(previewImage(location, { ...first, runId: "older" }), /newer one/);
  // A retry put another file at that position: the old reference is refused.
  await assert.rejects(previewImage(location, { ...first, path: join(root, "test-results", "retry0.png") }), /A retry replaced/);

  // Too large to preview, but still a screenshot the dialog can open.
  const large = join(root, "test-results", "large.png");
  writeFileSync(large, Buffer.alloc(MAX_PREVIEW_BYTES + 1));
  writeRun(location, snapshot({ tests: [pulseTest({ attachments: [{ name: "screenshot", contentType: "image/png", path: large }] })] }));
  assert.deepEqual(await previewImage(location, { ...ref, index: 0, path: large }), { dataUri: null, bytes: MAX_PREVIEW_BYTES + 1 });
});

function sh(file: string, body: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function recorder() {
  const commands: HostCommand[] = [];
  const opener: Opener = async (command) => {
    commands.push(command);
  };
  return { commands, opener, ran: () => commands.map(({ command, args }) => [command, ...args]) };
}

function isInside(root: string, path: string): boolean {
  const inside = relative(root, path);
  return !inside.startsWith("..") && !isAbsolute(inside);
}

function at(index: number, path: string) {
  return { runId: "run1-4242", testId: "t1", index, path };
}

async function playwright() {
  return "node node_modules/@playwright/test/cli.js test -g edits";
}

test("a branch checked out after the run can't make Trace or Open run its files", async (t) => {
  if (process.platform === "win32") return t.skip("needs symlinks and sh");
  const root = mkdtempSync(join(tmpdir(), "pulse-git-"));
  const home = mkdtempSync(join(tmpdir(), "pulse-home-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.symlinks=true", ...args], { cwd: root, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, ".gitignore"), "node_modules/\ntest-results/\n");
  git("add", ".gitignore");
  git("commit", "-q", "-m", "main");

  // Someone else's branch: a fake Playwright and xdg-open, a script, and the
  // run's video and screenshot as links to the script, all past .gitignore.
  const ran = join(home, "attacker-ran");
  git("checkout", "-q", "-b", "pr");
  sh(join(root, "node_modules", ".bin", "playwright"), `echo playwright >> "${ran}"`);
  sh(join(root, "node_modules", ".bin", "xdg-open"), `echo xdg-open >> "${ran}"`);
  sh(join(root, "evil.command"), `echo evil >> "${ran}"`);
  mkdirSync(join(root, "test-results", "t1"), { recursive: true });
  symlinkSync("../../evil.command", join(root, "test-results", "t1", "video.webm"));
  symlinkSync("../../evil.command", join(root, "test-results", "t1", "shot.png"));
  git("add", "-f", "node_modules", "evil.command", "test-results");
  git("commit", "-q", "-m", "pr");
  git("checkout", "-q", "main");

  // The user's own run on main recorded a trace, a video and a screenshot.
  sh(join(root, "node_modules", ".bin", "playwright"), "exit 0");
  const trace = join(root, "test-results", "t1", "trace.zip");
  const video = join(root, "test-results", "t1", "video.webm");
  const shot = join(root, "test-results", "t1", "shot.png");
  mkdirSync(dirname(trace), { recursive: true });
  writeFileSync(trace, "PK");
  writeFileSync(video, "webm");
  writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const location = locateRun(root, home);
  writeRun(
    location,
    snapshot({
      tests: [
        pulseTest({
          attachments: [
            { name: "trace", contentType: "application/zip", path: trace },
            { name: "video", contentType: "video/webm", path: video },
            { name: "screenshot", contentType: "image/png", path: shot },
          ],
        }),
      ],
    }),
  );

  // xdg-open comes from PATH, skipping the worktree's folders and relative ones.
  const bin = mkdtempSync(join(tmpdir(), "pulse-bin-"));
  const log = join(bin, "log");
  sh(join(bin, "xdg-open"), `echo "$@" >> "${log}"`);
  const host: Host = { platform: "linux", env: { PATH: [join(root, "node_modules", ".bin"), "node_modules/.bin", bin].join(":") }, home };

  const before = recorder();
  await openFile(location, at(1, video), before.opener, host);
  await openFile(location, at(2, shot), before.opener, host);
  assert.deepEqual(before.ran(), [
    [join(bin, "xdg-open"), video],
    [join(bin, "xdg-open"), shot],
  ]);
  for (const { cwd } of before.commands) assert.ok(!isInside(root, cwd), `${cwd} is outside the worktree`);

  git("checkout", "-q", "pr");
  assert.ok(lstatSync(video).isSymbolicLink(), "checkout swapped the ignored video for the branch's link");
  assert.match(readFileSync(join(root, "node_modules", ".bin", "playwright"), "utf8"), /attacker-ran/, "checkout swapped the ignored playwright");

  // Trace shows its folder through the system's own opener and hands back a
  // command for the user, which reads nothing from the worktree.
  const shown = await openFile(location, at(0, trace), systemOpener, host);
  assert.equal(readFileSync(log, "utf8"), `${dirname(trace)}\n`);
  assert.equal(shown.traceCommand, `npx --prefix "${home}" playwright show-trace "${trace}"`);

  const after = recorder();
  await assert.rejects(openFile(location, at(1, video), after.opener, host), /video is a link/);
  await assert.rejects(openFile(location, at(2, shot), after.opener, host), /screenshot is a link/);
  await assert.rejects(previewImage(location, at(2, shot)), /screenshot is a link/);
  assert.deepEqual(after.commands, []);
  assert.ok(!existsSync(ran), "nothing the branch committed ran");
});

test("Open takes only a real file of the attachment's own type, never through a linked folder", async () => {
  const { root, home, location } = worktree();
  const script = join(root, "test-results", "t1", "video.command");
  const mp4 = join(root, "test-results", "t1", "clip.MP4");
  const real = join(root, "elsewhere", "video.webm");
  mkdirSync(dirname(script), { recursive: true });
  mkdirSync(dirname(real), { recursive: true });
  writeFileSync(script, "#!/bin/sh\n");
  writeFileSync(mp4, "mp4");
  writeFileSync(real, "webm");
  symlinkSync(dirname(real), join(root, "test-results", "linked"), "dir");
  const linked = join(root, "test-results", "linked", "video.webm");
  writeRun(
    location,
    snapshot({
      tests: [
        pulseTest({
          attachments: [
            { name: "video", contentType: "video/webm", path: script },
            { name: "video", contentType: "video/webm", path: linked },
            { name: "video", contentType: "video/mp4", path: mp4 },
          ],
        }),
      ],
    }),
  );
  const { opener, ran } = recorder();
  const host: Host = { platform: "darwin", env: {}, home };
  await assert.rejects(openFile(location, at(0, script), opener, host), /video isn't a video/);
  await assert.rejects(openFile(location, at(1, linked), opener, host), /video is a link/);
  await openFile(location, at(2, mp4), opener, host);
  assert.deepEqual(ran(), [["/usr/bin/open", realpathSync(mp4)]]);
});

test("each system's opener is called by absolute path, from a folder outside the worktree", async () => {
  const { root, home, location } = worktree();
  const trace = join(root, "test-results", "t1", "trace.zip");
  const video = join(root, "test-results", "t1", "video.webm");
  mkdirSync(dirname(trace), { recursive: true });
  writeFileSync(trace, "PK");
  writeFileSync(video, "webm");
  writeRun(
    location,
    snapshot({
      tests: [
        pulseTest({
          attachments: [
            { name: "trace", contentType: "application/zip", path: trace },
            { name: "video", contentType: "video/webm", path: video },
          ],
        }),
      ],
    }),
  );
  const refs = [
    { runId: "run1-4242", testId: "t1", index: 0, path: trace },
    { runId: "run1-4242", testId: "t1", index: 1, path: video },
  ];
  const both = async (host: Host) => {
    const { commands, opener, ran } = recorder();
    for (const ref of refs) await openFile(location, ref, opener, host);
    for (const { cwd } of commands) assert.ok(!isInside(root, cwd), `${cwd} is outside the worktree`);
    return ran();
  };
  const [shownTrace, shownVideo] = [realpathSync(trace), realpathSync(video)];
  assert.deepEqual(await both({ platform: "darwin", env: {}, home }), [
    ["/usr/bin/open", "-R", shownTrace],
    ["/usr/bin/open", shownVideo],
  ]);
  assert.deepEqual(await both({ platform: "win32", env: { SystemRoot: "D:\\Windows" }, home }), [
    ["D:\\Windows\\explorer.exe", "/select,", shownTrace],
    ["D:\\Windows\\explorer.exe", shownVideo],
  ]);
  // A missing or relative SystemRoot falls back to the usual folder, never a bare name.
  for (const env of [{}, { SystemRoot: "Windows" }]) {
    assert.equal((await both({ platform: "win32", env, home }))[0][0], "C:\\Windows\\explorer.exe");
  }
  await assert.rejects(openFile(location, refs[1], recorder().opener, { platform: "linux", env: { PATH: "" }, home }), /xdg-open/);
});

test("no command is copied for a trace whose path a shell would read as code", async () => {
  const { root, home, location } = worktree();
  const trace = join(root, "test-results", "$(touch pwned)", "trace.zip");
  mkdirSync(dirname(trace), { recursive: true });
  writeFileSync(trace, "PK");
  writeRun(location, snapshot({ tests: [pulseTest({ attachments: [{ name: "trace", contentType: "application/zip", path: trace }] })] }));
  const shown = await openFile(location, { runId: "run1-4242", testId: "t1", index: 0, path: trace }, recorder().opener, { platform: "darwin", env: {}, home });
  assert.equal(shown.traceCommand, undefined);
});

test("stops only a live run whose process is still Playwright and started with the run", async () => {
  const { location } = worktree();
  const signalled: number[] = [];
  const signal = (pid: number) => {
    signalled.push(pid);
  };
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
  await assert.rejects(
    stopRun(location, "run1-4242", { command: playwright, signal, startTimeOf: async () => Date.parse(startedAt) + 5_000 }),
    /already exited/,
  );
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
