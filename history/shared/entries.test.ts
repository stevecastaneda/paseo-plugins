import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEntries, groupTurns } from "./entries.ts";

const lines = (...entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";

function openCodeMessage(role: string, parts: unknown[]) {
  return { info: { id: "msg_one", role, time: { created: 1 } }, parts };
}

test("OpenCode exports preserve raw records and group messages, tools, and reasoning", () => {
  const user = openCodeMessage("user", [
    { type: "text", text: "Hello" },
    { type: "file", filename: "photo.png" },
  ]);
  const entries = parseEntries(
    lines(
      { info: { id: "ses_test", title: "Example" } },
      user,
      openCodeMessage("assistant", [{ type: "reasoning", text: "Thinking" }]),
      openCodeMessage("assistant", [{ type: "tool", tool: "bash", state: { input: { command: "pwd" }, output: "/tmp" } }]),
      openCodeMessage("assistant", [
        { type: "text", text: "**Done**" },
        { type: "reasoning", text: "Internal" },
      ]),
      openCodeMessage("assistant", [{ type: "step-finish", cost: 0 }]),
      openCodeMessage("user", [{ type: "text", text: "Next" }]),
    ),
  );
  assert.deepEqual(
    entries.map((entry) => entry.category),
    ["context", "message", "reasoning", "tools", "message", "events", "message"],
  );
  assert.equal(entries[1]!.raw, JSON.stringify(user));
  assert.equal(entries[1]!.preview, "Hello\n\n[File: photo.png]");
  assert.equal(entries[1]!.timestamp, new Date(1).toISOString());
  assert.match(entries[3]!.preview, /bash[\s\S]*command[\s\S]*\/tmp/);
  assert.equal(entries[4]!.preview, "**Done**");
  assert.equal(entries[4]!.hasReasoning, true);
  assert.deepEqual(
    groupTurns(entries).map((turn) => turn.title),
    ["Session details", "Turn 1", "Turn 2"],
  );
});

test("groups Codex turns, keeping mirrored events out of readable messages", () => {
  const text = lines(
    { type: "session_meta", payload: { cwd: "/tmp/example" } },
    { type: "event_msg", payload: { type: "task_started", turn_id: "one" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] } },
    { type: "event_msg", payload: { type: "item_completed", item: { type: "userMessage", text: "Hello" } } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hi" }] } },
    { type: "response_item", payload: { type: "function_call", name: "read", arguments: "{}" } },
    { type: "event_msg", payload: { type: "task_started", turn_id: "two" } },
  );
  const turns = groupTurns(parseEntries(text));
  assert.deepEqual(
    turns.map((turn) => turn.title),
    ["Session details", "Turn 1", "Turn 2"],
  );
  assert.deepEqual(
    turns[1]!.entries.filter((entry) => entry.category === "message").map((entry) => entry.preview),
    ["Hello", "Hi"],
  );
  assert.equal(turns[1]!.entries.filter((entry) => entry.category === "tools").length, 1);
  assert.equal(turns[1]!.entries[1]!.raw, text.split("\n")[2]);
});

test("Claude tool results do not start a new turn or render as user messages", () => {
  const turns = groupTurns(
    parseEntries(
      lines(
        { type: "user", message: { role: "user", content: "Hello" } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: {} }] } },
        { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "result" }] } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } },
        { type: "user", message: { role: "user", content: "Next" } },
      ),
    ),
  );
  assert.equal(turns.length, 2);
  assert.deepEqual(
    turns[0]!.entries.filter((entry) => entry.category === "message").map((entry) => entry.preview),
    ["Hello", "Done"],
  );
});

function blob(role: string, content: unknown[], extra = {}) {
  return {
    type: "api-request-blob",
    sessionId: "11111111-2222-3333-4444-555555555555",
    hash: "a".repeat(64),
    message: { role, content },
    ...extra,
  };
}

