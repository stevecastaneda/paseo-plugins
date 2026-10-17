import type { PluginClientContext } from "@getpaseo/plugin/client";
import { RunRowView } from "./client/run-row.tsx";
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
  return () => {
    for (const stop of stops) void stop();
  };
}
