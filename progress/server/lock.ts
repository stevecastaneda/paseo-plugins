import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createFolderIn, removeIn } from "./system.ts";

const RETRY_MS = 25;
const WAIT_MS = 10_000;
// A lock older than this was left by a command that crashed.
const STALE_MS = 30_000;

// Serializes read-then-append so two commands never hand out the same id or
// interleave a line. mkdir is atomic, so only one process creates the folder.
export async function withLock<T>(folder: string, name: string, work: () => Promise<T>): Promise<T> {
  const lockPath = join(folder, name);
  const started = Date.now();
  while (true) {
    try {
      await createFolderIn(folder, name);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const since = await stat(lockPath).then(
        (info) => Date.now() - info.mtimeMs,
        () => 0,
      );
      if (since > STALE_MS) {
        await removeIn(folder, name, { recursive: true });
        continue;
      }
      if (Date.now() - started > WAIT_MS)
        throw new Error(`Timed out waiting for ${lockPath}. If no other progress command is running, delete it.`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS + Math.random() * RETRY_MS));
    }
  }
  try {
    return await work();
  } finally {
    await removeIn(folder, name, { recursive: true });
  }
}