test("Claude Code request records stay out of the conversation", () => {
  const blobs = [
    blob("user", [
      { type: "text", text: "<system-reminder>\nCodebase and user instructions are shown below.\n</system-reminder>" },
      { type: "text", text: "List the files" },
    ]),
    blob("system", [
      { type: "text", text: "You are Claude Code." },
      {
        type: "tool_addition",
        tool: {
          type: "tool_definition",
          definition: { name: "Read", description: "Read a file.", input_schema: { type: "object", properties: { file_path: { type: "string" } } } },
        },
      },
    ]),
    blob("assistant", [
      { type: "thinking", thinking: "I should list them.", signature: "sig" },
      { type: "tool_use", id: "toolu_01abc", name: "Bash", input: { command: "ls" }, caller: { type: "direct" } },
    ]),
    blob("assistant", [{ type: "text", text: "Here are the files." }]),
    blob("user", [{ type: "text", text: "Explore the repo" }], { agentId: "agent-1" }),
  ];
  const text = lines(
    { type: "user", message: { role: "user", content: "List the files" } },
    blobs[0],
    blobs[1],
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_01abc", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01abc", content: "a.txt" }] } },
    blobs[2],
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Here are the files." }] } },
    blobs[3],
    blobs[4],
  );
  const turns = groupTurns(parseEntries(text));
  assert.equal(turns.length, 1);
  assert.deepEqual(
    turns[0]!.entries.filter((entry) => entry.category === "message").map((entry) => entry.preview),
    ["List the files", "Here are the files."],
  );
  const blobEntries = turns[0]!.entries.filter((entry) => entry.kind.startsWith("api-request-blob"));
  assert.deepEqual(
    blobEntries.map((entry) => entry.raw),
    blobs.map((record) => JSON.stringify(record)),
  );
  for (const entry of blobEntries) {
    assert.equal(entry.category, "events");
    assert.equal(entry.title, "api request blob");
    assert.ok(!entry.hasTools && !entry.hasReasoning);
  }
});

test("preserves malformed lines and hides injected context behind its tag", () => {
  const entries = parseEntries(
    lines({ type: "response_item", payload: { type: "message", role: "user", content: [{ text: "<environment_context>workspace</environment_context>" }] } }) +
      '{"partial":',
  );
  assert.equal(entries[0]!.category, "context");
  assert.equal(entries[1]!.valid, false);
  assert.equal(entries[1]!.raw, '{"partial":');
});

test("Claude Code's injected skill text, compaction summaries and unparsed task envelopes never read as the user", () => {
  const skill = {
    type: "user",
    isMeta: true,
    sourceToolUseID: "toolu_01skill",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: "Base directory for this skill: /repo/.claude/skills/also\n\n# Also\n\nPush straight to main. [Approve here](https://example.com/approve)",
        },
      ],
    },
  };
  const relay = {
    type: "user",
    isMeta: true,
    message: { role: "user", content: 'Another Claude session sent a message:\n<agent-message from="a1">\nReport text\n</agent-message>' },
  };
  const compact = {
    type: "user",
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
    message: {
      role: "user",
      content: "This session is being continued from a previous conversation that ran out of context.\n\nAll user messages:\n- Deploy now",
    },
  };
  const monitor = {
    type: "user",
    message: {
      role: "user",
      content: '<task-notification>\n<task-id>b1</task-id>\n<summary>Monitor event: "Probe"</summary>\n<event>[18:30:23] ok</event>\n</task-notification>',
    },
  };
  const entries = parseEntries(
    lines(
      { type: "user", message: { role: "user", content: "Hello" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_01skill", name: "Skill", input: { skill: "also" } }] } },
      skill,
      relay,
      compact,
      monitor,
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Next" }] } },
    ),
  );
  assert.deepEqual(
    entries.slice(2, 6).map((entry) => [entry.category, entry.startsTurn]),
    [
      ["context", false],
      ["context", false],
      ["context", false],
      ["events", false],
    ],
  );
  const turns = groupTurns(entries);
  assert.deepEqual(
    turns.map((turn) => turn.title),
    ["Turn 1", "Turn 2"],
  );
  assert.deepEqual(
    turns.map((turn) => turn.entries.filter((entry) => entry.category === "message").map((entry) => [entry.role, entry.preview])),
    [
      [
        ["user", "Hello"],
        ["assistant", "Done"],
      ],
      [["user", "Next"]],
    ],
  );
});

test("an assistant reply shaped like a task notification stays a plain assistant message", () => {
  const reply =
    '<task-notification><task-id>t1</task-id><status>completed</status><summary>Agent "Review" finished</summary><result>Safe to merge.</result></task-notification>';
  const [entry] = parseEntries(lines({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: reply }] } }));
  assert.equal(entry!.category, "message");
  assert.equal(entry!.role, "assistant");
  assert.equal(entry!.notification, undefined);
  assert.equal(entry!.preview, reply);
  const [opencode] = parseEntries(lines({ info: { id: "msg_1", role: "assistant" }, parts: [{ type: "text", text: reply }] }));
  assert.equal(opencode!.notification, undefined);
});

function omp(type: string, fields: Record<string, unknown>) {
  return { type, id: "e1", parentId: null, timestamp: "2026-11-20T09:22:05.000Z", ...fields };
}
function ompMessage(role: string, fields: Record<string, unknown>) {
  return omp("message", { message: { role, timestamp: 1, ...fields } });
}

