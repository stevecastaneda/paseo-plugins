// The only module in Progress that starts programs or changes files. The lint
// config allows node:child_process and the fs functions that change files here
// and in tests, nowhere else, so each new call gets these defaults.
//
// A program starts in LAUNCH_FOLDER unless the caller names a folder it has a
// reason for. Windows looks for a program in the folder it starts in before
// PATH, and a relative PATH entry resolves against that folder, so a bare name
// started in a worktree could run a program the repo committed.
//
// A file change names a folder the caller trusts (the plugin's state folder, a
// folder in the user's home, a worktree's real path) and a relative name
// inside it. The name can't climb out with `..`, and no folder between the two
// may be a link, which a cloned repo could commit to lead the change elsewhere.
import { exec, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, chmod, type FileHandle, lstat, mkdir, open, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, sep } from "node:path";
import { promisify } from "node:util";

export const LAUNCH_FOLDER = dirname(process.execPath);

export type RunOptions = { cwd?: string; timeout?: number };

export function runProgram(program: string, args: readonly string[], { cwd = LAUNCH_FOLDER, ...options }: RunOptions = {}) {
  return promisify(execFile)(program, args, { ...options, cwd, encoding: "utf8" });
}

// Through cmd.exe, for Windows .cmd programs, which Node can start only that way.
export function runCommandLine(line: string, { cwd = LAUNCH_FOLDER, ...options }: RunOptions = {}) {
  return promisify(exec)(line, { ...options, cwd, encoding: "utf8" });
}

export function openToRead(path: string): Promise<FileHandle> {
  return open(path, "r");
}

function stepsOf(folder: string, name: string): string[] {
  if (isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw new Error(`${name} is not a name inside ${folder}.`);
  return name.split(sep);
}

async function placeIn(folder: string, name: string): Promise<string> {
  const steps = stepsOf(folder, name);
  let step = folder;
  for (const part of steps.slice(0, -1)) {
    step = join(step, part);
    if ((await lstat(step).catch(() => null))?.isSymbolicLink()) throw new Error(`${step} is a link, so nothing was written through it.`);
  }
  return join(folder, name);
}

// `atomic` writes beside the file, then renames over it: readers see the old
// file or the new one, never half of one, and a link at the file is replaced
// instead of written through.
export async function writeFileIn(folder: string, name: string, text: string, { atomic = false, executable = false } = {}): Promise<void> {
  const path = await placeIn(folder, name);
  await mkdir(dirname(path), { recursive: true });
  if (!atomic) {
    await writeFile(path, text);
  } else {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, text);
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  if (executable) await chmod(path, 0o755);
}

export async function appendFileIn(folder: string, name: string, text: string): Promise<void> {
  await appendFile(await placeIn(folder, name), text);
}

// The trusted folder itself, with any missing parents.
export async function makeFolder(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true });
}

// Fails with EEXIST when the folder is already there, so only one caller makes it.
export async function createFolderIn(folder: string, name: string): Promise<void> {
  await mkdir(await placeIn(folder, name));
}

// Makes each missing folder of `name` one at a time. Null when any of them is
// a link or a file.
export async function makeFoldersIn(folder: string, name: string): Promise<string | null> {
  let directory = folder;
  for (const part of stepsOf(folder, name)) {
    directory = join(directory, part);
    const info = await lstat(directory).catch(() => null);
    if (!info) await mkdir(directory);
    else if (!info.isDirectory()) return null;
  }
  return directory;
}

export async function removeIn(folder: string, name: string, { recursive = false } = {}): Promise<void> {
  await rm(await placeIn(folder, name), { recursive, force: true });
}

// A junction on Windows, where a folder symlink needs admin rights or
// Developer Mode. Other systems ignore the type and make a symlink.
export async function linkFolderIn(folder: string, name: string, target: string): Promise<void> {
  const path = await placeIn(folder, name);
  await mkdir(dirname(path), { recursive: true });
  await symlink(target, path, "junction");
}

export async function removeLinkIn(folder: string, name: string): Promise<void> {
  await unlink(await placeIn(folder, name));
}
