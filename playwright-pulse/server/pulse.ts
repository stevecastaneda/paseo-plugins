import { createHash } from "node:crypto";
import type { PulseResult } from "../shared/rpc.ts";
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
