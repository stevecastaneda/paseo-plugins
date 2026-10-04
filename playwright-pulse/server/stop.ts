// Stops a live run the way Ctrl+C in its terminal would: Playwright ends the
// running tests, runs teardown, stops its web servers, and reports the run as
// interrupted. A second press while it winds down forces it, as a second
// Ctrl+C does.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type RunLocation, type StartTimeOf, isOpen, processStartTime, readCurrentRun, runProcessAlive } from "./run-file.ts";

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

export async function stopRun(location: RunLocation, runId: string, { command = commandOf, signal = interrupt, startTimeOf = processStartTime }: { command?: CommandOf; signal?: Signal; startTimeOf?: StartTimeOf } = {}): Promise<{ stopped: true }> {
  const run = await readCurrentRun(location, runId);
  if (!isOpen(run)) throw new Error("That run has already ended.");
  // The run names a process id, and ids get reused: signal only the process
  // that started with the run and is still Playwright. When `ps` can't
  // confirm that, leave it alone.
  if (!(await runProcessAlive(run, startTimeOf))) throw new Error("That run's process has already exited.");
  const line = await command(run.pid);
  if (!line || !/playwright/i.test(line)) throw new Error("That run's process has already exited.");
  signal(run.pid);
  return { stopped: true };
}
