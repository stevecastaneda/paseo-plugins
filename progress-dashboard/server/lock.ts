import { mkdir, rm, stat } from "node:fs/promises";

const RETRY_MS = 25;
const WAIT_MS = 10_000;
// A lock older than this was left by a command that crashed.
const STALE_MS = 30_000;

// Serializes read-then-append so two commands never hand out the same id or
// interleave a line. mkdir is atomic, so only one process creates the folder.
export async function withLock<T>(lockPath: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const since = await stat(lockPath).then((info) => Date.now() - info.mtimeMs, () => 0);
      if (since > STALE_MS) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > WAIT_MS) throw new Error(`Timed out waiting for ${lockPath}. If no other progress command is running, delete it.`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS + Math.random() * RETRY_MS));
    }
  }
  try {
    return await work();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}
