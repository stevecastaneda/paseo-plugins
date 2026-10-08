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

export const linkStatusSchema = z.enum(["up", "down"]);
export type LinkStatus = z.infer<typeof linkStatusSchema>;

/** Whether each link in the workspace's file answers, in file order. */
export const getLinkStatus = defineRpc({
  name: "workspace-links.status",
  input: workspaceInput,
  output: z.object({ statuses: z.array(linkStatusSchema) }),
});
