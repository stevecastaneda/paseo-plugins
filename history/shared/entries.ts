import { parseTaskNotification, type TaskNotification } from "./task-notification.ts";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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
  return value
    .map((item) => {
      const block = record(item);
      return (
        string(block.text) ||
        string(block.thinking) ||
        string(block.content) ||
        (block.type === "tool_use" ? `${string(block.name)}\n${JSON.stringify(block.input, null, 2)}` : "") ||
        (block.type === "tool_result" ? contentText(block.content) : "") ||
        (string(block.type).includes("image") ? "[Image]" : "")
      );
    })
    .filter(Boolean)
    .join("\n\n");
}

// `provider` names the harness that wrote the log. OMP records share field names
// with Claude Code's, so they are read as OMP's only when the log is OMP's.
export function parseEntries(text: string, provider?: string): HistoryEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((raw) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        const data = record(parsed);
        if (provider === "omp") return parseOmpEntry(data, raw);
        if (string(record(data.info).id).startsWith("ses_") || (data.info && Array.isArray(data.parts))) {
          return parseOpenCodeEntry(data, raw);
        }
        const payload = record(data.payload);
        const kind = string(data.type) || "object";
        const chat = kind === "user" || kind === "assistant";
        const message = chat ? record(data.message) : {};
        const body = Object.keys(payload).length ? payload : Object.keys(message).length ? message : data;
        const subtype = string(body.type);
        const role = string(body.role) || (chat ? kind : "");
        const title = role ? `${role[0]!.toUpperCase()}${role.slice(1)}` : (subtype || kind).replace(/[_-]/g, " ");
        const preview =
          contentText(body.content) ||
          string(body.message) ||
          string(body.text) ||
          string(body.output) ||
          string(body.arguments) ||
          string(body.summary) ||
          string(body.cwd) ||
          string(data.summary) ||
          JSON.stringify(parsed);
        const blocks = Array.isArray(body.content) ? body.content.map(record) : [];
        const tool = /(?:function|custom_tool)_call/.test(subtype) || blocks.some((block) => block.type === "tool_use" || block.type === "tool_result");
        const reasoning = subtype === "reasoning" || blocks.some((block) => block.type === "thinking");
        const messageText =
          typeof body.content === "string"
            ? body.content
            : blocks
                .filter((block) => ["text", "input_text", "output_text"].includes(string(block.type)))
                .map((block) => string(block.text))
                .join("\n\n");
        const conversation = role === "user" || role === "assistant";
        // Claude Code delivers harness task envelopes as user entries, never as assistant text.
        const envelope = role === "user" && /^\s*<task-notification>/.test(messageText);
        const parsedNotification = envelope ? (parseTaskNotification(messageText) ?? undefined) : undefined;
        // First matching rule wins. Claude Code marks text it injects (skill bodies,
        // command expansions, compaction summaries) with isMeta or isCompactSummary.
        const category =
          (
            [
              ["context", role === "developer" || role === "system" || kind === "session_meta" || kind === "turn_context" || kind === "world_state"],
              ["context", data.isMeta === true || data.isCompactSummary === true],
              ["context", role === "user" && /^(?:# AGENTS\.md|<environment_context>|<recommended_plugins>)/.test(preview.trim())],
              ["events", envelope && !parsedNotification],
              ["message", conversation && Boolean(messageText)],
              ["tools", tool],
              ["reasoning", reasoning],
              ["message", conversation],
            ] as const
          ).find(([, matches]) => matches)?.[0] ?? "events";
        const displayText = category === "message" ? messageText || preview : preview;
        const notification = category === "message" ? parsedNotification : undefined;
        // Codex event_msg item_completed/message mirrors are kept as events; only
        // canonical response_item messages enter the readable conversation.
        return {
          raw,
          title,
          kind: subtype && subtype !== kind ? `${kind} · ${subtype}` : kind,
          timestamp: string(data.timestamp) || string(body.timestamp),
          preview: displayText,
          valid: true,
          category,
          role,
          startsTurn: subtype === "task_started" || (kind === "user" && category === "message" && !tool && !notification),
          hasTools: tool,
          hasReasoning: reasoning,
          notification,
        };
      } catch {
        return {
          raw,
          title: "Unparsed entry",
          kind: "raw text",
          timestamp: "",
          preview: "This line is incomplete or is not valid JSON. Its original text is preserved below.",
          valid: false,
          category: "events",
          role: "",
          startsTurn: false,
          hasTools: false,
          hasReasoning: false,
        };
      }
    });
}

