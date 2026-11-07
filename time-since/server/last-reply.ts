import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import type { LastReplies } from "../shared/last-reply.ts";
import { lastReplyStore, type createLastReplyStore } from "./last-reply.storage.ts";

type LastReplyStore = ReturnType<typeof createLastReplyStore>;

function report(error: unknown): void {
  console.error("time-since could not update last replies", error);
}

// Turn ends arrive from the daemon without opening the agent, so the clock
// can seed every pill at launch from this ledger instead of timeline reads.
export function recordLastReplies(server: Pick<PluginServerContext, "on">, store: LastReplyStore = lastReplyStore): () => void {
  const stopTurns = server.on("agent.turn_ended", ({ agent }) => {
    void store.record(agent.id, new Date().toISOString()).catch(report);
  });
  const stopArchive = server.on("agent.archived", ({ agent }) => {
    void store.forget(agent.id).catch(report);
  });
  return () => {
    stopTurns();
    stopArchive();
  };
}

export function listLastRepliesHandler(store: LastReplyStore = lastReplyStore) {
  return async (_input: Record<string, never>, _context: PluginHandlerContext): Promise<{ lastReplyAt: LastReplies }> => ({ lastReplyAt: await store.list() });
}
