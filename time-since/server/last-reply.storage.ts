import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { lastReplySchema, type LastReplies } from "../shared/last-reply.ts";
import { settingsRootFromEnvironment } from "./settings.storage.ts";
import { withWriteLock } from "./write-lock.ts";

export function lastReplyFilePath(root: string): string {
  return join(root, "plugin-data", "time-since", "last-reply.json");
}

// The ledger is derived data: an unreadable file starts over instead of
// blocking every later turn from being recorded.
async function readLastReplies(filePath: string): Promise<LastReplies> {
  let contents: string;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Unable to read time-since last replies at ${filePath}`, { cause: error });
  }
  try {
    return lastReplySchema.parse(JSON.parse(contents));
  } catch (error) {
    console.error(`Invalid time-since last replies at ${filePath}; starting over`, error);
    return {};
  }
}

async function writeLastReplies(filePath: string, replies: LastReplies): Promise<void> {
  await fs.mkdir(join(filePath, ".."), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(replies)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new Error(`Unable to write time-since last replies at ${filePath}`, { cause: error });
  }
}

export function createLastReplyStore(root: string) {
  const filePath = lastReplyFilePath(root);
  const mutate = (change: (replies: LastReplies) => boolean) =>
    withWriteLock(filePath, async () => {
      const replies = await readLastReplies(filePath);
      if (change(replies)) await writeLastReplies(filePath, replies);
    });
  return {
    filePath,
    list(): Promise<LastReplies> {
      return withWriteLock(filePath, () => readLastReplies(filePath));
    },
    record(agentId: string, at: string): Promise<void> {
      return mutate((replies) => {
        replies[agentId] = at;
        return true;
      });
    },
    forget(agentId: string): Promise<void> {
      return mutate((replies) => delete replies[agentId]);
    },
  };
}

export const lastReplyStore = createLastReplyStore(settingsRootFromEnvironment());
