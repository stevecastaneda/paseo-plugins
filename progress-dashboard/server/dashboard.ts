import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EMPTY_DASHBOARD, parseProgress, reduceProgress, type Dashboard } from "../shared/dashboard.ts";
import { PANEL_OPENED_FILE, PROGRESS_FILE } from "../shared/events.ts";

export async function readProgressText(directory: string): Promise<string | null> {
  try {
    return await readFile(join(directory, PROGRESS_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Stale and overdue checks use the daemon host's clock, the same clock the
// command stamps events with.
export async function readDashboard(directory: string, now = new Date()): Promise<{ configured: boolean; dashboard: Dashboard; panelOpened: boolean }> {
  const text = await readProgressText(directory);
  const panelOpened = await exists(join(directory, PANEL_OPENED_FILE));
  if (text === null) return { configured: false, dashboard: EMPTY_DASHBOARD, panelOpened };
  return { configured: true, dashboard: reduceProgress(parseProgress(text), now), panelOpened };
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
  const path = join(directory, PANEL_OPENED_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "");
}

export async function handleMarkPanelOpened(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
) {
  await markPanelOpened(input.workspaceDirectory);
  return {};
}

export async function handleGetDashboard(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
) {
  return readDashboard(input.workspaceDirectory);
}
