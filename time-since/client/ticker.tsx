import type { PaseoAgentUpdate } from "@getpaseo/client";
import { observeDirectory } from "./directory";
import {
  type PluginButtonContentProps,
  type PluginButtonIconProps,
  type PluginButtonRegistration,
  type PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import {
  formatTimeSincePillLabel,
  isWorkingStatus,
  lastThreadMessageAtFromStream,
} from "../shared/elapsed";
import { getLastThreadMessage } from "../shared/last-message";
import { subscribeSettings, useSettings } from "./settings";
import { defaultSettings, getSettings, type TimeSinceSettings } from "../shared/settings";

const lastMessageAt = new Map<string, string>();
const lastMessageListeners = new Map<string, Set<() => void>>();

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
  const settings = useSettings(props.host.id).data ?? defaultSettings;
  if (!settings.showIcon) return null;
  return <Icon name="Clock" size={props.size} color={props.color} />;
}

function TimeSincePopover(props: PluginButtonContentProps) {
  const agentId = props.context === "agent" ? props.agentId : "";
  const lastAt = useLastMessageAt(agentId);
  if (props.context !== "agent") return null;
  const when = lastAt ? new Date(lastAt) : null;
  const valid = when !== null && !Number.isNaN(when.getTime());
  const muted = props.theme.colors.foregroundMuted;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginVertical: -4,
      }}
    >
      <Text style={{ color: muted, fontSize: 12, lineHeight: 18, flexShrink: 1 }}>Last message</Text>
      <Text selectable style={{ color: props.theme.colors.foreground, fontSize: 12, lineHeight: 18 }}>
        {valid ? when.toLocaleString() : "None yet"}
      </Text>
    </View>
  );
}

type AgentSnap = {
  id: string;
  workspaceId: string;
  status?: "initializing" | "idle" | "running" | "error" | "closed" | null;
};

export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, { workspaceId: string; label: string; visible: boolean; pill: PluginButtonRegistration }>();
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
            kind: "popover",
            Content: TimeSincePopover,
          },
        },
      });
      pills.set(agent.id, { workspaceId: agent.workspaceId, label, visible, pill });
      return;
    }
    if (current.label === label && current.visible === visible) return;
    current.pill.update({ label, visible });
    current.label = label;
    current.visible = visible;
  };

  const publishAll = () => {
    if (stopped) return;
    for (const agent of tracked.values()) publishAgent(agent);
  };

  let settingsChanged = false;
  const stopSettings = subscribeSettings((next) => {
    settingsChanged = true;
    settings = next;
    publishAll();
  });
  void client.rpc(getSettings, {}).then((next) => {
    if (stopped || settingsChanged) return;
    settings = next;
    publishAll();
  }).catch(() => undefined);

  const register = (agent: {
    id: string;
    workspaceId?: string | null;
    status?: "initializing" | "idle" | "running" | "error" | "closed" | null;
  }) => {
    if (stopped) return;
    if (!agent.workspaceId) { remove(agent.id); return; }
    tracked.set(agent.id, {
      id: agent.id,
      workspaceId: agent.workspaceId,
      status: agent.status,
    });
    publishAgent(tracked.get(agent.id)!);
  };

  const unsubscribe = observeDirectory({
    list: (options) => client.paseo.agents.list({ ...options, filter: { includeArchived: false } }),
    subscribe: (listener) => client.paseo.agents.subscribe(listener),
    snapshot: (entries) => {
      const ids = new Set(entries.map(({ agent }) => agent.id));
      for (const id of tracked.keys()) if (!ids.has(id)) remove(id);
      for (const { agent } of entries) register(agent);
    },
    update: (update: PaseoAgentUpdate) => {
      if (update.kind === "remove") remove(update.agentId);
      else register(update.agent);
    },
  });

  // Elapsed labels need a clock, not a daemon request.
  timer = setInterval(publishAll, 1000);

  return () => {
    stopped = true;
    unsubscribe();
    stopSettings();
    if (timer) clearInterval(timer);
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
    tracked.clear();
    for (const stop of watches.values()) stop();
    watches.clear();
    lastMessageAt.clear();
    lastMessageListeners.clear();
  };
}
