// Stops a live run the way Ctrl+C in its terminal would: Playwright ends the
// running tests, runs teardown, stops its web servers, and reports the run as
// interrupted. A second press while it winds down forces it, as a second
// Ctrl+C does.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type RunLocation, processAlive, readRunFile } from "./run-file.ts";

// The command line of a process on this host, or null when it's gone.
export type CommandOf = (pid: number) => Promise<string | null>;

export const commandOf: CommandOf = async (pid) => {
  try {
    const { stdout } = await promisify(execFile)("ps", ["-o", "command=", "-p", String(pid)]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

export type Signal = (pid: number) => void;

export const interrupt: Signal = (pid) => {
  process.kill(pid, "SIGINT");
};

export async function stopRun(location: RunLocation, runId: string, { command = commandOf, signal = interrupt } = {}): Promise<{ stopped: true }> {
  const run = await readRunFile(location.file);
  if (!run || run.id !== runId) throw new Error("That run has been replaced by a newer one.");
  if (run.status !== "starting" && run.status !== "running") throw new Error("That run has already ended.");
  if (!processAlive(run.pid)) throw new Error("That run's process has already exited.");
  // The run file names a process id; make sure it's still Playwright before
  // signalling it, since ids get reused.
  const line = await command(run.pid);
  if (!line || !/playwright/i.test(line)) throw new Error("That run's process has already exited.");
  signal(run.pid);
  return { stopped: true };
}
