import type { PaseoAgentUpdate, PaseoWorkspaceUpdate } from "@getpaseo/client";
import type {
  PluginButton,
  PluginButtonIconProps,
  PluginButtonMenuEntry,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { useWorkspace } from "@getpaseo/plugin/client";
import { subscribeLinks } from "./links-state";
import { observeDirectory } from "./directory";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useLinks } from "./links-query";
import { openLink } from "../shared/links";
import { linksMenuEntries, linksMenuKey, type WorkspaceLink } from "../shared/menu";
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

type WorkspaceLinksState = {
  directory?: string;
  links: WorkspaceLink[];
};

function toPluginMenuItems(
  client: PluginClientContext,
  workspaceId: string,
  directory: string | undefined,
  links: readonly WorkspaceLink[],
): PluginButtonMenuEntry[] {
  return linksMenuEntries(links).map((entry) => {
    if (entry.kind === "separator") return { kind: "separator", id: entry.id };
    if (entry.action === "manage") {
      return {
        kind: "item",
        id: entry.id,
        title: entry.title,
        icon: entry.icon,
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel("links", { workspaceId, location: "explorer" });
          },
        },
      };
    }
    return {
      kind: "item",
      id: entry.id,
      title: entry.title,
      icon: entry.icon,
      disabled: !directory,
      behavior: {
        kind: "action",
        async onPress() {
          if (!directory) return;
          await client.rpc(openLink, { workspaceId, workspaceDirectory: directory, url: entry.url });
        },
      },
    };
  });
}

function linksButton(
  client: PluginClientContext,
  workspaceId: string,
  showLabel: boolean,
  state: WorkspaceLinksState | undefined,
): PluginButton {
  const label = headerButtonLabel(showLabel);
  return {
    title: "Workspace Links",
    icon: LinksIcon,
    ...(label ? { label } : {}),
    behavior: {
      kind: "menu",
      items: toPluginMenuItems(client, workspaceId, state?.directory, state?.links ?? []),
    },
  };
}

function workspaceDirectory(workspace: { workspaceDirectory?: string; projectRootPath: string }): string {
  return workspace.workspaceDirectory ?? workspace.projectRootPath;
}

export function contributeClient(client: PluginClientContext) {
  let agents = new Map<string, string>();
  const workspaces = new Map<string, string>();
  const agentsByWorkspace = new Map<string, string[]>();
  const linksByWorkspace = new Map<string, WorkspaceLinksState>();
  const pills = new Map<string, { workspaceId: string; menuKey: string; pill: PluginButtonRegistration }>();
  const headers = new Map<string, { showLabel: boolean; menuKey: string; button: PluginButtonRegistration }>();
  let stopped = false;

  const stateFor = (workspaceId: string): WorkspaceLinksState | undefined => {
    const cached = linksByWorkspace.get(workspaceId);
    if (cached) return cached;
    const directory = workspaces.get(workspaceId);
    return directory ? { directory, links: [] } : undefined;
  };

  const publishWorkspace = (workspaceId: string) => {
    const shortcut = getShortcut();
    const state = stateFor(workspaceId);
    const menuKey = linksMenuKey(state?.directory, state?.links ?? []);

    for (const agentId of agentsByWorkspace.get(workspaceId) ?? []) {
      const existing = pills.get(agentId);
      if (shortcut.placement !== "composer") {
        if (existing) {
          existing.pill.remove();
          pills.delete(agentId);
        }
        continue;
      }
      if (existing && existing.workspaceId === workspaceId && existing.menuKey === menuKey) continue;
      if (existing && existing.workspaceId === workspaceId) {
        existing.pill.update({ behavior: linksButton(client, workspaceId, true, state).behavior });
        existing.menuKey = menuKey;
        continue;
      }
      existing?.pill.remove();
      const pill = client.addComposerPill({
        id: "workspace-links",
        workspaceId,
        agentId,
        button: linksButton(client, workspaceId, true, state),
      });
      pills.set(agentId, { workspaceId, menuKey, pill });
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
    } else if (header && header.menuKey !== menuKey) {
      header.button.update({ behavior: linksButton(client, workspaceId, shortcut.headerShowsLabel, state).behavior });
      header.menuKey = menuKey;
      return;
    } else if (header) {
      return;
    }
    const button = client.addHeaderButton({
      id: "workspace-links",
      workspaceId,
      button: linksButton(client, workspaceId, shortcut.headerShowsLabel, state),
    });
    headers.set(workspaceId, { showLabel: shortcut.headerShowsLabel, menuKey, button });
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
    subscribe: (listener) => client.paseo.agents.subscribe(listener),
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
  const refreshWorkspace = (workspaceId: string, directory: string) => {
    if (workspaces.get(workspaceId) === directory) return;
    workspaces.set(workspaceId, directory);
    linksByWorkspace.delete(workspaceId);
  };
  const stopWorkspaces = observeDirectory({
    list: (options) => client.paseo.workspaces.list(options),
    subscribe: (listener) => client.paseo.workspaces.subscribe(listener),
    snapshot: (entries) => {
      const ids = new Set(entries.map((workspace) => workspace.id));
      for (const id of workspaces.keys()) if (!ids.has(id)) {
        workspaces.delete(id);
        linksByWorkspace.delete(id);
      }
      for (const workspace of entries) refreshWorkspace(workspace.id, workspaceDirectory(workspace));
      sync();
    },
    update: (update: PaseoWorkspaceUpdate) => {
      if (update.kind === "remove") {
        workspaces.delete(update.id);
        linksByWorkspace.delete(update.id);
      } else refreshWorkspace(update.workspace.id, workspaceDirectory(update.workspace));
      sync();
    },
  });
  const stopLinks = subscribeLinks((workspaceId, directory, links) => {
    if (stopped || workspaces.get(workspaceId) !== directory) return;
    linksByWorkspace.set(workspaceId, { directory, links });
    publishWorkspace(workspaceId);
  });
  const initialSettings = settings;
  void client.rpc(getShortcutSettings, {}).then((next) => {
    if (!stopped && settings === initialSettings) setShortcut(next);
  }).catch(() => undefined);
  return () => {
    stopped = true;
    stopAgents();
    stopWorkspaces();
    stopLinks();
    listeners.delete(sync);
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
    for (const { button } of headers.values()) button.remove();
    headers.clear();
  };
}
