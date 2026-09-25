import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listLastRepliesHandler, recordLastReplies } from "./last-reply.ts";
import { createLastReplyStore } from "./last-reply.storage.ts";

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "time-since-last-reply-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("recorded turn ends persist across store instances and archived agents are forgotten", async () => {
  await withTempRoot(async (root) => {
    const store = createLastReplyStore(root);
    assert.deepEqual(await store.list(), {});
    await Promise.all([
      store.record("a", "2026-09-25T12:00:00.000Z"),
      store.record("b", "2026-09-25T12:05:00.000Z"),
    ]);
    await store.record("a", "2026-09-25T12:10:00.000Z");
    await store.forget("b");
    await store.forget("missing");
    assert.deepEqual(await createLastReplyStore(root).list(), { a: "2026-09-25T12:10:00.000Z" });
  });
});

test("an unreadable ledger starts over instead of blocking new turns", async () => {
  await withTempRoot(async (root) => {
    const store = createLastReplyStore(root);
    await mkdir(join(root, "plugin-data", "time-since"), { recursive: true });
    await writeFile(store.filePath, "not json", "utf8");
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await store.list(), {});
      await store.record("a", "2026-09-25T12:00:00.000Z");
    } finally {
      console.error = originalError;
    }
    assert.deepEqual(JSON.parse(await readFile(store.filePath, "utf8")), { a: "2026-09-25T12:00:00.000Z" });
  });
});

test("turn ends and archives from the daemon update the ledger the client reads", async () => {
  await withTempRoot(async (root) => {
    const store = createLastReplyStore(root);
    const handlers = new Map<string, (event: { agent: { id: string } }) => void>();
    const stopped: string[] = [];
    const server = {
      on(name: string, handler: (event: { agent: { id: string } }) => void) {
        handlers.set(name, handler);
        return () => stopped.push(name);
      },
    };
    const stop = recordLastReplies(server as never, store);
    const before = Date.now();
    handlers.get("agent.turn_ended")!({ agent: { id: "a" } });
    handlers.get("agent.turn_ended")!({ agent: { id: "b" } });
    handlers.get("agent.archived")!({ agent: { id: "b" } });
    const { lastReplyAt } = await listLastRepliesHandler(store)({}, {} as never);
    assert.deepEqual(Object.keys(lastReplyAt), ["a"]);
    assert.ok(Date.parse(lastReplyAt.a) >= before);
    stop();
    assert.deepEqual(stopped.sort(), ["agent.archived", "agent.turn_ended"]);
  });
});
