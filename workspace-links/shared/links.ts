import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const webUrlSchema = z.url().refine((value) => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS URL");

export const linksSchema = z.array(z.object({
  label: z.string().min(1),
  url: webUrlSchema,
})).max(100);

const workspaceInput = z.object({
  workspaceId: z.string().min(1),
  workspaceDirectory: z.string().min(1),
});

export const getLinks = defineRpc({
  name: "workspace-links.get",
  input: workspaceInput,
  output: z.object({ links: linksSchema, configured: z.boolean() }),
});

export const openLink = defineRpc({
  name: "workspace-links.open",
  input: workspaceInput.extend({ url: webUrlSchema }),
  output: z.object({ launched: z.boolean() }),
});
