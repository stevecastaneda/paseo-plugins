import { test } from "node:test";
import assert from "node:assert/strict";
import { pageOpenCodeExport, readOpenCodeHistory } from "./opencode.ts";

const sessionId = "ses_test";
const message = (text: string) => ({ info: { id: "msg_one", role: "user", sessionID: sessionId }, parts: [{ type: "text", text }] });
const exported = (messages: unknown[]) => JSON.stringify({ info: { id: sessionId, time: { updated: 1 } }, messages });

test("paginates exports on whole records with byte-correct Unicode offsets", () => {
  const messages = [message("🐉".repeat(20_000)), message("next")];
  const json = exported(messages);
  const first = pageOpenCodeExport(json, sessionId, 0);
  assert.ok(first.nextOffset < first.totalBytes);
  const second = pageOpenCodeExport(json, sessionId, first.nextOffset, first.source);
  assert.equal(second.nextOffset, second.totalBytes);
  assert.deepEqual((first.text + second.text).trim().split("\n").map(JSON.parse as (text: string) => unknown).slice(1), messages);
  assert.equal(first.modifiedAt, new Date(1).toISOString());
  assert.equal(pageOpenCodeExport(json, sessionId, second.nextOffset, second.source).text, "");
});

test("rejects changed exports and offsets within records", () => {
  const first = pageOpenCodeExport(exported([message("before")]), sessionId, 0);
  assert.throws(() => pageOpenCodeExport(exported([message("after")]), sessionId, 0, first.source), /changed/);
  for (const offset of [-1, 1, 100_000, NaN]) assert.throws(() => pageOpenCodeExport(exported([]), sessionId, offset), /offset/);
});

test("validates session identity, shape, IDs, and entry limits", async () => {
  assert.throws(() => pageOpenCodeExport("", sessionId, 0), /invalid session export/);
  assert.throws(() => pageOpenCodeExport(exported([]), "ses_other", 0), /invalid session export/);
  assert.throws(() => pageOpenCodeExport(exported([{}]), sessionId, 0), /invalid session export/);
  assert.throws(() => pageOpenCodeExport(exported([message("x".repeat(4 * 1024 * 1024))]), sessionId, 0), /exceeds 4 MiB/);
  await assert.rejects(readOpenCodeHistory("--help", 0), /Invalid OpenCode session ID/);
});
