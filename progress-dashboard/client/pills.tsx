import type { PaseoAgentUpdate, PaseoWorkspaceUpdate } from "@getpaseo/client";
import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useSyncExternalStore } from "react";
import { attentionOf, pillLabel, type Attention } from "../shared/attention";
import { getDashboard } from "../shared/rpc";
import { observeDirectory } from "./directory";
import { AttentionPopover } from "./pill-popover";

export const PILL_POLL_MS = 5_000;
const EXPLORER = { location: "explorer" as const };

type Workspace = { id: string; workspaceDirectory?: string; projectRootPath: string };

function directoryOf(workspace: Workspace): string {
  return workspace.workspaceDirectory ?? workspace.projectRootPath;
}

// A pill above the message box for every agent in a workspace whose dashboard
// has questions waiting or something stuck. Pressing it opens a popover with
// the questions and their Copy buttons, and a way into the panel.
export function contributePills(client: PluginClientContext) {
  const workspaces = new Map<string, string>();
  const attention = new Map<string, Attention>();
  const listeners = new Set<() => void>();
  const pills = new Map<string, { workspaceId: string; label: string; pill: PluginButtonRegistration }>();
  const pending = new Set<string>();
  let agents: Array<{ id: string; workspaceId?: string | null }> = [];
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function PillIcon(props: PluginButtonIconProps) {
    const stuck = useSyncExternalStore(
      (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      () => attention.get(props.workspaceId)?.stuck ?? 0,
    );
    return stuck
      ? <Icon name="CircleAlert" size={props.size} color={props.theme.colors.statusDanger} />
      : <Icon name="MessageCircleQuestion" size={props.size} color={props.color} />;
  }

  function PillContent(props: PluginButtonContentProps) {
    return <AttentionPopover {...props} openPanel={() => client.openPanel("progress", { workspaceId: props.workspaceId, ...EXPLORER })} />;
  }

  const publish = () => {
    if (stopped) return;
    const seen = new Set<string>();
    for (const agent of agents) {
      const workspaceId = agent.workspaceId;
      if (!workspaceId) continue;
      const current = attention.get(workspaceId);
      const label = current ? pillLabel(current) : null;
      if (!label) continue;
      seen.add(agent.id);
      const existing = pills.get(agent.id);
      if (existing && existing.workspaceId !== workspaceId) {
        existing.pill.remove();
        pills.delete(agent.id);
      }
      const entry = pills.get(agent.id);
      if (!entry) {
        const pill = client.addComposerPill({
          id: "progress-attention",
          workspaceId,
          agentId: agent.id,
          button: {
            title: "Progress needs you",
            icon: PillIcon,
            label,
            behavior: { kind: "popover", Content: PillContent },
          },
        });
        pills.set(agent.id, { workspaceId, label, pill });
      } else if (entry.label !== label) {
        entry.pill.update({ label });
        entry.label = label;
      }
    }
    for (const [agentId, entry] of pills) {
      if (!seen.has(agentId)) {
        entry.pill.remove();
        pills.delete(agentId);
      }
    }
  };

  const setAttention = (workspaceId: string, next: Attention | undefined) => {
    const previous = attention.get(workspaceId);
    if (previous?.questions === next?.questions && previous?.stuck === next?.stuck) return;
    if (next) attention.set(workspaceId, next);
    else attention.delete(workspaceId);
    for (const listener of listeners) listener();
  };

  // Only workspaces with an agent can show a pill, so only those are read.
  const refresh = async (workspaceId: string) => {
    const directory = workspaces.get(workspaceId);
    if (stopped || !directory || pending.has(workspaceId)) return;
    pending.add(workspaceId);
    try {
      const result = await client.rpc(getDashboard, { workspaceId, workspaceDirectory: directory });
      if (stopped || workspaces.get(workspaceId) !== directory) return;
      setAttention(workspaceId, result.configured ? attentionOf(result.dashboard) : undefined);
      publish();
    } catch { /* Try again on the next poll. */ } finally {
      pending.delete(workspaceId);
    }
  };
  const watched = () => new Set(agents.flatMap((agent) => (agent.workspaceId && workspaces.has(agent.workspaceId) ? [agent.workspaceId] : [])));
  const sync = async () => {
    await Promise.all([...watched()].map(refresh));
    if (!stopped) timer = setTimeout(() => void sync(), PILL_POLL_MS);
  };
  const forget = (workspaceId: string) => {
    workspaces.delete(workspaceId);
    setAttention(workspaceId, undefined);
  };

  const stopWorkspaces = observeDirectory({
    list: (options) => client.paseo.workspaces.list(options),
    select: (message) => (message.type === "workspace_update" ? message.payload : undefined),
    snapshot: (entries) => {
      const next = new Map((entries as Workspace[]).map((workspace) => [workspace.id, directoryOf(workspace)]));
      for (const id of [...workspaces.keys()]) if (!next.has(id)) forget(id);
      const hasAgent = new Set(agents.map((agent) => agent.workspaceId));
      for (const [id, directory] of next) {
        if (workspaces.get(id) !== directory) {
          workspaces.set(id, directory);
          if (hasAgent.has(id)) void refresh(id);
        }
      }
      publish();
    },
    update: (update: PaseoWorkspaceUpdate) => {
      if (update.kind === "remove") forget(update.id);
      else {
        const directory = directoryOf(update.workspace as Workspace);
        if (workspaces.get(update.workspace.id) !== directory) {
          workspaces.set(update.workspace.id, directory);
          if (agents.some((agent) => agent.workspaceId === update.workspace.id)) void refresh(update.workspace.id);
        }
      }
      publish();
    },
  });
  const stopAgents = observeDirectory({
    list: (options) => client.paseo.agents.list({ ...options, filter: { includeArchived: false } }),
    select: (message) => (message.type === "agent_update" ? message.payload : undefined),
    snapshot: (entries) => {
      agents = entries.map(({ agent }) => agent);
      for (const id of watched()) if (!attention.has(id)) void refresh(id);
      publish();
    },
    update: (update: PaseoAgentUpdate) => {
      const id = update.kind === "remove" ? update.agentId : update.agent.id;
      agents = agents.filter((agent) => agent.id !== id);
      if (update.kind !== "remove") {
        agents.push(update.agent);
        if (update.agent.workspaceId && !attention.has(update.agent.workspaceId)) void refresh(update.agent.workspaceId);
      }
      publish();
    },
  });
  timer = setTimeout(() => void sync(), PILL_POLL_MS);

  return () => {
    stopped = true;
    stopWorkspaces();
    stopAgents();
    if (timer) clearTimeout(timer);
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
    listeners.clear();
  };
}
