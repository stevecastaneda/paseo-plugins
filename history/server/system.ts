// The only module in History that starts programs or opens files with a call
// that could change them. The lint config allows node:child_process and those
// fs functions here and in tests, nowhere else.
//
// A program starts in LAUNCH_FOLDER unless the caller names a folder it has a
// reason for. Windows looks for a program in the folder it starts in before
// PATH, and a relative PATH entry resolves against that folder, so a bare name
// started in a worktree could run a program the repo committed.
import { execFile } from "node:child_process";
import { open, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

export const LAUNCH_FOLDER = dirname(process.execPath);

export type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number };

export function runProgram(program: string, args: readonly string[], { cwd = LAUNCH_FOLDER, ...options }: RunOptions = {}) {
  return promisify(execFile)(program, args, { ...options, cwd, encoding: "utf8" });
}

export function openToRead(path: string): Promise<FileHandle> {
  return open(path, "r");
}
