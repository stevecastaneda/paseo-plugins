import {
  Icon,
  type PluginClientContext,
  type PluginComposerPillProps,
  useRpc,
} from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import type { SetupSnapshot } from "./setup.shared";
import { getSetupStatus } from "./setup.shared";
import { pillLabel, shouldShowPill, statusIconName } from "./snapshot";

const EXPLORER = { location: "explorer" as const };
const CHAT_SEED_MS = 1_200;

function SetupPill({ theme, workspaceId }: PluginComposerPillProps) {
  const fetchStatus = useRpc(getSetupStatus);
  const query = useQuery({
    queryKey: ["setup-monitor", "status", workspaceId],
    queryFn: () => fetchStatus({ workspaceId }),
    refetchInterval: (current) =>
      current.state.data?.snapshot?.status === "running" ? 750 : 4_000,
  });
  const snapshot = query.data?.snapshot ?? null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [runningSinceMs, setRunningSinceMs] = useState<number | null>(null);
  const textStyle = useMemo(
    () => ({ color: theme.colors.foregroundMuted, flexShrink: 1 as const }),
    [theme],
  );

  useEffect(() => {
    if (snapshot?.status !== "running") {
      setRunningSinceMs(null);
      return;
    }
    setRunningSinceMs((current) => current ?? Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [snapshot?.status]);

  const elapsedMs =
    snapshot?.status === "running" && runningSinceMs ? Math.max(0, nowMs - runningSinceMs) : 0;
  const label = pillLabel(snapshot, elapsedMs);
  const color =
    snapshot?.status === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted;

  return (
    <>
      {snapshot?.status === "running" ? (
        <ActivityIndicator size="small" color={theme.colors.accent} />
      ) : (
        <Icon
          name={snapshot ? statusIconName(snapshot.status) : "Package"}
          size={14}
          color={color}
        />
      )}
      <Text style={{ ...textStyle, color }} numberOfLines={1}>
        {label ?? "setup"}
      </Text>
    </>
  );
}

export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, () => void>();
  const autoOpened = new Set<string>();
  const scheduled = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const remove = (agentId: string) => {
    pills.get(agentId)?.();
    pills.delete(agentId);
  };

  const forgetWorkspace = (workspaceId: string) => {
    autoOpened.delete(workspaceId);
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
    const interesting = new Set<string>();
    await Promise.all(
      [...worktreeIds].map(async (workspaceId) => {
        try {
          const { snapshot } = await client.rpc(getSetupStatus, { workspaceId });
          if (shouldShowPill(snapshot)) interesting.add(workspaceId);
          scheduleSetupTab(workspaceId, snapshot);
        } catch {
          // Leave the workspace out of the pill set.
        }
      }),
    );

    const seen = new Set<string>();
    for (const { agent } of agentEntries) {
      const workspaceId = agent.workspaceId;
      if (!workspaceId || !interesting.has(workspaceId)) continue;
      seen.add(agent.id);
      if (pills.has(agent.id)) continue;
      const removePill = client.addComposerPill({
        id: "setup-monitor",
        title: "Worktree setup",
        workspaceId,
        agentId: agent.id,
        Component: SetupPill,
        onPress() {
          client.openPanel("setup", { workspaceId, ...EXPLORER });
        },
      });
      pills.set(agent.id, removePill);
    }
    for (const agentId of pills.keys()) {
      if (!seen.has(agentId)) remove(agentId);
    }
  };

  void client.paseo.workspaces.list({ subscribe: {} }).catch(() => undefined);
  void client.paseo.agents.list({ subscribe: {} }).catch(() => undefined);

  const unsubscribeWorkspaces = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "remove") {
      forgetWorkspace(update.id);
      return;
    }
    if (update.workspace.workspaceKind !== "worktree") {
      void sync();
      return;
    }
    void client.rpc(getSetupStatus, { workspaceId: update.workspace.id }).then(({ snapshot }) => {
      scheduleSetupTab(update.workspace.id, snapshot);
      void sync();
    });
  });
  const unsubscribeAgents = client.paseo.agents.subscribe(() => {
    void sync();
  });

  timer = setInterval(() => {
    void sync();
  }, 2_000);
  void sync();

  return () => {
    stopped = true;
    unsubscribeWorkspaces();
    unsubscribeAgents();
    if (timer) clearInterval(timer);
    for (const id of scheduled.values()) clearTimeout(id);
    scheduled.clear();
    for (const dispose of pills.values()) dispose();
    pills.clear();
  };
}
