import type { PaseoAgentUpdate, PaseoWorkspaceUpdate } from "@getpaseo/client";
import type {
  PluginButton,
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { useWorkspace } from "@getpaseo/plugin/client";
import { observeDirectory } from "./directory";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useLinks } from "./links-query";
import { LinksPopover } from "./popover";
import {
  defaultShortcut,
  getShortcutSettings,
  headerButtonLabel,
  type ShortcutSettings,
} from "../shared/shortcut";

function LinksIcon(props: PluginButtonIconProps) {
  const directory = useWorkspace(props.workspaceId, (workspace) => workspace.directory);
  useLinks(props.host.id, props.workspaceId, directory);
  const size = props.context === "workspace" ? 14 : props.size;
  return <Icon name="Link" size={size} color={props.color} />;
}

let settings: ShortcutSettings = { ...defaultShortcut };
const listeners = new Set<() => void>();

function notify() {
  for (const sync of listeners) sync();
}

export function getShortcut(): ShortcutSettings {
  return settings;
}

export function subscribeShortcut(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setShortcut(patch: Partial<ShortcutSettings>) {
  const next = { ...settings, ...patch };
  if (settings.placement === next.placement && settings.headerShowsLabel === next.headerShowsLabel) {
    return;
  }
  settings = next;
  notify();
}

function linksButton(behavior: PluginButton["behavior"], showLabel: boolean): PluginButton {
  const label = headerButtonLabel(showLabel);
  return {
    title: "Workspace Links",
    icon: LinksIcon,
    ...(label ? { label } : {}),
    behavior,
  };
}

function workspaceDirectory(workspace: { workspaceDirectory?: string; projectRootPath: string }): string {
  return workspace.workspaceDirectory ?? workspace.projectRootPath;
}

export function contributeClient(client: PluginClientContext) {
  let agents = new Map<string, string>();
  const workspaces = new Map<string, string>();
  const agentsByWorkspace = new Map<string, string[]>();
  const pills = new Map<string, { workspaceId: string; pill: PluginButtonRegistration }>();
  const headers = new Map<string, { showLabel: boolean; button: PluginButtonRegistration }>();
  let stopped = false;

  // The popover reads links itself, so the button never needs rebuilding when they change.
  function Content(props: PluginButtonContentProps) {
    return (
      <LinksPopover
        {...props}
        onManage={() => client.openPanel("links", { workspaceId: props.workspaceId, location: "explorer" })}
      />
    );
  }
  const popover: PluginButton["behavior"] = { kind: "popover", Content };

  const publishWorkspace = (workspaceId: string) => {
    const shortcut = getShortcut();

    for (const agentId of agentsByWorkspace.get(workspaceId) ?? []) {
      const existing = pills.get(agentId);
      if (shortcut.placement !== "composer") {
        if (existing) {
          existing.pill.remove();
          pills.delete(agentId);
        }
        continue;
      }
      if (existing && existing.workspaceId === workspaceId) continue;
      existing?.pill.remove();
      const pill = client.addComposerPill({
        id: "workspace-links",
        workspaceId,
        agentId,
        button: linksButton(popover, true),
      });
      pills.set(agentId, { workspaceId, pill });
    }

    const header = headers.get(workspaceId);
    if (shortcut.placement !== "header") {
      if (header) {
        header.button.remove();
        headers.delete(workspaceId);
      }
      return;
    }
    if (header && header.showLabel !== shortcut.headerShowsLabel) {
      header.button.remove();
      headers.delete(workspaceId);
    } else if (header) {
      return;
    }
    const button = client.addHeaderButton({
      id: "workspace-links",
      workspaceId,
      button: linksButton(popover, shortcut.headerShowsLabel),
    });
    headers.set(workspaceId, { showLabel: shortcut.headerShowsLabel, button });
  };

  const sync = () => {
    if (stopped) return;
    agentsByWorkspace.clear();
    for (const [agentId, workspaceId] of agents) {
      const ids = agentsByWorkspace.get(workspaceId) ?? [];
      ids.push(agentId);
      agentsByWorkspace.set(workspaceId, ids);
    }
    const knownWorkspaces = new Set(workspaces.keys());
    for (const workspaceId of agents.values()) knownWorkspaces.add(workspaceId);

    for (const [agentId, entry] of pills) {
      const workspaceId = agents.get(agentId);
      if (!workspaceId || workspaceId !== entry.workspaceId || getShortcut().placement !== "composer") {
        entry.pill.remove();
        pills.delete(agentId);
      }
    }
    for (const [workspaceId, entry] of headers) {
      if (!knownWorkspaces.has(workspaceId) || getShortcut().placement !== "header") {
        entry.button.remove();
        headers.delete(workspaceId);
      }
    }

    for (const workspaceId of knownWorkspaces) publishWorkspace(workspaceId);
  };
  listeners.add(sync);

  const stopAgents = observeDirectory({
    list: (options) => client.paseo.agents.list({ ...options, filter: { includeArchived: false } }),
    select: (message) => message.type === "agent_update" ? message.payload : undefined,
    snapshot: (entries) => {
      agents = new Map(entries.flatMap(({ agent }) => agent.workspaceId ? [[agent.id, agent.workspaceId]] : []));
      sync();
    },
    update: (update: PaseoAgentUpdate) => {
      if (update.kind === "remove") agents.delete(update.agentId);
      else if (update.agent.workspaceId) agents.set(update.agent.id, update.agent.workspaceId);
      else agents.delete(update.agent.id);
      sync();
    },
  });
  const stopWorkspaces = observeDirectory({
    list: (options) => client.paseo.workspaces.list(options),
    select: (message) => message.type === "workspace_update" ? message.payload : undefined,
    snapshot: (entries) => {
      const ids = new Set(entries.map((workspace) => workspace.id));
      for (const id of workspaces.keys()) if (!ids.has(id)) workspaces.delete(id);
      for (const workspace of entries) workspaces.set(workspace.id, workspaceDirectory(workspace));
      sync();
    },
    update: (update: PaseoWorkspaceUpdate) => {
      if (update.kind === "remove") workspaces.delete(update.id);
      else workspaces.set(update.workspace.id, workspaceDirectory(update.workspace));
      sync();
    },
  });
  const initialSettings = settings;
  void client.rpc(getShortcutSettings, {}).then((next) => {
    if (!stopped && settings === initialSettings) setShortcut(next);
  }).catch(() => undefined);
  return () => {
    stopped = true;
    stopAgents();
    stopWorkspaces();
    listeners.delete(sync);
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
    for (const { button } of headers.values()) button.remove();
    headers.clear();
  };
}
