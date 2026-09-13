import { open, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const PAGE_BYTES = 64 * 1024;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;

// Search only harness session directories. Do not follow directory symlinks or
// fall back to the newest log: the native session ID must match exactly.
export async function findLog(roots: string[], sessionId: string, provider: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("Invalid native session ID.");
  const matches: string[] = [];
  let visited = 0;
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 8) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (++visited > 100_000) throw new Error("The session directory is too large to search.");
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile() && (provider === "claude"
        ? entry.name === `${sessionId}.jsonl`
        : entry.name.startsWith("rollout-") && entry.name.endsWith(`-${sessionId}.jsonl`))) {
        matches.push(path);
      }
    }
  }
  for (const root of roots) await walk(root, 0);
  if (matches.length > 1) throw new Error("Multiple logs match this session. Cannot select a source safely.");
  if (!matches[0]) throw new Error("No raw log found for this session. It may not have been saved yet, or may have been moved or deleted.");
  return matches[0];
}

export async function readPage(path: string, offset: number, expectedSource?: string) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("The session log is not a regular file.");
    const source = createHash("sha256").update(`${path}:${stat.dev}:${stat.ino}:${stat.birthtimeMs}`).digest("hex");
    if (expectedSource && source !== expectedSource) throw new Error("The log source changed. Refresh to start again.");
    if (offset > stat.size) throw new Error("The log was shortened. Refresh to start again.");
    let buffer = Buffer.alloc(0);
    let end = 0;
    // End pages on JSONL boundaries so an object is never split between cards.
    // A single large object may exceed the normal page budget.
    while (offset + buffer.length < stat.size) {
      const chunk = Buffer.alloc(Math.min(PAGE_BYTES, stat.size - offset - buffer.length));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, offset + buffer.length);
      if (!bytesRead) break;
      buffer = Buffer.concat([buffer, chunk.subarray(0, bytesRead)]);
      const newline = buffer.length <= PAGE_BYTES
        ? buffer.lastIndexOf(10)
        : buffer.indexOf(10);
      if (newline >= 0) { end = newline + 1; break; }
      if (buffer.length >= MAX_ENTRY_BYTES) throw new Error("This entry exceeds 4 MiB. Open the source file in an editor to inspect it.");
    }
    if (!end) end = buffer.length;
    return {
      path, source, text: buffer.subarray(0, end).toString("utf8"), offset,
      nextOffset: offset + end, totalBytes: stat.size, modifiedAt: stat.mtime.toISOString(),
    };
  } finally { await file.close(); }
}
