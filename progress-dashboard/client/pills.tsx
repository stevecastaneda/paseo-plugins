import type { PaseoAgentUpdate, PaseoWorkspaceUpdate } from "@getpaseo/client";
import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useSyncExternalStore } from "react";
import { pillLabel, type Attention } from "../shared/attention";
import { getAttention } from "../shared/rpc";
import { observeDirectory } from "./directory";
import { onPanelOpened } from "./panel-opened";
import { IconSwap } from "./motion";
import { Spinner } from "./spinner";
import { AttentionPopover } from "./pill-popover";

export const PILL_POLL_MS = 5_000;
// A worktree with nothing going on (no file, or a closed run with nothing
// waiting) is checked on every 6th poll, 30 seconds. Its agents' updates
// still trigger a check, at most once a poll interval.
export const IDLE_POLL_EVERY = 6;
const EXPLORER = { location: "explorer" as const };

type Mode = "attention" | "started";
type Workspace = { id: string; workspaceDirectory?: string; projectRootPath: string };

function directoryOf(workspace: Workspace): string {
  return workspace.workspaceDirectory ?? workspace.projectRootPath;
}

// A pill above the message box for every agent in a workspace whose dashboard
// has questions waiting or something stuck. Pressing it opens a popover with
// the questions and their Copy buttons, and a way into the panel.
//
// Until the Progress panel has been opened once for a worktree, a run there
// shows a spinning "Progress" pill instead; pressing it opens the panel. Paseo
// can't open a panel without switching to its workspace, so this is a nudge
// in that workspace rather than opening the panel on its own.
export function contributePills(client: PluginClientContext) {
  const workspaces = new Map<string, string>();
  const attention = new Map<string, Attention>();
  // Workspaces with a run whose panel has never been opened.
  const started = new Set<string>();
  // Bumped on each report so a poll that was already in flight can't bring the pill back.
  let openedReports = 0;
  const listeners = new Set<() => void>();
  const pills = new Map<string, { workspaceId: string; label: string; mode: Mode; pill: PluginButtonRegistration }>();
  const pending = new Set<string>();
  // Polls left before an idle workspace is checked again, and when each was last checked.
  const idleWait = new Map<string, number>();
  const checkedAt = new Map<string, number>();
  let agents: Array<{ id: string; workspaceId?: string | null }> = [];
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function PillIcon(props: PluginButtonIconProps) {
    const icon = useSyncExternalStore(
      (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      () => {
        const current = attention.get(props.workspaceId);
        return current?.stuck ? "stuck" : current?.questions ? "questions" : "started";
      },
    );
    return (
      <IconSwap swapKey={icon} size={props.size}>
        {icon === "stuck" ? <Icon name="OctagonAlert" size={props.size} color={props.theme.colors.statusDanger} />
          : icon === "questions" ? <Icon name="MessageCircleQuestion" size={props.size} color={props.color} />
          : <Spinner color={props.color} size={props.size} />}
      </IconSwap>
    );
  }

  const openPanel = (workspaceId: string) => client.openPanel("progress", { workspaceId, ...EXPLORER });

  // What an agent's pill shows: what needs the user first, else the one-time nudge.
  const pillFor = (workspaceId: string): { mode: Mode; label: string } | null => {
    const current = attention.get(workspaceId);
    const label = current ? pillLabel(current) : null;
    if (label) return { mode: "attention", label };
    if (started.has(workspaceId)) return { mode: "started", label: "Progress" };
    return null;
  };
  const buttonFor = (workspaceId: string, mode: Mode, label: string) => mode === "attention"
    ? { title: "Progress needs you", icon: PillIcon, label, behavior: { kind: "popover" as const, Content: PillContent } }
    : { title: "Open Progress", icon: PillIcon, label, behavior: { kind: "action" as const, onPress: () => openPanel(workspaceId) } };

  function PillContent(props: PluginButtonContentProps) {
    return <AttentionPopover {...props} openPanel={() => openPanel(props.workspaceId)} />;
  }

  const publish = () => {
    if (stopped) return;
    const seen = new Set<string>();
    for (const agent of agents) {
      const workspaceId = agent.workspaceId;
      if (!workspaceId) continue;
      const wanted = pillFor(workspaceId);
      if (!wanted) continue;
      const { mode, label } = wanted;
      seen.add(agent.id);
      const existing = pills.get(agent.id);
      if (existing && existing.workspaceId !== workspaceId) {
        existing.pill.remove();
        pills.delete(agent.id);
      }
      const entry = pills.get(agent.id);
      if (!entry) {
        const pill = client.addComposerPill({ id: "progress-attention", workspaceId, agentId: agent.id, button: buttonFor(workspaceId, mode, label) });
        pills.set(agent.id, { workspaceId, label, mode, pill });
      } else if (entry.mode !== mode) {
        entry.pill.update(buttonFor(workspaceId, mode, label));
        Object.assign(entry, { mode, label });
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
    checkedAt.set(workspaceId, Date.now());
    const reportsBefore = openedReports;
    try {
      const result = await client.rpc(getAttention, { workspaceId, workspaceDirectory: directory });
      if (stopped || workspaces.get(workspaceId) !== directory) return;
      setAttention(workspaceId, result.configured ? { questions: result.questions, stuck: result.stuck } : undefined);
      if (result.configured && result.runOpen && !result.panelOpened) {
        if (openedReports === reportsBefore) started.add(workspaceId);
      } else started.delete(workspaceId);
      const idle = !result.runOpen && !result.questions && !result.stuck;
      if (idle) idleWait.set(workspaceId, IDLE_POLL_EVERY - 1);
      else idleWait.delete(workspaceId);
      publish();
    } catch { /* Try again on the next poll. */ } finally {
      pending.delete(workspaceId);
    }
  };
  const watched = () => new Set(agents.flatMap((agent) => (agent.workspaceId && workspaces.has(agent.workspaceId) ? [agent.workspaceId] : [])));
  const due = (workspaceId: string) => {
    const wait = idleWait.get(workspaceId);
    if (!wait) return true;
    idleWait.set(workspaceId, wait - 1);
    return false;
  };
  // An agent update can mean a new run; check soon, but not on every update.
  const nudge = (workspaceId: string) => {
    if (Date.now() - (checkedAt.get(workspaceId) ?? 0) >= PILL_POLL_MS) void refresh(workspaceId);
  };
  const sync = async () => {
    await Promise.all([...watched()].filter(due).map(refresh));
    if (!stopped) timer = setTimeout(() => void sync(), PILL_POLL_MS);
  };
  const forget = (workspaceId: string) => {
    workspaces.delete(workspaceId);
    started.delete(workspaceId);
    idleWait.delete(workspaceId);
    checkedAt.delete(workspaceId);
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
        if (update.agent.workspaceId && !attention.has(update.agent.workspaceId)) nudge(update.agent.workspaceId);
      }
      publish();
    },
  });
  const stopOpened = onPanelOpened((workspaceId) => {
    openedReports++;
    started.delete(workspaceId);
    publish();
  });
  timer = setTimeout(() => void sync(), PILL_POLL_MS);

  return () => {
    stopped = true;
    stopWorkspaces();
    stopAgents();
    stopOpened();
    if (timer) clearTimeout(timer);
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
    listeners.clear();
  };
}
