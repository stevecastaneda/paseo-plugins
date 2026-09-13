import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findLog, readPage, PAGE_BYTES } from "./files.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "raw-history-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("finds the exact Codex session including archived logs, ignoring newer unrelated files", async (t) => {
  const dir = await fixture(t);
  const archive = join(dir, "archived_sessions"); await mkdir(archive);
  const path = join(archive, "rollout-2026-09-13-session-123.jsonl");
  await writeFile(path, "correct");
  await writeFile(join(archive, "rollout-2026-09-14-other-session.jsonl"), "wrong");
  assert.equal(await findLog([join(dir, "sessions"), archive], "session-123", "codex"), path);
  await assert.rejects(findLog([archive], "../session-123", "codex"), /Invalid/);
});

test("finds Claude log in encoded project directories and rejects ambiguity", async (t) => {
  const dir = await fixture(t);
  await mkdir(join(dir, "project-one")); await mkdir(join(dir, "project-two"));
  const path = join(dir, "project-one", "session-123.jsonl"); await writeFile(path, "{}");
  assert.equal(await findLog([dir], "session-123", "claude"), path);
  await writeFile(join(dir, "project-two", "session-123.jsonl"), "{}");
  await assert.rejects(findLog([dir], "session-123", "claude"), /Multiple logs/);
});

test("does not follow symlinks or substitute a different session", async (t) => {
  const dir = await fixture(t); const other = await fixture(t);
  await writeFile(join(other, "session-123.jsonl"), "private");
  await symlink(other, join(dir, "project"));
  await assert.rejects(findLog([dir], "session-123", "claude"), /No raw log/);
});

test("reconstructs exact UTF-8 content without splitting JSONL records", async (t) => {
  const dir = await fixture(t); const path = join(dir, "log.jsonl");
  const original = JSON.stringify({ message: "x".repeat(PAGE_BYTES - 1) + "🐟" }) + "\r\n"
    + JSON.stringify({ message: "é中".repeat(PAGE_BYTES) }) + "\n";
  await writeFile(path, original);
  let offset = 0; let restored = ""; let source: string | undefined;
  do {
    const page = await readPage(path, offset, source);
    for (const line of page.text.trim().split("\n")) assert.doesNotThrow(() => JSON.parse(line));
    assert.ok(page.nextOffset > offset);
    restored += page.text; offset = page.nextOffset; source = page.source;
  } while (offset < Buffer.byteLength(original));
  assert.equal(restored, original);
});

test("limits oversized records and preserves incomplete final lines", async (t) => {
  const dir = await fixture(t); const path = join(dir, "log.jsonl");
  await writeFile(path, '{"partial":');
  assert.equal((await readPage(path, 0)).text, '{"partial":');
  await writeFile(path, "x".repeat(4 * 1024 * 1024));
  await assert.rejects(readPage(path, 0), /exceeds 4 MiB/);
});

test("supports append and empty logs; detects shortening and source replacement", async (t) => {
  const dir = await fixture(t); const path = join(dir, "log.jsonl");
  await writeFile(path, ""); const empty = await readPage(path, 0);
  assert.equal(empty.text, ""); assert.equal(empty.nextOffset, 0);
  await appendFile(path, "hello\n");
  const page = await readPage(path, 0, empty.source); assert.equal(page.text, "hello\n");
  await appendFile(path, "world\n");
  assert.equal((await readPage(path, page.nextOffset, page.source)).text, "world\n");
  await writeFile(path, "");
  await assert.rejects(readPage(path, page.nextOffset, page.source), /shortened/);
  await rename(path, join(dir, "old")); await writeFile(path, "new");
  await assert.rejects(readPage(path, 0, page.source), /source changed/);
});
