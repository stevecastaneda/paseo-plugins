import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { open, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { imageMimeType, previewKind } from "../shared/preview.ts";
import type { Dashboard } from "../shared/dashboard.ts";
import { readDashboard } from "./dashboard.ts";
import { outside } from "./paths.ts";

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

// What an attachment reference names: a deliverable ("D3") or the nth file on
// a question ("Q7.2", counting from 1). Null when it names nothing local.
export function attachmentPath(dashboard: Dashboard, ref: string): string | null {
  const question = ref.match(/^(Q\d+)\.(\d+)$/);
  if (question) {
    const all = [...dashboard.questions.open, ...dashboard.questions.answered];
    return all.find((candidate) => candidate.id === question[1])?.files[Number(question[2]) - 1]?.path ?? null;
  }
  return dashboard.deliverables.find((candidate) => candidate.id === ref)?.path ?? null;
}

// A deliverable or question attachment the agent recorded, found by reference,
// so the panel can never reach an arbitrary path. Only files inside the
// worktree resolve.
async function resolveAttachment(directory: string, ref: string, verb: string): Promise<{ path: string; target: string }> {
  const { dashboard } = await readDashboard(directory);
  const path = attachmentPath(dashboard, ref);
  if (!path) throw new Error(`No local ${ref.startsWith("Q") ? "attachment" : "deliverable"} ${ref} in this worktree.`);
  const root = await realpath(directory);
  const target = await realpath(resolve(root, path)).catch(() => null);
  if (!target) throw new Error(`${path} no longer exists.`);
  const inside = relative(root, target);
  if (outside(inside)) throw new Error(`${path} is outside this worktree, so it was not ${verb}.`);
  return { path, target };
}

export async function openDeliverable(directory: string, id: string, opener: Opener): Promise<{ opened: string }> {
  const { target } = await resolveAttachment(directory, id, "opened");
  await opener(target);
  return { opened: target };
}

// Large enough for full-page screenshots; the image travels over the socket.
export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;

// Text past this is cut off in the preview; the full file is a click away.
export const MAX_PREVIEW_TEXT_BYTES = 256 * 1024;

export type Preview =
  | { kind: "image"; dataUri: string; bytes: number }
  | { kind: "text"; text: string; bytes: number; truncated: boolean };

// An image (as a data URI) or a text file's contents, so any client (desktop
// or phone) can show it without reaching the daemon host's disk.
export async function previewDeliverable(directory: string, id: string): Promise<Preview> {
  const { path, target } = await resolveAttachment(directory, id, "previewed");
  const kind = previewKind(target);
  if (!kind) throw new Error(`${path} isn't an image or text file, so it can't be previewed.`);
  const { size } = await stat(target);
  if (kind === "text") {
    // Read only what's shown, so a huge log doesn't load whole.
    const file = await open(target);
    try {
      const { buffer, bytesRead } = await file.read({ buffer: Buffer.alloc(Math.min(size, MAX_PREVIEW_TEXT_BYTES)), position: 0 });
      return { kind, text: buffer.subarray(0, bytesRead).toString("utf8"), bytes: size, truncated: size > MAX_PREVIEW_TEXT_BYTES };
    } finally {
      await file.close();
    }
  }
  if (size > MAX_PREVIEW_BYTES) throw new Error(`${path} is ${Math.round(size / 1024 / 1024)} MB, too large to preview.`);
  const data = await readFile(target);
  return { kind, dataUri: `data:${imageMimeType(target)};base64,${data.toString("base64")}`, bytes: size };
}

export async function handlePreviewDeliverable(
  input: { workspaceId: string; workspaceDirectory: string; ref: string },
  _context: PluginHandlerContext,
) {
  return previewDeliverable(input.workspaceDirectory, input.ref);
}

export async function handleOpenDeliverable(
  input: { workspaceId: string; workspaceDirectory: string; ref: string },
  _context: PluginHandlerContext,
) {
  return openDeliverable(input.workspaceDirectory, input.ref, systemOpener);
}
