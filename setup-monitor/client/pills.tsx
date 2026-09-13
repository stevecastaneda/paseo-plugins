import type { PaseoAgentUpdate, PaseoWorkspaceUpdate } from "@getpaseo/client";
import { observeDirectory } from "./directory";
import {
  type PluginButtonIconProps,
  type PluginButtonRegistration,
  type PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useSyncExternalStore } from "react";
import { ActivityIndicator } from "react-native";
import type { SetupSnapshot } from "../shared/setup";
import { getSetupStatus } from "../shared/setup";
import { pillLabel, shouldShowPill, statusIconName } from "../shared/snapshot";

const EXPLORER = { location: "explorer" as const };
const CHAT_SEED_MS = 1_200;

export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, { workspaceId: string; label: string; pill: PluginButtonRegistration }>();
  const snapshots = new Map<string, SetupSnapshot | null>();
  const snapshotListeners = new Map<string, Set<() => void>>();
  function SetupIcon(props: PluginButtonIconProps) {
    if (props.context !== "agent") return null;
    const { theme, workspaceId, size, color } = props;
    const snapshot = useSyncExternalStore(
      (listener) => {
        const listeners = snapshotListeners.get(workspaceId) ?? new Set<() => void>();
        listeners.add(listener);
        snapshotListeners.set(workspaceId, listeners);
        return () => {
          listeners.delete(listener);
          if (!listeners.size) snapshotListeners.delete(workspaceId);
        };
      },
      () => snapshots.get(workspaceId) ?? null,
    );
    if (snapshot?.status === "running") {
      return <ActivityIndicator size="small" color={theme.colors.accent} />;
    }
    return (
      <Icon
        name={snapshot ? statusIconName(snapshot.status) : "Package"}
        size={size}
        color={snapshot?.status === "failed" ? theme.colors.statusDanger : color}
      />
    );
  }

  const runningSince = new Map<string, number>();
  const autoOpened = new Set<string>();
  const scheduled = new Map<string, ReturnType<typeof setTimeout>>();
  let lastAgents: Array<{ id: string; workspaceId?: string | null }> = [];
  let stopped = false;
  let dataTimer: ReturnType<typeof setTimeout> | undefined;
  const worktreeIds = new Set<string>();
  const pending = new Map<string, object>();
  let labelTimer: ReturnType<typeof setInterval> | undefined;

  const remove = (agentId: string) => {
    pills.get(agentId)?.pill.remove();
    pills.delete(agentId);
  };

  const forgetWorkspace = (workspaceId: string) => {
    pending.delete(workspaceId);
    autoOpened.delete(workspaceId);
    snapshots.delete(workspaceId);
    for (const listener of snapshotListeners.get(workspaceId) ?? []) listener();
    runningSince.delete(workspaceId);
    const scheduledId = scheduled.get(workspaceId);
    if (scheduledId) {
      clearTimeout(scheduledId);
      scheduled.delete(workspaceId);
    }
  };

  const openSetupInExplorer = (workspaceId: string) => {
    try {
      client.openPanel("setup", { workspaceId, ...EXPLORER });
    } catch {
      // Compact hosts have no Explorer pane.
    }
  };

  const scheduleSetupTab = (workspaceId: string, snapshot: SetupSnapshot | null) => {
    if (snapshot?.status !== "running") return;
    if (autoOpened.has(workspaceId) || scheduled.has(workspaceId)) return;
    const scheduledId = setTimeout(() => {
      scheduled.delete(workspaceId);
      if (stopped || autoOpened.has(workspaceId)) return;
      autoOpened.add(workspaceId);
      openSetupInExplorer(workspaceId);
    }, CHAT_SEED_MS);
    scheduled.set(workspaceId, scheduledId);
  };

  const rememberSnapshot = (workspaceId: string, snapshot: SetupSnapshot | null) => {
    if (JSON.stringify(snapshots.get(workspaceId)) !== JSON.stringify(snapshot)) {
      snapshots.set(workspaceId, snapshot);
      for (const listener of snapshotListeners.get(workspaceId) ?? []) listener();
    }
    if (snapshot?.status === "running") {
      if (!runningSince.has(workspaceId)) runningSince.set(workspaceId, Date.now());
    } else {
      runningSince.delete(workspaceId);
    }
  };

  const publishPills = () => {
    if (stopped) return;
    const now = Date.now();
    const seen = new Set<string>();
    for (const agent of lastAgents) {
      const workspaceId = agent.workspaceId;
      if (!workspaceId) continue;
      const snapshot = snapshots.get(workspaceId) ?? null;
      if (!shouldShowPill(snapshot)) continue;
      seen.add(agent.id);
      const since = runningSince.get(workspaceId);
      const elapsedMs =
        snapshot?.status === "running" && since ? Math.max(0, now - since) : 0;
      const label = pillLabel(snapshot, elapsedMs) ?? "setup";
      const existing = pills.get(agent.id);
      if (existing && existing.workspaceId !== workspaceId) {
        existing.pill.remove();
        pills.delete(agent.id);
      }
      const current = pills.get(agent.id);
      if (!current) {
        const pill = client.addComposerPill({
          id: "setup-monitor",
          workspaceId,
          agentId: agent.id,
          button: {
            title: "Worktree setup",
            icon: SetupIcon,
            label,
            behavior: {
              kind: "action",
              onPress() {
                client.openPanel("setup", { workspaceId, ...EXPLORER });
              },
            },
          },
        });
        pills.set(agent.id, { workspaceId, label, pill });
      } else if (current.label !== label) {
        current.pill.update({ label });
        current.label = label;
      }
    }
    for (const agentId of pills.keys()) {
      if (!seen.has(agentId)) remove(agentId);
    }
  };

  const refreshWorkspace = async (workspaceId: string) => {
    if (stopped || pending.has(workspaceId) || !worktreeIds.has(workspaceId)) return;
    const request = {};
    pending.set(workspaceId, request);
    try {
      const { snapshot } = await client.rpc(getSetupStatus, { workspaceId });
      if (stopped || !worktreeIds.has(workspaceId) || pending.get(workspaceId) !== request) return;
      rememberSnapshot(workspaceId, snapshot);
      scheduleSetupTab(workspaceId, snapshot);
      publishPills();
    } catch { /* Retry on the next status refresh. */ }
    finally { if (pending.get(workspaceId) === request) pending.delete(workspaceId); }
  };
  const sync = async () => {
    await Promise.all([...worktreeIds].map(refreshWorkspace));
    if (!stopped) dataTimer = setTimeout(() => void sync(), 2_000);
  };
  const unsubscribeWorkspaces = observeDirectory({
    list: (options) => client.paseo.workspaces.list(options),
    subscribe: (listener) => client.paseo.workspaces.subscribe(listener),
    snapshot: (entries) => {
      const next = new Set(entries.filter((workspace) => workspace.workspaceKind === "worktree").map((workspace) => workspace.id));
      for (const id of worktreeIds) if (!next.has(id)) { worktreeIds.delete(id); forgetWorkspace(id); }
      for (const id of next) {
        worktreeIds.add(id);
        void refreshWorkspace(id);
      }
      publishPills();
    },
    update: (update: PaseoWorkspaceUpdate) => {
      const id = update.kind === "remove" ? update.id : update.workspace.id;
      if (update.kind === "remove" || update.workspace.workspaceKind !== "worktree") {
        worktreeIds.delete(id);
        forgetWorkspace(id);
      } else if (!worktreeIds.has(id)) {
        worktreeIds.add(id);
        void refreshWorkspace(id);
      }
      publishPills();
    },
  });
  const unsubscribeAgents = observeDirectory({
    list: (options) => client.paseo.agents.list({ ...options, filter: { includeArchived: false } }),
    subscribe: (listener) => client.paseo.agents.subscribe(listener),
    snapshot: (entries) => {
      lastAgents = entries.map(({ agent }) => agent);
      publishPills();
    },
    update: (update: PaseoAgentUpdate) => {
      const id = update.kind === "remove" ? update.agentId : update.agent.id;
      lastAgents = lastAgents.filter((agent) => agent.id !== id);
      if (update.kind !== "remove") lastAgents.push(update.agent);
      publishPills();
    },
  });

  labelTimer = setInterval(() => {
    publishPills();
  }, 1_000);
  void sync();

  return () => {
    stopped = true;
    unsubscribeWorkspaces();
    unsubscribeAgents();
    if (dataTimer) clearTimeout(dataTimer);
    if (labelTimer) clearInterval(labelTimer);
    for (const id of scheduled.values()) clearTimeout(id);
    scheduled.clear();
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
  };
}
