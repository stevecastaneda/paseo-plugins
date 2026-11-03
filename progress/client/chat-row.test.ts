// Progress draws its own chat row for a call to one of its tools. These drive
// the transformer Paseo runs on each tool call, and read the line the row draws.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function contributed() {
  const h = clientHarness(directory);
  const stop = h.load("index.client.tsx").default(h.client);
  const [transformer] = h.timelineTransformers;
  const { chatRowText } = h.load("client/chat-row.ts");
  const m = h.load("client/i18n.ts").messagesFor("en");
  return {
    h,
    stop,
    transformer,
    transform: (item: object, phase = "complete") => transformer.transform({ item: { type: "tool_call", callId: "c1", error: null, ...item }, phase }),
    // The row Paseo would draw: the renderer registered for the item, fed its data.
    drawn(result: { items: Array<{ kind: string; version: number; data: unknown }> }) {
      assert.equal(result.items.length, 1, "one call, one row");
      const [row] = result.items;
      const renderer = h.timelineRenderers.find((entry) => entry.kind === row.kind && entry.version === row.version);
      assert.ok(renderer, "a renderer is registered for the row");
      // Paseo copies the data through JSON, then checks it with the renderer's schema.
      const parsed = renderer.schema.safeParse(JSON.parse(JSON.stringify(row.data)));
      assert.ok(parsed.success, "Paseo's schema check accepts the row");
      return plain(chatRowText(parsed.data, m));
    },
  };
}

const claudeDone = (name: string, output: unknown) => ({ name, status: "completed", detail: { type: "unknown", input: { title: "x" }, output } });

test("a Progress call from Claude Code draws the first line of what the tool returned", () => {
  const { transformer, transform, drawn } = contributed();
  assert.deepEqual(plain(transformer.query), { itemType: "tool_call" });
  const added = transform(claudeDone("mcp__paseo__progress_ticket_add", { output: "Added T01: Write the spec for the full tool set (30m)" }));
  assert.deepEqual(drawn(added), { line: "Added T01: Write the spec for the full tool set (30m)", more: "Added T01: Write the spec for the full tool set (30m)" }, "a line that truncates on a phone still opens to its full text");
  const started = transform(claudeDone("mcp__paseo__progress_start", { output: "Started run: Progress agent tools\nQuestion mode: Stop, set by the user in Paseo's Settings." }));
  assert.deepEqual(drawn(started), {
    line: "Started run: Progress agent tools",
    more: "Started run: Progress agent tools\nQuestion mode: Stop, set by the user in Paseo's Settings.",
  }, "the row opens to the full output");
  assert.equal(drawn(transform(claudeDone("progress_finish", { output: "Finished run: Export" }))).line, "Finished run: Export", "an unprefixed name");
});

test("Show draws as reading the dashboard and opens to the dashboard text", () => {
  const { transform, drawn } = contributed();
  const text = "Worktree: /w\nQuestion mode: Stop\n\nExport\n0 of 1 tickets done";
  assert.deepEqual(drawn(transform(claudeDone("mcp__paseo__progress_show", { output: text }))), { line: "Read the dashboard", more: text });
});

test("a Progress call from Codex, named server.tool with the MCP result, draws the same row", () => {
  const { transform, drawn } = contributed();
  const result = { content: [{ type: "text", text: "Logged A3 on T02: Tests pass" }] };
  assert.equal(drawn(transform(claudeDone("paseo.progress_activity_add", result))).line, "Logged A3 on T02: Tests pass");
  const refused = { content: [{ type: "text", text: "No ticket T09.\nUsage: paseo-progress ticket update <id>" }], isError: true };
  const failure = transform(claudeDone("paseo.progress_ticket_update", refused));
  assert.equal(failure.items[0].data.state, "failed", "drawn in the error color");
  assert.deepEqual(drawn(failure), {
    line: "No ticket T09.",
    more: "No ticket T09.\nUsage: paseo-progress ticket update <id>",
  }, "a result Codex marks as an error draws as a failure");
});

