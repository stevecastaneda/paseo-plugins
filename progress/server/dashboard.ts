import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { createHash } from "node:crypto";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EMPTY_DASHBOARD, parseProgress, reduceProgress, type Dashboard } from "../shared/dashboard.ts";
import { PANEL_OPENED_FILE, PROGRESS_FILE } from "../shared/events.ts";
import type { AttentionResult, DashboardResult } from "../shared/rpc.ts";
import { prepareScratch } from "./scratch.ts";

export async function readProgressText(directory: string): Promise<string | null> {
  try {
    return await readFile(join(directory, PROGRESS_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// The parsed file per worktree, kept until its size or change time moves. The
// file only grows, and the panel and pills read it every few seconds.
const parsedFiles = new Map<string, { size: number; mtimeMs: number; ctimeMs: number; parsed: ReturnType<typeof parseProgress> }>();

async function readParsed(directory: string): Promise<ReturnType<typeof parseProgress> | null> {
  const info = await stat(join(directory, PROGRESS_FILE)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) {
    parsedFiles.delete(directory);
    return null;
  }
  const cached = parsedFiles.get(directory);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs && cached.ctimeMs === info.ctimeMs) return cached.parsed;
  // Stat before reading: if the file grows in between, the next stat won't match and it's read again.
  const text = await readProgressText(directory);
  if (text === null) return null;
  const parsed = parseProgress(text);
  parsedFiles.set(directory, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, parsed });
  return parsed;
}

// Stale and overdue checks use the daemon host's clock, the same clock the
// command stamps events with.
export async function readDashboard(directory: string, now = new Date()): Promise<{ configured: boolean; dashboard: Dashboard; panelOpened: boolean }> {
  const parsed = await readParsed(directory);
  const panelOpened = await exists(join(directory, PANEL_OPENED_FILE));
  if (parsed === null) return { configured: false, dashboard: EMPTY_DASHBOARD, panelOpened };
  return { configured: true, dashboard: reduceProgress(parsed, now), panelOpened };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function markPanelOpened(directory: string): Promise<void> {
  await prepareScratch(directory);
  await writeFile(join(directory, PANEL_OPENED_FILE), "");
}

export async function handleMarkPanelOpened(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
) {
  await markPanelOpened(input.workspaceDirectory);
  return {};
}

// The panel polls with the version it already has; when nothing it shows has
// changed, the reply is just "unchanged" instead of the whole dashboard again.
export async function handleGetDashboard(
  input: { workspaceId: string; workspaceDirectory: string; since?: string },
  _context: PluginHandlerContext,
): Promise<DashboardResult | { unchanged: true; version: string }> {
  const result = await readDashboard(input.workspaceDirectory);
  const version = createHash("sha1").update(JSON.stringify(result)).digest("base64url");
  return input.since === version ? { unchanged: true, version } : { ...result, version };
}

// Just what a message-box pill needs, so polling every workspace stays small.
export async function handleGetAttention(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
): Promise<AttentionResult> {
  const { configured, dashboard, panelOpened } = await readDashboard(input.workspaceDirectory);
  return {
    configured,
    questions: dashboard.questions.open.length,
    stuck: dashboard.stuck.length,
    runOpen: Boolean(dashboard.run && !dashboard.run.finished),
    panelOpened,
  };
}
