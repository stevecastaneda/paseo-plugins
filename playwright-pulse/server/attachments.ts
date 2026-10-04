// Screenshots, videos and traces a test left behind, found by reference in the
// latest run, so the panel can never reach an arbitrary path. Only files
// inside the worktree resolve.
import { execFile, spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import type { Attachment } from "../shared/run.ts";
import { type RunLocation, readRunFile } from "./run-file.ts";

export type AttachmentRef = { runId: string; testId: string; index: number };

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// Large enough for full-page screenshots; the image travels over the socket.
export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;

export function isTrace(attachment: Pick<Attachment, "name" | "path">): boolean {
  return attachment.name === "trace" || attachment.path.endsWith(".zip");
}

function outside(inside: string): boolean {
  return inside === ".." || inside.startsWith(`..${"/"}`) || inside.startsWith("..\\") || isAbsolute(inside);
}

export async function resolveAttachment(location: RunLocation, ref: AttachmentRef): Promise<{ attachment: Attachment; target: string }> {
  const run = await readRunFile(location.file);
  if (!run || run.id !== ref.runId) throw new Error("That run has been replaced by a newer one.");
  const attachment = run.tests.find((test) => test.id === ref.testId)?.attachments[ref.index];
  if (!attachment) throw new Error("No such attachment in the latest run.");
  const root = await realpath(location.root);
  const target = await realpath(attachment.path).catch(() => null);
  if (!target) throw new Error(`${attachment.name} no longer exists. Playwright clears its results folder at the start of each run.`);
  if (outside(relative(root, target))) throw new Error(`${attachment.name} is outside this worktree, so it was not opened.`);
  return { attachment, target };
}

export async function previewImage(location: RunLocation, ref: AttachmentRef): Promise<{ dataUri: string; bytes: number }> {
  const { attachment, target } = await resolveAttachment(location, ref);
  const mime = IMAGE_TYPES[extname(target).toLowerCase()];
  if (!mime) throw new Error(`${attachment.name} isn't an image, so it can't be previewed.`);
  const { size } = await stat(target);
  if (size > MAX_PREVIEW_BYTES) throw new Error(`${attachment.name} is too large to preview.`);
  return { dataUri: `data:${mime};base64,${(await readFile(target)).toString("base64")}`, bytes: size };
}

// How to open a file on this host. Traces go to the project's own Playwright
// trace viewer, so it matches the version that recorded them.
export function openCommand(attachment: Attachment, target: string, root: string, platform: NodeJS.Platform): { command: string; args: string[]; detached: boolean } {
  if (isTrace(attachment)) {
    const local = join(root, "node_modules", ".bin", platform === "win32" ? "playwright.cmd" : "playwright");
    return { command: local, args: ["show-trace", target], detached: true };
  }
  if (platform === "win32") return { command: "explorer", args: [target], detached: false };
  if (platform !== "darwin") return { command: "xdg-open", args: [target], detached: false };
  return { command: "open", args: [target], detached: false };
}

export type Opener = (command: { command: string; args: string[]; detached: boolean }, cwd: string) => Promise<void>;

// The trace viewer keeps running until its window closes, so it's left to
// run on its own instead of being waited on.
export const systemOpener: Opener = async ({ command, args, detached }, cwd) => {
  if (!detached) {
    await promisify(execFile)(command, args, { cwd });
    return;
  }
  await stat(command).catch(() => {
    throw new Error("Playwright isn't installed in this worktree (no node_modules/.bin/playwright), so the trace can't open.");
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
};

export async function openFile(location: RunLocation, ref: AttachmentRef, opener: Opener = systemOpener): Promise<{ opened: string }> {
  const { attachment, target } = await resolveAttachment(location, ref);
  await opener(openCommand(attachment, target, location.root, process.platform), location.root);
  return { opened: target };
}
