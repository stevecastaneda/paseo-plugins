import type { PaseoAgentUpdate, PaseoWorkspaceUpdate } from "@getpaseo/client";
import { observeDirectory } from "./directory";
import {
  type PluginButtonContentProps,
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
import { SetupPopover } from "./popover";

export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, { workspaceId: string; label: string; pill: PluginButtonRegistration }>();
  const snapshots = new Map<string, SetupSnapshot | null>();
  const snapshotListeners = new Map<string, Set<() => void>>();
  const useSnapshot = (workspaceId: string) =>
    useSyncExternalStore(
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
  function SetupIcon(props: PluginButtonIconProps) {
    if (props.context !== "agent") return null;
    const { theme, workspaceId, size, color } = props;
    const snapshot = useSnapshot(workspaceId);
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

  function SetupContent({ theme, workspaceId }: PluginButtonContentProps) {
    const snapshot = useSnapshot(workspaceId);
    return (
      <SetupPopover
        theme={theme}
        snapshot={snapshot}
        runningSinceMs={runningSince.get(workspaceId) ?? null}
      />
    );
  }

  const runningSince = new Map<string, number>();
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
    snapshots.delete(workspaceId);
    for (const listener of snapshotListeners.get(workspaceId) ?? []) listener();
    runningSince.delete(workspaceId);
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
            behavior: { kind: "popover", Content: SetupContent },
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
    select: (message) => message.type === "workspace_update" ? message.payload : undefined,
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
    select: (message) => message.type === "agent_update" ? message.payload : undefined,
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
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
  };
}
