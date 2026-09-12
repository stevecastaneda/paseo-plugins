import type {
  PluginButton,
  PluginButtonIconProps,
  PluginButtonMenuEntry,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { getLinks, openLink } from "../shared/links";
import { linksMenuEntries, linksMenuKey, type WorkspaceLink } from "../shared/menu";
import {
  defaultShortcut,
  getShortcutSettings,
  headerButtonLabel,
  type ShortcutSettings,
} from "../shared/shortcut";

function LinksIcon(props: PluginButtonIconProps) {
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
  let workspaces = new Map<string, string>();
  const linksByWorkspace = new Map<string, WorkspaceLinksState>();
  const pills = new Map<string, { workspaceId: string; menuKey: string; pill: PluginButtonRegistration }>();
  const headers = new Map<string, { showLabel: boolean; menuKey: string; button: PluginButtonRegistration }>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

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

    for (const [agentId, agentWorkspaceId] of agents) {
      if (agentWorkspaceId !== workspaceId) continue;
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

  async function loadLinks(workspaceId: string, directory: string) {
    try {
      const data = await client.rpc(getLinks, { workspaceId, workspaceDirectory: directory });
      if (stopped) return;
      const previous = linksByWorkspace.get(workspaceId);
      linksByWorkspace.set(workspaceId, { directory, links: data.links });
      if (linksMenuKey(previous?.directory, previous?.links ?? []) === linksMenuKey(directory, data.links)) return;
      publishWorkspace(workspaceId);
    } catch {
      const previous = linksByWorkspace.get(workspaceId);
      if (previous?.directory === directory) return;
      linksByWorkspace.set(workspaceId, { directory, links: previous?.links ?? [] });
      if (!stopped) publishWorkspace(workspaceId);
    }
  }

  async function syncTargets() {
    try {
      try {
        const nextShortcut = await client.rpc(getShortcutSettings, {});
        if (stopped) return;
        setShortcut(nextShortcut);
      } catch { /* Keep the last known placement until the next tick. */ }
      const nextAgents = new Map<string, string>();
      const nextWorkspaces = new Map<string, string>();
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
        for (const workspace of page.entries) nextWorkspaces.set(workspace.id, workspaceDirectory(workspace));
        workspaceCursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
      } while (workspaceCursor);
      if (stopped) return;
      agents = nextAgents;
      workspaces = nextWorkspaces;
      const agentWorkspaces = new Set(nextAgents.values());
      for (const workspaceId of linksByWorkspace.keys()) {
        if (!nextWorkspaces.has(workspaceId) && !agentWorkspaces.has(workspaceId)) {
          linksByWorkspace.delete(workspaceId);
        }
      }
      sync();
      await Promise.all(
        [...nextWorkspaces].map(([workspaceId, directory]) => loadLinks(workspaceId, directory)),
      );
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
