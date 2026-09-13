import React, { useSyncExternalStore } from "react";
import { View } from "react-native";
import type { PaseoAgentUpdate } from "@getpaseo/client";
import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { observeDirectory } from "./directory";
import { HistoryViewer } from "./viewer";
import { modalEventBoundary } from "./web";

export function contributePills(client: PluginClientContext) {
  let selected: string | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const select = (id: string | null) => { selected = id; for (const listener of listeners) listener(); };
  const pills = new Map<string, { workspaceId: string; pill: PluginButtonRegistration }>();

  // The action toggles a controlled host modal mounted beside the custom icon.
  // No nested popover or extra workspace tab is needed. Portal events must not
  // reactivate the host pill, whose pending state unmounts its icon subtree.
  function HistoryIcon(props: PluginButtonIconProps) {
    const agentId = props.context === "agent" ? props.agentId : "";
    const open = useSyncExternalStore(subscribe, () => selected === agentId, () => false);
    return <>
      <Icon name="GalleryVerticalEnd" size={props.size} color={props.color} />
      <View {...modalEventBoundary()}>
        <Modal title="History" open={open} onOpenChange={(next) => { if (!next) select(null); }}>
          <Modal.Content scrollable={false} contentContainerStyle={{ flex: 1, minHeight: 0, padding: 0 }}>
            {open ? <HistoryViewer {...props} agentId={agentId} /> : null}
          </Modal.Content>
        </Modal>
      </View>
    </>;
  }

  const remove = (id: string) => {
    if (selected === id) select(null);
    pills.get(id)?.pill.remove(); pills.delete(id);
  };
  const register = (agent: { id: string; workspaceId?: string | null; archivedAt?: string | null }) => {
    if (!agent.workspaceId || agent.archivedAt) { remove(agent.id); return; }
    const existing = pills.get(agent.id);
    if (existing?.workspaceId === agent.workspaceId) return;
    if (existing) remove(agent.id);
    pills.set(agent.id, { workspaceId: agent.workspaceId, pill: client.addComposerPill({
      id: "history", workspaceId: agent.workspaceId, agentId: agent.id,
      button: { title: "History", label: "History", icon: HistoryIcon,
        behavior: { kind: "action", onPress: () => { select(agent.id); } } },
    }) });
  };
  const stop = observeDirectory({
    list: (options) => client.paseo.agents.list({ ...options, filter: { includeArchived: false } }),
    subscribe: (listener) => client.paseo.agents.subscribe(listener),
    snapshot: (entries) => {
      const ids = new Set(entries.map(({ agent }) => agent.id));
      for (const id of pills.keys()) if (!ids.has(id)) remove(id);
      for (const { agent } of entries) register(agent);
    },
    update: (update: PaseoAgentUpdate) => {
      if (update.kind === "remove") remove(update.agentId);
      else register(update.agent);
    },
  });
  return () => {
    stop(); select(null);
    for (const { pill } of pills.values()) pill.remove();
    pills.clear(); listeners.clear();
  };
}
