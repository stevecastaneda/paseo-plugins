import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { linksSchema } from "../shared/links.ts";

const MAX_FILE_BYTES = 64 * 1024;

export async function readLinks(directory: string) {
  const file = join(directory, "workspace-links.json");
  let stats;
  try {
    stats = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { configured: false, links: [] };
    }
    throw error;
  }
  if (!stats.isFile() || stats.size > MAX_FILE_BYTES) {
    throw new Error("workspace-links.json must be a regular file, not a symlink, and no larger than 64 KB.");
  }
  const contents = await readFile(file, "utf8");
  let links;
  try {
    links = linksSchema.parse(JSON.parse(contents));
  } catch {
    throw new Error("workspace-links.json must contain an array of links with a label and an HTTP(S) URL.");
  }
  return { configured: true, links: links.map(canonical) };
}

// The link as the browser will read it, so the popover shows the site the click opens.
// A name before an `@`, which extra slashes after the scheme can hide, could pass for the site.
function canonical(link: { label: string; url: string }) {
  const url = new URL(link.url);
  if (url.username || url.password) {
    throw new Error(`The "${link.label}" link has a name before an @, so it could show a site it doesn't open.`);
  }
  return { label: link.label, url: url.href };
}

export async function handleGetLinks(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
) {
  return readLinks(input.workspaceDirectory);
}
