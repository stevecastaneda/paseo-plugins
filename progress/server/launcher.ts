import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, posix, win32 } from "node:path";

export const PLUGIN_ID = "progress";

// Where Paseo's command may be, in the order tried: an override, the one
// Paseo names for the agents and plugins it starts, PATH, then the app's
// default install. The launcher script below carries the same list.
export function paseoCommands(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const installed = platform === "win32"
    ? env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, "Programs", "Paseo", "resources", "bin", "paseo.cmd")
    : "/Applications/Paseo.app/Contents/Resources/bin/paseo";
  return [env.PASEO_BIN, env.PASEO_CLI, "paseo", installed].filter((cli): cli is string => Boolean(cli));
}

// The launcher never names a plugin folder. Each run asks Paseo which copy of
// the plugin it is running, so updates and `npm run dev` switches keep working.
export function launcherScript(): string {
  return `#!/usr/bin/env node
// Written by the ${PLUGIN_ID} Paseo plugin. Runs the progress command from the
// copy of the plugin Paseo is running now.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error("paseo-progress needs Node.js 22.18 or later; this is " + process.version + ".");
  process.exit(1);
}
// Not require: a package.json with "type": "module" above this folder makes Node load it as ESM.
const { spawnSync } = process.getBuiltinModule("node:child_process");
const { existsSync } = process.getBuiltinModule("node:fs");
const { join } = process.getBuiltinModule("node:path");

const windows = process.platform === "win32";

function paseoCommands() {
  const env = process.env;
  const installed = windows
    ? env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Paseo", "resources", "bin", "paseo.cmd")
    : "/Applications/Paseo.app/Contents/Resources/bin/paseo";
  return [env.PASEO_BIN, env.PASEO_CLI, "paseo", installed].filter(Boolean);
}

// On Windows Paseo's command is paseo.cmd, which Node can start, or find on
// PATH, only through cmd.exe.
function askPaseo(cli) {
  return windows
    ? spawnSync('"' + cli + '" plugin ls ${PLUGIN_ID} --json', { shell: true, encoding: "utf8" })
    : spawnSync(cli, ["plugin", "ls", "${PLUGIN_ID}", "--json"], { encoding: "utf8" });
}

function pluginDirectory() {
  if (process.env.PASEO_PROGRESS_PLUGIN_DIR) return process.env.PASEO_PROGRESS_PLUGIN_DIR;
  for (const cli of paseoCommands()) {
    const result = askPaseo(cli);
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

// An npm install puts the plugin under node_modules, where Node won't run
// TypeScript, so the npm package carries the command compiled to dist/.
const directory = pluginDirectory();
const entry = directory && [join(directory, "dist", "server", "cli.js"), join(directory, "server", "cli.ts")].find((path) => existsSync(path));
if (!entry) {
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

type LauncherFile = { path: string; content: string };

// PowerShell and cmd run only files with an extension like .cmd, so on
// Windows a .cmd file beside the launcher runs it with node.
function launcherFiles(path: string, platform: NodeJS.Platform): LauncherFile[] {
  const files = [{ path, content: launcherScript() }];
  if (platform === "win32") {
    files.push({ path: `${path}.cmd`, content: `@echo off\r\nrem ${MARKER}. Lets PowerShell and cmd run ${basename(path)}.\r\nnode "%~dp0${basename(path)}" %*\r\nexit /b %errorlevel%\r\n` });
  }
  return files;
}

async function fileState(file: LauncherFile): Promise<LauncherState> {
  const current = await readFile(file.path, "utf8").catch(() => null);
  if (current === null) return "missing";
  if (current === file.content) return "current";
  return current.includes(MARKER) ? "outdated" : "foreign";
}

async function fileStates(path: string, platform: NodeJS.Platform) {
  const files = launcherFiles(path, platform);
  const states = await Promise.all(files.map(fileState));
  return files.map((file, index) => ({ ...file, state: states[index] }));
}

// Writes the launcher files that are missing or out of date. Never replaces a
// file something else put there. Returns whether it wrote.
export async function installLauncher(path: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const files = await fileStates(path, platform);
  const foreign = files.find((file) => file.state === "foreign");
  if (foreign) throw new Error(`${foreign.path} already exists and was not written by this plugin. Move it, or pass another path.`);
  let wrote = false;
  for (const file of files) {
    if (file.state === "current") continue;
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content);
    await chmod(file.path, 0o755);
    wrote = true;
  }
  return wrote;
}

// For the panel: whether agents on the daemon host can run `paseo-progress`.
// When something else is in the way, path names that file.
export async function launcherStatus(path = defaultLauncherPath(), pathEnv = process.env.PATH ?? "", platform: NodeJS.Platform = process.platform) {
  const files = await fileStates(path, platform);
  const states = files.map((file) => file.state);
  const foreign = files.find((file) => file.state === "foreign");
  const state: LauncherState = foreign ? "foreign"
    : states.every((each) => each === "current") ? "current"
    : states.every((each) => each === "missing") ? "missing" : "outdated";
  // Windows paths ignore case and may end in either slash.
  const paths = platform === "win32" ? win32 : posix;
  const folder = (dir: string) => platform === "win32" ? dir.replace(/[\\/]+$/, "").toLowerCase() : dir.replace(/\/+$/, "");
  return {
    path: foreign?.path ?? path,
    state,
    onPath: pathEnv.split(paths.delimiter).some((entry) => folder(entry) === folder(paths.dirname(path))),
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
