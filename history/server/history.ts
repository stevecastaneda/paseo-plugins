import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { findLog, readPage } from "./files.ts";
import { readOpenCodeHistory } from "./opencode.ts";

type ProviderEntry = { extends?: string; env?: Record<string, string> };

export async function handleReadHistory(
  input: { agentId: string; offset: number; source?: string },
  { paseo }: PluginHandlerContext,
) {
  const handle = paseo.agents.ref(input.agentId);
  await handle.refresh();
  const agent = handle.current();
  if (!agent) throw new Error("This chat is no longer available.");
  // A custom provider (`extends`) runs a built-in harness with its own env, so
  // match on the harness and read logs where that env points it. Paseo only
  // allows `extends` to name a built-in provider, so one level is enough.
  const { config } = await paseo.config.get();
  const entry = config.providers[agent.provider] as ProviderEntry | undefined;
  const provider = entry?.extends ?? agent.provider;
  if (provider !== "codex" && provider !== "claude" && provider !== "opencode") {
    throw new Error(`Raw history is not supported for ${agent.provider} yet. Codex, Claude, and OpenCode are supported.`);
  }
  const env = { ...process.env, ...entry?.env };
  const sessionId = agent.persistence?.nativeHandle ?? agent.persistence?.sessionId ?? agent.runtimeInfo?.sessionId;
  if (!sessionId) throw new Error("This chat has no saved session yet. Send a message, then refresh.");
  if (provider === "opencode") return { ...await readOpenCodeHistory(sessionId, input.offset, input.source, env), provider };
  const root = provider === "codex"
    ? env.CODEX_HOME ?? join(homedir(), ".codex")
    : env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const roots = provider === "codex"
    ? [join(root, "sessions"), join(root, "archived_sessions")]
    : [join(root, "projects")];
  const path = await findLog(roots, sessionId, provider);
  return { ...await readPage(path, input.offset, input.source), provider };
}
