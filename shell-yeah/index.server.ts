import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { agentOf, attachItems, fetchTurn, latestAssistantText, proposeFromReply, scanProposals, sendToClaude, sendVia, withHandoffPrompt, type AttachDeps } from "./server/claude.ts";
import { createLogStore, defaultLogRoot } from "./server/logs.ts";
import { createRunRegistry } from "./server/runs.ts";
import { commandFinder } from "./server/shells.ts";
import { attachSearch, dismiss, fullOutput, input, scan, send, start, stop, suggest, tail } from "./shared/rpc.ts";
import { RUN_KIND, RUN_VERSION, cardIdOf } from "./shared/row.ts";

export default function contribute(server: PluginServerContext) {
  // `paseo` exists only inside handler and hook contexts; every one of them hands over the
  // same object, so the first call remembers it for the process events that fire later.
  let paseo: PluginHandlerContext["paseo"] | null = null;
  const bind = (ctx: PluginHandlerContext) => (paseo = ctx.paseo);

  const runs = createRunRegistry({
    publish: async (agentId, row) => {
      if (!paseo) throw new Error("Paseo isn't connected yet.");
      await paseo.agents.ref(agentId).timeline.append({ type: "plugin", id: cardIdOf(row), kind: RUN_KIND, version: RUN_VERSION, data: row });
    },
    now: Date.now,
    env: process.env,
  });
  const sendCounts = new Map<string, number>();
  const logs = createLogStore({ root: defaultLogRoot() });
  const saved: AttachDeps["saved"] = new Map();
  void logs.prune().catch(() => undefined);

  server.handle(start, (input, ctx) => (bind(ctx), runs.start(input)));
  server.handle(stop, ({ runId, force }, ctx) => (bind(ctx), runs.stop(runId, force), { ok: true as const }));
  server.handle(input, ({ runId, keys }) => (runs.input(runId, keys), { ok: true as const }));
  server.handle(tail, ({ runId, lines, since, waitMs }, ctx) => (bind(ctx), runs.tail(runId, lines, since, waitMs)));
  server.handle(fullOutput, ({ runId }) => runs.fullText(runId));
  server.handle(send, (input, ctx) => (bind(ctx), sendToClaude({ runs, logs, agent: agentOf(ctx.paseo), send: sendVia(ctx.paseo), sendCounts }, input)));
  server.handle(attachSearch, async ({ query }) => ({ items: await attachItems({ runs, logs, saved }, query) }));
  server.handle(dismiss, (input, ctx) => (bind(ctx), runs.dismiss(input).then(() => ({ ok: true as const }))));

  // `refetch` also updates the ref's agent, so `cwd` is set after it.
  const latestTurn = async (agentId: string, ctx: PluginHandlerContext) => {
    bind(ctx);
    const ref = ctx.paseo.agents.ref(agentId);
    const turn = await fetchTurn((options) => ref.timeline.refetch(options), null);
    if (!ref.cwd) throw new Error("Paseo doesn't have this agent loaded.");
    return { cwd: ref.cwd, turn };
  };

  // `/sh` with no command: look at Claude's latest reply again, this time counting plain shell blocks.
  server.handle(scan, async ({ agentId }, ctx) => {
    const { cwd, turn } = await latestTurn(agentId, ctx);
    const { found, proposed } = await proposeFromReply({ registry: runs, agentId, cwd, turn, mode: "any" });
    if (found === 0) throw new Error("The last reply has no commands to run. Type /sh and a command to run one.");
    if (proposed === 0) throw new Error("Those commands are already in the chat.");
    return { found: proposed };
  });

  server.handle(suggest, async ({ agentId }, ctx) => {
    const { cwd, turn } = await latestTurn(agentId, ctx);
    return { commands: scanProposals(latestAssistantText(turn.timeline), "all", commandFinder(process.env, cwd)) };
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
    // Paseo 0.13 sends the event with an empty timeline.
    const ref = ctx.paseo.agents.ref(event.agent.id);
    const turn = await fetchTurn((options) => ref.timeline.refetch(options), event.turnId).catch(() => null);
    if (!turn) return;
    await proposeFromReply({ registry: runs, agentId: event.agent.id, cwd: event.agent.cwd, turn, mode: "marked" });
  });

  // An archived chat is done with: its saved logs go with it. Archiving a workspace archives its chats.
  server.on("agent.archived", ({ agent }) => logs.forget(agent.id));

  return () => runs.shutdown();
}
