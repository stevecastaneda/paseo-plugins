import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { EMPTY_DASHBOARD, type Dashboard } from "../shared/dashboard.ts";
import { PROGRESS_FILE_NAME } from "../shared/events.ts";
import type { AttentionResult, DashboardResult, SetupChoice } from "../shared/rpc.ts";
import { markPanelOpened, readProgress, type ProgressRead } from "./progress-file.ts";
import { findRoot } from "./paths.ts";
import { alreadyIgnored, checkFolder, findStore, listFolders, saveSetup, setupNeeded } from "./setup.ts";

const versions = new WeakMap<Dashboard, { key: string; version: string }>();
const NOT_STARTED: ProgressRead = { configured: false, dashboard: EMPTY_DASHBOARD, panelOpened: false };

// The worktree's progress, or an empty read when the repo isn't set up yet.
async function read(workspaceDirectory: string) {
  const root = findRoot(workspaceDirectory);
  const store = await findStore(root);
  const result = store.ready ? await readProgress(store.directory) : NOT_STARTED;
  return { root, store, result, setupNeeded: await setupNeeded(root) };
}

export async function handleMarkPanelOpened(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
) {
  const store = await findStore(findRoot(input.workspaceDirectory));
  if (store.ready) await markPanelOpened(store.directory);
  return {};
}

// The panel polls with the version it already has; when nothing it shows has
// changed, the reply is just "unchanged" instead of the whole dashboard again.
export async function handleGetDashboard(
  input: { workspaceId: string; workspaceDirectory: string; since?: string },
  _context: PluginHandlerContext,
): Promise<DashboardResult | { unchanged: true; version: string }> {
  const { root, store, result, setupNeeded } = await read(input.workspaceDirectory);
  const file = store.ready ? join(store.shown, PROGRESS_FILE_NAME) : null;
  const key = JSON.stringify([result.panelOpened, setupNeeded, file]);
  let cached = versions.get(result.dashboard);
  if (!cached || cached.key !== key) {
    cached = { key, version: createHash("sha1").update(JSON.stringify(result) + key).digest("base64url") };
    versions.set(result.dashboard, cached);
  }
  const { version } = cached;
  return input.since === version ? { unchanged: true, version } : { ...result, setupNeeded, file, root, version };
}

// Just what a message-box pill needs, so polling every workspace stays small.
export async function handleGetAttention(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
): Promise<AttentionResult> {
  const { configured, dashboard, panelOpened } = (await read(input.workspaceDirectory)).result;
  return {
    configured,
    questions: dashboard.questions.open.length,
    stuck: dashboard.stuck.length,
    runOpen: Boolean(dashboard.run && !dashboard.run.finished),
    panelOpened,
  };
}

export async function handleCheckSetupFolder(
  input: { workspaceId: string; workspaceDirectory: string; folder: string },
  _context: PluginHandlerContext,
) {
  const checked = checkFolder(input.folder);
  if ("error" in checked) return { error: checked.error, alreadyIgnored: false };
  return { alreadyIgnored: await alreadyIgnored(findRoot(input.workspaceDirectory), checked.folder) };
}

// Runs only when the user saves setup in the panel.
export async function handleSaveSetup(
  input: { workspaceId: string; workspaceDirectory: string; choice: SetupChoice },
  _context: PluginHandlerContext,
) {
  const store = await saveSetup(findRoot(input.workspaceDirectory), input.choice);
  return { shown: store.ready ? store.shown : "" };
}

export async function handleListSetupFolders(
  input: { workspaceId: string; workspaceDirectory: string; folder: string },
  _context: PluginHandlerContext,
) {
  return listFolders(findRoot(input.workspaceDirectory), input.folder);
}
