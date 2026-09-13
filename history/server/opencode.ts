import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { PAGE_BYTES } from "./files.ts";

const exec = promisify(execFile);

// Export lets OpenCode resolve its own storage, including XDG overrides, without
// depending on its internal database schema. Never invoke a shell or a model.
export async function readOpenCodeHistory(sessionId: string, offset: number, source?: string) {
  if (!/^ses_[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("Invalid OpenCode session ID.");
  let stdout: string;
  try {
    ({ stdout } = await exec("opencode", ["export", sessionId, "--pure"], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("OpenCode is not available on the Paseo daemon PATH. Install OpenCode to read this history.");
    }
    throw new Error("Could not export this OpenCode session. Check that it is saved and that the daemon's OpenCode supports export --pure. Exports are limited to 64 MiB and 30 seconds.");
  }
  return pageOpenCodeExport(stdout, sessionId, offset, source);
}

export function pageOpenCodeExport(json: string, sessionId: string, offset: number, expectedSource?: string) {
  let data;
  try { data = JSON.parse(json); }
  catch { throw new Error("OpenCode returned an invalid session export. Check that the session is saved and try Refresh."); }
  if (data?.info?.id !== sessionId || !Array.isArray(data.messages)
    || data.messages.some((message: any) => !message?.info || !Array.isArray(message.parts))) {
    throw new Error("OpenCode returned an invalid session export.");
  }
  // Keep each exported message intact, including unknown parts and metadata.
  const lines = [{ info: data.info }, ...data.messages].map((entry) => Buffer.from(JSON.stringify(entry) + "\n"));
  if (lines.some((line) => line.length > 4 * 1024 * 1024)) {
    throw new Error("An OpenCode entry exceeds 4 MiB. Use opencode export to inspect it.");
  }
  const buffer = Buffer.concat(lines);
  const source = createHash("sha256").update(sessionId).update(buffer).digest("hex");
  // OpenCode updates messages in place. Byte offsets are valid only for the same
  // export; reject changes rather than skipping or duplicating message content.
  if (expectedSource && source !== expectedSource) throw new Error("The OpenCode history changed. Refresh to start again.");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > buffer.length
    || (offset > 0 && buffer[offset - 1] !== 10)) throw new Error("Invalid OpenCode history offset. Refresh to start again.");
  let end = offset;
  while (end < buffer.length) {
    end = buffer.indexOf(10, end) + 1;
    if (end - offset >= PAGE_BYTES) break;
  }
  const updated = data.info.time?.updated;
  return {
    path: `opencode export ${sessionId}`, source, text: buffer.subarray(offset, end).toString("utf8"),
    offset, nextOffset: end, totalBytes: buffer.length,
    modifiedAt: typeof updated === "number" && Number.isFinite(new Date(updated).getTime()) ? new Date(updated).toISOString() : "",
  };
}
