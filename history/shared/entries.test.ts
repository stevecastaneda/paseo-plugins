import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEntries, groupTurns } from "./entries.ts";

const lines = (...entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";

test("OpenCode exports preserve raw records and group messages, tools, and reasoning", () => {
  const entry = (role: string, parts: unknown[]) => ({ info: { id: "msg_one", role, time: { created: 1 } }, parts });
  const user = entry("user", [{ type: "text", text: "Hello" }, { type: "file", filename: "photo.png" }]);
  const entries = parseEntries(lines(
    { info: { id: "ses_test", title: "Example" } }, user,
    entry("assistant", [{ type: "reasoning", text: "Thinking" }]),
    entry("assistant", [{ type: "tool", tool: "bash", state: { input: { command: "pwd" }, output: "/tmp" } }]),
    entry("assistant", [{ type: "text", text: "**Done**" }, { type: "reasoning", text: "Internal" }]),
    entry("assistant", [{ type: "step-finish", cost: 0 }]),
    entry("user", [{ type: "text", text: "Next" }]),
  ));
  assert.deepEqual(entries.map((entry) => entry.category), ["context", "message", "reasoning", "tools", "message", "events", "message"]);
  assert.equal(entries[1]!.raw, JSON.stringify(user));
  assert.equal(entries[1]!.preview, "Hello\n\n[File: photo.png]");
  assert.equal(entries[1]!.timestamp, new Date(1).toISOString());
  assert.match(entries[3]!.preview, /bash[\s\S]*command[\s\S]*\/tmp/);
  assert.equal(entries[4]!.preview, "**Done**");
  assert.equal(entries[4]!.hasReasoning, true);
  assert.deepEqual(groupTurns(entries).map((turn) => turn.title), ["Session details", "Turn 1", "Turn 2"]);
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
  assert.deepEqual(turns.map((turn) => turn.title), ["Session details", "Turn 1", "Turn 2"]);
  assert.deepEqual(turns[1]!.entries.filter((entry) => entry.category === "message").map((entry) => entry.preview), ["Hello", "Hi"]);
  assert.equal(turns[1]!.entries.filter((entry) => entry.category === "tools").length, 1);
  assert.equal(turns[1]!.entries[1]!.raw, text.split("\n")[2]);
});

test("Claude tool results do not start a new turn or render as user messages", () => {
  const turns = groupTurns(parseEntries(lines(
    { type: "user", message: { role: "user", content: "Hello" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: {} }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "result" }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } },
    { type: "user", message: { role: "user", content: "Next" } },
  )));
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0]!.entries.filter((entry) => entry.category === "message").map((entry) => entry.preview), ["Hello", "Done"]);
});

test("preserves malformed lines and hides injected context behind its tag", () => {
  const entries = parseEntries(lines({ type: "response_item", payload: { type: "message", role: "user", content: [{ text: "<environment_context>workspace</environment_context>" }] } }) + '{"partial":');
  assert.equal(entries[0]!.category, "context");
  assert.equal(entries[1]!.valid, false);
  assert.equal(entries[1]!.raw, '{"partial":');
});
