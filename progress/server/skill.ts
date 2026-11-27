import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { paseoCommands, PLUGIN_ID } from "./launcher.ts";
import { removeLinkIn, runCommandLine, runProgram, writeFileIn } from "./system.ts";

export const SKILL_NAME = "paseo-progress";

// The same three folders Paseo installs its own skills into: the shared
// ~/.agents folder (Codex, Gemini CLI, Antigravity 1.5.16 and later), Claude
// Code's, and Antigravity's own.
export function defaultSkillPaths(home = homedir()): string[] {
  return [[".agents"], [".claude"], [".gemini", "config"]].map((folder) => join(home, ...folder, "skills", SKILL_NAME));
}

// Earlier versions linked the skill here too. Codex reads ~/.agents/skills,
// so this one only gave it a second copy.
export function retiredSkillPaths(home = homedir()): string[] {
  return [join(home, ".codex", "skills", SKILL_NAME)];
}

export function skillSource(pluginDirectory: string): string {
  return join(pluginDirectory, "skills", SKILL_NAME);
}

export function readPluginSkill(pluginDirectory: string): Promise<string> {
  return readFile(join(skillSource(pluginDirectory), "SKILL.md"), "utf8");
}

// Each install is a copied folder, not a link: Go programs such as
// Antigravity skip Windows junctions, and a real symlink there needs admin
// rights or Developer Mode.
const MARKER = ".installed-by-paseo-progress";
const MARKER_TEXT =
  "Paseo's Progress plugin installed this copy of the skill and replaces it when the plugin updates.\n" +
  "Delete this file to keep the folder as your own. Progress then leaves it alone.\n";

export type SkillState = "missing" | "current" | "outdated" | "foreign";

type Found =
  // An empty folder too, as a crash right after making it leaves.
  | { kind: "nothing" }
  | { kind: "link" }
  // `skill` is null when a crash left the marker without SKILL.md.
  | { kind: "copy"; skill: string | null }
  | { kind: "other" };

async function inspect(path: string): Promise<Found> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "nothing" } : { kind: "other" };
  }
  if (stats.isSymbolicLink()) {
    const target = resolve(dirname(path), await readlink(path));
    return basename(target) === SKILL_NAME && basename(dirname(target)) === "skills" ? { kind: "link" } : { kind: "other" };
  }
  const entries = stats.isDirectory() ? await readdir(path).catch(() => null) : null;
  if (!entries) return { kind: "other" };
  if (entries.length === 0) return { kind: "nothing" };
  if (!entries.includes(MARKER)) return { kind: "other" };
  return { kind: "copy", skill: await readFile(join(path, "SKILL.md"), "utf8").catch(() => null) };
}

function stateOf(found: Found, skill: string): SkillState {
  switch (found.kind) {
    case "nothing":
      return "missing";
    case "link":
      return "outdated";
    case "copy":
      return found.skill === skill ? "current" : "outdated";
    case "other":
      return "foreign";
  }
}

// The marker goes before SKILL.md, so a crash leaves a copy that reads
// outdated and the next load finishes it.
async function place(path: string, found: Exclude<Found, { kind: "other" }>, skill: string) {
  const [folder, name] = [dirname(path), basename(path)];
  if (found.kind === "link") await removeLinkIn(folder, name);
  if (found.kind !== "copy") await writeFileIn(folder, join(name, MARKER), MARKER_TEXT);
  await writeFileIn(folder, join(name, "SKILL.md"), skill, { atomic: true });
}

// "update" runs on load and never adds a copy where there is none; "install"
// is the button, which also fills those paths.
export async function syncSkill(paths: string[], skill: string, mode: "update" | "install"): Promise<boolean> {
  const found = await Promise.all(paths.map(inspect));
  if (mode === "install" && found.every((at) => at.kind === "other")) {
    throw new Error(`${paths.join(", ")} already exist and were not installed by this plugin.`);
  }
  let wrote = false;
  for (const [index, at] of found.entries()) {
    if (at.kind === "other" || stateOf(at, skill) === "current") continue;
    if (at.kind === "nothing" && mode === "update") continue;
    await place(paths[index], at, skill);
    wrote = true;
  }
  return wrote;
}

export async function retireSkill(paths: string[]): Promise<boolean> {
  let wrote = false;
  for (const path of paths) {
    if ((await inspect(path)).kind !== "link") continue;
    await removeLinkIn(dirname(path), basename(path));
    wrote = true;
  }
  return wrote;
}

export async function skillStatus(paths: string[], skill: string) {
  const targets = await Promise.all(paths.map(async (path) => ({ path, state: stateOf(await inspect(path), skill) })));
  const states = targets.map((target) => target.state);
  const state: SkillState = states.includes("outdated")
    ? "outdated"
    : states.includes("missing")
      ? "missing"
      : states.includes("current")
        ? "current"
        : "foreign";
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
// PATH, only through cmd.exe. A hung CLI must fail so the next one is tried.
function askPaseo(cli: string) {
  const options = { timeout: 10_000 };
  return process.platform === "win32"
    ? runCommandLine(`"${cli}" plugin ls ${PLUGIN_ID} --json`, options)
    : runProgram(cli, ["plugin", "ls", PLUGIN_ID, "--json"], options);
}

// Runs once per load, when the server starts: an update reloads the bundle.
// New copies wait for Install skill. A failure leaves the copies as they
// were, and status says so.
let repair: Promise<unknown> | null = null;

export function repairSkill(): Promise<unknown> {
  repair ??= findPluginDirectory()
    .then(readPluginSkill)
    .then(async (skill) => {
      await syncSkill(defaultSkillPaths(), skill, "update");
      await retireSkill(retiredSkillPaths());
    })
    .catch(() => {});
  return repair;
}

export async function handleSkillStatus() {
  await repairSkill();
  return skillStatus(defaultSkillPaths(), await readPluginSkill(await findPluginDirectory()));
}

// SKILL.md's frontmatter holds one-line fields; only the description is shown.
export function skillDocument(text: string): { markdown: string; description: string } {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const description =
    /^description:[ \t]*(.*)$/m
      .exec(frontmatter?.[1] ?? "")?.[1]
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2") ?? "";
  return { markdown: text.slice(frontmatter?.[0].length ?? 0).trimStart(), description };
}

export async function handleReadSkill() {
  return skillDocument(await readPluginSkill(await findPluginDirectory()));
}

// repairSkill must finish first: both would rewrite the same outdated copy.
export async function handleInstallSkill() {
  await repairSkill();
  const skill = await readPluginSkill(await findPluginDirectory());
  await syncSkill(defaultSkillPaths(), skill, "install");
  return skillStatus(defaultSkillPaths(), skill);
}
