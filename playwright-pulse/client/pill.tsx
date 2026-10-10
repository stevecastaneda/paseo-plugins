// Watches every workspace's newest run. While a workspace's tests run, and for
// a little while after, its header shows a pill, and the store below feeds the
// sidebar's list of runs (see sidebar.tsx). Pressing either opens the panel.
// Paseo can open a panel on its own, but that also switches to the workspace,
// so they wait to be pressed instead.
import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React from "react";
import { getBriefs, type RunBrief } from "../shared/rpc";
import { pillView, type PillTone, type PillView } from "../shared/view";
import { Spinner } from "./spinner";
import { getSettings, type PulseSettings } from "../shared/settings";
import { publishSettings, subscribeSettings } from "./settings";

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

type Workspace = { id: string; name: string; directory: string };

// A workspace whose run is worth showing, and what to show.
export type WorkspaceRun = { workspaceId: string; name: string; view: PillView };

// The runs to show, for the sidebar. Changes only when what's shown does.
export type RunStore = { get(): WorkspaceRun[]; subscribe(listener: () => void): () => void };

function createRunStore() {
  let runs: WorkspaceRun[] = [];
  let key = "[]";
  const listeners = new Set<() => void>();
  return {
    get: () => runs,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next: WorkspaceRun[]) {
      const nextKey = JSON.stringify(next);
      if (nextKey === key) return;
      runs = next;
      key = nextKey;
      for (const listener of listeners) listener();
    },
  };
}

async function listWorkspaces(client: PluginClientContext): Promise<Workspace[]> {
  const workspaces: Workspace[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    for (const entry of page.entries) {
      const directory = entry.workspaceDirectory ?? entry.projectRootPath;
      if (directory && !entry.archivingAt) workspaces.push({ id: entry.id, name: entry.name, directory });
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return workspaces;
}

// `onSettings` hears the options when they're read and whenever they change.
export function watchRuns(client: PluginClientContext, openPanel: (workspaceId: string) => void, onSettings: (settings: PulseSettings) => void): { store: RunStore; stop(): void } {
  const store = createRunStore();
  const stopSettings = subscribeSettings(onSettings);
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
      // Options change rarely, and another device may change them: read them
      // with the workspaces.
      if (Date.now() - workspacesAt > WORKSPACES_MS) {
        workspaces = await listWorkspaces(client);
        workspacesAt = Date.now();
        const asked = Date.now();
        publishSettings(await client.rpc(getSettings, {}), asked);
      }
      const { briefs } = workspaces.length
        ? await client.rpc(getBriefs, { directories: [...new Set(workspaces.map((workspace) => workspace.directory))] })
        : { briefs: {} as Record<string, RunBrief | null> };
      if (stopped) return;
      const now = Date.now();
      const seen = new Set<string>();
      const shown: WorkspaceRun[] = [];
      for (const workspace of workspaces) {
        const brief = briefs[workspace.directory] ?? null;
        live ||= brief?.status === "starting" || brief?.status === "running";
        const view = pillView(brief, now);
        show(workspace.id, view);
        if (view) shown.push({ workspaceId: workspace.id, name: workspace.name, view });
        seen.add(workspace.id);
      }
      store.set(shown);
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

  return {
    store,
    stop() {
      stopped = true;
      stopSettings();
      if (timer) clearTimeout(timer);
      for (const pill of pills.values()) pill.registration.remove();
      pills.clear();
    },
  };
}
