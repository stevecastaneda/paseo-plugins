import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import nodePath, { delimiter, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { findAttachment, type FolderEntry, imageMimeType, isPieced, type PiecedKind, previewKind, splitRef, textFormat, videoMimeType } from "../shared/attachments.ts";
import { prepareMarkdown, previewText } from "../shared/markdown.ts";
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
// so the panel can never reach an arbitrary path. Only files inside the
// worktree resolve.
async function resolveAttachment(directory: string, ref: string, verb: string): Promise<{ path: string; realTarget: string; realRoot: string; worktree: string }> {
  const { base, inner } = splitRef(ref);
  const worktree = findRoot(directory);
  const { dashboard } = await readProgress((await findStore(worktree)).directory);
  const folder = findAttachment(dashboard, base)?.path;
  if (!folder) throw new Error(`No local ${base.startsWith("Q") ? "attachment" : "deliverable"} ${base} in this worktree.`);
  const path = inner ? join(folder, inner) : folder;
  if (outside(relative(resolve(worktree, folder), resolve(worktree, path)))) throw new Error(`${path} is outside ${folder}, so it was not ${verb}.`);
  const realRoot = await realpath(worktree);
  const realTarget = await realpath(resolve(realRoot, path)).catch(() => null);
  if (!realTarget) throw new Error(`${path} no longer exists.`);
  const inside = relative(realRoot, realTarget);
  if (outside(inside)) throw new Error(`${path} is outside this worktree, so it was not ${verb}.`);
  return { path, realTarget, realRoot, worktree };
}

export async function openDeliverable(directory: string, id: string, opener: Opener): Promise<{ opened: string }> {
  const { realTarget } = await resolveAttachment(directory, id, "opened");
  await opener(realTarget);
  return { opened: realTarget };
}

// Large enough for full-page screenshots; the image travels over the socket.
export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;

// Text past this is cut off in the preview; the full file is a click away.
export const MAX_PREVIEW_TEXT_BYTES = 256 * 1024;

export const PIECED_LIMIT_BYTES: Record<PiecedKind, number> = {
  video: 200 * 1024 * 1024,
  pdf: 100 * 1024 * 1024,
};

// Small enough that one piece doesn't hold up the agent output sharing the socket.
export const PIECE_BYTES = 4 * 1024 * 1024;

export const MAX_FOLDER_ENTRIES = 500;

export type Preview =
  | { kind: "image"; dataUri: string; bytes: number }
  | { kind: "video"; mimeType: string; bytes: number }
  | { kind: "pdf"; bytes: number }
  | { kind: "text"; text: string; bytes: number; truncated: boolean }
  | { kind: "markdown"; markdown: string; bytes: number; truncated: boolean }
  | { kind: "html"; html: string; bytes: number }
  | { kind: "folder"; entries: FolderEntry[]; truncated: boolean };

export async function previewDeliverable(directory: string, id: string): Promise<Preview> {
  const { path, realTarget, realRoot, worktree } = await resolveAttachment(directory, id, "previewed");
  const stats = await stat(realTarget);
  if (stats.isDirectory()) return { kind: "folder", ...(await listFolder(realTarget)) };
  const kind = previewKind(realTarget);
  if (!kind) throw new Error(`${path} isn't an image, video, PDF, text or HTML file, so it can't be previewed.`);
  const { size } = stats;
  if (isPieced(kind)) {
    if (size > PIECED_LIMIT_BYTES[kind]) throw new Error(tooLarge(path, size));
    return kind === "video" ? { kind, mimeType: videoMimeType(realTarget)!, bytes: size } : { kind, bytes: size };
  }
  if (kind === "text") {
    // Read only what's shown, so a huge log doesn't load whole.
    const file = await open(realTarget);
    try {
      const { buffer, bytesRead } = await file.read({ buffer: Buffer.alloc(Math.min(size, MAX_PREVIEW_TEXT_BYTES)), position: 0 });
      const bytes = buffer.subarray(0, bytesRead);
      const truncated = size > MAX_PREVIEW_TEXT_BYTES;
      if (textFormat(realTarget) === "plain") return { kind, text: previewText(bytes, truncated), bytes: size, truncated };
      const where = { root: worktree, folder: dirname(resolve(worktree, path)), path: nodePath };
      return { kind: "markdown", markdown: prepareMarkdown(bytes, truncated, where), bytes: size, truncated };
    } finally {
      await file.close();
    }
  }
  if (size > MAX_PREVIEW_BYTES) throw new Error(tooLarge(path, size));
  if (kind === "html") return { kind, html: await inlineLocalFiles(await readFile(realTarget, "utf8"), dirname(realTarget), realRoot), bytes: size };
  const data = await readFile(realTarget);
  return { kind, dataUri: `data:${imageMimeType(realTarget)};base64,${data.toString("base64")}`, bytes: size };
}

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

// The preview gets only the page, so the files beside it that it loads (its
// screenshots, a script, a stylesheet) are written into it. Only files inside the
// worktree, up to MAX_PREVIEW_BYTES in all; anything else is left as written and
// fails to load. Web addresses are left alone.
async function inlineLocalFiles(html: string, directory: string, root: string): Promise<string> {
  let room = MAX_PREVIEW_BYTES - Buffer.byteLength(html);
  const inline = async (url: string, encode: (data: Buffer, file: string) => string): Promise<string | null> => {
    if (!url || /^([a-z][a-z0-9+.-]*:|[/\\#?])/i.test(url)) return null;
    try {
      const file = await realpath(resolve(directory, decodeURI(url.replace(/[?#].*$/, ""))));
      const stats = await stat(file);
      if (outside(relative(root, file)) || !stats.isFile() || stats.size > room) return null;
      const encoded = encode(await readFile(file), file);
      if (encoded.length > room) return null;
      room -= encoded.length;
      return encoded;
    } catch {
      return null;
    }
  };
  const dataUri = (data: Buffer, file: string) => `data:${imageMimeType(file) ?? videoMimeType(file) ?? "application/octet-stream"};base64,${data.toString("base64")}`;
  // Its own end tag would close the element early.
  const body = (tag: string) => (data: Buffer) => data.toString("utf8").replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
  html = await replaceEach(html, /<(?:img|source|video)\b[^>]*>/gi, (tag) =>
    replaceEach(tag[0], /(?<=\s)(src|poster)(\s*=\s*)(["'])([^"']*)\3/gi, async ([, name, equals, quote, url]) => {
      const uri = await inline(url, dataUri);
      return uri && `${name}${equals}${quote}${uri}${quote}`;
    }));
  html = await replaceEach(html, /<link\b[^>]*>/gi, async ([tag]) => {
    const href = tag.match(/\bhref\s*=\s*(["'])([^"']*)\1/i)?.[2];
    if (!href || !/\brel\s*=\s*(["'])\s*stylesheet\s*\1/i.test(tag)) return null;
    const css = await inline(href, body("style"));
    return css === null ? null : `<style>${css}</style>`;
  });
  return replaceEach(html, /<script\b([^>]*?)\s+src\s*=\s*(["'])([^"']*)\2([^>]*)>\s*<\/script\s*>/gi, async ([, before, , src, after]) => {
    const script = await inline(src, body("script"));
    return script === null ? null : `<script${before}${after}>${script}</script>`;
  });
}

// `replace` on each match in turn; a null keeps the match as it was.
async function replaceEach(text: string, pattern: RegExp, replace: (match: RegExpMatchArray) => Promise<string | null>): Promise<string> {
  let result = "";
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    result += text.slice(last, match.index) + ((await replace(match)) ?? match[0]);
    last = match.index! + match[0].length;
  }
  return result + text.slice(last);
}

function tooLarge(path: string, size: number): string {
  return `${path} is ${Math.round(size / 1024 / 1024)} MB, too large to preview.`;
}

export async function readDeliverablePiece(directory: string, id: string, offset: number): Promise<{ data: string; bytes: number }> {
  const { path, realTarget } = await resolveAttachment(directory, id, "previewed");
  const kind = previewKind(realTarget);
  if (!isPieced(kind)) throw new Error(`${path} isn't a video or PDF.`);
  const file = await open(realTarget);
  try {
    const { size } = await file.stat();
    if (size > PIECED_LIMIT_BYTES[kind]) throw new Error(tooLarge(path, size));
    const length = Math.max(0, Math.min(PIECE_BYTES, size - offset));
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
