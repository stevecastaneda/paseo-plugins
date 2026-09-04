import {
  Icon,
  type PluginClientContext,
  type PluginComposerPillProps,
  useAgent,
} from "@getpaseo/plugin";
import { useToast } from "@getpaseo/plugin/react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { formatTimeSinceLabel } from "./elapsed";

const showAbsolute = new Map<string, () => void>();

function TimeSincePill({ theme, agentId }: PluginComposerPillProps) {
  const agent = useAgent(agentId, ({ lastActivityAt, status }) => ({
    lastActivityAt,
    status,
  }));
  const toast = useToast();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const textStyle = useMemo(
    () => ({ color: theme.colors.foregroundMuted, flexShrink: 1 }),
    [theme],
  );

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const lastActivityAt = agent?.lastActivityAt;
    if (!lastActivityAt) {
      showAbsolute.delete(agentId);
      return;
    }
    showAbsolute.set(agentId, () => {
      const when = new Date(lastActivityAt);
      if (Number.isNaN(when.getTime())) return;
      toast.show(when.toLocaleString(), { variant: "info" });
    });
    return () => {
      showAbsolute.delete(agentId);
    };
  }, [agent?.lastActivityAt, agentId, toast]);

  const label = agent
    ? formatTimeSinceLabel(agent.lastActivityAt, agent.status, nowMs)
    : null;

  return (
    <>
      <Icon name="Clock" size={14} color={theme.colors.foregroundMuted} />
      <Text style={textStyle} numberOfLines={1}>
        {label ?? "…"}
      </Text>
    </>
  );
}

export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, () => void>();
  let stopped = false;

  const register = (agent: { id: string; workspaceId?: string | null }) => {
    if (stopped || !agent.workspaceId) return;
    pills.get(agent.id)?.();
    const workspaceId = agent.workspaceId;
    const remove = client.addComposerPill({
      id: "time-since",
      title: "Time since last activity",
      workspaceId,
      agentId: agent.id,
      Component: TimeSincePill,
      onPress() {
        showAbsolute.get(agent.id)?.();
      },
    });
    pills.set(agent.id, remove);
  };

  const remove = (agentId: string) => {
    pills.get(agentId)?.();
    pills.delete(agentId);
    showAbsolute.delete(agentId);
  };

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") remove(update.agentId);
    else register(update.agent);
  });

  void client.paseo.agents
    .list()
    .then(({ entries }) => {
      for (const { agent } of entries) register(agent);
      return undefined;
    })
    .catch(() => undefined);

  return () => {
    stopped = true;
    unsubscribe();
    for (const dispose of pills.values()) dispose();
    pills.clear();
    showAbsolute.clear();
  };
}
