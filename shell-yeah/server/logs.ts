import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { LIMITS } from "../shared/limits.ts";
import { removeFolderIn, removeIn, writePrivateFileIn } from "./system.ts";

// Full logs of output too long to send whole, saved outside every repo for the agent to read
// or grep. One folder per chat, one file per run. A chat's folder goes when the chat is
// archived; prune drops logs older than a week, then the oldest past the size cap.
export interface LogStore {
  // Writes one run's log, replacing an earlier save of the same run, and returns its path.
  save(input: { agentId: string; runId: string; command: string; text: string }): Promise<string>;
  forget(agentId: string): Promise<void>;
  prune(): Promise<void>;
}

// Windows keeps app state in %LOCALAPPDATA%, macOS and Linux tools in ~/.local/state.
export function defaultLogRoot(home = homedir(), env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32" && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "shell-yeah", "logs");
  return join(home, ".local", "state", "shell-yeah", "logs");
}

export function createLogStore({
  root,
  now = Date.now,
  limits = LIMITS.logs,
}: {
  root: string;
  now?: () => number;
  limits?: { maxAgeMs: number; maxBytes: number };
}): LogStore {
  return {
    save: ({ agentId, runId, command, text }) => writePrivateFileIn(root, join(safeName(agentId), `${slug(command)}-${safeName(runId)}.log`), text),

    forget: (agentId) => removeIn(root, safeName(agentId), { recursive: true }),

    async prune() {
      const files = (await logFiles(root)).toSorted((a, b) => b.mtimeMs - a.mtimeMs);
      const cutoff = now() - limits.maxAgeMs;
      let bytes = 0;
      for (const [i, file] of files.entries()) {
        bytes += file.size;
        // The newest log stays even past the cap: it is the one about to be sent.
        if (file.mtimeMs < cutoff || (i > 0 && bytes > limits.maxBytes)) await removeIn(root, join(file.folder, file.name));
      }
      for (const folder of new Set(files.map((file) => file.folder))) await removeFolderIn(root, folder).catch(() => undefined);
    },
  };
}

async function logFiles(root: string): Promise<Array<{ folder: string; name: string; mtimeMs: number; size: number }>> {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    for (const name of await readdir(dir).catch(() => [])) {
      if (!name.endsWith(".log")) continue;
      const info = await stat(join(dir, name)).catch(() => null);
      if (info) files.push({ folder: entry.name, name, mtimeMs: info.mtimeMs, size: info.size });
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
  return (
    command
      .split("\n")[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "output"
  );
}
