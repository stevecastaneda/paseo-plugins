import { createHash } from "node:crypto";
import { mkdir, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { LIMITS } from "../shared/limits.ts";

// Full logs of output too long to send whole, saved outside every repo for the agent to read
// or grep. One folder per chat, one file per run. A chat's folder goes when the chat is
// archived; prune drops logs older than a week, then the oldest past the size cap.
export interface LogStore {
  // Writes one run's log, replacing an earlier save of the same run, and returns its path.
  save(input: { agentId: string; runId: string; command: string; text: string }): Promise<string>;
  forget(agentId: string): Promise<void>;
  prune(): Promise<void>;
}

export function defaultLogRoot(home = homedir()): string {
  return join(home, ".local", "state", "shell-yeah", "logs");
}

export function createLogStore({ root, now = Date.now, limits = LIMITS.logs }: {
  root: string;
  now?: () => number;
  limits?: { maxAgeMs: number; maxBytes: number };
}): LogStore {
  const folder = (agentId: string) => join(root, safeName(agentId));
  return {
    async save({ agentId, runId, command, text }) {
      const dir = folder(agentId);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, `${slug(command)}-${safeName(runId)}.log`);
      await writeFile(path, text, { mode: 0o600 });
      return path;
    },

    forget: (agentId) => rm(folder(agentId), { recursive: true, force: true }),

    async prune() {
      const files = (await logFiles(root)).sort((a, b) => b.mtimeMs - a.mtimeMs);
      const cutoff = now() - limits.maxAgeMs;
      let bytes = 0;
      for (const [i, file] of files.entries()) {
        bytes += file.size;
        // The newest log stays even past the cap: it is the one about to be sent.
        if (file.mtimeMs < cutoff || (i > 0 && bytes > limits.maxBytes)) await rm(file.path, { force: true });
      }
      for (const dir of new Set(files.map((file) => file.dir))) await rmdir(dir).catch(() => undefined);
    },
  };
}

async function logFiles(root: string): Promise<Array<{ dir: string; path: string; mtimeMs: number; size: number }>> {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    for (const name of await readdir(dir).catch(() => [])) {
      if (!name.endsWith(".log")) continue;
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      if (info) files.push({ dir, path, mtimeMs: info.mtimeMs, size: info.size });
    }
  }
  return files;
}

// Ids arrive over RPC, so anything that isn't a plain id becomes a hash before it names a folder.
function safeName(id: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : createHash("sha1").update(id).digest("hex").slice(0, 16);
}

// "npm test -- --watch" -> "npm-test-watch", so a person browsing the folder knows each file.
function slug(command: string): string {
  return command.split("\n")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 40).replace(/-+$/, "") || "output";
}
