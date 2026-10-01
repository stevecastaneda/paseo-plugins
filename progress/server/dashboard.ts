import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Dashboard } from "../shared/dashboard.ts";
import { PROGRESS_FILE_NAME } from "../shared/events.ts";
import type { AttentionResult, DashboardResult } from "../shared/rpc.ts";
import { markPanelOpened, readProgress } from "./progress-file.ts";
import { findRoot } from "./paths.ts";
import { findStore, historyFolder, inGitRepo, listFolders, setHistoryFolder } from "./store.ts";

const versions = new WeakMap<Dashboard, { key: string; version: string }>();

export async function handleMarkPanelOpened(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
) {
  await markPanelOpened((await findStore(findRoot(input.workspaceDirectory))).directory);
  return {};
}

// The panel polls with the version it already has; when nothing it shows has
// changed, the reply is just "unchanged" instead of the whole dashboard again.
export async function handleGetDashboard(
  input: { workspaceId: string; workspaceDirectory: string; since?: string },
  _context: PluginHandlerContext,
): Promise<DashboardResult | { unchanged: true; version: string }> {
  const root = findRoot(input.workspaceDirectory);
  const store = await findStore(root);
  const result = await readProgress(store.directory);
  const file = join(store.shown, PROGRESS_FILE_NAME);
  const savedTo = await historyFolder(root);
  const inRepo = await inGitRepo(root);
  const key = JSON.stringify([result.panelOpened, file, savedTo, inRepo]);
  let cached = versions.get(result.dashboard);
  if (!cached || cached.key !== key) {
    cached = { key, version: createHash("sha1").update(JSON.stringify(result) + key).digest("base64url") };
    versions.set(result.dashboard, cached);
  }
  const { version } = cached;
  return input.since === version ? { unchanged: true, version } : { ...result, file, savedTo, inRepo, root, version };
}

// Just what a message-box pill needs, so polling every workspace stays small.
export async function handleGetAttention(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
): Promise<AttentionResult> {
  const { configured, dashboard, panelOpened } = await readProgress((await findStore(findRoot(input.workspaceDirectory))).directory);
  return {
    configured,
    questions: dashboard.questions.open.length,
    stuck: dashboard.stuck.length,
    runOpen: Boolean(dashboard.run && !dashboard.run.finished),
    panelOpened,
  };
}

export async function handleListFolders(
  input: { workspaceId: string; workspaceDirectory: string; folder: string },
  _context: PluginHandlerContext,
) {
  return listFolders(findRoot(input.workspaceDirectory), input.folder);
}

// Runs only when the user picks a folder, or stops saving, in the panel.
export async function handleSetHistoryFolder(
  input: { workspaceId: string; workspaceDirectory: string; folder: string | null },
  _context: PluginHandlerContext,
) {
  return { savedTo: await setHistoryFolder(findRoot(input.workspaceDirectory), input.folder) };
}
