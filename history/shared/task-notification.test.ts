import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTaskNotification, notificationUsage } from "./task-notification.ts";
import { parseEntries, groupTurns } from "./entries.ts";

const envelope = '<task-notification>\n<task-id>same-task</task-id><tool-use-id>tool-1</tool-use-id><output-file>/tmp/task.output</output-file><status>completed</status><summary>Agent "Check chart" finished</summary><note>Can resume.</note><result>## Results\n\n- **Passed**\n\n```html\n<div>Example</div>\n```</result><usage><subagent_tokens>83651</subagent_tokens><tool_uses>53</tool_uses><duration_ms>391880</duration_ms></usage>\n</task-notification>';

test("extracts known notification fields while preserving Markdown, HTML examples, and original source", () => {
  const notification = parseTaskNotification(envelope)!;
  assert.equal(notification.taskId, "same-task");
  assert.equal(notification.outputFile, "/tmp/task.output");
  assert.equal(notification.result, '## Results\n\n- **Passed**\n\n```html\n<div>Example</div>\n```');
  assert.equal(notificationUsage(notification), "83,651 tokens · 53 tool uses · 6m 32s");
  const raw = JSON.stringify({ type: "user", message: { role: "user", content: envelope } });
  const entry = parseEntries(raw)[0]!;
  assert.equal(entry.raw, raw);
  assert.equal(entry.preview, envelope);
  assert.equal(entry.startsTurn, false);
});

test("notifications stay in the current turn and repeated task IDs are retained", () => {
  const text = ["Start task", envelope, envelope].map((content) => JSON.stringify({ type: "user", message: { role: "user", content } })).join("\n");
  const turns = groupTurns(parseEntries(text));
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.entries.filter((entry) => entry.notification).length, 2);
});

test("quoted examples, incomplete envelopes, duplicate and unknown fields fall back unchanged", () => {
  for (const text of [
    '```xml\n' + envelope + '\n```', 'An example:\n' + envelope,
    envelope.replace('</task-notification>', ''),
    envelope.replace('<status>', '<unknown>extra</unknown><status>'),
    envelope.replace('<status>', '<task-id>duplicate</task-id><status>'),
    '<div>ordinary HTML</div>',
  ]) assert.equal(parseTaskNotification(text), null);
});

test("accepts a failure without a result and keeps missing usage distinct from zero", () => {
  const minimal = '<task-notification><task-id>x</task-id><status>failed</status><summary>Task stopped</summary></task-notification>';
  assert.equal(parseTaskNotification(minimal)!.status, "failed");
  assert.equal(notificationUsage(parseTaskNotification(minimal)!), "");
  assert.equal(notificationUsage({ ...parseTaskNotification(minimal)!, tokens: 0, durationMs: 0 }), "0 tokens · 0s");
});
