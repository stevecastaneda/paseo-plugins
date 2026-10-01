// Where a worktree's progress files live. Each repo picks once, in the
// Progress panel: outside the repo, or a folder inside it. The choice is kept
// in the repo's local git config, which every worktree of the repo shares and
// nothing commits. The command won't write until the repo has a choice.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, normalize, resolve } from "node:path";
import { promisify } from "node:util";
import { LEGACY_FOLDER, PANEL_OPENED_NAME, PROGRESS_FILE_NAME } from "../shared/events.ts";
import type { HideChoice, SetupChoice } from "../shared/rpc.ts";
import { withLock } from "./lock.ts";
import { outside } from "./paths.ts";

const LOCATION_KEY = "paseo-progress.location";
const HIDE_KEY = "paseo-progress.hide";
const OUTSIDE = "outside";
// The plugin's files in the progress folder. A name ending in "/" is a folder.
export const PLUGIN_FILES = [PROGRESS_FILE_NAME, `${PROGRESS_FILE_NAME}.lock/`, PANEL_OPENED_NAME];
const RULES_HEADER = "# Added by the progress plugin for Paseo so its files stay out of git.";

export type Store =
  // `directory` holds the progress files. `shown` is how to name it to a person.
  | { ready: true; directory: string; shown: string }
  | { ready: false };

export async function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await promisify(execFile)("git", args, { cwd });
    return { code: 0, stdout };
  } catch (error) {
    const failed = error as { code?: number | string; stdout?: string };
    return { code: typeof failed.code === "number" ? failed.code : -1, stdout: failed.stdout ?? "" };
  }
}

// The repo's shared config file per worktree root, so a poll costs one stat
// and git runs again only when the file changes. `null`: not a git repo.
const configFiles = new Map<string, string | null>();
const setups = new Map<string, { mtimeMs: number; location: string | null }>();

async function configFile(root: string): Promise<string | null> {
  if (!configFiles.has(root)) {
    const { code, stdout } = await git(root, ["rev-parse", "--git-common-dir"]);
    configFiles.set(root, code === 0 ? join(resolve(root, stdout.trim()), "config") : null);
  }
  return configFiles.get(root)!;
}

// The saved location: "outside", a folder relative to the worktree root, or
// null before setup. `undefined` outside git, where there's nowhere to save it.
async function savedLocation(root: string): Promise<string | null | undefined> {
  const file = await configFile(root);
  if (file === null) return undefined;
  const mtimeMs = (await stat(file).catch(() => null))?.mtimeMs ?? 0;
  const cached = setups.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.location;
  const { stdout } = await git(root, ["config", "--get", LOCATION_KEY]);
  const location = stdout.trim() || null;
  setups.set(file, { mtimeMs, location });
  return location;
}

// Outside the repo: one folder per worktree on this computer, named so a
// person can tell which worktree it belongs to.
export function outsideDirectory(root: string, home = homedir()): string {
  let real = root;
  try {
    real = realpathSync(root);
  } catch {}
  const hash = createHash("sha1").update(real).digest("hex").slice(0, 8);
  return join(home, ".local", "state", "paseo-progress", `${basename(real)}-${hash}`);
}

export async function findStore(root: string, home = homedir()): Promise<Store> {
  const chosen = storeAt(root, await savedLocation(root), home);
  if (chosen.ready && await exists(join(chosen.directory, PROGRESS_FILE_NAME))) return chosen;
  // A worktree with a run from before setup existed keeps it in .scratch, so
  // the run doesn't vanish. Saving setup in that worktree moves it.
  if (await exists(join(root, LEGACY_FOLDER, PROGRESS_FILE_NAME))) {
    return { ready: true, directory: join(root, LEGACY_FOLDER), shown: LEGACY_FOLDER };
  }
  return chosen;
}

// Where a saved location puts the files; outside git, always outside the repo.
function storeAt(root: string, location: string | null | undefined, home: string): Store {
  if (location === null) return { ready: false };
  if (location !== undefined && location !== OUTSIDE) return { ready: true, directory: join(root, location), shown: location };
  const directory = outsideDirectory(root, home);
  return { ready: true, directory, shown: directory.replace(home, "~") };
}

async function exists(path: string): Promise<boolean> {
  return Boolean(await stat(path).catch(() => null));
}

// Whether the repo still needs setup. Outside git there's nothing to set up.
export async function setupNeeded(root: string): Promise<boolean> {
  return (await savedLocation(root)) === null;
}

// A folder the user typed, as a clean path inside the worktree, or why not.
export function checkFolder(raw: string): { folder: string } | { error: string } {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return { error: "Enter a folder name, like .scratch" };
  const folder = normalize(trimmed);
  if (outside(folder) || folder === ".") return { error: "Choose a folder inside the repo" };
  if (folder === ".git" || folder.startsWith(".git/")) return { error: "Choose a folder outside .git" };
  if (folder === OUTSIDE) return { error: `"${OUTSIDE}" is reserved. Choose another name` };
  return { folder };
}

