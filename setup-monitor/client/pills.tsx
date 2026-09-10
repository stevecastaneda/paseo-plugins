import {
  type PluginButtonIconProps,
  type PluginButtonRegistration,
  type PluginClientContext,
  useRpc,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { ActivityIndicator } from "react-native";
import type { SetupSnapshot } from "../shared/setup";
import { getSetupStatus } from "../shared/setup";
import { pillLabel, shouldShowPill, statusIconName } from "../shared/snapshot";

const EXPLORER = { location: "explorer" as const };
const CHAT_SEED_MS = 1_200;

function SetupIcon(props: PluginButtonIconProps) {
  if (props.context !== "agent") return null;
  const { theme, workspaceId, size, color } = props;
  const fetchStatus = useRpc(getSetupStatus);
  const query = useQuery({
    queryKey: ["setup-monitor", "status", workspaceId],
    queryFn: () => fetchStatus({ workspaceId }),
    refetchInterval: (current) =>
      current.state.data?.snapshot?.status === "running" ? 750 : 4_000,
  });
  const snapshot = query.data?.snapshot ?? null;
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

export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, { workspaceId: string; pill: PluginButtonRegistration }>();
  const snapshots = new Map<string, SetupSnapshot | null>();
  const runningSince = new Map<string, number>();
  const autoOpened = new Set<string>();
  const scheduled = new Map<string, ReturnType<typeof setTimeout>>();
  let lastAgents: Array<{ id: string; workspaceId?: string | null }> = [];
  let stopped = false;
  let dataTimer: ReturnType<typeof setInterval> | undefined;
  let labelTimer: ReturnType<typeof setInterval> | undefined;

  const remove = (agentId: string) => {
    pills.get(agentId)?.pill.remove();
    pills.delete(agentId);
  };

  const forgetWorkspace = (workspaceId: string) => {
    autoOpened.delete(workspaceId);
    snapshots.delete(workspaceId);
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
    snapshots.set(workspaceId, snapshot);
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
        pills.set(agent.id, { workspaceId, pill });
      } else {
        current.pill.update({ label });
      }
    }
    for (const agentId of pills.keys()) {
      if (!seen.has(agentId)) remove(agentId);
    }
  };

  const sync = async () => {
    if (stopped) return;
    let agentEntries: Array<{ agent: { id: string; workspaceId?: string | null } }>;
    let workspaceEntries: Array<{ id: string; workspaceKind?: string }>;
    try {
      const [agents, workspaces] = await Promise.all([
        client.paseo.agents.list(),
        client.paseo.workspaces.list(),
      ]);
      agentEntries = agents.entries;
      workspaceEntries = workspaces.entries;
    } catch {
      return;
    }

    const worktreeIds = new Set(
      workspaceEntries
        .filter((workspace) => workspace.workspaceKind === "worktree")
        .map((workspace) => workspace.id),
    );
    await Promise.all(
      [...worktreeIds].map(async (workspaceId) => {
        try {
          const { snapshot } = await client.rpc(getSetupStatus, { workspaceId });
          rememberSnapshot(workspaceId, snapshot);
          scheduleSetupTab(workspaceId, snapshot);
        } catch {
          // Leave the workspace out of the pill set.
        }
      }),
    );
    for (const workspaceId of snapshots.keys()) {
      if (!worktreeIds.has(workspaceId)) forgetWorkspace(workspaceId);
    }

    lastAgents = agentEntries.map(({ agent }) => agent);
    publishPills();
  };

  void client.paseo.workspaces.list({ subscribe: {} }).catch(() => undefined);
  void client.paseo.agents.list({ subscribe: {} }).catch(() => undefined);

  const unsubscribeWorkspaces = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "remove") {
      forgetWorkspace(update.id);
      publishPills();
      return;
    }
    if (update.workspace.workspaceKind !== "worktree") {
      void sync();
      return;
    }
    void client.rpc(getSetupStatus, { workspaceId: update.workspace.id }).then(({ snapshot }) => {
      rememberSnapshot(update.workspace.id, snapshot);
      scheduleSetupTab(update.workspace.id, snapshot);
      void sync();
    });
  });
  const unsubscribeAgents = client.paseo.agents.subscribe(() => {
    void sync();
  });

  dataTimer = setInterval(() => {
    void sync();
  }, 2_000);
  labelTimer = setInterval(() => {
    publishPills();
  }, 1_000);
  void sync();

  return () => {
    stopped = true;
    unsubscribeWorkspaces();
    unsubscribeAgents();
    if (dataTimer) clearInterval(dataTimer);
    if (labelTimer) clearInterval(labelTimer);
    for (const id of scheduled.values()) clearTimeout(id);
    scheduled.clear();
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
  };
}
