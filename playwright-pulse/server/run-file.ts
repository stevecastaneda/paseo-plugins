// Reads a worktree's latest run for the panel. The reporter rewrites the file
// up to four times a second while tests run; the panel asks every second.
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { RUN_FILE_NAME, findRoot, pulseDirectory } from "./pulse-reporter.mjs";
import type { RunSnapshot } from "../shared/run.ts";

export type RunLocation = { root: string; file: string; shown: string };

export function locateRun(workspaceDirectory: string, home = homedir()): RunLocation {
  const root = findRoot(workspaceDirectory);
  const file = join(pulseDirectory(root, home), RUN_FILE_NAME);
  return { root, file, shown: file.startsWith(home) ? `~${file.slice(home.length)}` : file };
}

// Whether the process that wrote the run is still running on this host.
export type IsAlive = (pid: number) => boolean;

export const processAlive: IsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // It exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

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
  cache.set(file, { size: info.size, mtimeMs: info.mtimeMs, run });
  return run;
}

// What the panel needs, and no more: finished tests drop their step trail, so
// a full suite stays small enough to send every second. A run whose process
// is gone without ending reads as interrupted, and so do its running tests.
export function runForPanel(run: RunSnapshot, alive: IsAlive): RunSnapshot {
  const open = run.status === "starting" || run.status === "running";
  const died = open && !alive(run.pid);
  return {
    ...run,
    status: died ? "interrupted" : run.status,
    tests: run.tests.map((test) => {
      if (test.status === "running") {
        return died ? { ...test, status: "interrupted", step: undefined } : test;
      }
      const { recentSteps: _recentSteps, ...rest } = test;
      return test.status === "failed" || test.status === "timedOut" ? test : rest;
    }),
  };
}

export async function readRun(location: RunLocation, alive: IsAlive = processAlive): Promise<RunSnapshot | null> {
  const run = await readRunFile(location.file);
  return run ? runForPanel(run, alive) : null;
}

// Drops the runs of worktrees that no longer exist, so archived worktrees
// don't leave their last run behind. Runs on start; failures are ignored.
export async function pruneRuns(home = homedir()): Promise<string[]> {
  const parent = dirname(pulseDirectory(home, home));
  const folders = await readdir(parent, { withFileTypes: true }).catch(() => []);
  const removed: string[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const directory = join(parent, folder.name);
    const run = await readRunFile(join(directory, RUN_FILE_NAME));
    if (!run?.root || (await stat(run.root).catch(() => null))) continue;
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    removed.push(directory);
  }
  return removed;
}