test("a failed call carries the command's error, whichever way Claude Code stored it", () => {
  const { transform, drawn } = contributed();
  const error = 'Unknown status "in_progress". Statuses: not_started, working, blocked, done, skipped.\nUsage: paseo-progress ticket update <id>';
  const failed = (stored: unknown) => transform({ name: "mcp__paseo__progress_ticket_update", status: "failed", detail: { type: "unknown", input: {}, output: null }, error: stored });
  const expected = { line: 'Unknown status "in_progress". Statuses: not_started, working, blocked, done, skipped.', more: error };
  assert.deepEqual(plain(failed({ type: "tool_result", tool_use_id: "c1", content: error, is_error: true }).items[0].data), { tool: "progress_ticket_update", state: "failed", error });
  assert.deepEqual(drawn(failed({ type: "tool_result", content: error, is_error: true })), expected);
  assert.deepEqual(drawn(failed({ type: "tool_result", content: [{ type: "text", text: error }], is_error: true })), expected, "as text blocks");
  assert.deepEqual(drawn(failed({ message: "Tool call failed" })), { line: "Tool call failed", more: "Tool call failed" }, "Paseo's own failure message");
  assert.deepEqual(drawn(failed({ type: "tool_result", content: "", is_error: true })), { line: "Update ticket: failed", more: null }, "an empty error still says it failed");
});

test("a running call shows what the tool is doing; a canceled one says so", () => {
  const { transform, drawn } = contributed();
  const running = transform({ name: "mcp__paseo__progress_ticket_add", status: "running", detail: { type: "unknown", input: { title: "x" }, output: null } }, "streaming");
  assert.deepEqual(drawn(running), { line: "Adding ticket…", more: null });
  const canceled = transform({ name: "mcp__paseo__progress_question_ask", status: "canceled", detail: { type: "unknown", input: {}, output: null } });
  assert.deepEqual(drawn(canceled), { line: "Ask question: canceled", more: null });
  const empty = transform(claudeDone("mcp__paseo__paseo_progress", null));
  assert.deepEqual(drawn(empty), { line: "Record progress", more: null }, "a call that returned nothing names the tool");
});

test("other tool calls, and Progress calls it can't read, keep Paseo's own row", () => {
  const { transform } = contributed();
  for (const name of ["Bash", "mcp__paseo__list_agents", "mcp__paseo__progress_shows", "progress_show_all", "myprogress_show"]) {
    assert.equal(transform(claudeDone(name, { output: "Added T01: x" })), undefined, name);
  }
  const unreadable = [
    { name: "mcp__paseo__progress_show", status: "completed", detail: { type: "shell", command: "ls" } },
    { name: "mcp__paseo__progress_show", status: "completed", detail: null },
    { name: "mcp__paseo__progress_show", status: "completed", detail: { type: "unknown", input: {}, output: 42 } },
    { name: "mcp__paseo__progress_show", status: "completed", detail: { type: "unknown", input: {}, output: { output: { tickets: [] } } } },
    { name: "mcp__paseo__progress_show", status: "completed", detail: { type: "unknown", input: {}, output: { content: [{ type: "image", data: "…" }] } } },
    { name: "mcp__paseo__progress_ticket_add", status: "failed", detail: { type: "unknown", input: {}, output: null }, error: { code: 7 } },
  ];
  for (const item of unreadable) assert.equal(transform(item), undefined, JSON.stringify(item));
});

test("the same call always gives the same row, and stopping removes both registrations", () => {
  const { h, stop, transform } = contributed();
  const item = claudeDone("mcp__paseo__progress_deliverable_add", { output: "Added D1: Screenshot" });
  assert.deepEqual(plain(transform(item)), plain(transform(item)));
  stop();
  assert.ok(h.timelineTransformers.every((entry) => entry.removed) && h.timelineRenderers.every((entry) => entry.removed));
});
