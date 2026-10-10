import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { type AttentionResult, getAttention } from "../shared/rpc";
import { isIdle, type Pill, pillFor } from "./pill-state";
import { observeDirectory, type PaseoAgentUpdate, type PaseoWorkspaceUpdate } from "./directory";
import { onPanelOpened } from "./panel-opened";
import { IconSwap } from "./motion";
import { Spinner } from "./spinner";
import { AttentionPopover } from "./pill-popover";

export const PILL_POLL_MS = 5_000;
// A worktree with nothing going on (no file, or a closed run with nothing
// waiting) is checked on every 6th poll, 30 seconds. Its agents' updates
// still trigger a check, at most once a poll interval.
export const IDLE_POLL_EVERY = 6;

// Paseo's desktop app shows the panel in Explorer, beside the chat. The phone
// apps never draw Explorer's pane, so there the panel is a tab of its own.
// It has its own id on phones: Paseo 0.10.1 reopens an existing tab where it
// already is, and earlier versions of this plugin left a "progress" tab in the
// phone's hidden Explorer pane, which a plugin can't move or close.
export function progressPanel(): { id: string; location: "explorer" | "workspace" } {
  return Platform.OS === "web" ? { id: "progress", location: "explorer" } : { id: "progress-tab", location: "workspace" };
}

type Workspace = { id: string; workspaceDirectory?: string; projectRootPath: string };

function directoryOf(workspace: Workspace): string {
  return workspace.workspaceDirectory ?? workspace.projectRootPath;
}

// A pill above the message box for every agent whose workspace has something
// to show; pill-state.ts decides what. Questions or something stuck open a
// popover with the questions, their Copy buttons and a way into the panel.
// The other pills open the panel. Paseo can't open a panel without switching
// to its workspace, so the first-run pill is a nudge in that workspace rather
// than opening the panel on its own.
export function contributePills(client: PluginClientContext) {
  const workspaces = new Map<string, string>();
  // The last report per workspace; pillFor turns it into what the pill shows.
  const reports = new Map<string, AttentionResult>();
  const where = { phone: progressPanel().location === "workspace" };
  const pillOf = (workspaceId: string) => pillFor(reports.get(workspaceId), where);
  // Bumped on each report so a poll that was already in flight can't bring the pill back.
  let openedReports = 0;
  const listeners = new Set<() => void>();
  const pills = new Map<string, { workspaceId: string; label: string; mode: Pill["mode"]; pill: PluginButtonRegistration }>();
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
      () => pillOf(props.workspaceId)?.icon ?? "open",
    );
    return (
      <IconSwap swapKey={icon} size={props.size}>
        {icon === "stuck" ? <Icon name="OctagonAlert" size={props.size} color={props.theme.colors.statusDanger} />
          : icon === "questions" ? <Icon name="MessageCircleQuestion" size={props.size} color={props.color} />
          : icon === "started" ? <Spinner color={props.color} size={props.size} />
          : <Icon name="ListChecks" size={props.size} color={props.color} />}
      </IconSwap>
    );
  }

  const openPanel = (workspaceId: string) => {
    const { id, location } = progressPanel();
    client.openPanel(id, { workspaceId, location });
  };

  const buttonFor = (workspaceId: string, mode: Pill["mode"], label: string) => mode === "attention"
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
      const wanted = pillOf(workspaceId);
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

  // Every change goes through here, so the icons redraw whenever a pill could change.
  const setReport = (workspaceId: string, next: AttentionResult | undefined) => {
    if (next) reports.set(workspaceId, next);
    else reports.delete(workspaceId);
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
      // The panel was opened while this poll was in flight: its answer is already out of date.
      setReport(workspaceId, openedReports === reportsBefore ? result : { ...result, panelOpened: true });
      if (isIdle(result)) idleWait.set(workspaceId, IDLE_POLL_EVERY - 1);
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
  // The next poll doesn't wait on this one: a slow worktree can't hold up every pill.
  // `pending` already stops a second check of the same worktree overlapping.
  const sync = () => {
    for (const workspaceId of [...watched()].filter(due)) void refresh(workspaceId);
    if (!stopped) timer = setTimeout(sync, PILL_POLL_MS);
  };
  const forget = (workspaceId: string) => {
    workspaces.delete(workspaceId);
    idleWait.delete(workspaceId);
    checkedAt.delete(workspaceId);
    setReport(workspaceId, undefined);
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
      for (const id of watched()) if (!reports.has(id)) void refresh(id);
      publish();
    },
    update: (update: PaseoAgentUpdate) => {
      const id = update.kind === "remove" ? update.agentId : update.agent.id;
      agents = agents.filter((agent) => agent.id !== id);
      if (update.kind !== "remove") {
        agents.push(update.agent);
        if (update.agent.workspaceId && workspaces.has(update.agent.workspaceId)) nudge(update.agent.workspaceId);
      }
      publish();
    },
  });
  const stopOpened = onPanelOpened((workspaceId) => {
    openedReports++;
    const report = reports.get(workspaceId);
    if (report) setReport(workspaceId, { ...report, panelOpened: true });
    publish();
  });
  timer = setTimeout(sync, PILL_POLL_MS);

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
