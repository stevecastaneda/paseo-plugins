import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const getLastThreadMessage = defineRpc({
  name: "time-since.last-thread-message.get",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({
    lastMessageAt: z.string().nullable(),
  }),
});
