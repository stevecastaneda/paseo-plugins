import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { lastThreadMessageAt } from "../shared/elapsed";

export async function handleGetLastThreadMessage(
  input: { agentId: string },
  { paseo }: PluginHandlerContext,
): Promise<{ lastMessageAt: string | null }> {
  try {
    const page = await paseo.agents.ref(input.agentId).timeline.refetch({
      direction: "tail",
      limit: 100,
      projection: "projected",
    });
    const fromThread = lastThreadMessageAt(page.entries);
    return { lastMessageAt: fromThread ?? page.agent?.createdAt ?? null };
  } catch {
    return { lastMessageAt: null };
  }
}
