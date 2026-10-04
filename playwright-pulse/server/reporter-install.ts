// Keeps the copy of the reporter that playwright.config.ts names, at a fixed
// path, in step with the plugin. The copy is self-contained, so a test run
// never has to ask Paseo anything.
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ReporterStatus } from "../shared/rpc.ts";

export const PLUGIN_ID = "playwright-pulse";
export const REPORTER_SOURCE = join("server", "pulse-reporter.mjs");
// The reporter's first line; only files starting with it are ever replaced.
const MARKER = "// Written by the playwright-pulse Paseo plugin.";

export function defaultReporterPath(home = homedir()): string {
  return join(home, ".local", "share", "playwright-pulse", "reporter.mjs");
}

export async function reporterState(path: string, source: string): Promise<ReporterStatus["state"]> {
  const current = await readFile(path, "utf8").catch(() => null);
  if (current === null) return "missing";
  if (current === source) return "current";
  return current.startsWith(MARKER) ? "outdated" : "foreign";
}

// Writes the copy when it's missing or out of date, through a rename, so a
// test run starting at that moment never loads half a file.
export async function writeReporter(path: string, source: string): Promise<ReporterStatus["state"]> {
  const state = await reporterState(path, source);
  if (state === "current") return state;
  if (state === "foreign") throw new Error(`${path} already exists and was not written by this plugin. Move it, then press Set up again.`);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, source);
  await rename(temporary, path);
  return "current";
}

// The server bundle doesn't know its own folder, so ask Paseo.
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

// The source this copy of the plugin ships. A reload or update starts a new
// server process, so reading it once per process stays correct.
// After a failure it waits a while before asking again, since the panel polls
// every second.
let source: Promise<string> | null = null;
let failedAt = 0;
const RETRY_MS = 30_000;

export function reporterSource(): Promise<string> {
  if (!source && Date.now() - failedAt < RETRY_MS) return Promise.reject(new Error("Could not ask Paseo where this plugin is installed."));
  source ??= findPluginDirectory().then((directory) => readFile(join(directory, REPORTER_SOURCE), "utf8"));
  source.catch(() => {
    source = null;
    failedAt = Date.now();
  });
  return source;
}

// For each poll: the copy's state, bringing one this plugin wrote up to date
// on its own. Setting it up the first time waits for the user.
export async function reporterStatus(path = defaultReporterPath()): Promise<ReporterStatus> {
  const text = await reporterSource().catch(() => null);
  if (text === null) return { path, state: "unknown" };
  let state = await reporterState(path, text);
  if (state === "outdated") state = await writeReporter(path, text).catch(() => state);
  return { path, state };
}

export async function handleInstallReporter(): Promise<ReporterStatus> {
  const path = defaultReporterPath();
  return { path, state: await writeReporter(path, await reporterSource()) };
}
