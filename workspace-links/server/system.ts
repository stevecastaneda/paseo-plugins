// The only module in Workspace Links that changes files. The lint config allows the
// fs functions that change files here and in tests, nowhere else.
//
// A change names a folder the caller trusts (the plugin's data folder) and a
// relative name inside it. The name can't climb out with `..`, and no folder
// between the two may be a link.
import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
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

// Writes beside the file, then renames over it: readers see the old file or
// the new one, never half of one.
export async function writeFileAtomicIn(folder: string, name: string, text: string): Promise<void> {
  const path = await placeIn(folder, name);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
