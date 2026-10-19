import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { observeDirectory, type PaseoAgentUpdate } from "./client/directory.ts";
import { RunRowView } from "./client/run-row.tsx";
import { RunWindow } from "./client/run-window.tsx";
import { commandOutputSource, scan, start } from "./shared/rpc.ts";
import { RUN_KIND, RUN_VERSION, runRow } from "./shared/row.ts";
import { errorMessage, shortCommand } from "./shared/text.ts";

// One leading "! " or "$ " that people paste along with the command.
export function normalizeArgs(args: string): string {
  return args.trim().replace(/^[!$]\s+/, "").trim();
}

export default function contribute(client: PluginClientContext) {
  const stops = [
    client.addSlashCommand({
      name: "sh",
      description: "Run a shell command here. The agent sees the output only if you send it.",
      argumentHint: "<command>",
      context: "agent",
      async onSubmit({ args, agent, rpc }) {
        const command = normalizeArgs(args);
        if (!command) {
          await rpc(scan, { agentId: agent.id });
          return;
        }
        // The composer already cleared the box, so a failure names the command: the
        // toast is all the user has left of what they typed.
        try {
          await rpc(start, { agentId: agent.id, cwd: agent.cwd, command, origin: "user" });
        } catch (error) {
          throw new Error(`Couldn't run "${shortCommand(command)}": ${errorMessage(error)}`);
        }
      },
    }),
    client.addTimelineRenderer({ kind: RUN_KIND, version: RUN_VERSION, schema: runRow, Component: RunRowView }),
    client.addAttachmentSource(commandOutputSource),
  ];
  const stopPills = addRunPills(client);
  return () => {
    stopPills();
    for (const stop of stops) void stop();
  };
}

// A Run pill in every chat's composer. Paseo places pills per agent, so this follows the
// agent list. A pill is added once per agent: replacing it would close a window that's open.
function addRunPills(client: PluginClientContext): () => void {
  const pills = new Map<string, { workspaceId: string; pill: PluginButtonRegistration }>();
  const remove = (agentId: string) => {
    pills.get(agentId)?.pill.remove();
    pills.delete(agentId);
  };
  const add = (agent: { id: string; workspaceId?: string | null }) => {
    if (!agent.workspaceId || pills.get(agent.id)?.workspaceId === agent.workspaceId) return;
    remove(agent.id);
    const pill = client.addComposerPill({
      id: "run",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: { title: "Run a command", label: "Run", icon: "SquareTerminal", behavior: { kind: "popover", Content: RunWindow } },
    });
    pills.set(agent.id, { workspaceId: agent.workspaceId, pill });
  };
  const stopAgents = observeDirectory({
    list: (options) => client.paseo.agents.list({ ...options, filter: { includeArchived: false } }),
    select: (message) => (message.type === "agent_update" ? message.payload : undefined),
    snapshot: (entries) => {
      const ids = new Set(entries.map(({ agent }) => agent.id));
      for (const id of [...pills.keys()]) if (!ids.has(id)) remove(id);
      for (const { agent } of entries) add(agent);
    },
    update: (update: PaseoAgentUpdate) => (update.kind === "remove" ? remove(update.agentId) : add(update.agent)),
  });
  return () => {
    stopAgents();
    for (const id of [...pills.keys()]) remove(id);
  };
}
