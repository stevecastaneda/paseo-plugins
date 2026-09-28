import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { readDashboard } from "./dashboard.ts";

export type Opener = (path: string) => Promise<void>;

// Plain-text files open in the browser: the Mac's default app for them is
// often an editor, or one that closes straight away. The browser shows them
// as text.
const BROWSER_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt", ".log", ".json", ".jsonl", ".yaml", ".yml", ".csv"]);

// The command that opens `path` on this host: like a double-click, except
// plain-text files go to the default browser (`browser` is its bundle id).
export function openCommand(path: string, platform: NodeJS.Platform, browser: string | null): [string, string[]] {
  if (platform === "win32") return ["explorer", [path]];
  if (platform !== "darwin") return ["xdg-open", [path]];
  const toBrowser = BROWSER_EXTENSIONS.has(extname(path).toLowerCase());
  return toBrowser ? ["open", ["-b", browser ?? "com.apple.Safari", path]] : ["open", [path]];
}

// The default browser from Launch Services, e.g. "com.google.chrome".
async function defaultBrowser(): Promise<string | null> {
  try {
    const plist = join(homedir(), "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist");
    const { stdout } = await promisify(execFile)("plutil", ["-convert", "json", "-o", "-", plist]);
    const handlers = (JSON.parse(stdout).LSHandlers ?? []) as Array<{ LSHandlerURLScheme?: string; LSHandlerRoleAll?: string }>;
    return handlers.find((handler) => handler.LSHandlerURLScheme === "https")?.LSHandlerRoleAll ?? null;
  } catch {
    return null;
  }
}

export const systemOpener: Opener = async (path) => {
  const browser = process.platform === "darwin" ? await defaultBrowser() : null;
  const [command, args] = openCommand(path, process.platform, browser);
  await promisify(execFile)(command, args);
};

// Opens a deliverable the agent recorded, by id, so the panel can never ask
// the daemon to open an arbitrary path. Only files inside the worktree open.
export async function openDeliverable(directory: string, id: string, opener: Opener): Promise<{ opened: string }> {
  const { dashboard } = await readDashboard(directory);
  const deliverable = dashboard.deliverables.find((candidate) => candidate.id === id);
  if (!deliverable?.path) throw new Error(`No local deliverable ${id} in this worktree.`);
  const root = await realpath(directory);
  const target = await realpath(resolve(root, deliverable.path)).catch(() => null);
  if (!target) throw new Error(`${deliverable.path} no longer exists.`);
  const inside = relative(root, target);
  if (inside.startsWith("..") || isAbsolute(inside)) throw new Error(`${deliverable.path} is outside this worktree, so it was not opened.`);
  await opener(target);
  return { opened: target };
}

export async function handleOpenDeliverable(
  input: { workspaceId: string; workspaceDirectory: string; deliverableId: string },
  _context: PluginHandlerContext,
) {
  return openDeliverable(input.workspaceDirectory, input.deliverableId, systemOpener);
}
