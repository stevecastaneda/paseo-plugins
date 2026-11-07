// Where a worktree's progress files live, and the run history a repo can opt
// in to saving. The working files never touch the repo: they live outside it,
// one folder per worktree, so git never sees them and nothing needs hiding.
// Only runs the user asks to save are written into the repo, one file per run.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { latestRun, parseProgress } from "../shared/dashboard.ts";
import { hasGitEntry, inGitFolder, outside } from "./paths.ts";

const SAVE_RUNS_KEY = "paseo-progress.saveRuns";

// `directory` holds the working files. `shown` names it for people.
export type Store = { directory: string; shown: string };

// Git runs in the worktree through -C, started from the folder Node itself
// lives in: Windows looks for a program in the folder it starts in before
// PATH, and a cloned repo can commit a git.exe.
export async function git(root: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await promisify(execFile)("git", ["-C", resolve(root), ...args], { cwd: dirname(process.execPath) });
    return { code: 0, stdout };
  } catch (error) {
    const failed = error as { code?: number | string; stdout?: string };
    return { code: typeof failed.code === "number" ? failed.code : -1, stdout: failed.stdout ?? "" };
  }
}

// The plugin's per-user folder on this computer.
export function stateRoot(home = homedir()): string {
  return join(home, ".local", "state", "paseo-progress");
}

// Readers see the old file or the new one, never half of one.
export async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

// One folder per worktree on this computer, named so a person can tell which
// worktree it belongs to.
export function outsideDirectory(root: string, home = homedir()): string {
  let real = root;
  try {
    real = realpathSync(root);
  } catch {}
  const hash = createHash("sha1").update(real).digest("hex").slice(0, 8);
  return join(stateRoot(home), `${basename(real)}-${hash}`);
}

// The worktree's working files, always outside the repo. Progress never reads
// a repo's .scratch, where 0.1.x kept them: a cloned repo could put anything there.
export function findStore(root: string, home = homedir()): Store {
  const directory = outsideDirectory(root, home);
  return { directory, shown: directory.startsWith(home) ? `~${directory.slice(home.length)}` : directory };
}

// The repo's saved-history folder, kept in its local git config, which every
// worktree of the repo shares and nothing commits. Polls cost one stat; git
// runs again only when the config file changes. A worktree with no .git
// entry is no repo; when git fails in one that has it, the next poll asks again.
const configFiles = new Map<string, string>();
const savedFolders = new Map<string, { mtimeMs: number; folder: string | null }>();

async function configFile(root: string): Promise<string | null> {
  if (!hasGitEntry(root)) return null;
  if (!configFiles.has(root)) {
    const { code, stdout } = await git(root, ["rev-parse", "--git-common-dir"]);
    if (code !== 0) return null;
    configFiles.set(root, join(resolve(root, stdout.trim()), "config"));
  }
  return configFiles.get(root)!;
}

// Whether git answers for the worktree's repo, which saving run history needs.
export async function inGitRepo(root: string): Promise<boolean> {
  return (await configFile(root)) !== null;
}

// The folder runs are saved to, relative to the worktree root, or null. A
// folder set outside Paseo gets the same check as one picked in it.
export async function historyFolder(root: string): Promise<string | null> {
  const file = await configFile(root);
  if (file === null) return null;
  const mtimeMs = (await stat(file).catch(() => null))?.mtimeMs ?? 0;
  const cached = savedFolders.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.folder;
  const { stdout } = await git(root, ["config", "--get", SAVE_RUNS_KEY]);
  const checked = checkFolder(stdout);
  const folder = "folder" in checked ? checked.folder : null;
  savedFolders.set(file, { mtimeMs, folder });
  return folder;
}

// A folder the user picked, as a clean path inside the worktree, or why not.
export function checkFolder(raw: string): { folder: string } | { error: string } {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return { error: "Choose a folder" };
  const folder = normalize(trimmed);
  if (outside(folder) || folder === ".") return { error: "Choose a folder inside the repo" };
  if (inGitFolder(folder)) return { error: "Choose a folder outside .git" };
  return { folder };
}

// Starts or stops saving runs for the whole repo. Files already saved stay.
export async function setHistoryFolder(root: string, raw: string | null): Promise<string | null> {
  if (raw === null) {
    const { code } = await git(root, ["config", "--local", "--unset-all", SAVE_RUNS_KEY]);
    // 5: it wasn't set, which is what was asked for.
    if (code !== 0 && code !== 5) throw new Error("Could not change this repo's git settings.");
    return null;
  }
  const checked = checkFolder(raw);
  if ("error" in checked) throw new Error(checked.error);
  const { code } = await git(root, ["config", "--local", SAVE_RUNS_KEY, checked.folder]);
  if (code !== 0) throw new Error("Could not save this in the repo's git settings. Is it a git repo?");
  return checked.folder;
}

// "20261001-064512-warn-when-scratch.jsonl": when the run started, then its
// title as it was at the start, so the name never changes and two runs never
// share one.
export function runFileName(startedAt: string, title: string): string {
  const stamp = startedAt
    .replace(/\.\d+Z$/, "")
    .replace(/[-:]/g, "")
    .replace("T", "-");
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${stamp}${slug ? `-${slug}` : ""}.jsonl`;
}

// After each change: when the repo saves runs, rewrite the current run's file
// with every event from its start. Runs before the first start aren't saved.
export async function saveRunCopy(root: string, text: string): Promise<void> {
  const folder = await historyFolder(root);
  if (!folder) return;
  // The run the dashboard shows. A start line it can't read is no run.
  const [start] = latestRun(parseProgress(text).events);
  if (start?.event.type !== "run.start") return;
  const lines = text
    .split("\n")
    .slice(start.line - 1)
    .filter((line) => line.trim());
  const directory = await runsFolder(root, folder);
  if (!directory) return;
  // A rename replaces a link at the run's file instead of writing through it.
  await writeAtomic(join(directory, runFileName(start.event.ts, start.event.title)), `${lines.join("\n")}\n`);
}

// The saved-runs folder in the real worktree, made one step at a time, or null
// when any step is a link or a file: a cloned repo can commit a link that leads
// out of it.
async function runsFolder(root: string, folder: string): Promise<string | null> {
  let directory = await realpath(root);
  for (const name of folder.split(sep)) {
    directory = join(directory, name);
    const info = await lstat(directory).catch(() => null);
    if (!info) await mkdir(directory);
    else if (!info.isDirectory()) return null;
  }
  return directory;
}

// The folders directly inside one folder of the worktree ("" is the top), for
// the folder picker. .git folders are left out; so are links, which could leave the repo.
export async function listFolders(root: string, folder: string): Promise<{ folder: string; folders: string[] }> {
  const checked = folder === "" ? { folder: "" } : checkFolder(folder);
  if ("error" in checked) throw new Error(checked.error);
  const entries = await readdir(join(root, checked.folder), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const folders = entries.filter((entry) => entry.isDirectory() && !inGitFolder(entry.name)).map((entry) => entry.name);
  return { folder: checked.folder, folders: folders.sort((a, b) => a.localeCompare(b)) };
}
