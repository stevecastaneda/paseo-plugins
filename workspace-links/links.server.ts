import type { PluginHandlerContext } from "@getpaseo/plugin";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { linksSchema } from "./links.shared.ts";
import { launchUrl } from "./browser.server.ts";

export async function readLinks(directory: string) {
  let contents: string;
  try {
    contents = await readFile(join(directory, "workspace-links.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { configured: false, links: [] };
    }
    throw error;
  }
  try {
    return { configured: true, links: linksSchema.parse(JSON.parse(contents)) };
  } catch {
    throw new Error("workspace-links.json must contain an array of links with a label and an HTTP(S) URL.");
  }
}

export async function handleGetLinks(input: { workspaceId: string }, { paseo }: PluginHandlerContext) {
  const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
  if (!workspace) throw new Error("Workspace is no longer available");
  return readLinks(workspace.workspaceDirectory);
}

export async function handleOpenLink(input: { workspaceId: string; url: string }, context: PluginHandlerContext) {
  const { links } = await handleGetLinks(input, context);
  if (!links.some((link) => link.url === input.url)) {
    throw new Error("This link has changed or was removed. Refresh the list.");
  }
  await launchUrl(input.url);
  return { launched: true };
}
