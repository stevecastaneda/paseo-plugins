import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EMPTY_DASHBOARD, parseProgress, reduceProgress, type Dashboard } from "../shared/dashboard.ts";
import { PROGRESS_FILE } from "../shared/events.ts";

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
export async function readDashboard(directory: string, now = new Date()): Promise<{ configured: boolean; dashboard: Dashboard }> {
  const text = await readProgressText(directory);
  if (text === null) return { configured: false, dashboard: EMPTY_DASHBOARD };
  return { configured: true, dashboard: reduceProgress(parseProgress(text), now) };
}

export async function handleGetDashboard(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
) {
  return readDashboard(input.workspaceDirectory);
}
