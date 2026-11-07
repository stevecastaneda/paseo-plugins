// The only module in Pulse that starts programs or changes files, besides the
// reporter, which runs inside Playwright and can't import it. The lint config
// allows node:child_process and the fs functions that change files here, in
// the reporter and in tests, nowhere else.
//
// Programs Pulse starts are named by absolute path and run from a folder the
// repo can't control. With a bare name or the worktree as the working folder,
// Windows runs a program of that name from the folder first, and a relative
// PATH entry would find one in the worktree on any system.
//
// A file change names a folder the caller trusts (the plugin's own folders in
// the user's home) and a relative name inside it. The name can't climb out
// with `..`, and no folder between the two may be a link.
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, link, lstat, mkdir, realpath, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, sep, win32 } from "node:path";
import { promisify } from "node:util";

export const LAUNCH_FOLDER = dirname(process.execPath);

function isWithin(folder: string, path: string, paths: typeof posix): boolean {
  const inside = paths.relative(folder, path);
  return inside === "" || (inside !== ".." && !inside.startsWith(`..${paths.sep}`) && !paths.isAbsolute(inside));
}

// The first `name` on PATH, skipping relative entries and any inside `avoid`
// (the worktree), whether by their own name or where they lead.
export async function findProgram(
  name: string,
  { path = process.env.PATH ?? "", platform = process.platform, avoid = [] as string[] } = {},
): Promise<string | null> {
  const paths = platform === "win32" ? win32 : posix;
  const file = platform === "win32" ? `${name}.exe` : name;
  for (const entry of path.split(paths.delimiter)) {
    if (!paths.isAbsolute(entry)) continue;
    const real = await realpath(entry).catch(() => entry);
    if (avoid.some((folder) => isWithin(folder, entry, paths) || isWithin(folder, real, paths))) continue;
    const candidate = paths.join(entry, file);
    const info = await stat(candidate).catch(() => null);
    if (!info?.isFile()) continue;
    if (
      platform !== "win32" &&
      !(await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      ))
    )
      continue;
    return candidate;
  }
  return null;
}

let ps: Promise<string | null> | undefined;
export const findPs = () => (ps ??= findProgram("ps"));

export function runProgram(program: string, args: readonly string[], { cwd = LAUNCH_FOLDER }: { cwd?: string } = {}) {
  return promisify(execFile)(program, args, { cwd, encoding: "utf8" });
}

// Resolves once the program has started, without waiting for it to exit.
export function startDetached(program: string, args: readonly string[], { cwd = LAUNCH_FOLDER }: { cwd?: string } = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { cwd, detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function placeIn(folder: string, name: string): Promise<string> {
  if (isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw new Error(`${name} is not a name inside ${folder}.`);
  let step = folder;
  for (const part of name.split(sep).slice(0, -1)) {
    step = join(step, part);
    if ((await lstat(step).catch(() => null))?.isSymbolicLink()) throw new Error(`${step} is a link, so nothing was written through it.`);
  }
  return join(folder, name);
}

// Writes the file whole beside its place, then moves it in, so a reader never
// sees half of it. `replace` renames over what's there; otherwise it's linked
// into place, which fails with EEXIST rather than replace a file that
// appeared meanwhile.
export async function placeFileIn(folder: string, name: string, text: string, { replace }: { replace: boolean }): Promise<void> {
  const path = await placeIn(folder, name);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text);
  try {
    await (replace ? rename : link)(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function removeIn(folder: string, name: string): Promise<void> {
  await rm(await placeIn(folder, name), { force: true });
}

// Only an empty folder goes.
export async function removeFolderIn(folder: string, name: string): Promise<void> {
  await rmdir(await placeIn(folder, name));
}
