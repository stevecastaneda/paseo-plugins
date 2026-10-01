import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { createHash } from "node:crypto";
import type { Dashboard } from "../shared/dashboard.ts";
import type { AttentionResult, DashboardResult } from "../shared/rpc.ts";
import { markPanelOpened, readProgress } from "./progress-file.ts";
import { findRoot } from "./paths.ts";

const versions = new WeakMap<Dashboard, { panelOpened: boolean; version: string }>();

export async function handleMarkPanelOpened(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
) {
  await markPanelOpened(findRoot(input.workspaceDirectory));
  return {};
}

// The panel polls with the version it already has; when nothing it shows has
// changed, the reply is just "unchanged" instead of the whole dashboard again.
export async function handleGetDashboard(
  input: { workspaceId: string; workspaceDirectory: string; since?: string },
  _context: PluginHandlerContext,
): Promise<DashboardResult | { unchanged: true; version: string }> {
  const root = findRoot(input.workspaceDirectory);
  const result = await readProgress(root);
  let cached = versions.get(result.dashboard);
  if (!cached || cached.panelOpened !== result.panelOpened) {
    cached = { panelOpened: result.panelOpened, version: createHash("sha1").update(JSON.stringify(result)).digest("base64url") };
    versions.set(result.dashboard, cached);
  }
  const { version } = cached;
  return input.since === version ? { unchanged: true, version } : { ...result, root, version };
}

// Just what a message-box pill needs, so polling every workspace stays small.
export async function handleGetAttention(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
): Promise<AttentionResult> {
  const { configured, dashboard, panelOpened } = await readProgress(findRoot(input.workspaceDirectory));
  return {
    configured,
    questions: dashboard.questions.open.length,
    stuck: dashboard.stuck.length,
    runOpen: Boolean(dashboard.run && !dashboard.run.finished),
    panelOpened,
  };
}
