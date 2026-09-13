import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { readHistory } from "../shared/history";
import { parseEntries } from "../shared/entries.ts";

// Native logs can begin with pages of context before the first real message.
// Read a useful conversation batch, not just the first file chunk.
export async function loadConversationBatch(
  rpc: (input: RpcInput<typeof readHistory>) => Promise<RpcOutput<typeof readHistory>>,
  input: RpcInput<typeof readHistory>,
  cancelled: () => boolean,
) {
  let text = "";
  let nextInput = input;
  let page: RpcOutput<typeof readHistory>;
  do {
    page = await rpc(nextInput);
    if (cancelled()) return null;
    text += page.text;
    const messages = parseEntries(text).filter((entry) => entry.category === "message").length;
    if (messages >= 6 || page.nextOffset >= page.totalBytes || page.nextOffset <= page.offset) break;
    // Bound a batch even for logs containing only context or tool output.
    if (page.nextOffset - (input.offset ?? 0) >= 4 * 1024 * 1024) break;
    nextInput = { agentId: input.agentId, offset: page.nextOffset, source: page.source };
  } while (true);
  return { page, text };
}
