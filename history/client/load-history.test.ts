import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConversationBatch } from "./load-history.ts";

test("automatically reads past context-only pages to visible conversation messages", async () => {
  const texts = [
    JSON.stringify({ type: "session_meta", payload: { cwd: "/tmp/test" } }) + "\n",
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "Long context" }] } }) + "\n",
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "My actual message" }] } }) + "\n",
  ];
  let calls = 0;
  const totalBytes = texts.reduce((total, text) => total + Buffer.byteLength(text), 0);
  const result = await loadConversationBatch(async (input) => {
    const text = texts[calls++]!;
    const offset = input.offset ?? 0;
    return { path: "/tmp/test.jsonl", provider: "codex", source: "one", text, offset,
      nextOffset: offset + Buffer.byteLength(text), totalBytes, modifiedAt: "2026-09-13T00:00:00Z" };
  }, { agentId: "a" }, () => false);
  assert.equal(calls, 3);
  assert.match(result!.text, /My actual message/);
  assert.equal(result!.page.nextOffset, totalBytes);
});

test("stops fetching immediately when the dialog closes", async () => {
  let calls = 0;
  const result = await loadConversationBatch(async () => {
    calls++;
    return { path: "/tmp/test.jsonl", provider: "codex", source: "one", text: "{}\n", offset: 0,
      nextOffset: 3, totalBytes: 100, modifiedAt: "2026-09-13T00:00:00Z" };
  }, { agentId: "a" }, () => true);
  assert.equal(calls, 1); assert.equal(result, null);
});
