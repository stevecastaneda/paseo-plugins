import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSettingsStore } from "./settings.storage.ts";

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "time-since-settings-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("missing settings use defaults and persist across store instances", async () => {
  await withTempRoot(async (root) => {
    const first = createSettingsStore(root);
    assert.deepEqual(await first.get(), { showIcon: true, showAgo: false });
    assert.deepEqual(await first.update({ showAgo: true }), { showIcon: true, showAgo: true });
    assert.deepEqual(await createSettingsStore(root).get(), { showIcon: true, showAgo: true });
  });
});

test("concurrent partial updates preserve both fields", async () => {
  await withTempRoot(async (root) => {
    const store = createSettingsStore(root);
    await Promise.all([store.update({ showIcon: false }), store.update({ showAgo: true })]);
    assert.deepEqual(await createSettingsStore(root).get(), { showIcon: false, showAgo: true });
  });
});

test("malformed settings fail visibly and do not get replaced", async () => {
  await withTempRoot(async (root) => {
    const store = createSettingsStore(root);
    await store.update({ showAgo: true });
    await writeFile(store.filePath, "not json", "utf8");
    await assert.rejects(store.get(), /Invalid JSON in time-since settings/);
    assert.equal(await readFile(store.filePath, "utf8"), "not json");
  });
});

test("schema-invalid settings fail visibly", async () => {
  await withTempRoot(async (root) => {
    const store = createSettingsStore(root);
    await mkdir(join(root, "plugin-data", "time-since"), { recursive: true });
    await writeFile(store.filePath, JSON.stringify({ showIcon: "yes", showAgo: false }), "utf8");
    await assert.rejects(store.get(), /Invalid time-since settings/);
  });
});
