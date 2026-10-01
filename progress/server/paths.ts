import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

// Whether a path from relative(root, target) leaves the root. "..notes" is a
// name inside it, not a step out.
export function outside(inside: string): boolean {
  return inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
}

// The worktree root is the nearest directory with a `.git` entry (a folder in
// a checkout, a file in a linked worktree). Outside git, use the directory.
// The command and the panel both start from here, so a Paseo project set at a
// subfolder of the repo still reads the file the agent writes.
export function findRoot(cwd: string): string {
  let directory = resolve(cwd);
  while (true) {
    if (existsSync(join(directory, ".git"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(cwd);
    directory = parent;
  }
}
