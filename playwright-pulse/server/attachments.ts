// Screenshots, videos and traces a test left behind, found by reference in the
// latest run, so the panel can never reach an arbitrary path. Only real files
// inside the worktree resolve. A branch checked out after the run can replace
// ignored files, so no step of the path may be a link.
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, sep, win32 } from "node:path";
import type { Attachment } from "../shared/run.ts";
import { type AttachmentKind, attachmentKind } from "../shared/view.ts";
import { LAUNCH_FOLDER, findProgram, runProgram, startDetached } from "./system.ts";
import { type RunLocation, readCurrentRun } from "./run-file.ts";

export type AttachmentRef = { runId: string; testId: string; index: number; path: string };

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// The file itself must carry one of its kind's extensions to open: the
// system's default app for anything else might run it.
const OPENS_AS: Record<AttachmentKind, { noun: string; extensions: string[] }> = {
  screenshot: { noun: "an image", extensions: Object.keys(IMAGE_TYPES) },
  video: { noun: "a video", extensions: [".webm", ".mp4", ".mov"] },
  trace: { noun: "a trace", extensions: [".zip"] },
  other: { noun: "a file Pulse opens", extensions: [] },
};

// Large enough for full-page screenshots; the image travels over the socket.
export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;

function outside(inside: string): boolean {
  return inside === ".." || inside.startsWith(`..${"/"}`) || inside.startsWith("..\\") || isAbsolute(inside);
}

// The run may have recorded the worktree by the name it was given or by its
// real path.
function placeIn(location: RunLocation, root: string, path: string): string | null {
  for (const base of [location.root, root]) {
    const inside = relative(base, path);
    if (inside && !outside(inside)) return inside;
  }
  return null;
}

export async function resolveAttachment(location: RunLocation, ref: AttachmentRef): Promise<{ attachment: Attachment; target: string; root: string }> {
  const run = await readCurrentRun(location, ref.runId);
  const attachment = run.tests.find((test) => test.id === ref.testId)?.attachments[ref.index];
  if (!attachment) throw new Error("No such attachment in the latest run.");
  if (attachment.path !== ref.path) throw new Error(`A retry replaced this ${attachment.name}. Open the new one from the failure.`);
  const root = await realpath(location.root);
  const inside = placeIn(location, root, attachment.path);
  if (!inside) throw new Error(`${attachment.name} is outside this worktree, so it was not opened.`);
  let target = root;
  let isFile = false;
  for (const step of inside.split(sep)) {
    target = join(target, step);
    const info = await lstat(target).catch(() => null);
    if (!info) throw new Error(`${attachment.name} no longer exists. Playwright clears its results folder at the start of each run.`);
    if (info.isSymbolicLink()) throw new Error(`${attachment.name} is a link, not the file the run saved, so it was not opened.`);
    isFile = info.isFile();
  }
  if (!isFile) throw new Error(`${attachment.name} isn't a file, so it was not opened.`);
  return { attachment, target, root };
}

// Null when the image is too large to send; the dialog can still open it.
export async function previewImage(location: RunLocation, ref: AttachmentRef): Promise<{ dataUri: string | null; bytes: number }> {
  const { attachment, target } = await resolveAttachment(location, ref);
  const mime = IMAGE_TYPES[extname(target).toLowerCase()];
  if (!mime) throw new Error(`${attachment.name} isn't an image, so it can't be previewed.`);
  const { size } = await lstat(target);
  if (size > MAX_PREVIEW_BYTES) return { dataUri: null, bytes: size };
  return { dataUri: `data:${mime};base64,${(await readFile(target)).toString("base64")}`, bytes: size };
}

export type Host = { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; home: string };

const thisHost = (): Host => ({ platform: process.platform, env: process.env, home: homedir() });

export type HostCommand = { command: string; args: string[]; cwd: string; wait: boolean };

function explorer(env: NodeJS.ProcessEnv): string {
  const systemRoot = env.SystemRoot;
  return win32.join(systemRoot && /^[A-Za-z]:\\/.test(systemRoot) ? systemRoot : "C:\\Windows", "explorer.exe");
}

// The system's own way to open a file in its default app, or to show it
// selected in its folder.
async function hostCommand(action: "open" | "reveal", target: string, avoid: string[], { platform, env }: Host): Promise<HostCommand> {
  const reveal = action === "reveal";
  if (platform === "darwin") return { command: "/usr/bin/open", args: reveal ? ["-R", target] : [target], cwd: LAUNCH_FOLDER, wait: true };
  // Explorer exits with an error code even when it worked, so it isn't waited on.
  if (platform === "win32") return { command: explorer(env), args: reveal ? ["/select,", target] : [target], cwd: LAUNCH_FOLDER, wait: false };
  const xdgOpen = await findProgram("xdg-open", { path: env.PATH ?? "", platform, avoid });
  if (!xdgOpen) throw new Error("xdg-open isn't installed, so Pulse can't open files on this computer.");
  return { command: xdgOpen, args: [reveal ? dirname(target) : target], cwd: LAUNCH_FOLDER, wait: true };
}

export type Opener = (command: HostCommand) => Promise<void>;

export const systemOpener: Opener = async ({ command, args, cwd, wait }) => {
  if (wait) await runProgram(command, args, { cwd });
  else await startDetached(command, args, { cwd });
};

// A command for the user to run in their own terminal. Run in the worktree,
// npx would take a playwright the branch supplies (in node_modules, its
// package.json or its .npmrc), so --prefix points npm at the home folder.
// None for a path a shell would read as code.
function viewTraceCommand(trace: string, root: string, { platform, home }: Host): string | undefined {
  const code = platform === "win32" ? /["$`%!\x00-\x1f\x7f]/ : /["$`\\!\x00-\x1f\x7f]/;
  if (code.test(trace) || code.test(home) || !outside(relative(root, home))) return undefined;
  return `npx --prefix "${home}" playwright show-trace "${trace}"`;
}

// Traces are shown in their folder, never opened: opening one would start a
// trace viewer, and the worktree decides which one.
export async function openFile(
  location: RunLocation,
  ref: AttachmentRef,
  opener: Opener = systemOpener,
  host: Host = thisHost(),
): Promise<{ opened: string; traceCommand?: string }> {
  const { attachment, target, root } = await resolveAttachment(location, ref);
  const kind = attachmentKind(attachment);
  const { noun, extensions } = OPENS_AS[kind];
  if (!extensions.includes(extname(target).toLowerCase())) throw new Error(`${attachment.name} isn't ${noun}, so it was not opened.`);
  const avoid = [location.root, root];
  if (kind !== "trace") {
    await opener(await hostCommand("open", target, avoid, host));
    return { opened: target };
  }
  await opener(await hostCommand("reveal", target, avoid, host));
  return { opened: target, traceCommand: viewTraceCommand(target, root, host) };
}
