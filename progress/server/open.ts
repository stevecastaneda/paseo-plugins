import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { delimiter, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { findAttachment, type FolderEntry, imageMimeType, previewKind, videoMimeType } from "../shared/attachments.ts";
import { readProgress } from "./progress-file.ts";
import { findRoot, outside } from "./paths.ts";
import { findStore } from "./store.ts";

export type Opener = (path: string) => Promise<void>;

// The command that opens `path` on this host: like a double-click, except
// plain-text files go to the default browser (`browser` is its bundle id): the
// Mac's default app for them is often an editor, or one that closes straight
// away. The browser shows them as text.
export function openCommand(path: string, platform: NodeJS.Platform, browser: string | null): [string, string[]] {
  if (platform === "win32") return ["explorer", [path]];
  if (platform !== "darwin") return ["xdg-open", [path]];
  const toBrowser = previewKind(path) === "text";
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

// Whether this computer can open a file in an app for someone at its screen.
// A Mac or a Windows PC can. Linux needs a desktop session and xdg-open, which
// a server reached over ssh doesn't have.
export function canOpenFiles(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  if (platform === "darwin" || platform === "win32") return true;
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return (env.PATH ?? "").split(delimiter).some((directory) => directory && existsSync(join(directory, "xdg-open")));
}

export function hostOpener(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Opener {
  return async (path) => {
    if (!canOpenFiles(platform, env)) throw new Error(`Can't open files on ${hostname()}`);
    const browser = platform === "darwin" ? await defaultBrowser() : null;
    const [command, args] = openCommand(path, platform, browser);
    await promisify(execFile)(command, args);
  };
}

// A deliverable or question attachment the agent recorded, found by reference,
// so the panel can never reach an arbitrary path. A file inside a recorded
// folder is the folder's reference, a slash, and its path in the folder
// ("D3/older/a.png"). Only files inside the worktree resolve.
async function resolveAttachment(directory: string, ref: string, verb: string): Promise<{ path: string; target: string }> {
  const [base, ...rest] = ref.split("/");
  const inner = rest.join("/");
  const worktree = findRoot(directory);
  const { dashboard } = await readProgress((await findStore(worktree)).directory);
  const folder = findAttachment(dashboard, base)?.path;
  if (!folder) throw new Error(`No local ${base.startsWith("Q") ? "attachment" : "deliverable"} ${base} in this worktree.`);
  const path = inner ? join(folder, inner) : folder;
  if (outside(relative(resolve(worktree, folder), resolve(worktree, path)))) throw new Error(`${path} is outside ${folder}, so it was not ${verb}.`);
  const root = await realpath(worktree);
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

// A video travels in pieces, so it's capped by what the app can hold, not the socket.
export const MAX_PREVIEW_VIDEO_BYTES = 200 * 1024 * 1024;

// Small enough that one piece doesn't hold up the agent output sharing the socket.
export const VIDEO_PIECE_BYTES = 4 * 1024 * 1024;

// A folder lists this many entries at most; past it the preview says it stopped.
export const MAX_FOLDER_ENTRIES = 500;

export type Preview =
  | { kind: "image"; dataUri: string; bytes: number }
  | { kind: "video"; mimeType: string; bytes: number }
  | { kind: "text"; text: string; bytes: number; truncated: boolean }
  | { kind: "folder"; entries: FolderEntry[]; truncated: boolean };

// An image (as a data URI), a text file's contents or a folder's entries, so
// any client (desktop or phone) can show it without reaching the daemon host's disk.
export async function previewDeliverable(directory: string, id: string): Promise<Preview> {
  const { path, target } = await resolveAttachment(directory, id, "previewed");
  const stats = await stat(target);
  if (stats.isDirectory()) return { kind: "folder", ...(await listFolder(target)) };
  const kind = previewKind(target);
  if (!kind) throw new Error(`${path} isn't an image, video or text file, so it can't be previewed.`);
  const { size } = stats;
  if (kind === "video") {
    if (size > MAX_PREVIEW_VIDEO_BYTES) throw new Error(tooLarge(path, size));
    return { kind, mimeType: videoMimeType(target)!, bytes: size };
  }
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
  if (size > MAX_PREVIEW_BYTES) throw new Error(tooLarge(path, size));
  const data = await readFile(target);
  return { kind, dataUri: `data:${imageMimeType(target)};base64,${data.toString("base64")}`, bytes: size };
}

// Folders first, then by name with numbers in order ("shot 2" before "shot 10").
// Hidden files are left out, as Finder does.
async function listFolder(target: string): Promise<{ entries: FolderEntry[]; truncated: boolean }> {
  const entries: FolderEntry[] = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const linkedFolder = entry.isSymbolicLink() && (await stat(join(target, entry.name)).catch(() => null))?.isDirectory();
    entries.push({ name: entry.name, folder: entry.isDirectory() || Boolean(linkedFolder) });
  }
  entries.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return { entries: entries.slice(0, MAX_FOLDER_ENTRIES), truncated: entries.length > MAX_FOLDER_ENTRIES };
}

function tooLarge(path: string, size: number): string {
  return `${path} is ${Math.round(size / 1024 / 1024)} MB, too large to preview.`;
}

// One piece of a video, from `offset`. Resolved by reference each time, like the
// preview, so a piece can only come from a video the agent recorded.
export async function readDeliverablePiece(directory: string, id: string, offset: number): Promise<{ data: string; bytes: number }> {
  const { path, target } = await resolveAttachment(directory, id, "previewed");
  if (previewKind(target) !== "video") throw new Error(`${path} isn't a video.`);
  const file = await open(target);
  try {
    const { size } = await file.stat();
    if (size > MAX_PREVIEW_VIDEO_BYTES) throw new Error(tooLarge(path, size));
    const length = Math.max(0, Math.min(VIDEO_PIECE_BYTES, size - offset));
    if (!length) return { data: "", bytes: size };
    const { buffer, bytesRead } = await file.read({ buffer: Buffer.alloc(length), position: offset });
    return { data: buffer.subarray(0, bytesRead).toString("base64"), bytes: size };
  } finally {
    await file.close();
  }
}

export async function handlePreviewDeliverable(
  input: { workspaceId: string; workspaceDirectory: string; ref: string },
  _context: PluginHandlerContext,
) {
  return previewDeliverable(input.workspaceDirectory, input.ref);
}

export async function handleReadDeliverablePiece(
  input: { workspaceId: string; workspaceDirectory: string; ref: string; offset: number },
  _context: PluginHandlerContext,
) {
  return readDeliverablePiece(input.workspaceDirectory, input.ref, input.offset);
}

export async function handleOpenDeliverable(
  input: { workspaceId: string; workspaceDirectory: string; ref: string },
  _context: PluginHandlerContext,
) {
  return openDeliverable(input.workspaceDirectory, input.ref, hostOpener(process.platform, process.env));
}

export async function handleCanOpenOnHost(_input: { workspaceId: string; workspaceDirectory: string }, _context: PluginHandlerContext) {
  return { canOpen: canOpenFiles(process.platform, process.env) };
}
