import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const readHistory = defineRpc({
  name: "raw-history.read",
  input: z.object({
    agentId: z.string().min(1),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    source: z.string().optional(),
  }),
  output: z.object({
    path: z.string(),
    provider: z.string(),
    source: z.string(),
    text: z.string(),
    offset: z.number(),
    nextOffset: z.number(),
    totalBytes: z.number(),
    modifiedAt: z.string(),
  }),
});
