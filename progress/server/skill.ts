import { exec, execFile } from "node:child_process";
import { lstat, mkdir, readFile, readlink, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { paseoCommands, PLUGIN_ID } from "./launcher.ts";

export const SKILL_NAME = "paseo-progress";

// The same three folders Paseo installs its own skills into: the shared
// ~/.agents folder plus Claude Code's and Codex's own.
export function defaultSkillPaths(home = homedir()): string[] {
  return [".agents", ".claude", ".codex"].map((folder) => join(home, folder, "skills", SKILL_NAME));
}

export function skillSource(pluginDirectory: string): string {
  return join(pluginDirectory, "skills", SKILL_NAME);
}

// The skill is a link into the copy of the plugin Paseo runs, so plugin
// updates reach agents without reinstalling. "outdated" is a link this plugin
// made to a copy Paseo no longer runs; "foreign" is anything else.
export type SkillState = "missing" | "current" | "outdated" | "foreign";

export async function skillState(path: string, pluginDirectory: string): Promise<SkillState> {
  const stats = await lstat(path).catch(() => null);
  if (!stats) return "missing";
  if (!stats.isSymbolicLink()) return "foreign";
  const target = resolve(dirname(path), await readlink(path));
  if (target === skillSource(pluginDirectory)) return "current";
  return basename(target) === SKILL_NAME && basename(dirname(target)) === "skills" ? "outdated" : "foreign";
}

// Repoints each link this plugin made to an old copy at the copy Paseo runs
// now. Paseo puts every update in a new folder, so this follows each update.
// Returns whether it wrote.
export async function relinkSkill(paths: string[], pluginDirectory: string): Promise<boolean> {
  let wrote = false;
  for (const path of paths) {
    if (await skillState(path, pluginDirectory) !== "outdated") continue;
    await unlink(path);
    await link(path, pluginDirectory);
    wrote = true;
  }
  return wrote;
}

// Links the skill wherever it is missing or points at an old copy of the
// plugin. Leaves alone anything else at those paths. Returns whether it wrote.
export async function installSkill(paths: string[], pluginDirectory: string): Promise<boolean> {
  const states = await Promise.all(paths.map((path) => skillState(path, pluginDirectory)));
  if (states.every((state) => state === "foreign")) throw new Error(`${paths.join(", ")} already exist and were not linked by this plugin.`);
  let wrote = await relinkSkill(paths, pluginDirectory);
  for (const [index, path] of paths.entries()) {
    if (states[index] !== "missing") continue;
    await link(path, pluginDirectory);
    wrote = true;
  }
  return wrote;
}

async function link(path: string, pluginDirectory: string) {
  await mkdir(dirname(path), { recursive: true });
  // A junction on Windows, where a directory symlink needs admin rights or
  // Developer Mode. Other systems ignore the type and make a symlink.
  await symlink(skillSource(pluginDirectory), path, "junction");
}

// "current" once every folder that can take the link has it.
export async function skillStatus(paths: string[], pluginDirectory: string) {
  const targets = await Promise.all(paths.map(async (path) => ({ path, state: await skillState(path, pluginDirectory) })));
  const states = targets.map((target) => target.state);
  const state: SkillState = states.includes("outdated") ? "outdated"
    : states.includes("missing") ? "missing"
    : states.includes("current") ? "current" : "foreign";
  return { state, targets };
}

// The server bundle doesn't know its own folder, so ask Paseo, the same way
// the launcher does.
export async function findPluginDirectory(): Promise<string> {
  for (const cli of paseoCommands()) {
    try {
      const { stdout } = await askPaseo(cli);
      const plugin = (JSON.parse(stdout) as Array<{ id: string; path?: string }>).find((entry) => entry.id === PLUGIN_ID);
      if (plugin?.path) return plugin.path;
    } catch {
      // Try the next place the paseo CLI might be.
    }
  }
  throw new Error("Could not ask Paseo where this plugin is installed.");
}

// On Windows Paseo's command is paseo.cmd, which Node can start, or find on
// PATH, only through cmd.exe.
function askPaseo(cli: string) {
  return process.platform === "win32"
    ? promisify(exec)(`"${cli}" plugin ls ${PLUGIN_ID} --json`)
    : promisify(execFile)(cli, ["plugin", "ls", PLUGIN_ID, "--json"]);
}

// Runs once per load, when the server starts: an update reloads the bundle.
// Only repoints links the user already asked for; new ones wait for Install
// skill. A failure leaves the links as they were, and status says so.
let repair: Promise<unknown> | null = null;

export function repairSkill(): Promise<unknown> {
  repair ??= findPluginDirectory().then((directory) => relinkSkill(defaultSkillPaths(), directory)).catch(() => {});
  return repair;
}

export async function handleSkillStatus() {
  await repairSkill();
  return skillStatus(defaultSkillPaths(), await findPluginDirectory());
}

// SKILL.md's frontmatter holds one-line fields; only the description is shown.
export function skillDocument(text: string): { markdown: string; description: string } {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const description = /^description:[ \t]*(.*)$/m.exec(frontmatter?.[1] ?? "")?.[1].trim().replace(/^(["'])(.*)\1$/, "$2") ?? "";
  return { markdown: text.slice(frontmatter?.[0].length ?? 0).trimStart(), description };
}

export async function handleReadSkill() {
  return skillDocument(await readFile(join(skillSource(await findPluginDirectory()), "SKILL.md"), "utf8"));
}

// Runs only when the user presses Install skill. Links that only need to
// follow an update are repointed on their own (repairSkill).
export async function handleInstallSkill() {
  const pluginDirectory = await findPluginDirectory();
  await installSkill(defaultSkillPaths(), pluginDirectory);
  return skillStatus(defaultSkillPaths(), pluginDirectory);
}
