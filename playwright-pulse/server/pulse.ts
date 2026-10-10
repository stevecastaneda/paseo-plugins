import { createHash } from "node:crypto";
import type { PulseResult, RunBrief } from "../shared/rpc.ts";
import { runBrief } from "../shared/view.ts";
import { openFile, previewImage, type AttachmentRef } from "./attachments.ts";
import { reporterStatus } from "./reporter-install.ts";
import { locateRun, readRun } from "./run-file.ts";
import { stopRun } from "./stop.ts";

export async function handleGetPulse(input: { workspaceDirectory: string; since?: string }): Promise<PulseResult | { unchanged: true; version: string }> {
  const location = locateRun(input.workspaceDirectory);
  const [run, reporter] = await Promise.all([readRun(location), reporterStatus()]);
  const body = { run, file: location.shown, root: location.root, reporter };
  const version = createHash("sha1").update(JSON.stringify(body)).digest("hex");
  if (input.since === version) return { unchanged: true, version };
  return { ...body, version };
}

// Workspaces in one worktree share its run, so each worktree is read once.
export async function handleGetBriefs(input: { directories: string[] }, home?: string): Promise<{ briefs: Record<string, RunBrief | null> }> {
  const byRoot = new Map<string, Promise<RunBrief | null>>();
  const briefs: Record<string, RunBrief | null> = {};
  await Promise.all(input.directories.map(async (directory) => {
    const location = locateRun(directory, home);
    let brief = byRoot.get(location.directory);
    if (!brief) {
      brief = readRun(location).then((run) => (run ? runBrief(run) : null), () => null);
      byRoot.set(location.directory, brief);
    }
    briefs[directory] = await brief;
  }));
  return { briefs };
}

type AttachmentInput = AttachmentRef & { workspaceDirectory: string };

export async function handlePreviewAttachment(input: AttachmentInput) {
  return previewImage(locateRun(input.workspaceDirectory), input);
}

export async function handleOpenAttachment(input: AttachmentInput) {
  return openFile(locateRun(input.workspaceDirectory), input);
}

export async function handleStopRun(input: { workspaceDirectory: string; runId: string }) {
  return stopRun(locateRun(input.workspaceDirectory), input.runId);
}