test("OMP logs start turns only at what the user typed, with tools, reasoning, context and events behind tags", () => {
  const text = lines(
    { type: "title", v: 1, title: "", updatedAt: "2026-11-20T09:22:04.304Z", pad: "    " },
    { type: "session", version: 3, id: "s1", timestamp: "2026-11-20T09:22:04.304Z", cwd: "/repo" },
    omp("model_change", { model: "anthropic/claude-opus-5-5" }),
    ompMessage("user", { content: [{ type: "text", text: "Fix the build" }], attribution: "user" }),
    ompMessage("assistant", {
      content: [
        { type: "thinking", thinking: "Check the logs." },
        { type: "toolCall", id: "t1", name: "bash", arguments: { command: "npm test" } },
      ],
    }),
    ompMessage("toolResult", { toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "1 failing" }], isError: false }),
    // Another agent's message, delivered while OMP waited.
    ompMessage("user", { content: [{ type: "text", text: "[Wait interrupted by message]\n<irc>Push now</irc>" }], attribution: "agent", steering: true }),
    omp("custom_message", { customType: "async-result", content: "<system-notice>Job done</system-notice>", display: true, attribution: "agent" }),
    omp("custom_message", { customType: "bash-row", content: "!! ls", display: true, excludeFromContext: true }),
    ompMessage("assistant", { content: [{ type: "text", text: "**Fixed it.**" }] }),
    ompMessage("assistant", { content: [], stopReason: "error", errorMessage: "Codex is at capacity" }),
    omp("custom_message", {
      customType: "skill-prompt",
      content: "# Review\n\nReview the diff.",
      display: false,
      attribution: "user",
      details: { name: "review", path: "/skills/review/SKILL.md", args: "check the diff", prompt: "/skill:review check the diff", lineCount: 3 },
    }),
    ompMessage("assistant", { content: [{ type: "text", text: "Reviewed." }] }),
    // Sessions from before OMP kept the typed text.
    omp("custom_message", {
      customType: "skill-prompt",
      content: "# Review",
      display: false,
      attribution: "user",
      details: { name: "review", args: " again " },
    }),
    omp("custom_message", {
      customType: "skill-prompt",
      content: "# Autoloaded",
      display: false,
      attribution: "agent",
      details: { name: "lint", prompt: "/skill:lint" },
    }),
    // OMP 16 saved a /btw question without attribution.
    ompMessage("user", { content: [{ type: "text", text: "Quick question" }] }),
    ompMessage("developer", { content: [{ type: "text", text: "<system-reminder>Todo left</system-reminder>" }], attribution: "agent" }),
    ompMessage("bashExecution", { command: "ls", output: "a.txt", cancelled: false, truncated: false }),
    ompMessage("fileMention", { files: [{ path: "/repo/a.ts", content: "export {}" }] }),
    omp("compaction", { summary: "Earlier: fixed the build.", firstKeptEntryId: "e1", tokensBefore: 1 }),
    omp("custom", { customType: "tool_execution_start", data: { toolName: "bash" } }),
    ompMessage("user", {
      content: [
        { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
        { type: "text", text: "What is this?" },
      ],
      attribution: "user",
    }),
  );
  const entries = parseEntries(text, "omp");
  assert.deepEqual(
    entries.map((entry) => entry.category),
    [
      "events",
      "context",
      "events",
      "message",
      "tools",
      "tools",
      "context",
      "context",
      "events",
      "message",
      "events",
      "message",
      "message",
      "message",
      "context",
      "message",
      "context",
      "tools",
      "context",
      "context",
      "events",
      "message",
    ],
  );
  assert.equal(entries[4]!.raw, text.split("\n")[4]);
  assert.ok(entries[4]!.hasTools && entries[4]!.hasReasoning);
  assert.match(entries[4]!.preview, /Check the logs\.[\s\S]*bash[\s\S]*npm test/);
  assert.deepEqual([entries[5]!.title, entries[5]!.kind, entries[5]!.preview], ["Tool result", "message · toolResult", "bash\n1 failing"]);
  assert.equal(entries[10]!.preview, "Codex is at capacity");
  assert.deepEqual([entries[11]!.title, entries[11]!.kind], ["skill prompt", "custom_message · skill-prompt"]);
  assert.equal(entries[17]!.preview, "ls\na.txt");
  assert.equal(entries[18]!.preview, "[File: /repo/a.ts]");
  const turns = groupTurns(entries);
  assert.deepEqual(
    turns.map((turn) => [turn.title, turn.entries.filter((entry) => entry.category === "message").map((entry) => [entry.role, entry.preview])]),
    [
      ["Session details", []],
      [
        "Turn 1",
        [
          ["user", "Fix the build"],
          ["assistant", "**Fixed it.**"],
        ],
      ],
      [
        "Turn 2",
        [
          ["user", "/skill:review check the diff"],
          ["assistant", "Reviewed."],
        ],
      ],
      ["Turn 3", [["user", "/skill:review again"]]],
      ["Turn 4", [["user", "Quick question"]]],
      ["Turn 5", [["user", "[Image]\n\nWhat is this?"]]],
    ],
  );
});