function parseOpenCodeEntry(data: RecordValue, raw: string): HistoryEntry {
  const info = record(data.info);
  const role = string(info.role);
  const parts = Array.isArray(data.parts) ? data.parts.map(record) : [];
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => string(part.text))
    .filter(Boolean)
    .join("\n\n");
  const hasTools = parts.some((part) => part.type === "tool");
  const hasReasoning = parts.some((part) => part.type === "reasoning");
  const attachments = parts
    .filter((part) => part.type === "file")
    .map((part) => `[File: ${string(part.filename) || string(part.mime) || "attachment"}]`)
    .join("\n");
  const category =
    !role || role === "system" || role === "developer"
      ? "context"
      : text || attachments
        ? "message"
        : hasTools
          ? "tools"
          : hasReasoning
            ? "reasoning"
            : "events";
  const preview =
    [text, attachments].filter(Boolean).join("\n\n") ||
    parts
      .map((part) => {
        if (part.type === "reasoning") return string(part.text);
        if (part.type === "tool") {
          const state = record(part.state);
          return [string(part.tool), JSON.stringify(state.input, null, 2), string(state.output) || string(state.error)].filter(Boolean).join("\n");
        }
        return JSON.stringify(part);
      })
      .join("\n\n") ||
    string(info.title) ||
    JSON.stringify(info);
  const created = record(info.time).created;
  const timestamp = typeof created === "number" && Number.isFinite(new Date(created).getTime()) ? new Date(created).toISOString() : "";
  const notification = category === "message" && role === "user" ? (parseTaskNotification(preview) ?? undefined) : undefined;
  return {
    raw,
    title: role ? `${role[0]!.toUpperCase()}${role.slice(1)}` : "Session details",
    kind: `opencode · ${role || "session"}`,
    timestamp,
    preview,
    valid: true,
    category,
    role,
    startsTurn: role === "user" && !notification,
    hasTools,
    hasReasoning,
    notification,
  };
}

function words(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase();
}

// OMP content is a string or a list of text and image blocks.
function ompContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      const block = record(item);
      return block.type === "text" ? string(block.text) : block.type === "image" ? "[Image]" : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

// A skill the user ran with /skill:<name>. OMP saves the skill's expanded body as
// the message and what the user typed in its details. Sessions from before OMP
// kept the typed text have only the skill's name and arguments, so this rebuilds
// it the way Paseo's chat does.
function ompSkillCommand(message: RecordValue): string {
  if (message.customType !== "skill-prompt" || message.attribution !== "user") return "";
  const details = record(message.details);
  const name = string(details.name);
  const args = string(details.args).trim();
  return string(details.prompt) || (name ? `/skill:${name}${args ? ` ${args}` : ""}` : "");
}

// An OMP log is a title line, a session header, then one entry per line. A
// `message` entry wraps one message of the model's context. Only what the user
// typed reads as You: OMP marks what it adds itself, such as subagent
// assignments, messages from other agents and notices, with attribution "agent".
function parseOmpEntry(data: RecordValue, raw: string): HistoryEntry {
  const type = string(data.type) || "object";
  const message = type === "message" ? record(data.message) : data;
  const role = type === "message" ? string(message.role) : "";
  const customType = string(message.customType);
  const blocks = Array.isArray(message.content) ? message.content.map(record) : [];
  const hasTools = ["toolResult", "bashExecution", "pythonExecution"].includes(role) || blocks.some((block) => block.type === "toolCall");
  const hasReasoning = role === "assistant" && blocks.some((block) => block.type === "thinking" || block.type === "redactedThinking");
  let category: HistoryEntry["category"] = "events";
  let speaker = role;
  let preview = "";
  if (role === "user") {
    category = message.attribution === "agent" ? "context" : "message";
    preview = ompContent(message.content);
  } else if (role === "assistant") {
    const text = blocks
      .filter((block) => block.type === "text")
      .map((block) => string(block.text))
      .filter(Boolean)
      .join("\n\n");
    category = text ? "message" : hasTools ? "tools" : hasReasoning ? "reasoning" : "events";
    preview =
      text ||
      blocks
        .map((block) => {
          if (block.type === "thinking") return string(block.thinking);
          if (block.type === "redactedThinking") return "[Redacted thinking]";
          if (block.type === "toolCall") return `${string(block.name)}\n${JSON.stringify(block.arguments ?? {}, null, 2)}`;
          return block.type === "image" ? "[Image]" : "";
        })
        .filter(Boolean)
        .join("\n\n") ||
      string(message.errorMessage);
  } else if (role === "toolResult") {
    category = "tools";
    preview = [string(message.toolName), ompContent(message.content)].filter(Boolean).join("\n");
  } else if (role === "bashExecution" || role === "pythonExecution") {
    category = "tools";
    preview = [string(message.command) || string(message.code), string(message.output)].filter(Boolean).join("\n");
  } else if (role === "custom" || role === "hookMessage" || type === "custom_message") {
    preview = ompSkillCommand(message);
    if (preview) {
      category = "message";
      speaker = "user";
    } else {
      category = message.excludeFromContext === true ? "events" : "context";
      preview = ompContent(message.content);
    }
  } else if (role === "developer") {
    category = "context";
    preview = ompContent(message.content);
  } else if (role === "branchSummary" || role === "compactionSummary") {
    category = "context";
    preview = string(message.summary);
  } else if (role === "fileMention") {
    category = "context";
    preview = (Array.isArray(message.files) ? message.files : []).map((file) => `[File: ${string(record(file).path) || "attachment"}]`).join("\n");
  } else if (["session", "session_init", "compaction", "branch_summary"].includes(type)) {
    category = "context";
  }
  const subtype = customType || role;
  const label = words(customType || role || type);
  return {
    raw,
    title: role && !customType ? `${label[0]!.toUpperCase()}${label.slice(1)}` : label,
    kind: subtype ? `${type} · ${subtype}` : type,
    timestamp: string(data.timestamp),
    preview:
      preview ||
      [data.summary, data.task, data.title, data.model, data.thinkingLevel, data.mode, data.label, data.cwd].map(string).find(Boolean) ||
      JSON.stringify(data),
    valid: true,
    category,
    role: speaker,
    startsTurn: category === "message" && speaker === "user",
    hasTools,
    hasReasoning,
  };
}

export interface HistoryTurn {
  entries: HistoryEntry[];
  title: string;
}

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
