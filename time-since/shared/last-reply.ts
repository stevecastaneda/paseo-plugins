import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const lastReplySchema = z.record(z.string(), z.string());

export type LastReplies = z.infer<typeof lastReplySchema>;

export const listLastReplies = defineRpc({
  name: "time-since.last-reply.list",
  input: z.object({}),
  output: z.object({ lastReplyAt: lastReplySchema }),
});
