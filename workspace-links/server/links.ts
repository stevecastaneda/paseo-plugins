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
  try {
    return { configured: true, links: linksSchema.parse(JSON.parse(contents)) };
  } catch {
    throw new Error("workspace-links.json must contain an array of links with a label and an HTTP(S) URL.");
  }
}

export async function handleGetLinks(
  input: { workspaceId: string; workspaceDirectory: string },
  _context: PluginHandlerContext,
) {
  return readLinks(input.workspaceDirectory);
}
