import { execFile } from "node:child_process";
import { lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { PLUGIN_ID } from "./launcher.ts";

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

// Links the skill wherever it is missing or points at an old copy of the
// plugin. Leaves alone anything else at those paths. Returns whether it wrote.
export async function installSkill(paths: string[], pluginDirectory: string): Promise<boolean> {
  const states = await Promise.all(paths.map((path) => skillState(path, pluginDirectory)));
  if (states.every((state) => state === "foreign")) throw new Error(`${paths.join(", ")} already exist and were not linked by this plugin.`);
  let wrote = false;
  for (const [index, path] of paths.entries()) {
    if (states[index] !== "missing" && states[index] !== "outdated") continue;
    if (states[index] === "outdated") await unlink(path);
    await mkdir(dirname(path), { recursive: true });
    await symlink(skillSource(pluginDirectory), path, "dir");
    wrote = true;
  }
  return wrote;
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
  const clis = [process.env.PASEO_BIN, "paseo", "/Applications/Paseo.app/Contents/Resources/bin/paseo"].filter((cli): cli is string => Boolean(cli));
  for (const cli of clis) {
    try {
      const { stdout } = await promisify(execFile)(cli, ["plugin", "ls", PLUGIN_ID, "--json"]);
      const plugin = (JSON.parse(stdout) as Array<{ id: string; path?: string }>).find((entry) => entry.id === PLUGIN_ID);
      if (plugin?.path) return plugin.path;
    } catch {
      // Try the next place the paseo CLI might be.
    }
  }
  throw new Error("Could not ask Paseo where this plugin is installed.");
}

export async function handleSkillStatus() {
  return skillStatus(defaultSkillPaths(), await findPluginDirectory());
}

// Runs only when the user presses Install skill in the panel.
export async function handleInstallSkill() {
  const pluginDirectory = await findPluginDirectory();
  await installSkill(defaultSkillPaths(), pluginDirectory);
  return skillStatus(defaultSkillPaths(), pluginDirectory);
}
