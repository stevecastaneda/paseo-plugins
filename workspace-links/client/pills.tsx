import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";

const hidden = new Set<string>();
const listeners = new Set<() => void>();
export const isShortcutEnabled = (workspaceId: string) => !hidden.has(workspaceId);
export function setShortcutEnabled(workspaceId: string, enabled: boolean) {
  if (enabled) hidden.delete(workspaceId);
  else hidden.add(workspaceId);
  for (const sync of listeners) sync();
}

export function contributeClient(client: PluginClientContext) {
  let eligible = new Map<string, string>();
  const pills = new Map<string, { workspaceId: string; pill: PluginButtonRegistration }>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sync = () => {
    if (stopped) return;
    for (const [id, entry] of pills) {
      if (eligible.get(id) !== entry.workspaceId || !isShortcutEnabled(entry.workspaceId)) {
        entry.pill.remove();
        pills.delete(id);
      }
    }
    for (const [agentId, workspaceId] of eligible) {
      if (!isShortcutEnabled(workspaceId) || pills.has(agentId)) continue;
      const pill = client.addComposerPill({
        id: "workspace-links",
        workspaceId,
        agentId,
        button: {
          title: "Workspace Links",
          icon: "Link",
          label: "Links",
          behavior: {
            kind: "action",
            onPress() {
              client.openPanel("links", { workspaceId, location: "explorer" });
            },
          },
        },
      });
      pills.set(agentId, { workspaceId, pill });
    }
  };
  listeners.add(sync);

  async function syncAgents() {
    try {
      const agents = new Map<string, string>();
      let cursor: string | undefined;
      do {
        const page = await client.paseo.agents.list({ filter: { includeArchived: false }, page: { limit: 100, cursor } });
        if (stopped) return;
        for (const { agent } of page.entries) if (agent.workspaceId) agents.set(agent.id, agent.workspaceId);
        cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
      } while (cursor);
      if (stopped) return;
      eligible = agents;
      sync();
    } catch { /* Retry after a temporary connection error. */ }
    finally { if (!stopped) timer = setTimeout(() => void syncAgents(), 2_000); }
  }
  void syncAgents();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    listeners.delete(sync);
    for (const { pill } of pills.values()) pill.remove();
    pills.clear();
  };
}
