import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { findLog, readPage } from "./files.ts";

export async function handleReadHistory(
  input: { agentId: string; offset: number; source?: string },
  { paseo }: PluginHandlerContext,
) {
  const handle = paseo.agents.ref(input.agentId);
  await handle.refresh();
  const agent = handle.current();
  if (!agent) throw new Error("This chat is no longer available.");
  const provider = agent.provider;
  if (provider !== "codex" && provider !== "claude") {
    throw new Error(`Raw history is not supported for ${provider} yet. Codex and Claude are supported.`);
  }
  const sessionId = agent.persistence?.nativeHandle ?? agent.persistence?.sessionId ?? agent.runtimeInfo?.sessionId;
  if (!sessionId) throw new Error("This chat has no saved session yet. Send a message, then refresh.");
  const root = provider === "codex"
    ? process.env.CODEX_HOME ?? join(homedir(), ".codex")
    : process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const roots = provider === "codex"
    ? [join(root, "sessions"), join(root, "archived_sessions")]
    : [join(root, "projects")];
  const path = await findLog(roots, sessionId, provider);
  return { ...await readPage(path, input.offset, input.source), provider };
}
