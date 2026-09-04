import {
  Icon,
  type PluginClientContext,
  type PluginComposerPillProps,
  useAgent,
} from "@getpaseo/plugin";
import { useToast } from "@getpaseo/plugin/react-native";
import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text } from "react-native";
import {
  formatTimeSinceLabel,
  isWorkingStatus,
  lastThreadMessageAtFromStream,
} from "./elapsed";
import { getLastThreadMessage } from "./last-message.shared";

const lastMessageAt = new Map<string, string>();
const lastMessageListeners = new Map<string, Set<() => void>>();
const showAbsolute = new Map<string, () => void>();

function emitLastMessage(agentId: string) {
  for (const listener of lastMessageListeners.get(agentId) ?? []) listener();
}

function rememberLastMessageAt(agentId: string, at: string) {
  const next = Date.parse(at);
  if (Number.isNaN(next)) return;
  const current = lastMessageAt.get(agentId);
  if (current) {
    const previous = Date.parse(current);
    if (!Number.isNaN(previous) && previous > next) return;
    if (current === at) return;
  }
  lastMessageAt.set(agentId, at);
  emitLastMessage(agentId);
}

function forgetLastMessageAt(agentId: string) {
  if (!lastMessageAt.delete(agentId)) return;
  emitLastMessage(agentId);
}

function subscribeLastMessageAt(agentId: string, listener: () => void) {
  let listeners = lastMessageListeners.get(agentId);
  if (!listeners) {
    listeners = new Set();
    lastMessageListeners.set(agentId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) lastMessageListeners.delete(agentId);
  };
}

function useLastMessageAt(agentId: string) {
  return useSyncExternalStore(
    (listener) => subscribeLastMessageAt(agentId, listener),
    () => lastMessageAt.get(agentId) ?? null,
    () => lastMessageAt.get(agentId) ?? null,
  );
}

function TimeSincePill({ theme, agentId }: PluginComposerPillProps) {
  const agent = useAgent(agentId, ({ status }) => ({ status }));
  const lastAt = useLastMessageAt(agentId);
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
    if (!lastAt) {
      showAbsolute.delete(agentId);
      return;
    }
    showAbsolute.set(agentId, () => {
      const when = new Date(lastAt);
      if (Number.isNaN(when.getTime())) return;
      toast.show(when.toLocaleString(), { variant: "info" });
    });
    return () => {
      showAbsolute.delete(agentId);
    };
  }, [lastAt, agentId, toast]);

  if (isWorkingStatus(agent?.status)) return null;

  const label = lastAt ? formatTimeSinceLabel(lastAt, nowMs) : null;

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
  const watches = new Map<string, () => void>();
  let stopped = false;

  const stopWatch = (agentId: string) => {
    watches.get(agentId)?.();
    watches.delete(agentId);
    forgetLastMessageAt(agentId);
  };

  const remove = (agentId: string) => {
    pills.get(agentId)?.();
    pills.delete(agentId);
    showAbsolute.delete(agentId);
    stopWatch(agentId);
  };

  const watch = (agentId: string) => {
    if (stopped || watches.has(agentId)) return;
    const handle = client.paseo.agents.ref(agentId);
    const unsubscribe = handle.timeline.subscribe((payload) => {
      const at = lastThreadMessageAtFromStream(payload);
      if (at) rememberLastMessageAt(agentId, at);
    });
    let cancelled = false;
    void client
      .rpc(getLastThreadMessage, { agentId })
      .then((result) => {
        if (cancelled || stopped || !result.lastMessageAt) return;
        rememberLastMessageAt(agentId, result.lastMessageAt);
        return undefined;
      })
      .catch(() => undefined);
    watches.set(agentId, () => {
      cancelled = true;
      unsubscribe();
    });
  };

  const register = (agent: {
    id: string;
    workspaceId?: string | null;
    status?: "initializing" | "idle" | "running" | "error" | "closed" | null;
  }) => {
    if (stopped || !agent.workspaceId) return;
    if (isWorkingStatus(agent.status)) {
      pills.get(agent.id)?.();
      pills.delete(agent.id);
      showAbsolute.delete(agent.id);
      watch(agent.id);
      return;
    }
    watch(agent.id);
    pills.get(agent.id)?.();
    const workspaceId = agent.workspaceId;
    const dispose = client.addComposerPill({
      id: "time-since",
      title: "Time since last message",
      workspaceId,
      agentId: agent.id,
      Component: TimeSincePill,
      onPress() {
        showAbsolute.get(agent.id)?.();
      },
    });
    pills.set(agent.id, dispose);
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
    for (const stop of watches.values()) stop();
    watches.clear();
    lastMessageAt.clear();
    lastMessageListeners.clear();
    showAbsolute.clear();
  };
}
