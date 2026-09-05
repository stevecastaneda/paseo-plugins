import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const webUrlSchema = z.url().refine((value) => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS URL");

export const linksSchema = z.array(z.object({
  label: z.string().min(1),
  url: webUrlSchema,
})).max(100);

export const getLinks = defineRpc({
  name: "workspace-links.get",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({ links: linksSchema, configured: z.boolean() }),
});

export const openLink = defineRpc({
  name: "workspace-links.open",
  input: z.object({ workspaceId: z.string().min(1), url: webUrlSchema }),
  output: z.object({ launched: z.boolean() }),
});
