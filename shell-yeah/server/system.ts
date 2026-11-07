// The only module in Shell Yeah that changes files, as proc.ts is the only one
// that starts programs. The lint config allows the fs functions that change
// files in these two and in tests, nowhere else.
//
// A change names a folder the caller trusts (the log folder) and a relative
// name inside it. The name can't climb out with `..`, and no folder between
// the two may be a link.
import { lstat, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, sep } from "node:path";

async function placeIn(folder: string, name: string): Promise<string> {
  if (isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw new Error(`${name} is not a name inside ${folder}.`);
  let step = folder;
  for (const part of name.split(sep).slice(0, -1)) {
    step = join(step, part);
    if ((await lstat(step).catch(() => null))?.isSymbolicLink()) throw new Error(`${step} is a link, so nothing was written through it.`);
  }
  return join(folder, name);
}

// Readable by the user alone: logs can hold whatever a command printed.
export async function writePrivateFileIn(folder: string, name: string, text: string): Promise<string> {
  const path = await placeIn(folder, name);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, text, { mode: 0o600 });
  return path;
}

export async function removeIn(folder: string, name: string, { recursive = false } = {}): Promise<void> {
  await rm(await placeIn(folder, name), { recursive, force: true });
}

// Only an empty folder goes.
export async function removeFolderIn(folder: string, name: string): Promise<void> {
  await rmdir(await placeIn(folder, name));
}
