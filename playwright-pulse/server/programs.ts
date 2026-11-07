// Programs Pulse starts are named by absolute path and run from a folder the
// repo can't control. With a bare name or the worktree as the working folder,
// Windows runs a program of that name from the folder first, and a relative
// PATH entry would find one in the worktree on any system.
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";

export const LAUNCH_FOLDER = dirname(process.execPath);

function isWithin(folder: string, path: string, paths: typeof posix): boolean {
  const inside = paths.relative(folder, path);
  return inside === "" || (inside !== ".." && !inside.startsWith(`..${paths.sep}`) && !paths.isAbsolute(inside));
}

// The first `name` on PATH, skipping relative entries and any inside `avoid`
// (the worktree), whether by their own name or where they lead.
export async function findProgram(name: string, { path = process.env.PATH ?? "", platform = process.platform, avoid = [] as string[] } = {}): Promise<string | null> {
  const paths = platform === "win32" ? win32 : posix;
  const file = platform === "win32" ? `${name}.exe` : name;
  for (const entry of path.split(paths.delimiter)) {
    if (!paths.isAbsolute(entry)) continue;
    const real = await realpath(entry).catch(() => entry);
    if (avoid.some((folder) => isWithin(folder, entry, paths) || isWithin(folder, real, paths))) continue;
    const candidate = paths.join(entry, file);
    const info = await stat(candidate).catch(() => null);
    if (!info?.isFile()) continue;
    if (platform !== "win32" && !(await access(candidate, constants.X_OK).then(() => true, () => false))) continue;
    return candidate;
  }
  return null;
}

let ps: Promise<string | null> | undefined;
export const findPs = () => (ps ??= findProgram("ps"));
