import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { agentOf, attachItems, proposeFromReply, sendToClaude, sendVia, withHandoffPrompt } from "./server/claude.ts";
import { createRunRegistry } from "./server/runs.ts";
import { attachSearch, dismiss, fullOutput, scan, send, start, stop, tail } from "./shared/rpc.ts";
import { RUN_KIND, RUN_VERSION } from "./shared/row.ts";

export default function contribute(server: PluginServerContext) {
  // `paseo` exists only inside handler and hook contexts; every one of them hands over the
  // same object, so the first call remembers it for the process events that fire later.
  let paseo: PluginHandlerContext["paseo"] | null = null;
  const bind = (ctx: PluginHandlerContext) => (paseo = ctx.paseo);

  const runs = createRunRegistry({
    publish: async (agentId, row) => {
      if (!paseo) throw new Error("Paseo isn't connected yet.");
      await paseo.agents.ref(agentId).timeline.append({ type: "plugin", id: row.runId, kind: RUN_KIND, version: RUN_VERSION, data: row });
    },
    now: Date.now,
    env: process.env,
  });
  const sendCounts = new Map<string, number>();

  server.handle(start, (input, ctx) => (bind(ctx), runs.start(input)));
  server.handle(stop, ({ runId, force }, ctx) => (bind(ctx), runs.stop(runId, force), { ok: true as const }));
  server.handle(tail, ({ runId, lines, since, waitMs }, ctx) => (bind(ctx), runs.tail(runId, lines, since, waitMs)));
  server.handle(fullOutput, ({ runId }) => runs.fullText(runId));
  server.handle(send, (input, ctx) => (bind(ctx), sendToClaude({ runs, agent: agentOf(ctx.paseo), send: sendVia(ctx.paseo), sendCounts }, input)));
  server.handle(attachSearch, ({ query }) => ({ items: attachItems(runs, query) }));
  server.handle(dismiss, (input, ctx) => (bind(ctx), runs.dismiss(input).then(() => ({ ok: true as const }))));

  // `/sh` with no command: look at Claude's latest reply again, this time counting plain shell blocks.
  server.handle(scan, async ({ agentId }, ctx) => {
    bind(ctx);
    const ref = ctx.paseo.agents.ref(agentId);
    const page = await ref.timeline.refetch({ direction: "tail", limit: 400, projection: "projected" });
    if (page.error) throw new Error(page.error);
    await ref.refresh();
    if (!ref.cwd) throw new Error("Paseo doesn't have this agent loaded.");
    const { found, proposed } = await proposeFromReply({ registry: runs, agentId, cwd: ref.cwd, timeline: page.entries.map((entry) => entry.item), turnId: null, mode: "any" });
    if (found === 0) throw new Error("The last reply has no commands to run. Type /sh and a command to run one.");
    if (proposed === 0) throw new Error("Those commands are already in the chat.");
    return { found: proposed };
  });

  // New agents only: one tagged block in the system prompt, merged after whatever is there.
  server.before("agent.create", ({ request }) => ({
    ...request,
    config: { ...request.config, systemPrompt: withHandoffPrompt(request.config.systemPrompt) },
  }));

  // Every agent: a finished turn that handed the user a command gets one proposal card per command.
  server.on("agent.turn_ended", async (event, ctx) => {
    bind(ctx);
    if (event.outcome.kind !== "completed") return;
    await proposeFromReply({ registry: runs, agentId: event.agent.id, cwd: event.agent.cwd, timeline: event.timeline, turnId: event.turnId, mode: "marked" });
  });

  return () => runs.shutdown();
}
