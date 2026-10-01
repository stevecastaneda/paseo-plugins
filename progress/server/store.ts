// Where a worktree's progress files live, and the run history a repo can opt
// in to saving. The working files never touch the repo: they live outside it,
// one folder per worktree, so git never sees them and nothing needs hiding.
// Only runs the user asks to save are written into the repo, one file per run.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, normalize, resolve } from "node:path";
import { promisify } from "node:util";
import { LEGACY_FOLDER, PANEL_OPENED_NAME, PROGRESS_FILE_NAME } from "../shared/events.ts";
import { withLock } from "./lock.ts";
import { outside } from "./paths.ts";

const LOCK_NAME = `${PROGRESS_FILE_NAME}.lock`;
const SAVE_RUNS_KEY = "paseo-progress.saveRuns";
// Exactly what 0.1.x wrote into .scratch/.gitignore. Only this is ever removed.
const LEGACY_GITIGNORE = `# Added by the progress plugin for Paseo so its files stay out of git.
${PROGRESS_FILE_NAME}
${LOCK_NAME}/
${PANEL_OPENED_NAME}
.gitignore
`;

// `directory` holds the working files. `shown` names it for people.
export type Store = { directory: string; shown: string };

export async function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await promisify(execFile)("git", args, { cwd });
    return { code: 0, stdout };
  } catch (error) {
    const failed = error as { code?: number | string; stdout?: string };
    return { code: typeof failed.code === "number" ? failed.code : -1, stdout: failed.stdout ?? "" };
  }
}

async function exists(path: string): Promise<boolean> {
  return Boolean(await stat(path).catch(() => null));
}

// One folder per worktree on this computer, named so a person can tell which
// worktree it belongs to.
export function outsideDirectory(root: string, home = homedir()): string {
  let real = root;
  try {
    real = realpathSync(root);
  } catch {}
  const hash = createHash("sha1").update(real).digest("hex").slice(0, 8);
  return join(home, ".local", "state", "paseo-progress", `${basename(real)}-${hash}`);
}

// Whether git tracks a 0.1.x progress file, per worktree, until the file changes.
const trackedLegacy = new Map<string, { mtimeMs: number; tracked: boolean }>();

async function legacyTracked(root: string, mtimeMs: number): Promise<boolean> {
  const cached = trackedLegacy.get(root);
  if (cached && cached.mtimeMs === mtimeMs) return cached.tracked;
  const { code } = await git(root, ["ls-files", "--error-unmatch", "--", `${LEGACY_FOLDER}/${PROGRESS_FILE_NAME}`]);
  trackedLegacy.set(root, { mtimeMs, tracked: code === 0 });
  return code === 0;
}

// The worktree's working files. A run 0.1.x left in .scratch moves outside the
// first time anything asks, unless git tracks it: then it stays and is used in
// place, so nothing changes for a repo that commits it.
export async function findStore(root: string, home = homedir()): Promise<Store> {
  const directory = outsideDirectory(root, home);
  const store = { directory, shown: directory.startsWith(home) ? `~${directory.slice(home.length)}` : directory };
  const legacy = join(root, LEGACY_FOLDER);
  const info = await stat(join(legacy, PROGRESS_FILE_NAME)).catch(() => null);
  if (!info) return store;
  if (await legacyTracked(root, info.mtimeMs)) return { directory: legacy, shown: LEGACY_FOLDER };
  await moveLegacy(legacy, directory);
  return store;
}

// Appends the old file's lines to the new one rather than replacing it, so a
// command that wrote to the old place mid-move loses nothing: the next move
// picks those lines up. Then tidies what 0.1.x left behind.
async function moveLegacy(legacy: string, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await withLock(join(legacy, LOCK_NAME), async () => {
    const text = await readFile(join(legacy, PROGRESS_FILE_NAME), "utf8").catch(() => null);
    if (text === null) return;
    await withLock(join(directory, LOCK_NAME), async () => {
      const current = await readFile(join(directory, PROGRESS_FILE_NAME), "utf8").catch(() => "");
      const lead = current && !current.endsWith("\n") ? "\n" : "";
      await appendFile(join(directory, PROGRESS_FILE_NAME), `${lead}${text}`);
    });
    await rm(join(legacy, PROGRESS_FILE_NAME));
    if (await exists(join(legacy, PANEL_OPENED_NAME))) {
      await writeFile(join(directory, PANEL_OPENED_NAME), "");
      await rm(join(legacy, PANEL_OPENED_NAME));
    }
  });
  const ignore = await readFile(join(legacy, ".gitignore"), "utf8").catch(() => null);
  if (ignore === LEGACY_GITIGNORE) await rm(join(legacy, ".gitignore"));
  // Only if nothing else is in there; the user's own files keep the folder.
  await rmdir(legacy).catch(() => {});
}

// The repo's saved-history folder, kept in its local git config, which every
// worktree of the repo shares and nothing commits. Polls cost one stat; git
// runs again only when the config file changes.
const configFiles = new Map<string, string | null>();
const savedFolders = new Map<string, { mtimeMs: number; folder: string | null }>();

async function configFile(root: string): Promise<string | null> {
  if (!configFiles.has(root)) {
    const { code, stdout } = await git(root, ["rev-parse", "--git-common-dir"]);
    configFiles.set(root, code === 0 ? join(resolve(root, stdout.trim()), "config") : null);
  }
  return configFiles.get(root)!;
}

// Whether the worktree is in a git repo, which saving run history needs.
export async function inGitRepo(root: string): Promise<boolean> {
  return (await configFile(root)) !== null;
}

// The folder runs are saved to, relative to the worktree root, or null.
export async function historyFolder(root: string): Promise<string | null> {
  const file = await configFile(root);
  if (file === null) return null;
  const mtimeMs = (await stat(file).catch(() => null))?.mtimeMs ?? 0;
  const cached = savedFolders.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.folder;
  const { stdout } = await git(root, ["config", "--get", SAVE_RUNS_KEY]);
  const folder = stdout.trim() || null;
  savedFolders.set(file, { mtimeMs, folder });
  return folder;
}

// A folder the user picked, as a clean path inside the worktree, or why not.
export function checkFolder(raw: string): { folder: string } | { error: string } {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return { error: "Choose a folder" };
  const folder = normalize(trimmed);
  if (outside(folder) || folder === ".") return { error: "Choose a folder inside the repo" };
  if (folder === ".git" || folder.startsWith(".git/")) return { error: "Choose a folder outside .git" };
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
  const stamp = startedAt.replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "-");
  const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${stamp}${slug ? `-${slug}` : ""}.jsonl`;
}

// After each change: when the repo saves runs, rewrite the current run's file
// with every event from its start. Runs before the first start aren't saved.
export async function saveRunCopy(root: string, text: string): Promise<void> {
  const folder = await historyFolder(root);
  if (!folder) return;
  const lines = text.split("\n").filter((line) => line.trim());
  let start = -1;
  let event: { ts?: string; title?: string } | null = null;
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed?.type === "run.start") {
        start = index;
        event = parsed;
        break;
      }
    } catch {}
  }
  if (start < 0 || !event?.ts || !event.title) return;
  const directory = join(root, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, runFileName(event.ts, event.title)), `${lines.slice(start).join("\n")}\n`);
}

// The folders directly inside one folder of the worktree ("" is the top), for
// the folder picker. .git is left out; so are links, which could leave the repo.
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
