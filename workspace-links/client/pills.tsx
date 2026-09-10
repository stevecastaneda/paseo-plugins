import type {
  PluginButton,
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  defaultShortcut,
  headerButtonLabel,
  type ShortcutSettings,
} from "../shared/shortcut";

function LinksIcon(props: PluginButtonIconProps) {
  const size = props.context === "workspace" ? 14 : props.size;
  return <Icon name="Link" size={size} color={props.color} />;
}

const settings = new Map<string, ShortcutSettings>();
const listeners = new Set<() => void>();

function notify() {
  for (const sync of listeners) sync();
}

export function getShortcut(workspaceId: string): ShortcutSettings {
  return settings.get(workspaceId) ?? defaultShortcut;
}

export function setShortcut(workspaceId: string, patch: Partial<ShortcutSettings>) {
  const next = { ...getShortcut(workspaceId), ...patch };
  const current = settings.get(workspaceId);
  if (current && current.placement === next.placement && current.headerShowsLabel === next.headerShowsLabel) {
    return;
  }
  settings.set(workspaceId, next);
  notify();
}

function linksButton(client: PluginClientContext, workspaceId: string, showLabel: boolean): PluginButton {
  const label = headerButtonLabel(showLabel);
  return {
    title: "Workspace Links",
    icon: LinksIcon,
    ...(label ? { label } : {}),
    behavior: {
      kind: "action",
      onPress() {
        client.openPanel("links", { workspaceId, location: "explorer" });
      },
    },
  };
}

export function contributeClient(client: PluginClientContext) {
  let agents = new Map<string, string>();
  let workspaces = new Set<string>();
  const pills = new Map<string, { workspaceId: string; pill: PluginButtonRegistration }>();
  const headers = new Map<string, { showLabel: boolean; button: PluginButtonRegistration }>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sync = () => {
    if (stopped) return;
    const knownWorkspaces = new Set(workspaces);
    for (const workspaceId of agents.values()) knownWorkspaces.add(workspaceId);

    for (const [agentId, entry] of pills) {
      const workspaceId = agents.get(agentId);
      if (!workspaceId || workspaceId !== entry.workspaceId || getShortcut(workspaceId).placement !== "composer") {
        entry.pill.remove();
        pills.delete(agentId);
      }
    }
    for (const [workspaceId, entry] of headers) {
      const shortcut = getShortcut(workspaceId);
      if (!knownWorkspaces.has(workspaceId) || shortcut.placement !== "header" || entry.showLabel !== shortcut.headerShowsLabel) {
        entry.button.remove();
        headers.delete(workspaceId);
      }
    }

    for (const [agentId, workspaceId] of agents) {
      if (getShortcut(workspaceId).placement !== "composer" || pills.has(agentId)) continue;
      const pill = client.addComposerPill({
        id: "workspace-links",
        workspaceId,
        agentId,
        button: linksButton(client, workspaceId, true),
      });
      pills.set(agentId, { workspaceId, pill });
    }
    for (const workspaceId of knownWorkspaces) {
      const shortcut = getShortcut(workspaceId);
      if (shortcut.placement !== "header" || headers.has(workspaceId)) continue;
      const button = client.addHeaderButton({
        id: "workspace-links",
        workspaceId,
        button: linksButton(client, workspaceId, shortcut.headerShowsLabel),
      });
      headers.set(workspaceId, { showLabel: shortcut.headerShowsLabel, button });
    }
  };
  listeners.add(sync);

  async function syncTargets() {
    try {
      const nextAgents = new Map<string, string>();
      const nextWorkspaces = new Set<string>();
      let agentCursor: string | undefined;
      do {
        const page = await client.paseo.agents.list({ filter: { includeArchived: false }, page: { limit: 100, cursor: agentCursor } });
        if (stopped) return;
        for (const { agent } of page.entries) if (agent.workspaceId) nextAgents.set(agent.id, agent.workspaceId);
        agentCursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
      } while (agentCursor);
      let workspaceCursor: string | undefined;
      do {
        const page = await client.paseo.workspaces.list({ page: { limit: 100, cursor: workspaceCursor } });
        if (stopped) return;
        for (const workspace of page.entries) nextWorkspaces.add(workspace.id);
        workspaceCursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
      } while (workspaceCursor);
      if (stopped) return;
      agents = nextAgents;
      workspaces = nextWorkspaces;
      sync();
    } catch { /* Retry after a temporary connection error. */ }
    finally { if (!stopped) timer = setTimeout(() => void syncTargets(), 2_000); }
  }
  void syncTargets();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    listeners.delete(sync);
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
    for (const { button } of headers.values()) button.remove();
    headers.clear();
  };
}
