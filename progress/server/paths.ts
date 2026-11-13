import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

// Whether a path from relative(root, target) leaves the root. "..notes" is a
// name inside it, not a step out.
export function outside(inside: string): boolean {
  return inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
}

// Whether a path from relative(root, target) is in a .git folder, a nested
// checkout's included. Windows writes either separator, and Windows and macOS
// match names in any case.
export function inGitFolder(inside: string): boolean {
  return inside.split(/[\\/]/).some((name) => name.toLowerCase() === ".git");
}

// A `.git` entry: a folder in a checkout, a file in a linked worktree.
export function hasGitEntry(directory: string): boolean {
  return existsSync(join(directory, ".git"));
}

// The worktree root is the nearest directory with a `.git` entry. Outside git,
// use the directory. The command and the panel both start from here, so a
// Paseo project set at a subfolder of the repo still reads the file the agent
// writes.
export function findRoot(cwd: string): string {
  let directory = resolve(cwd);
  while (true) {
    if (hasGitEntry(directory)) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(cwd);
    directory = parent;
  }
}

// The worktree a command records progress for. Claude Code gives an isolated
// subagent its own checkout at .claude/worktrees/<name>, in the repo's main
// checkout unless a WorktreeCreate hook moves it. The user watches the
// dashboard of the Paseo agent's workspace, which Paseo names in
// PASEO_AGENT_CWD, so progress from a subagent's checkout goes there.
export function progressRoot(cwd: string, agentCwd: string | undefined): string {
  const root = findRoot(cwd);
  const folder = dirname(root);
  const subagentCheckout = basename(folder) === "worktrees" && basename(dirname(folder)) === ".claude";
  return agentCwd && subagentCheckout ? findRoot(agentCwd) : root;
}
