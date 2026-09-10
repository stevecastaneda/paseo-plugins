import {
  type PluginButtonIconProps,
  type PluginButtonRegistration,
  type PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useSyncExternalStore } from "react";
import {
  formatTimeSincePillLabel,
  isWorkingStatus,
  lastThreadMessageAtFromStream,
} from "../shared/elapsed";
import { getLastThreadMessage } from "../shared/last-message";
import { useSettings } from "./settings";
import { defaultSettings, getSettings, type TimeSinceSettings } from "../shared/settings";

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

function TimeSinceIcon(props: PluginButtonIconProps) {
  if (props.context !== "agent") return null;
  const { host, agentId, size, color } = props;
  const settings = useSettings(host.id).data ?? defaultSettings;
  const lastAt = useLastMessageAt(agentId);
  const toast = useToast();

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

  if (!settings.showIcon) return null;
  return <Icon name="Clock" size={size} color={color} />;
}

type AgentSnap = {
  id: string;
  workspaceId: string;
  status?: "initializing" | "idle" | "running" | "error" | "closed" | null;
};

export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, { workspaceId: string; pill: PluginButtonRegistration }>();
  const watches = new Map<string, () => void>();
  const tracked = new Map<string, AgentSnap>();
  let settings: TimeSinceSettings = defaultSettings;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stopWatch = (agentId: string) => {
    watches.get(agentId)?.();
    watches.delete(agentId);
    forgetLastMessageAt(agentId);
  };

  const remove = (agentId: string) => {
    pills.get(agentId)?.pill.remove();
    pills.delete(agentId);
    tracked.delete(agentId);
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

  const publishAgent = (agent: AgentSnap) => {
    if (stopped) return;
    watch(agent.id);
    const visible = !isWorkingStatus(agent.status);
    const label = formatTimeSincePillLabel(lastMessageAt.get(agent.id), Date.now(), settings.showAgo);
    const existing = pills.get(agent.id);
    if (existing && existing.workspaceId !== agent.workspaceId) {
      existing.pill.remove();
      pills.delete(agent.id);
    }
    const current = pills.get(agent.id);
    if (!current) {
      const pill = client.addComposerPill({
        id: "time-since",
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        button: {
          title: "Time since last message",
          icon: TimeSinceIcon,
          label,
          visible,
          behavior: {
            kind: "action",
            onPress() {
              showAbsolute.get(agent.id)?.();
            },
          },
        },
      });
      pills.set(agent.id, { workspaceId: agent.workspaceId, pill });
      return;
    }
    current.pill.update({ label, visible });
  };

  const publishAll = () => {
    if (stopped) return;
    for (const agent of tracked.values()) publishAgent(agent);
  };

  const refreshSettings = async () => {
    try {
      settings = await client.rpc(getSettings, {});
    } catch {
      // Keep the last known settings until the next tick.
    }
  };

  const register = (agent: {
    id: string;
    workspaceId?: string | null;
    status?: "initializing" | "idle" | "running" | "error" | "closed" | null;
  }) => {
    if (stopped || !agent.workspaceId) return;
    tracked.set(agent.id, {
      id: agent.id,
      workspaceId: agent.workspaceId,
      status: agent.status,
    });
    publishAgent(tracked.get(agent.id)!);
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

  void refreshSettings();
  timer = setInterval(() => {
    void refreshSettings().then(publishAll);
  }, 1000);

  return () => {
    stopped = true;
    unsubscribe();
    if (timer) clearInterval(timer);
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
    tracked.clear();
    for (const stop of watches.values()) stop();
    watches.clear();
    lastMessageAt.clear();
    lastMessageListeners.clear();
    showAbsolute.clear();
  };
}
