import type { PluginHandlerContext } from "@getpaseo/plugin";
import { lastThreadMessageAt } from "./elapsed";

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
