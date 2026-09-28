import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export const PLUGIN_ID = "progress-dashboard";

// The launcher never names a plugin folder. Each run asks Paseo which copy of
// the plugin it is running, so updates and `npm run dev` switches keep working.
export function launcherScript(): string {
  return `#!/usr/bin/env node
// Written by the ${PLUGIN_ID} Paseo plugin. Runs the progress command from the
// copy of the plugin Paseo is running now.
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error("paseo-progress needs Node.js 22.18 or later; this is " + process.version + ".");
  process.exit(1);
}

function pluginDirectory() {
  if (process.env.PASEO_PROGRESS_PLUGIN_DIR) return process.env.PASEO_PROGRESS_PLUGIN_DIR;
  const clis = [process.env.PASEO_BIN, "paseo", "/Applications/Paseo.app/Contents/Resources/bin/paseo"].filter(Boolean);
  for (const cli of clis) {
    const result = spawnSync(cli, ["plugin", "ls", "${PLUGIN_ID}", "--json"], { encoding: "utf8" });
    if (result.error || result.status !== 0) continue;
    try {
      const plugin = JSON.parse(result.stdout).find((entry) => entry.id === "${PLUGIN_ID}");
      return plugin && plugin.path;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const directory = pluginDirectory();
const entry = directory && join(directory, "server", "cli.ts");
if (!entry || !existsSync(entry)) {
  console.error("The ${PLUGIN_ID} plugin is not installed in Paseo, or Paseo is not reachable. Check with: paseo plugin ls");
  process.exit(1);
}
const run = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(run.status === null ? 1 : run.status);
`;
}

const MARKER = `Written by the ${PLUGIN_ID} Paseo plugin`;

export function defaultLauncherPath(home = homedir()): string {
  return join(home, ".local", "bin", "paseo-progress");
}

export type LauncherState = "missing" | "current" | "outdated" | "foreign";

export async function launcherState(path: string): Promise<LauncherState> {
  const current = await readFile(path, "utf8").catch(() => null);
  if (current === null) return "missing";
  if (current === launcherScript()) return "current";
  return current.includes(MARKER) ? "outdated" : "foreign";
}

// Writes the launcher when it is missing or out of date. Never replaces a file
// something else put there. Returns whether it wrote.
export async function installLauncher(path: string): Promise<boolean> {
  const state = await launcherState(path);
  if (state === "current") return false;
  if (state === "foreign") throw new Error(`${path} already exists and was not written by this plugin. Move it, or pass another path.`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, launcherScript());
  await chmod(path, 0o755);
  return true;
}

// For the panel: whether agents on the daemon host can run `paseo-progress`.
export async function launcherStatus(path = defaultLauncherPath(), pathEnv = process.env.PATH ?? "") {
  return {
    path,
    state: await launcherState(path),
    onPath: pathEnv.split(delimiter).some((entry) => entry.replace(/\/+$/, "") === dirname(path)),
  };
}

export async function handleLauncherStatus() {
  return launcherStatus();
}

// Runs only when the user presses Install in the panel.
export async function handleInstallLauncher() {
  const path = defaultLauncherPath();
  await installLauncher(path);
  return launcherStatus(path);
}