// The folders directly inside one folder of the worktree ("" is the top), for
// the setup picker. .git is left out; so are links, which could leave the repo.
export async function listFolders(root: string, folder: string): Promise<{ folder: string; folders: string[] }> {
  const checked = folder === "" ? { folder: "" } : checkFolder(folder);
  if ("error" in checked) throw new Error(checked.error);
  const entries = await readdir(join(root, checked.folder), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const folders = entries.filter((entry) => entry.isDirectory() && !(checked.folder === "" && entry.name === ".git")).map((entry) => entry.name);
  return { folder: checked.folder, folders: folders.sort((a, b) => a.localeCompare(b)) };
}

// Whether git already ignores every plugin file in that folder.
export async function alreadyIgnored(root: string, folder: string): Promise<boolean> {
  const paths = PLUGIN_FILES.map((name) => `${folder}/${name}`);
  const { code, stdout } = await git(root, ["check-ignore", "--", ...paths]);
  if (code !== 0) return false;
  return new Set(stdout.split("\n").filter(Boolean)).size === paths.length;
}

function rules(folder: string): string {
  return [RULES_HEADER, ...PLUGIN_FILES.map((name) => `/${folder}/${name}`)].join("\n") + "\n";
}

async function appendRules(file: string, folder: string): Promise<void> {
  const current = await readFile(file, "utf8").catch(() => "");
  const lead = !current ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${lead}${rules(folder)}`);
}

// Every worktree of the repo, this one included, that's still on disk.
async function worktreesOf(root: string): Promise<string[]> {
  const { code, stdout } = await git(root, ["worktree", "list", "--porcelain"]);
  const listed = code === 0 ? stdout.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length)) : [];
  const present = await Promise.all(listed.map(async (tree) => ((await exists(tree)) ? tree : null)));
  return [...new Set([root, ...present.filter((tree): tree is string => tree !== null)])];
}

// Saves the repo's choice, writes the ignore rules it asks for, and moves each
// worktree's existing run to the new place, so the whole repo follows it.
export async function saveSetup(root: string, choice: SetupChoice, home = homedir()): Promise<Store> {
  const trees = await worktreesOf(root);
  const before = await Promise.all(trees.map((tree) => findStore(tree, home)));
  let location = OUTSIDE;
  let hide: HideChoice | "none" = "none";
  if (choice.kind === "folder") {
    const checked = checkFolder(choice.folder);
    if ("error" in checked) throw new Error(checked.error);
    location = checked.folder;
    hide = choice.hide;
    if (hide !== "none" && !(await alreadyIgnored(root, location))) {
      if (hide === "repo") {
        await appendRules(join(root, ".gitignore"), location);
      } else {
        const { code, stdout } = await git(root, ["rev-parse", "--git-path", "info/exclude"]);
        if (code !== 0) throw new Error("Could not find git's local exclude file for this repo.");
        await appendRules(resolve(root, stdout.trim()), location);
      }
    }
  }
  for (const [key, value] of [[LOCATION_KEY, location], [HIDE_KEY, hide]]) {
    const { code } = await git(root, ["config", "--local", key, value]);
    if (code !== 0) throw new Error("Could not save the setup in this repo's git settings.");
  }
  for (const [index, tree] of trees.entries()) {
    const from = before[index];
    const to = storeAt(tree, location, home);
    if (from.ready && to.ready && from.directory !== to.directory) await moveFiles(from.directory, to.directory);
  }
  return storeAt(root, location, home);
}

// Moves the plugin's files, never over files already at the new place. Holds
// the old folder's lock, so it waits for a command that's writing there.
async function moveFiles(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  await withLock(join(from, `${PROGRESS_FILE_NAME}.lock`), async () => {
    for (const name of [PROGRESS_FILE_NAME, PANEL_OPENED_NAME]) {
      if (await exists(join(to, name)) || !(await exists(join(from, name)))) continue;
      await rename(join(from, name), join(to, name)).catch(async (error: NodeJS.ErrnoException) => {
        // Outside the repo can be on another disk, where rename can't go.
        if (error.code !== "EXDEV") throw error;
        await copyFile(join(from, name), join(to, name));
        await rm(join(from, name));
      });
    }
  });
}

// For tests: forget cached config paths and values.
export function forgetSetups(): void {
  configFiles.clear();
  setups.clear();
}

export const SETUP_NEEDED_MESSAGE = "The Progress plugin isn't set up for this repo yet. Ask the user to open the Progress panel in Paseo and finish setup, then run this again.";
