import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { z } from "zod";
import { PROGRESS_TOOL_NAMES, progressToolName } from "../shared/tools";
import type { ProgressMessages } from "./messages";

export const CHAT_ROW_KIND = "tool-call";
export const CHAT_ROW_VERSION = 1;

const tool = z.enum(PROGRESS_TOOL_NAMES);

export const chatRowSchema = z.discriminatedUnion("state", [
  z.object({ tool, state: z.literal("running") }),
  z.object({ tool, state: z.literal("done"), output: z.string() }),
  z.object({ tool, state: z.literal("failed"), error: z.string() }),
  z.object({ tool, state: z.literal("canceled") }),
]);

export type ChatRow = z.output<typeof chatRowSchema>;

type ToolCall = Parameters<PluginTimelineTransformerContribution<"tool_call">["transform"]>[0]["item"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The text a tool call carries, or undefined when its shape is unfamiliar.
// Claude Code stores the result as { output: text } and an error as
// { content: text or [{ text }] }; Codex keeps the MCP result { content: [{ text }] }.
function readText(value: unknown): string | undefined {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((part) => (typeof part === "string" ? part : isRecord(part) && typeof part.text === "string" ? part.text : undefined));
    return parts.every((part) => part !== undefined) ? parts.join("\n") : undefined;
  }
  if (!isRecord(value)) return undefined;
  const key = ["output", "content", "text", "message"].find((name) => name in value);
  return key ? readText(value[key]) : undefined;
}

// A call to a Progress tool becomes the row's data. Anything else, or a call
// whose detail can't be read, stays undefined so Paseo draws its own row.
export function chatRow(item: ToolCall): ChatRow | undefined {
  const name = progressToolName(item.name);
  if (!name) return undefined;
  if (item.status === "running") return { tool: name, state: "running" };
  if (item.status === "canceled") return { tool: name, state: "canceled" };
  if (item.status === "failed") {
    const error = readText(item.error);
    return error === undefined ? undefined : { tool: name, state: "failed", error };
  }
  const detail: unknown = item.detail;
  if (!isRecord(detail) || !("output" in detail)) return undefined;
  const output = readText(detail.output);
  if (output === undefined) return undefined;
  // Codex reports a tool's own error inside a completed MCP result.
  if (isRecord(detail.output) && detail.output.isError === true) return { tool: name, state: "failed", error: output };
  return { tool: name, state: "done", output };
}

export function transformChatRow({ item }: { item: ToolCall }) {
  const data = chatRow(item);
  return data && { items: [{ type: "plugin" as const, kind: CHAT_ROW_KIND, version: CHAT_ROW_VERSION, data }] };
}

// What the row says: one line, and the full text the row opens to. The line
// truncates on a narrow chat, so any text at all can be opened.
export function chatRowText(row: ChatRow, m: ProgressMessages): { line: string; more: string | null } {
  const labels = m.toolRow[row.tool];
  const firstLine = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const withMore = (line: string, text: string) => ({ line, more: text.trim() || null });
  switch (row.state) {
    case "running":
      return { line: labels.running, more: null };
    case "canceled":
      return { line: m.toolRowCanceled(labels.name), more: null };
    case "failed":
      return withMore(firstLine(row.error) || m.toolRowFailed(labels.name), row.error);
    case "done":
      // Show starts with the worktree's path; the dashboard is what the agent read.
      return withMore(row.tool === "progress_show" ? labels.name : firstLine(row.output) || labels.name, row.output);
  }
}
