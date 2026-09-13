import { parseTaskNotification, type TaskNotification } from "./task-notification.ts";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}
function string(value: unknown): string { return typeof value === "string" ? value : ""; }

export interface HistoryEntry {
  raw: string;
  title: string;
  kind: string;
  timestamp: string;
  preview: string;
  valid: boolean;
  category: "message" | "tools" | "reasoning" | "context" | "events";
  role: string;
  startsTurn: boolean;
  hasTools: boolean;
  hasReasoning: boolean;
  notification?: TaskNotification;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    const block = record(item);
    return string(block.text) || string(block.thinking) || string(block.content)
      || (block.type === "tool_use" ? `${string(block.name)}\n${JSON.stringify(block.input, null, 2)}` : "")
      || (block.type === "tool_result" ? contentText(block.content) : "")
      || (string(block.type).includes("image") ? "[Image]" : "");
  }).filter(Boolean).join("\n\n");
}

export function parseEntries(text: string): HistoryEntry[] {
  return text.split("\n").filter((line) => line.trim()).map((raw) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      const data = record(parsed);
      const payload = record(data.payload);
      const message = record(data.message);
      const body = Object.keys(payload).length ? payload : Object.keys(message).length ? message : data;
      const kind = string(data.type) || "object";
      const subtype = string(body.type);
      const role = string(body.role) || (kind === "user" || kind === "assistant" ? kind : "");
      const title = role ? `${role[0]!.toUpperCase()}${role.slice(1)}`
        : (subtype || kind).replace(/[_-]/g, " ");
      const preview = contentText(body.content) || string(body.message) || string(body.text)
        || string(body.output) || string(body.arguments) || string(body.summary)
        || string(body.cwd) || string(data.summary) || JSON.stringify(parsed);
      const blocks = Array.isArray(body.content) ? body.content.map(record) : [];
      const tool = /(?:function|custom_tool)_call/.test(subtype) || blocks.some((block) => block.type === "tool_use" || block.type === "tool_result");
      const reasoning = subtype === "reasoning" || blocks.some((block) => block.type === "thinking");
      const context = role === "developer" || role === "system" || kind === "session_meta" || kind === "turn_context" || kind === "world_state"
        || (role === "user" && /^(?:# AGENTS\.md|<environment_context>|<recommended_plugins>)/.test(preview.trim()));
      const messageText = typeof body.content === "string" ? body.content : blocks
        .filter((block) => ["text", "input_text", "output_text"].includes(string(block.type)))
        .map((block) => string(block.text)).join("\n\n");
      const category = context ? "context" : messageText && (role === "user" || role === "assistant") ? "message" : tool ? "tools" : reasoning ? "reasoning"
        : role === "user" || role === "assistant" ? "message" : "events";
      const displayText = category === "message" ? messageText || preview : preview;
      const notification = category === "message" ? parseTaskNotification(displayText) ?? undefined : undefined;
      // Codex event_msg item_completed/message mirrors are kept as events; only
      // canonical response_item messages enter the readable conversation.
      return { raw, title, kind: subtype && subtype !== kind ? `${kind} · ${subtype}` : kind,
        timestamp: string(data.timestamp) || string(body.timestamp), preview: displayText, valid: true,
        category, role, startsTurn: subtype === "task_started" || (kind === "user" && !tool && !notification),
        hasTools: tool, hasReasoning: reasoning, notification };
    } catch {
      return { raw, title: "Unparsed entry", kind: "raw text", timestamp: "",
        preview: "This line is incomplete or is not valid JSON. Its original text is preserved below.", valid: false,
        category: "events", role: "", startsTurn: false, hasTools: false, hasReasoning: false };
    }
  });
}

export interface HistoryTurn { entries: HistoryEntry[]; title: string; }

export function groupTurns(entries: HistoryEntry[]): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  const explicitTurns = entries.some((entry) => entry.kind === "event_msg · task_started");
  for (const entry of entries) {
    const startsTurn = entry.startsTurn || (!explicitTurns && entry.category === "message" && entry.role === "user" && !entry.notification);
    if (!turns.length || (startsTurn && turns.at(-1)!.entries.length)) {
      turns.push({ entries: [], title: startsTurn ? `Turn ${turns.filter((turn) => turn.title !== "Session details").length + 1}` : "Session details" });
    }
    turns.at(-1)!.entries.push(entry);
  }
  return turns;
}
