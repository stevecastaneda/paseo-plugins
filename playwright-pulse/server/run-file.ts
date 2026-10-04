// Reads a worktree's latest run for the panel. The reporter rewrites its run's
// file up to four times a second while tests run; the panel asks every second.
import { execFile } from "node:child_process";
import { readdir, readFile, rm, rmdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { isFailure } from "../shared/view.ts";
import type { RunSnapshot } from "../shared/run.ts";
import { LATEST_FILE_NAME, RUNS_FOLDER, RUN_ID, findRoot, pulseDirectory, runFile } from "./pulse-reporter.mjs";

// `directory` holds the worktree's runs; `shown` names it for people.
export type RunLocation = { root: string; directory: string; shown: string };

export function locateRun(workspaceDirectory: string, home = homedir()): RunLocation {
  const root = findRoot(workspaceDirectory);
  const directory = pulseDirectory(root, home);
  return { root, directory, shown: directory.startsWith(home) ? `~${directory.slice(home.length)}` : directory };
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

// Whether a process with this id exists on this host.
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // It exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// When a process started, to the second, or null when `ps` can't say.
export type StartTimeOf = (pid: number) => Promise<number | null>;

export const processStartTime: StartTimeOf = async (pid) => {
  try {
    const { stdout } = await promisify(execFile)("ps", ["-o", "lstart=", "-p", String(pid)]);
    const time = Date.parse(stdout.trim());
    return Number.isNaN(time) ? null : time;
  } catch {
    return null;
  }
};

// Whether the process that wrote a run is still running. Process ids get
// reused, so the process must also have started no later than the run did: one
// that took the id over after the run's process died started after it.
// Null when that can't be checked (no `ps`).
export async function runProcessAlive(run: RunSnapshot, startTimeOf: StartTimeOf = processStartTime): Promise<boolean | null> {
  if (!processAlive(run.pid)) return false;
  const started = await startTimeOf(run.pid);
  if (started === null) return null;
  return started <= Date.parse(run.startedAt);
}

// The parsed file, kept until its size or change time moves.
const cache = new Map<string, { size: number; mtimeMs: number; run: RunSnapshot | null }>();

export async function readRunFile(file: string): Promise<RunSnapshot | null> {
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  const cached = cache.get(file);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.run;
  let run: RunSnapshot | null = null;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed?.v === 1 && Array.isArray(parsed.tests)) run = parsed as RunSnapshot;
  } catch {
    // Unreadable: show nothing rather than half a run. The next write fixes it.
  }
  // Runs are replaced, not kept; so is their cache entry.
  if (!cached) for (const key of cache.keys()) if (dirname(key) === dirname(file)) cache.delete(key);
  cache.set(file, { size: info.size, mtimeMs: info.mtimeMs, run });
  return run;
}

// The id latest.json names, or null before the first run.
export async function latestRunId(directory: string): Promise<string | null> {
  try {
    const id = JSON.parse(await readFile(join(directory, LATEST_FILE_NAME), "utf8"))?.id;
    return typeof id === "string" && RUN_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

// The worktree's newest run, as its reporter last wrote it.
export async function readLatestRun(location: Pick<RunLocation, "directory">): Promise<RunSnapshot | null> {
  const id = await latestRunId(location.directory);
  if (!id) return null;
  const run = await readRunFile(runFile(location.directory, id));
  return run?.id === id ? run : null;
}

// The run the panel asked about, only while it's still the newest.
export async function readCurrentRun(location: RunLocation, runId: string): Promise<RunSnapshot> {
  const run = await readLatestRun(location);
  if (!run || run.id !== runId) throw new Error("That run has been replaced by a newer one.");
  return run;
}

export function isOpen(run: RunSnapshot): boolean {
  return run.status === "starting" || run.status === "running";
}

// What the panel needs, and no more: finished tests drop their step trail, so
// a full suite stays small enough to send every second. A run whose process
// is gone without ending reads as interrupted, and so do its running tests.
export function runForPanel(run: RunSnapshot, alive: boolean): RunSnapshot {
  const died = isOpen(run) && !alive;
  return {
    ...run,
    status: died ? "interrupted" : run.status,
    tests: run.tests.map((test) => {
      if (test.status === "running") {
        return died ? { ...test, status: "interrupted", step: undefined } : test;
      }
      const { recentSteps: _recentSteps, ...rest } = test;
      return isFailure(test) ? test : rest;
    }),
  };
}

export async function readRun(location: RunLocation, startTimeOf: StartTimeOf = processStartTime): Promise<RunSnapshot | null> {
  const run = await readLatestRun(location);
  if (!run) return null;
  // Without `ps`, a live process id is the best evidence there is.
  const alive = isOpen(run) && ((await runProcessAlive(run, startTimeOf)) ?? processAlive(run.pid));
  return runForPanel(run, alive);
}

// The files the reporter writes in a run folder, and their temporary twins.
const REPORTER_FILE = /^(latest|[a-z0-9]+-\d+)\.json(\.\d+\.tmp)?$/;

// Drops the runs of worktrees that no longer exist, so archived worktrees
// don't leave their last run behind. Only a folder named for its run's own
// worktree is cleared, only once that worktree is gone (not merely
// unreadable), and only of the files the reporter writes: anything else
// keeps the folder. Runs on start; failures are ignored.
export async function pruneRuns(home = homedir()): Promise<string[]> {
  const parent = dirname(pulseDirectory(home, home));
  const folders = await readdir(parent, { withFileTypes: true }).catch(() => []);
  const removed: string[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const directory = join(parent, folder.name);
    const run = await readLatestRun({ directory });
    if (!run?.root || basename(pulseDirectory(run.root, home)) !== folder.name) continue;
    const gone = await stat(run.root).then(() => false, isMissing);
    if (!gone) continue;
    try {
      const runs = join(directory, RUNS_FOLDER);
      const names = await readdir(runs).catch((error) => (isMissing(error) ? [] : Promise.reject(error)));
      for (const name of names) if (REPORTER_FILE.test(name)) await rm(join(runs, name), { force: true });
      await rmdir(runs).catch((error) => (isMissing(error) ? undefined : Promise.reject(error)));
      for (const name of await readdir(directory)) if (REPORTER_FILE.test(name)) await rm(join(directory, name), { force: true });
      await rmdir(directory);
      removed.push(directory);
    } catch {
      // Something else is in there; leave it.
    }
  }
  return removed;
}
