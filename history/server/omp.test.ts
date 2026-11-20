import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGE_BYTES } from "./files.ts";
import { readOmpHistory } from "./omp.ts";

const SESSION = "01a1f843-5390-756c-887f-323831f64368";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "history-omp-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// OMP's layout: a padded title slot, the session header, then entries.
function log(sessionId: string, messages: string[]) {
  return [
    { type: "title", v: 1, title: "", updatedAt: "2026-11-20T09:22:04.304Z", pad: " ".repeat(160) },
    { type: "session", version: 3, id: sessionId, timestamp: "2026-11-20T09:22:04.304Z", cwd: "/repo" },
    ...messages.map((text, index) => ({
      type: "message",
      id: `m${index}`,
      parentId: null,
      timestamp: "2026-11-20T09:22:05.000Z",
      message: { role: "user", content: [{ type: "text", text }], attribution: "user", timestamp: 1 },
    })),
  ]
    .map((entry) => JSON.stringify(entry) + "\n")
    .join("");
}

test("reads the recorded session file by its header, whatever the file is named, across pages", async (t) => {
  const dir = await fixture(t);
  // Nested subagent transcripts are named after the task, not the session ID.
  await mkdir(join(dir, "parent"));
  const path = join(dir, "parent", "Reviewer.jsonl");
  const original = log(SESSION, ["🐉".repeat(PAGE_BYTES / 2), "next"]);
  await writeFile(path, original);
  let restored = "";
  let offset = 0;
  let source: string | undefined;
  do {
    const page = await readOmpHistory({ sessionId: SESSION, nativeHandle: path }, offset, source);
    assert.equal(page.path, path);
    restored += page.text;
    offset = page.nextOffset;
    source = page.source;
  } while (offset < Buffer.byteLength(original));
  assert.equal(restored, original);
});

test("reads a chat imported before Paseo 0.16, which recorded the path as its session ID", async (t) => {
  const path = join(await fixture(t), "session.jsonl");
  await writeFile(path, log(SESSION, ["hello"]));
  assert.equal((await readOmpHistory({ sessionId: path, nativeHandle: path }, 0)).text, log(SESSION, ["hello"]));
});

test("never shows a file that isn't this chat's OMP session", async (t) => {
  const dir = await fixture(t);
  const path = join(dir, "session.jsonl");
  await writeFile(path, log("another-session", ["private"]));
  await assert.rejects(readOmpHistory({ sessionId: SESSION, nativeHandle: path }, 0), /different OMP session/);
  // Without a separate ID to compare, a log still needs OMP's session header.
  await writeFile(path, '{"type":"user","message":{"role":"user","content":"private"}}\n');
  await assert.rejects(readOmpHistory({ sessionId: path, nativeHandle: path }, 0), /not an OMP session log/);
  await writeFile(path, "");
  await assert.rejects(readOmpHistory({ sessionId: SESSION, nativeHandle: path }, 0), /no saved session yet/);
  await assert.rejects(readOmpHistory({ sessionId: SESSION, nativeHandle: join(dir, "missing.jsonl") }, 0), /No raw log found/);
  await assert.rejects(readOmpHistory({ sessionId: SESSION, nativeHandle: "session.jsonl" }, 0), /can't find its log/);
  await assert.rejects(readOmpHistory({ sessionId: SESSION, nativeHandle: dir }, 0), /not a regular file/);
  await assert.rejects(readOmpHistory({ sessionId: SESSION }, 0), /no saved session yet/);
  await assert.rejects(readOmpHistory(null, 0), /no saved session yet/);
});

test("checks the header on every page, so a file rewritten in place to another session stops paging", async (t) => {
  const path = join(await fixture(t), "session.jsonl");
  await writeFile(path, log(SESSION, ["x".repeat(PAGE_BYTES), "more"]));
  const first = await readOmpHistory({ sessionId: SESSION, nativeHandle: path }, 0);
  assert.ok(first.nextOffset < first.totalBytes);
  await writeFile(path, log("another-session", ["x".repeat(PAGE_BYTES), "private"]));
  await assert.rejects(readOmpHistory({ sessionId: SESSION, nativeHandle: path }, first.nextOffset, first.source), /different OMP session/);
});

test("refuses a pipe instead of waiting for a writer", { skip: process.platform === "win32" }, async (t) => {
  const path = join(await fixture(t), "session.jsonl");
  execFileSync("mkfifo", [path]);
  await assert.rejects(readOmpHistory({ sessionId: SESSION, nativeHandle: path }, 0), /not a regular file/);
});
