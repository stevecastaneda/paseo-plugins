// A pill in the workspace header while that workspace's tests run, and for a
// little while after, so a run is never out of sight. Pressing it opens the
// panel. Paseo can open a panel on its own, but that also switches to the
// workspace, so the pill waits to be pressed instead.
import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React from "react";
import { getBriefs, type RunBrief } from "../shared/rpc";
import { pillView, type PillTone, type PillView } from "../shared/view";
import { Spinner } from "./spinner";

// How often runs are checked: often while one is going, less when none is.
const LIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 5_000;
// Workspaces come and go rarely.
const WORKSPACES_MS = 30_000;

const ICONS: Record<PillTone, React.ComponentType<PluginButtonIconProps>> = {
  running: ({ size, theme }) => <Spinner color={theme.colors.accent} size={size} />,
  failing: ({ size, theme }) => <Spinner color={theme.colors.statusDanger} size={size} />,
  passed: ({ size, theme }) => <Icon name="CircleCheck" size={size} color={theme.colors.statusSuccess} />,
  failed: ({ size, theme }) => <Icon name="CircleX" size={size} color={theme.colors.statusDanger} />,
  stopped: ({ size, theme }) => <Icon name="CircleStop" size={size} color={theme.colors.statusWarning} />,
};

type Workspace = { id: string; directory: string };

async function listWorkspaces(client: PluginClientContext): Promise<Workspace[]> {
  const workspaces: Workspace[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    for (const entry of page.entries) {
      const directory = entry.workspaceDirectory ?? entry.projectRootPath;
      if (directory && !entry.archivingAt) workspaces.push({ id: entry.id, directory });
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return workspaces;
}

export function watchRuns(client: PluginClientContext, openPanel: (workspaceId: string) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let workspaces: Workspace[] = [];
  let workspacesAt = 0;
  // Each workspace's pill, and what it last showed, so an unchanged pill
  // isn't updated (its spinner would restart).
  const pills = new Map<string, { registration: PluginButtonRegistration; shown: PillView | null }>();

  const show = (workspaceId: string, view: PillView | null) => {
    const pill = pills.get(workspaceId);
    if (!pill) {
      if (!view) return;
      const registration = client.addHeaderButton({
        id: "test-run",
        workspaceId,
        button: {
          title: "Open Playwright Pulse",
          icon: ICONS[view.tone],
          label: view.label,
          behavior: { kind: "action", onPress: () => openPanel(workspaceId) },
        },
      });
      pills.set(workspaceId, { registration, shown: view });
      return;
    }
    const before = pill.shown;
    if (before?.label === view?.label && before?.tone === view?.tone) return;
    pill.shown = view;
    if (!view) pill.registration.update({ visible: false });
    else if (before?.tone === view.tone) pill.registration.update({ visible: true, label: view.label });
    else pill.registration.update({ visible: true, label: view.label, icon: ICONS[view.tone] });
  };

  const tick = async () => {
    let live = false;
    try {
      if (Date.now() - workspacesAt > WORKSPACES_MS) {
        workspaces = await listWorkspaces(client);
        workspacesAt = Date.now();
      }
      const { briefs } = workspaces.length
        ? await client.rpc(getBriefs, { directories: [...new Set(workspaces.map((workspace) => workspace.directory))] })
        : { briefs: {} as Record<string, RunBrief | null> };
      if (stopped) return;
      const now = Date.now();
      const seen = new Set<string>();
      for (const workspace of workspaces) {
        const brief = briefs[workspace.directory] ?? null;
        live ||= brief?.status === "starting" || brief?.status === "running";
        show(workspace.id, pillView(brief, now));
        seen.add(workspace.id);
      }
      // Workspaces that were archived or closed.
      for (const [workspaceId, pill] of pills) {
        if (seen.has(workspaceId)) continue;
        pill.registration.remove();
        pills.delete(workspaceId);
      }
    } catch {
      // The host may be reconnecting; try again on the next tick.
    }
    if (!stopped) timer = setTimeout(tick, live ? LIVE_POLL_MS : IDLE_POLL_MS);
  };
  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };
}
